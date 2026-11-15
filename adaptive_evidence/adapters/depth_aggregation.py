"""SoilGrids v2.0 six-depth horizon resolver and physically sound depth aggregator.

Supports all six native SoilGrids v2.0 depth layers:
  0-5cm, 5-15cm, 15-30cm, 30-60cm, 60-100cm, 100-200cm.

Prevents topsoil (0-5cm) substitution for deeper intervals, preserves per-layer
native observations, performs thickness-weighted aggregation strictly on intensive
physical/chemical concentrations/densities, abstains from naive linear averaging of
non-additive logarithmic pH across heterogeneous horizons, and labels multi-layer
combined quantiles explicitly as uncalibrated scenario sensitivity bounds.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..schema import STANDARD_SOILGRIDS_DEPTHS_CM

DEPTH_LABELS_BY_BOUNDS: Dict[Tuple[int, int], str] = {
    (0, 5): "0-5cm",
    (5, 15): "5-15cm",
    (15, 30): "15-30cm",
    (30, 60): "30-60cm",
    (60, 100): "60-100cm",
    (100, 200): "100-200cm",
}

ALL_SOILGRIDS_DEPTH_LABELS: Tuple[str, ...] = tuple(
    DEPTH_LABELS_BY_BOUNDS[b] for b in STANDARD_SOILGRIDS_DEPTHS_CM
)

INTENSIVE_LINEAR_AGGREGATION_PROPS = frozenset(
    {"clay", "silt", "sand", "bdod", "cfvo", "soc", "nitrogen"}
)
NON_LINEAR_ABSTAIN_MULTI_DEPTH_PROPS = frozenset({"phh2o"})


def depth_label_for_bounds(top_cm: float, bot_cm: float) -> Optional[str]:
    if float(top_cm).is_integer() and float(bot_cm).is_integer():
        return DEPTH_LABELS_BY_BOUNDS.get((int(top_cm), int(bot_cm)))
    return None


def resolve_overlapping_soilgrids_depths(top_cm: float, bot_cm: float) -> Dict[str, Any]:
    """Resolve an arbitrary depth interval [top_cm, bot_cm] onto native SoilGrids layers."""
    if not (math.isfinite(top_cm) and math.isfinite(bot_cm)):
        return {
            "valid": False,
            "missing_reason": "depth_inconsistency",
            "detail": f"Depth bounds must be finite numbers, got [{top_cm}, {bot_cm}].",
        }
    if top_cm < 0.0 or bot_cm <= top_cm:
        return {
            "valid": False,
            "missing_reason": "depth_inconsistency",
            "detail": f"Invalid soil depth interval [{top_cm}, {bot_cm}] cm (require 0 <= top < bottom).",
        }
    if bot_cm > 200.0:
        return {
            "valid": False,
            "missing_reason": "depth_interval_unavailable",
            "detail": (
                f"Requested depth interval [{top_cm}, {bot_cm}] cm exceeds ISRIC SoilGrids v2.0 "
                "maximum modeled profile depth of 200 cm; deeper subsoil is not extrapolated."
            ),
        }

    total_thickness = float(bot_cm - top_cm)
    overlaps: List[Dict[str, Any]] = []
    for l_top, l_bot in STANDARD_SOILGRIDS_DEPTHS_CM:
        ov_top = max(float(top_cm), float(l_top))
        ov_bot = min(float(bot_cm), float(l_bot))
        if ov_bot > ov_top:
            ov_len = ov_bot - ov_top
            overlaps.append(
                {
                    "depth_label": DEPTH_LABELS_BY_BOUNDS[(l_top, l_bot)],
                    "bounds_cm": [float(l_top), float(l_bot)],
                    "overlap_bounds_cm": [round(ov_top, 4), round(ov_bot, 4)],
                    "overlap_cm": round(ov_len, 4),
                    "weight": ov_len / total_thickness,
                }
            )

    if not overlaps:
        return {
            "valid": False,
            "missing_reason": "depth_interval_unavailable",
            "detail": f"Requested depth interval [{top_cm}, {bot_cm}] cm does not intersect SoilGrids layers.",
        }

    weight_sum = sum(o["weight"] for o in overlaps)
    if abs(weight_sum - 1.0) > 1e-6:
        return {
            "valid": False,
            "missing_reason": "depth_inconsistency",
            "detail": f"Depth overlap weights sum to {weight_sum:.6f} != 1.0 for [{top_cm}, {bot_cm}] cm.",
        }

    exact_native = len(overlaps) == 1 and abs(overlaps[0]["bounds_cm"][0] - top_cm) < 1e-6 and abs(overlaps[0]["bounds_cm"][1] - bot_cm) < 1e-6
    return {
        "valid": True,
        "requested_interval_cm": [float(top_cm), float(bot_cm)],
        "exact_native_layer": overlaps[0]["depth_label"] if exact_native else None,
        "overlaps": overlaps,
        "missing_reason": None,
    }


def aggregate_soilgrids_property_layers(
    prop: str,
    overlaps: Sequence[Dict[str, Any]],
    layer_prop_si_by_label: Dict[str, Dict[str, Optional[float]]],
    *,
    unit: str,
) -> Dict[str, Any]:
    """Aggregate SoilGrids property across intersecting native layers without silent substitution."""
    missing_layers = [o["depth_label"] for o in overlaps if o["depth_label"] not in layer_prop_si_by_label]
    if missing_layers:
        return {
            "available": False,
            "missing_reason": "depth_interval_unavailable",
            "detail": f"Missing required SoilGrids layers for '{prop}': {missing_layers}.",
            "unit": unit,
        }

    per_layer_records: List[Dict[str, Any]] = []
    for o in overlaps:
        lbl = o["depth_label"]
        entry = layer_prop_si_by_label[lbl]
        mean_v = entry.get("mean")
        if mean_v is None or not math.isfinite(float(mean_v)):
            return {
                "available": False,
                "missing_reason": "nodata",
                "detail": f"SoilGrids layer '{lbl}' lacks finite mean for '{prop}'.",
                "unit": unit,
            }
        per_layer_records.append(
            {
                "depth_label": lbl,
                "weight": round(float(o["weight"]), 6),
                "mean": float(entry["mean"]),
                "q05": float(entry["q05"]) if entry.get("q05") is not None else None,
                "q50": float(entry["q50"]) if entry.get("q50") is not None else None,
                "q95": float(entry["q95"]) if entry.get("q95") is not None else None,
            }
        )

    if len(overlaps) == 1:
        single = per_layer_records[0]
        return {
            "available": True,
            "aggregation_mode": "NATIVE_SINGLE_LAYER",
            "quantile_basis": "SOILGRIDS_NATIVE_LAYER_PREDICTIVE_QUANTILES",
            "mean": round(single["mean"], 4),
            "q05": round(single["q05"], 4) if single["q05"] is not None else None,
            "q50": round(single["q50"], 4) if single["q50"] is not None else None,
            "q95": round(single["q95"], 4) if single["q95"] is not None else None,
            "unit": unit,
            "contributing_layers": per_layer_records,
            "abstained_scalar": False,
            "quality_flags": [],
        }

    if prop in NON_LINEAR_ABSTAIN_MULTI_DEPTH_PROPS:
        # Soil pH is logarithmic (-log10 a_H+) and buffered unevenly by carbonate/CEC across horizons.
        # Do not claim a naive linear thickness-weighted average as a calibrated horizon pH.
        means = [r["mean"] for r in per_layer_records]
        q05s = [r["q05"] for r in per_layer_records if r["q05"] is not None]
        q95s = [r["q95"] for r in per_layer_records if r["q95"] is not None]
        h_conc_mean = sum(r["weight"] * (10.0 ** (-r["mean"])) for r in per_layer_records)
        h_equiv_ph = round(-math.log10(max(h_conc_mean, 1e-14)), 3)
        return {
            "available": False,
            "missing_reason": "not_identifiable",
            "aggregation_mode": "ABSTAINED_NON_LINEAR_PH_MULTI_LAYER",
            "quantile_basis": "PER_LAYER_MIN_MAX_RANGE_ONLY",
            "mean": None,
            "q05": round(min(q05s), 4) if q05s else None,
            "q50": None,
            "q95": round(max(q95s), 4) if q95s else None,
            "layer_mean_min": round(min(means), 4),
            "layer_mean_max": round(max(means), 4),
            "unbuffered_h_activity_equiv_ph_diagnostic": h_equiv_ph,
            "unit": unit,
            "contributing_layers": per_layer_records,
            "abstained_scalar": True,
            "detail": (
                "Abstained from scalar linear thickness-averaging of soil pH (phh2o) across multiple "
                "horizons because pH is logarithmic and horizon buffering capacity (CEC/carbonates) is unknown; "
                "native per-layer values and min/max range are preserved."
            ),
            "quality_flags": ["NON_LINEAR_PH_MULTI_HORIZON_ABSTAINED", "NATIVE_LAYERS_PRESERVED"],
        }

    if prop not in INTENSIVE_LINEAR_AGGREGATION_PROPS:
        return {
            "available": False,
            "missing_reason": "not_identifiable",
            "detail": f"Property '{prop}' does not have an approved multi-depth aggregation rule.",
            "unit": unit,
        }

    def _wmean(key: str) -> Optional[float]:
        vals = [r[key] for r in per_layer_records]
        if any(v is None for v in vals):
            return None
        return round(sum(float(r["weight"]) * float(r[key]) for r in per_layer_records), 4)

    return {
        "available": True,
        "aggregation_mode": "THICKNESS_WEIGHTED_INTENSIVE_MEAN",
        "quantile_basis": "THICKNESS_WEIGHTED_SCENARIO_BOUNDS_NOT_CALIBRATED_90PCT_PI",
        "mean": _wmean("mean"),
        "q05": _wmean("q05"),
        "q50": _wmean("q50"),
        "q95": _wmean("q95"),
        "unit": unit,
        "contributing_layers": per_layer_records,
        "abstained_scalar": False,
        "quality_flags": [
            "MULTI_DEPTH_THICKNESS_WEIGHTED",
            "AGGREGATED_QUANTILES_ARE_SCENARIO_BOUNDS_NOT_90PCT_PI",
        ],
    }


__all__ = [
    "ALL_SOILGRIDS_DEPTH_LABELS",
    "DEPTH_LABELS_BY_BOUNDS",
    "aggregate_soilgrids_property_layers",
    "depth_label_for_bounds",
    "resolve_overlapping_soilgrids_depths",
]
