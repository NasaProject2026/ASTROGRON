"""Versioned Evidence Quality Gate and Quality Assessment sidecar (`astragron.quality-gate.v1`).

Evaluates and enforces claim admissibility across location, spatial pixel support,
depth physical basis, temporal cutoff / time-standard / staleness, units & sentinel vs
legitimate zero semantics, provenance / evidence levels / user measurement metadata,
and cross-source disagreement before downstream screening or planner routing.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .receipt_proof import verify_authentic_evidence_proof
from .schema import infer_evidence_level, validate_coordinates_and_crs

QUALITY_GATE_SCHEMA = "astragron.quality-gate.v1"
QUALITY_GATE_VERSION = "1.0.0"

QUALITY_VERDICTS = (
    "ACCEPTED_FOR_CLAIM",
    "ACCEPTED_CONDITIONALLY",
    "DEGRADED_TO_DESCRIPTION",
    "REJECTED",
    "UNDETERMINED",
)

RANKED_EVIDENCE_PRIORITY = {
    "AUTHENTIC_LIVE": 1,
    "AUTHENTIC_VERIFIED_CACHE": 2,
    "VERIFIED_OPEN_SOURCE_MAP_ESTIMATE": 3,
    "USER_DECLARED_SCENARIO": 4,
    "SCIENTIFIC_DERIVATION": 5,
    "SYNTHETIC_TEST_FIXTURE": 6,
    "UNAVAILABLE": 99,
}

_ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_ISO_DATETIME_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))?$"
)
_SHA256_HEX_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_PLACEHOLDER_METHOD_TEXTS = {
    "unknown",
    "n/a",
    "na",
    "none",
    "null",
    "tbd",
    "unspecified",
    "todo",
}


def _parse_iso_temporal(value: Any) -> Optional[Dict[str, Any]]:
    """Strictly parse an ISO-8601 YYYY-MM-DD date or full ISO datetime with valid calendar & offset."""
    if isinstance(value, datetime):
        dt = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        dt_utc = dt.astimezone(timezone.utc)
        d = dt_utc.date()
        if not (1900 <= d.year <= 2100):
            return None
        return {"is_datetime": True, "date": d, "dt_utc": dt_utc, "iso": dt_utc.isoformat()}
    if isinstance(value, date):
        if not (1900 <= value.year <= 2100):
            return None
        dt_utc = datetime(value.year, value.month, value.day, 0, 0, 0, tzinfo=timezone.utc)
        return {"is_datetime": False, "date": value, "dt_utc": dt_utc, "iso": value.isoformat()}
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    m_date = _ISO_DATE_RE.match(s)
    if m_date:
        try:
            d = date.fromisoformat(s)
        except ValueError:
            return None
        if not (1900 <= d.year <= 2100):
            return None
        dt_utc = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=timezone.utc)
        return {"is_datetime": False, "date": d, "dt_utc": dt_utc, "iso": d.isoformat()}
    m_dt = _ISO_DATETIME_RE.match(s)
    if m_dt:
        tz_part = m_dt.group(7)
        if tz_part and tz_part != "Z":
            sign = m_dt.group(8)
            off_h = int(m_dt.group(9))
            off_m = int(m_dt.group(10))
            if off_m > 59:
                return None
            if sign == "+" and (off_h > 14 or (off_h == 14 and off_m > 0)):
                return None
            if sign == "-" and (off_h > 12 or (off_h == 12 and off_m > 0)):
                return None
        norm = s[:-1] + "+00:00" if s.endswith("Z") else s
        try:
            dt = datetime.fromisoformat(norm)
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt_utc = dt.astimezone(timezone.utc)
        d = dt_utc.date()
        if not (1900 <= d.year <= 2100):
            return None
        return {"is_datetime": True, "date": d, "dt_utc": dt_utc, "iso": dt_utc.isoformat()}
    return None


def _is_non_empty_text(value: Any) -> bool:
    """Return True only when value is a meaningful, non-whitespace, non-placeholder string."""
    if not isinstance(value, str):
        return False
    s = value.strip()
    if len(s) < 2 or not any(ch.isalnum() for ch in s):
        return False
    return s.lower() not in _PLACEHOLDER_METHOD_TEXTS


def _is_valid_depth_spec(user_meas: Dict[str, Any]) -> bool:
    """Validate depth_interval_cm ([top, bottom] finite cm) and optional root_depth_m."""
    has_any = False
    interval = user_meas.get("depth_interval_cm")
    if interval is not None:
        if not isinstance(interval, (list, tuple)) or len(interval) != 2:
            return False
        top, bot = interval[0], interval[1]
        if (
            isinstance(top, bool)
            or isinstance(bot, bool)
            or not isinstance(top, (int, float))
            or not isinstance(bot, (int, float))
            or not math.isfinite(float(top))
            or not math.isfinite(float(bot))
            or float(top) < 0.0
            or float(bot) <= float(top)
            or float(bot) > 500.0
        ):
            return False
        has_any = True
    root_d = user_meas.get("root_depth_m")
    if root_d is not None:
        if (
            isinstance(root_d, bool)
            or not isinstance(root_d, (int, float))
            or not math.isfinite(float(root_d))
            or not (0.0 < float(root_d) <= 5.0)
        ):
            return False
        has_any = True
    return has_any


def validate_user_measurement_metadata(
    user_meas: Dict[str, Any],
    *,
    as_of_iso: Optional[str] = None,
) -> Dict[str, Any]:
    """Return strict ISO-8601 date, method, and depth validity flags for user-supplied measurements."""
    if not isinstance(user_meas, dict):
        return {
            "has_date": False,
            "has_method": False,
            "has_depth": False,
            "verified": False,
            "parsed_date_iso": None,
            "date_error": "invalid_user_measurements_container",
            "provenance_class": "USER_SCENARIO_ASSUMPTION",
            "evidence_level": "USER_DECLARED_SCENARIO",
            "independent_lab_authenticity_verified": False,
        }

    ref_now = datetime.now(timezone.utc)
    if as_of_iso is not None:
        ref_parsed = _parse_iso_temporal(as_of_iso)
        if ref_parsed is None:
            ref_date = ref_now.date()
            ref_dt = ref_now
            as_of_error: Optional[str] = "invalid_as_of_date"
        else:
            as_of_error = None
            ref_date = ref_parsed["date"]
            ref_dt = (
                ref_parsed["dt_utc"]
                if ref_parsed["is_datetime"]
                else datetime(ref_date.year, ref_date.month, ref_date.day, 23, 59, 59, 999999, tzinfo=timezone.utc)
            )
    else:
        as_of_error = None
        ref_date = ref_now.date()
        ref_dt = ref_now

    date_error: Optional[str] = as_of_error
    parsed_dates: Dict[str, Dict[str, Any]] = {}
    date_keys = ("measured_at", "sampled_at", "date", "available_at")
    provided_dates = [(k, user_meas.get(k)) for k in date_keys if user_meas.get(k) is not None]
    if not provided_dates:
        date_error = date_error or "missing_measurement_date"
        has_date = False
    elif as_of_error is not None:
        has_date = False
    else:
        has_date = True
        for k, raw_val in provided_dates:
            p = _parse_iso_temporal(raw_val)
            if p is None:
                has_date = False
                date_error = f"invalid_iso_date:{k}"
                break
            is_future = (p["dt_utc"] > ref_dt) if p["is_datetime"] else (p["date"] > ref_date)
            if is_future:
                has_date = False
                date_error = f"future_date_rejected:{k}"
                break
            parsed_dates[k] = p
        if has_date and "available_at" in parsed_dates:
            avail_p = parsed_dates["available_at"]
            for sample_k in ("sampled_at", "measured_at"):
                if sample_k in parsed_dates:
                    sp = parsed_dates[sample_k]
                    impossible = (
                        sp["dt_utc"] > avail_p["dt_utc"]
                        if (sp["is_datetime"] and avail_p["is_datetime"])
                        else sp["date"] > avail_p["date"]
                    )
                    if impossible:
                        has_date = False
                        date_error = f"logically_impossible_date:{sample_k}_after_available_at"
                        break

    parsed_date_iso: Optional[str] = None
    for k in date_keys:
        if k in parsed_dates:
            parsed_date_iso = parsed_dates[k]["dt_utc"].isoformat()
            break

    method_keys = ("method", "lab_method", "analysis_method")
    provided_methods = [(k, user_meas.get(k)) for k in method_keys if user_meas.get(k) is not None]
    has_method = bool(provided_methods) and all(_is_non_empty_text(v) for _, v in provided_methods)
    has_depth = _is_valid_depth_spec(user_meas)
    return {
        "has_date": has_date,
        "has_method": has_method,
        "has_depth": has_depth,
        "verified": bool(has_date and has_method and has_depth),
        "parsed_date_iso": parsed_date_iso,
        "date_error": date_error,
        "provenance_class": "USER_SCENARIO_ASSUMPTION",
        "evidence_level": "USER_DECLARED_SCENARIO",
        "independent_lab_authenticity_verified": False,
    }


def _check_user_measured_metadata(
    user_meas: Dict[str, Any],
    *,
    as_of_iso: Optional[str] = None,
) -> Dict[str, Any]:
    """Enforce rule: user 'measured' inputs without valid date+method(+depth) degrade to USER_DECLARED_SCENARIO."""
    if not isinstance(user_meas, dict) or not user_meas:
        return {"has_measured_claims": False, "verified": False, "downgraded_to_scenario": False, "issues": []}

    soil_claims = any(
        user_meas.get(k) is not None
        for k in ("theta_fc", "theta_wp", "mineral_n_kg_ha", "soil_lab_measured", "field_measured_soil")
    )
    econ_claims = isinstance(user_meas.get("economics"), dict) and bool(user_meas.get("economics"))
    general_claims = bool(user_meas.get("field_measured") or user_meas.get("claimed_measured"))

    if not (soil_claims or econ_claims or general_claims):
        return {"has_measured_claims": False, "verified": False, "downgraded_to_scenario": False, "issues": []}

    issues: List[Dict[str, str]] = []
    if soil_claims or general_claims:
        meta_flags = validate_user_measurement_metadata(user_meas, as_of_iso=as_of_iso)
        has_date = meta_flags["has_date"]
        has_method = meta_flags["has_method"]
        has_depth = meta_flags["has_depth"]
        if not (has_date and has_method and (not soil_claims or has_depth)):
            missing_parts = []
            if not has_date:
                d_err = meta_flags.get("date_error") or "invalid_or_missing_date"
                missing_parts.append(f"valid non-future ISO-8601 date ({d_err})")
            if not has_method:
                missing_parts.append("measurement method")
            if soil_claims and not has_depth:
                missing_parts.append("depth_interval_cm")
            issues.append(
                {
                    "code": "UNVERIFIED_MEASUREMENT_METADATA",
                    "detail": (
                        f"User-supplied measured claim lacks {', '.join(missing_parts)}; "
                        "classified as USER_DECLARED_SCENARIO (never promoted to calibrated measurement)."
                    ),
                }
            )
            return {
                "has_measured_claims": True,
                "verified": False,
                "downgraded_to_scenario": True,
                "effective_evidence_level": "USER_DECLARED_SCENARIO",
                "issues": issues,
            }

    return {
        "has_measured_claims": True,
        "verified": True,
        "downgraded_to_scenario": False,
        "effective_evidence_level": "USER_DECLARED_SCENARIO",
        "issues": issues,
    }


def rank_single_next_missing_input(
    capabilities: Dict[str, Dict[str, Any]],
    *,
    water_supply: Optional[Dict[str, Any]] = None,
    user_meas: Optional[Dict[str, Any]] = None,
    sensitivity_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Identify and rank the SINGLE highest-value missing farmer input.

    Ranking strictly obeys:
      1. Blocking prerequisite dependencies first (location/land -> historical climate -> root-zone soil/hydraulics -> water supply -> mineral N/pH lab -> official legal permits).
      2. Physical screening sensitivity impact next (without ever fabricating economic USD VOI).
    """
    ws = water_supply or {}
    um = user_meas or {}
    ordered: List[Dict[str, Any]] = []

    c1 = capabilities.get("C1") or {}
    c2 = capabilities.get("C2") or {}
    c3 = capabilities.get("C3") or {}
    c4 = capabilities.get("C4") or {}
    c6 = capabilities.get("C6") or {}
    c7 = capabilities.get("C7") or {}
    c10 = capabilities.get("C10") or {}

    if c1.get("status") != "READY":
        ordered.append(
            {
                "rank": 1,
                "input_key": "location.point_lon_lat_and_geometry",
                "human_label": "Verified agricultural field coordinate or polygon boundary (EPSG:4326)",
                "priority_tier": "BLOCKING_DEPENDENCY",
                "blocks_capabilities": ["C1", "C3", "C4", "C6", "C7"],
                "why_needed": str(c1.get("detail") or "Location must fall on verified terrestrial non-polar agricultural land."),
                "how_farmer_provides": "Supply WGS84 field coordinates [lon, lat] inside farmland boundaries.",
            }
        )

    if c2.get("status") == "BLOCKED":
        ordered.append(
            {
                "rank": len(ordered) + 1,
                "input_key": "climate.historical_daily_series",
                "human_label": "Historical daily weather record (at least 1 full year of rain and min/max/mean temperature)",
                "priority_tier": "BLOCKING_DEPENDENCY",
                "blocks_capabilities": ["C2", "C6", "C7"],
                "why_needed": str(c2.get("detail") or "Required to compute regional water demand (ET0) and rainfall variability."),
                "how_farmer_provides": "Enable NASA POWER historical lookup (`LIVE_ALLOWED`) or upload station rain/temperature records with date & method.",
            }
        )
    elif isinstance(c2.get("diagnostics"), dict) and c2["diagnostics"].get("is_sub_annual_window"):
        ordered.append(
            {
                "rank": len(ordered) + 1,
                "input_key": "climate.full_annual_historical_period",
                "human_label": "Multi-year historical weather window (at least 12 months)",
                "priority_tier": "BLOCKING_DEPENDENCY",
                "blocks_capabilities": ["C6", "C7"],
                "why_needed": "Sub-annual climate windows describe only those specific months and cannot evaluate seasonal crop water sufficiency.",
                "how_farmer_provides": "Specify a multi-year historical window (e.g., 5 years) for regional screening.",
            }
        )

    if c3.get("status") == "BLOCKED" or c4.get("status") == "BLOCKED":
        ordered.append(
            {
                "rank": len(ordered) + 1,
                "input_key": "soil.laboratory_texture_and_organic_carbon",
                "human_label": "Measured topsoil & subsoil texture (clay/sand/silt %) and organic carbon by depth",
                "priority_tier": "BLOCKING_DEPENDENCY",
                "blocks_capabilities": ["C3", "C4", "C6", "C7"],
                "why_needed": str(c3.get("detail") or c4.get("detail") or "Root-zone water-holding capacity cannot be bounded without soil texture and depth support."),
                "how_farmer_provides": "Enable SoilGrids retrieval (`LIVE_ALLOWED`) or provide a dated lab soil analysis specifying sampling depth and analytical method.",
            }
        )

    if (c6.get("status") in ("READY", "CONDITIONAL") or not ws.get("regime")) and c7.get("status") == "BLOCKED" and c7.get("missing_reason") == "insufficient_parameters":
        ordered.append(
            {
                "rank": len(ordered) + 1,
                "input_key": "water_supply_scenario.regime_and_volume",
                "human_label": "Irrigation water availability regime (rainfed vs. supplemental irrigation volume m3/ha)",
                "priority_tier": "BLOCKING_DEPENDENCY",
                "blocks_capabilities": ["C7"],
                "why_needed": "Crop water suitability depends on whether crops are rainfed or have guaranteed supplemental irrigation.",
                "how_farmer_provides": "Declare `water_supply_scenario.regime` ('rainfed' or 'irrigated') and available m3/ha.",
            }
        )

    # Non-blocking physical improvements ranked by sensitivity / critical decision gaps
    sens_items: List[Tuple[float, str, str, str, str]] = []
    if um.get("theta_fc") is None or um.get("theta_wp") is None:
        awc_score = 0.70
        if isinstance(sensitivity_result, dict):
            for p_rank in sensitivity_result.get("parameter_influence_ranking") or []:
                if "soil" in str(p_rank.get("parameter", "")).lower():
                    awc_score = max(awc_score, float(p_rank.get("spread_metric") or 0.75))
        sens_items.append(
            (
                awc_score,
                "soil.measured_field_retention_fc_wp",
                "On-farm measured field capacity (theta_fc), wilting point (theta_wp), and root depth",
                "Replaces modeled pedotransfer soil-water uncertainty bounds with field-specific retention values.",
                "Supply dated pressure-plate or sensor volumetric water content measurements by horizon depth.",
            )
        )

    if um.get("mineral_n_kg_ha") is None:
        sens_items.append(
            (
                0.60,
                "soil.mineral_n_no3_nh4_kg_ha",
                "Pre-season laboratory soil mineral nitrogen (NO3-N + NH4-N in kg/ha by depth)",
                "SoilGrids maps total carbon/nitrogen only; plant-available mineral N cannot be inferred without lab testing.",
                "Collect 0-30 cm and 30-60 cm cores shortly before planting and record sample date, depth, and extraction method.",
            )
        )

    if isinstance(c10.get("status"), str) and c10.get("status") != "READY":
        sens_items.append(
            (
                0.35,
                "legal.official_water_and_pesticide_permits",
                "Verified local water abstraction permit ID and national pesticide compliance certificate",
                "Regulatory legality cannot be verified from satellite climate or soil datasets.",
                "Upload or enter permit reference issued by your local water authority before executing irrigation plans.",
            )
        )

    sens_items.sort(key=lambda item: (-item[0], item[1]))
    for score, key, label, why, how in sens_items:
        ordered.append(
            {
                "rank": len(ordered) + 1,
                "input_key": key,
                "human_label": label,
                "priority_tier": "SENSITIVITY_RANKED",
                "sensitivity_priority_score": round(score, 3),
                "blocks_capabilities": [],
                "why_needed": why,
                "how_farmer_provides": how,
            }
        )

    top_single = ordered[0] if ordered else None
    return {
        "schema": "astragron.next-input-ranking.v1",
        "single_next_missing_input": top_single,
        "ordered_missing_inputs": ordered,
        "ranking_policy": "BLOCKING_DEPENDENCIES_FIRST_THEN_PHYSICAL_SENSITIVITY_NO_FABRICATED_VOI",
        "economic_voi_usd": None,
        "fabricated_voi": False,
    }


def _map_parameter_path_to_cap(parameter_path: str) -> Optional[str]:
    """Map canonical parameter_path prefix to ASTRAGRON capability ID C2..C8."""
    p = parameter_path.strip()
    if not p:
        return None
    if p.startswith("climate."):
        return "C2"
    if p == "soil.mineral_n_kg_ha":
        return "C8"
    if p.startswith("soil."):
        return "C3"
    if p.startswith("soil_hydraulics."):
        return "C4"
    if p.startswith("suitability."):
        return "C5"
    if p.startswith("water_balance."):
        return "C6"
    if p.startswith("crop_water_screening."):
        return "C7"
    return None


def _is_valid_sha256_hex(val: Any) -> bool:
    return isinstance(val, str) and bool(_SHA256_HEX_RE.match(val.strip()))


def _is_finite_number(val: Any) -> bool:
    return not isinstance(val, bool) and isinstance(val, (int, float)) and math.isfinite(float(val))


def _audit_evidence_object(
    ev: Any,
    *,
    trusted_nasa_dirs: Sequence[Path] = (),
    trusted_soilgrids_dirs: Sequence[Path] = (),
) -> Dict[str, Any]:
    """Independently verify receipt provenance, hashes, dates, coordinates, license, and SI values.

    Never accepts caller-supplied `evidence_level`, `status`, or `verified` flags on trust alone.
    """
    if not isinstance(ev, dict):
        return {
            "cap": None,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": False,
            "is_unavailable": True,
            "is_derived_c4": False,
            "is_user_declared": False,
            "reason": "corrupt_non_dict_evidence_object",
        }

    param_path = str(ev.get("parameter_path") or "").strip()
    cap = _map_parameter_path_to_cap(param_path)
    claimed_level = str(ev.get("evidence_level") or "").strip()
    fixture_origin = str(ev.get("fixture_origin") or "").strip()
    prov_class = str(ev.get("provenance_class") or "").strip()
    source_id = str(ev.get("source_id") or "").strip()
    license_str = str(ev.get("license") or "").strip()
    provider = str(ev.get("provider") or "").strip()
    attribution = str(ev.get("attribution") or "").strip()

    is_synthetic = (
        claimed_level == "SYNTHETIC_TEST_FIXTURE"
        or fixture_origin == "SYNTHETIC_OFFLINE_CONTROL_FIXTURE"
        or "SYNTHETIC" in source_id.upper()
        or "SYNTHETIC" in license_str.upper()
    )
    if is_synthetic:
        return {
            "cap": cap,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": True,
            "is_unavailable": False,
            "is_derived_c4": False,
            "is_user_declared": False,
            "reason": "SYNTHETIC_FIXTURE_DETECTED",
        }

    is_unavail = (
        claimed_level == "UNAVAILABLE"
        or fixture_origin == "UNAVAILABLE_NO_DATA"
        or prov_class in ("NOT_RETRIEVABLE", "OFFICIAL_VERIFICATION_REQUIRED")
        or ev.get("missing_reason") is not None
    )
    if is_unavail:
        return {
            "cap": cap,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": False,
            "is_unavailable": True,
            "is_derived_c4": False,
            "is_user_declared": False,
            "reason": str(ev.get("missing_reason") or "UNAVAILABLE"),
        }

    if not param_path or cap is None:
        return {
            "cap": cap,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": False,
            "is_unavailable": False,
            "is_derived_c4": False,
            "is_user_declared": False,
            "reason": "MISSING_OR_UNKNOWN_PARAMETER_PATH",
        }

    try:
        resolved_level = infer_evidence_level(prov_class, fixture_origin, is_available=True)
    except Exception:
        return {
            "cap": cap,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": False,
            "is_unavailable": False,
            "is_derived_c4": False,
            "is_user_declared": False,
            "reason": "INVALID_PROVENANCE_CLASS_OR_FIXTURE_ORIGIN",
        }

    if claimed_level and claimed_level != resolved_level:
        return {
            "cap": cap,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": False,
            "is_unavailable": False,
            "is_derived_c4": False,
            "is_user_declared": False,
            "reason": "CLAIMED_EVIDENCE_LEVEL_MISMATCH",
        }

    if (
        not source_id
        or not provider
        or not attribution
        or not license_str
        or license_str.upper() in ("UNVERIFIED", "UNVERIFIED_IN_OFFLINE_WORKSPACE", "NONE", "UNKNOWN")
    ):
        return {
            "cap": cap,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": False,
            "is_unavailable": False,
            "is_derived_c4": False,
            "is_user_declared": False,
            "reason": "MISSING_SOURCE_OR_LICENSE_METADATA",
        }

    if not (_is_valid_sha256_hex(ev.get("raw_source_sha256")) and _is_valid_sha256_hex(ev.get("receipt_sha256"))):
        return {
            "cap": cap,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": False,
            "is_unavailable": False,
            "is_derived_c4": False,
            "is_user_declared": False,
            "reason": "MISSING_OR_MALFORMED_SHA256_RECEIPT",
        }

    ret_parsed = _parse_iso_temporal(ev.get("retrieved_at"))
    if ret_parsed is None or ret_parsed["dt_utc"] > datetime.now(timezone.utc):
        return {
            "cap": cap,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": False,
            "is_unavailable": False,
            "is_derived_c4": False,
            "is_user_declared": False,
            "reason": "INVALID_OR_FUTURE_RETRIEVED_AT",
        }

    pt = ev.get("point_lon_lat")
    if (
        not isinstance(pt, (list, tuple))
        or len(pt) != 2
        or not _is_finite_number(pt[0])
        or not _is_finite_number(pt[1])
        or not (-180.0 <= float(pt[0]) <= 180.0 and -90.0 <= float(pt[1]) <= 90.0)
    ):
        return {
            "cap": cap,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": False,
            "is_unavailable": False,
            "is_derived_c4": False,
            "is_user_declared": False,
            "reason": "INVALID_EVIDENCE_COORDINATES",
        }

    si_unit = str(ev.get("si_unit") or "").strip()
    has_scalar = _is_finite_number(ev.get("converted_si_value"))
    q = ev.get("quantiles")
    has_quantiles = isinstance(q, dict) and any(_is_finite_number(q.get(k)) for k in ("q05", "q50", "q95", "mean"))
    if not si_unit or not (has_scalar or has_quantiles):
        return {
            "cap": cap,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": False,
            "is_unavailable": False,
            "is_derived_c4": False,
            "is_user_declared": False,
            "reason": "MISSING_SI_VALUE_OR_QUANTILES",
        }

    if cap == "C2":
        vp = ev.get("valid_period")
        if not isinstance(vp, (list, tuple)) or len(vp) != 2:
            return {
                "cap": cap,
                "admissible": False,
                "is_authentic": False,
                "is_synthetic": False,
                "is_unavailable": False,
                "is_derived_c4": False,
                "is_user_declared": False,
                "reason": "MISSING_CLIMATE_VALID_PERIOD",
            }
        p0, p1 = _parse_iso_temporal(vp[0]), _parse_iso_temporal(vp[1])
        if p0 is None or p1 is None or p0["date"] > p1["date"]:
            return {
                "cap": cap,
                "admissible": False,
                "is_authentic": False,
                "is_synthetic": False,
                "is_unavailable": False,
                "is_derived_c4": False,
                "is_user_declared": False,
                "reason": "INVALID_CLIMATE_VALID_PERIOD",
            }

    if cap == "C3":
        di = ev.get("depth_interval_cm")
        if (
            not isinstance(di, (list, tuple))
            or len(di) != 2
            or not _is_finite_number(di[0])
            or not _is_finite_number(di[1])
            or float(di[0]) < 0.0
            or float(di[1]) <= float(di[0])
            or float(di[1]) > 200.0
        ):
            return {
                "cap": cap,
                "admissible": False,
                "is_authentic": False,
                "is_synthetic": False,
                "is_unavailable": False,
                "is_derived_c4": False,
                "is_user_declared": False,
                "reason": "INVALID_SOIL_DEPTH_INTERVAL",
            }

    is_authentic = (
        prov_class == "OBSERVED_OR_AUTHENTIC_SOURCE"
        and resolved_level in ("AUTHENTIC_LIVE", "AUTHENTIC_VERIFIED_CACHE")
    )
    is_derived_c4 = (
        cap == "C4"
        and prov_class == "DERIVED_WITH_VALIDATED_METHOD"
        and str(ev.get("evidence_type") or "") == "DERIVED"
    )
    is_user_declared = (
        prov_class == "USER_SCENARIO_ASSUMPTION"
        and resolved_level == "USER_DECLARED_SCENARIO"
    )

    proof_record: Dict[str, Any] = {
        "parameter_path": param_path,
        "capability_id": cap,
        "claimed_level": claimed_level or resolved_level,
        "source_id": source_id,
    }
    if is_authentic or (resolved_level in ("AUTHENTIC_LIVE", "AUTHENTIC_VERIFIED_CACHE") and not is_derived_c4):
        proof = verify_authentic_evidence_proof(
            ev,
            trusted_nasa_dirs=trusted_nasa_dirs,
            trusted_soilgrids_dirs=trusted_soilgrids_dirs,
        )
        proof_record.update(proof)
        if not proof["verified"]:
            return {
                "cap": cap,
                "admissible": False,
                "is_authentic": False,
                "is_synthetic": False,
                "is_unavailable": False,
                "is_derived_c4": False,
                "is_user_declared": False,
                "unverified_proof": proof.get("status") == "UNVERIFIED",
                "proof_tier": proof.get("proof_tier", "SOURCE_CLAIMED_BUT_UNVERIFIED"),
                "proof_record": proof_record,
                "reason": proof.get("reason_code") or "UNVERIFIED_SOURCE_PROOF",
            }
    elif is_derived_c4:
        proof_record.update(
            {
                "status": "PENDING_PARENT_VERIFICATION",
                "verified": True,
                "proof_tier": "DERIVED_FROM_VERIFIED_PARENT",
                "reason_code": None,
                "raw_bytes_verified": False,
                "captured_extract_integrity_verified": False,
                "upstream_cryptographic_authenticity_proven": False,
                "detail": "Derived PTF evidence; requires verified linked C3 parent evidence chain.",
            }
        )
    elif is_user_declared:
        proof_record.update(
            {
                "status": "USER_DECLARED",
                "verified": True,
                "proof_tier": "USER_SCENARIO_DECLARED",
                "reason_code": None,
                "raw_bytes_verified": False,
                "captured_extract_integrity_verified": False,
                "upstream_cryptographic_authenticity_proven": False,
                "detail": "User-declared scenario input; never elevated to independent field measurement.",
            }
        )
    else:
        proof_record.update(
            {
                "status": "UNVERIFIED",
                "verified": False,
                "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
                "reason_code": "UNVERIFIED_SOURCE_PROOF",
                "raw_bytes_verified": False,
                "captured_extract_integrity_verified": False,
                "upstream_cryptographic_authenticity_proven": False,
                "detail": "Evidence object does not belong to a verified authentic, derived, or user-declared class.",
            }
        )
        return {
            "cap": cap,
            "admissible": False,
            "is_authentic": False,
            "is_synthetic": False,
            "is_unavailable": False,
            "is_derived_c4": False,
            "is_user_declared": False,
            "unverified_proof": True,
            "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
            "proof_record": proof_record,
            "reason": "UNVERIFIED_SOURCE_PROOF",
        }

    return {
        "cap": cap,
        "admissible": True,
        "resolved_level": resolved_level,
        "is_authentic": is_authentic,
        "is_synthetic": False,
        "is_unavailable": False,
        "is_derived_c4": is_derived_c4,
        "is_user_declared": is_user_declared,
        "unverified_proof": False,
        "proof_tier": proof_record["proof_tier"],
        "proof_record": proof_record,
        "raw_source_sha256": str(ev.get("raw_source_sha256")),
        "retrieved_at_dt": ret_parsed["dt_utc"],
        "reason": None,
    }


class EvidenceQualityGate:
    """Unified, versioned pre-claim Quality Gate producing capability verdicts and farmer guidance."""

    schema = QUALITY_GATE_SCHEMA
    version = QUALITY_GATE_VERSION

    def evaluate(
        self,
        request: Dict[str, Any],
        *,
        capabilities: Dict[str, Dict[str, Any]],
        evidence_objects: Sequence[Dict[str, Any]] = (),
        c2_res: Optional[Dict[str, Any]] = None,
        c3_res: Optional[Dict[str, Any]] = None,
        disagreement_diagnostics: Optional[Dict[str, Any]] = None,
        sensitivity_result: Optional[Dict[str, Any]] = None,
        max_age_days: Optional[int] = None,
        expected_time_standard: str = "UTC",
        trusted_nasa_dirs: Sequence[Path] = (),
        trusted_soilgrids_dirs: Sequence[Path] = (),
    ) -> Dict[str, Any]:
        req = request if isinstance(request, dict) else {}
        um = req.get("user_measurements") if isinstance(req.get("user_measurements"), dict) else {}
        ws = req.get("water_supply_scenario") if isinstance(req.get("water_supply_scenario"), dict) else {}
        as_of_iso = req.get("as_of")

        reasons: List[Dict[str, Any]] = []
        capability_verdicts: Dict[str, Dict[str, Any]] = {}

        # 1. Per-capability independent audit of evidence_objects (never trust claimed labels alone)
        admissible_by_cap: Dict[str, List[Dict[str, Any]]] = {f"C{i}": [] for i in range(1, 11)}
        invalid_reasons_by_cap: Dict[str, List[str]] = {f"C{i}": [] for i in range(1, 11)}
        unverified_reasons_by_cap: Dict[str, List[str]] = {f"C{i}": [] for i in range(1, 11)}
        synthetic_caps: set[str] = set()
        unscoped_synthetic = False
        unscoped_invalid = False
        unscoped_unverified = False
        observed_levels: set[str] = set()
        tiers_observed: set[str] = set()
        evidence_verifications: List[Dict[str, Any]] = []
        raw_c3_objects: List[Dict[str, Any]] = []
        raw_c4_derived_objects: List[Dict[str, Any]] = []

        for ev in evidence_objects:
            audit = _audit_evidence_object(
                ev,
                trusted_nasa_dirs=trusted_nasa_dirs,
                trusted_soilgrids_dirs=trusted_soilgrids_dirs,
            )
            if audit["is_synthetic"]:
                observed_levels.add("SYNTHETIC_TEST_FIXTURE")
                tiers_observed.add("SYNTHETIC_FIXTURE")
                if audit["cap"] is None:
                    unscoped_synthetic = True
                else:
                    synthetic_caps.add(audit["cap"])
                continue
            if audit["is_unavailable"]:
                observed_levels.add("UNAVAILABLE")
                continue
            if not audit["admissible"]:
                prec = audit.get("proof_record")
                if isinstance(prec, dict):
                    evidence_verifications.append(prec)
                tiers_observed.add(str(audit.get("proof_tier") or "SOURCE_CLAIMED_BUT_UNVERIFIED"))
                if audit.get("unverified_proof"):
                    if audit["cap"] is None:
                        unscoped_unverified = True
                    else:
                        unverified_reasons_by_cap[audit["cap"]].append(str(audit["reason"]))
                else:
                    if audit["cap"] is None:
                        unscoped_invalid = True
                    else:
                        invalid_reasons_by_cap[audit["cap"]].append(str(audit["reason"]))
                observed_levels.add("UNAVAILABLE")
                continue

            cid = audit["cap"]
            observed_levels.add(audit["resolved_level"])
            tiers_observed.add(str(audit["proof_tier"]))
            if isinstance(audit.get("proof_record"), dict):
                evidence_verifications.append(audit["proof_record"])
            admissible_by_cap[cid].append(audit)
            if cid == "C3" and isinstance(ev, dict):
                raw_c3_objects.append(ev)
            if cid == "C4" and audit["is_derived_c4"] and isinstance(ev, dict):
                raw_c4_derived_objects.append(ev)

        if um or ws.get("regime"):
            observed_levels.add("USER_DECLARED_SCENARIO")
            tiers_observed.add("USER_SCENARIO_DECLARED")
        evidence_levels_observed = sorted(observed_levels)

        if unscoped_synthetic:
            synthetic_caps.update({"C2", "C3", "C4", "C5", "C6", "C7"})
        else:
            if "C2" in synthetic_caps:
                synthetic_caps.update({"C6", "C7"})
            if "C3" in synthetic_caps:
                if raw_c4_derived_objects or not um:
                    synthetic_caps.update({"C4", "C6", "C7"})
            if "C4" in synthetic_caps:
                synthetic_caps.update({"C6", "C7"})

        if synthetic_caps:
            reasons.append(
                {
                    "code": "SYNTHETIC_FIXTURE_DETECTED",
                    "severity": "WARNING",
                    "capability_ids": sorted(synthetic_caps),
                    "message": (
                        f"Synthetic offline control fixtures detected for {', '.join(sorted(synthetic_caps))}; "
                        "affected outputs must never be reported as authentic retrieved environmental measurements."
                    ),
                }
            )

        for cid_unv, unv_codes in sorted(unverified_reasons_by_cap.items()):
            if unv_codes:
                reasons.append(
                    {
                        "code": "UNVERIFIED_SOURCE_PROOF",
                        "severity": "WARNING",
                        "capability_ids": [cid_unv],
                        "message": (
                            f"{cid_unv} source claim lacks verifiable backing raw bytes, allowlisted receipt store entry, "
                            f"or in-process live adapter attestation ({', '.join(sorted(set(unv_codes)))})."
                        ),
                    }
                )
        if unscoped_unverified:
            reasons.append(
                {
                    "code": "UNVERIFIED_SOURCE_PROOF",
                    "severity": "WARNING",
                    "capability_ids": ["C2", "C3", "C4", "C5", "C6", "C7"],
                    "message": "Source-claimed evidence lacks verifiable backing store receipt or live adapter proof.",
                }
            )
        for cid_inv, inv_codes in sorted(invalid_reasons_by_cap.items()):
            if inv_codes:
                reasons.append(
                    {
                        "code": "INVALID_OR_UNVERIFIED_EVIDENCE_RECEIPT",
                        "severity": "WARNING",
                        "capability_ids": [cid_inv],
                        "message": f"{cid_inv} evidence receipt failed independent audit ({', '.join(sorted(set(inv_codes)))}).",
                    }
                )
        if unscoped_invalid:
            reasons.append(
                {
                    "code": "INVALID_OR_UNVERIFIED_EVIDENCE_RECEIPT",
                    "severity": "WARNING",
                    "capability_ids": ["C2", "C3", "C4", "C5", "C6", "C7"],
                    "message": "Evidence object lacks identifiable parameter_path or failed receipt integrity audit.",
                }
            )

        # 1b. Parent hash / provenance chain check for derived C4 soil hydraulics
        c3_for_hash = (
            c3_res.get("evidence_objects")
            if isinstance(c3_res, dict) and isinstance(c3_res.get("evidence_objects"), list)
            else raw_c3_objects
        )
        c4_parent_disconnected = False
        if raw_c4_derived_objects:
            c3_status = (capabilities.get("C3") or {}).get("status", "BLOCKED")
            if not c3_for_hash or c3_status == "BLOCKED" or "C3" in synthetic_caps or not admissible_by_cap["C3"]:
                c4_parent_disconnected = True
            else:
                expected_parent_sha = hashlib.sha256(
                    json.dumps(c3_for_hash, sort_keys=True).encode("utf-8")
                ).hexdigest()
                if any(str(ev.get("raw_source_sha256") or "") != expected_parent_sha for ev in raw_c4_derived_objects):
                    c4_parent_disconnected = True
            if c4_parent_disconnected:
                reasons.append(
                    {
                        "code": "DISCONNECTED_OR_UNVERIFIED_PARENT",
                        "severity": "WARNING",
                        "capability_ids": ["C4", "C6", "C7"],
                        "message": "Derived C4 soil hydraulics parent SHA-256 or C3 parent evidence chain failed verification.",
                    }
                )

        # 2. User 'measured' metadata check (strict ISO-8601 & future date enforcement)
        user_meta_chk = _check_user_measured_metadata(um, as_of_iso=as_of_iso)
        if user_meta_chk["downgraded_to_scenario"]:
            for iss in user_meta_chk["issues"]:
                reasons.append(
                    {
                        "code": iss["code"],
                        "severity": "CAUTION",
                        "capability_ids": ["C4", "C6", "C7", "C8", "C9"],
                        "message": iss["detail"],
                    }
                )

        # 3. Spatial pixel & SoilGrids depth/pH/quantile audit
        c3_diag = (c3_res or {}).get("diagnostics") or (capabilities.get("C3") or {}).get("diagnostics") or {}
        if isinstance(c3_diag, dict):
            sp_sup = c3_diag.get("spatial_support") or {}
            if isinstance(sp_sup, dict) and sp_sup.get("geotransform_verified") is False:
                reasons.append(
                    {
                        "code": "SPATIAL_UNCERTAIN",
                        "severity": "CAUTION",
                        "capability_ids": ["C3", "C4"],
                        "message": "SoilGrids input lacks verified GeoTIFF affine transform metadata.",
                    }
                )
            elif isinstance(sp_sup, dict) and sp_sup.get("distance_m") is not None and float(sp_sup["distance_m"]) > 250.0:
                reasons.append(
                    {
                        "code": "SPATIAL_UNCERTAIN",
                        "severity": "INFO",
                        "capability_ids": ["C3"],
                        "message": f"Nearest 250 m SoilGrids cell center is {sp_sup['distance_m']} m from queried farm coordinate.",
                    }
                )
            resolved_layers = c3_diag.get("resolved_native_layers") or []
            if len(resolved_layers) > 1:
                reasons.append(
                    {
                        "code": "MULTI_HORIZON_SCENARIO_BOUNDS",
                        "severity": "INFO",
                        "capability_ids": ["C3", "C4"],
                        "message": (
                            f"Depth layers {resolved_layers} aggregated for intensive soil properties; combined Q05/Q95 represent scenario sensitivity bounds rather than exact 90% prediction intervals, and scalar linear pH averaging was abstained."
                        ),
                    }
                )

        # 4. Temporal, cutoff, UTC vs LST & staleness check
        c2_diag = (c2_res or {}).get("diagnostics") or (capabilities.get("C2") or {}).get("diagnostics") or {}
        if isinstance(c2_diag, dict):
            tstd = str(c2_diag.get("time_standard") or "UTC")
            if expected_time_standard and tstd != expected_time_standard:
                reasons.append(
                    {
                        "code": "TIME_STANDARD_DIFFERENCE",
                        "severity": "CAUTION",
                        "capability_ids": ["C2", "C6", "C7"],
                        "message": f"Climate series uses time_standard={tstd} while gate default is {expected_time_standard}; daily midnight cutoffs differ from UTC.",
                    }
                )
            if c2_diag.get("is_sub_annual_window"):
                reasons.append(
                    {
                        "code": "SUB_ANNUAL_CLIMATE_DESCRIPTION_ONLY",
                        "severity": "CAUTION",
                        "capability_ids": ["C6", "C7"],
                        "message": (
                            f"Historical window ({c2_diag.get('days_verified')} days) is sub-annual; descriptive daily weather (C2) is valid, but annual seasonal crop screening (C6/C7) is degraded/blocked."
                        ),
                    }
                )

        # Optional staleness enforcement across receipts
        if max_age_days is not None:
            if as_of_iso is not None:
                parsed_ref = _parse_iso_temporal(as_of_iso)
                ref_dt = parsed_ref["dt_utc"] if parsed_ref is not None else datetime.now(timezone.utc)
            else:
                ref_dt = datetime.now(timezone.utc)
            for ev in evidence_objects:
                ret = ev.get("retrieved_at") if isinstance(ev, dict) else None
                if not ret:
                    continue
                ret_p = _parse_iso_temporal(ret)
                if ret_p is not None:
                    age_d = (ref_dt - ret_p["dt_utc"]).total_seconds() / 86400.0
                    if age_d > float(max_age_days):
                        target_c = _map_parameter_path_to_cap(str(ev.get("parameter_path") or "")) or "C2"
                        affected_c = [target_c] if target_c in ("C2", "C3") else ["C2", "C3"]
                        reasons.append(
                            {
                                "code": "STALE_EVIDENCE_AGE_EXCEEDED",
                                "severity": "WARNING",
                                "capability_ids": affected_c,
                                "message": f"Cached snapshot {ev.get('source_id')} age {age_d:.1f} days exceeds max_age_days={max_age_days}.",
                            }
                        )
                        break

        # 5. Cross-source disagreement check (explicit or PTF divergence > 35 mm/m)
        if not isinstance(disagreement_diagnostics, dict):
            c4_diag = (capabilities.get("C4") or {}).get("diagnostics") or {}
            if isinstance(c4_diag, dict) and c4_diag.get("cross_ptf_awc_diff_mm_m") is not None:
                diff_val = float(c4_diag["cross_ptf_awc_diff_mm_m"])
                if diff_val > 35.0:
                    disagreement_diagnostics = {
                        "cross_source_disagreement_detected": True,
                        "cross_ptf_awc_diff_mm_m": diff_val,
                        "detail": (
                            f"Secondary PTF check (Wosten 1999) diverges from Saxton & Rawls (2006) by "
                            f"{diff_val:.1f} mm/m AWC (> 35 mm/m threshold); preserve wide uncertainty bounds."
                        ),
                    }
        if isinstance(disagreement_diagnostics, dict) and disagreement_diagnostics.get("cross_source_disagreement_detected"):
            reasons.append(
                {
                    "code": "CROSS_SOURCE_DISAGREEMENT",
                    "severity": "WARNING",
                    "capability_ids": ["C3", "C4", "C6", "C7"],
                    "message": str(
                        disagreement_diagnostics.get("detail")
                        or "Substantial discrepancy detected between data sources or pedotransfer methods; preserve uncertainty intervals."
                    ),
                }
            )

        # Check location validity for C1 when location block is provided
        loc = req.get("location")
        c1_location_valid = True
        if isinstance(loc, dict) and loc.get("point_lon_lat") is not None:
            lchk = validate_coordinates_and_crs(
                loc.get("point_lon_lat"),
                str(loc.get("crs") or "EPSG:4326"),
                loc.get("geometry"),
            )
            c1_location_valid = bool(lchk.get("valid") and lchk.get("is_land"))

        # Physical check on user soil retention if provided
        has_valid_user_soil_ret = False
        has_user_ret_claim = any(
            um.get(k) is not None
            for k in ("theta_fc", "theta_wp", "soil_lab_measured", "field_measured_soil", "field_measured", "claimed_measured")
        )
        if um.get("theta_fc") is not None and um.get("theta_wp") is not None:
            try:
                fc_u, wp_u = float(um["theta_fc"]), float(um["theta_wp"])
                has_valid_user_soil_ret = (
                    not isinstance(um["theta_fc"], bool)
                    and not isinstance(um["theta_wp"], bool)
                    and math.isfinite(fc_u)
                    and math.isfinite(wp_u)
                    and 0.0 < wp_u < fc_u < 0.85
                )
            except (TypeError, ValueError):
                has_valid_user_soil_ret = False

        # 6. Per-capability quality verdict assignment (fail-closed dependency order)
        for cid in ("C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"):
            cap = capabilities.get(cid) or {}
            st = cap.get("status", "BLOCKED")
            miss = cap.get("missing_reason")
            verdict_reason_codes: List[str] = [
                r["code"] for r in reasons if cid in r["capability_ids"]
            ]

            if cid == "C10" and st in ("READY", "CONDITIONAL"):
                verdict = "REJECTED"
                if "official_verification_required" not in verdict_reason_codes:
                    verdict_reason_codes.append("official_verification_required")
                expl = "Legal water rights and regulatory clearances cannot be promoted to READY or ACCEPTED_FOR_CLAIM; official local authority verification required."
            elif st in ("READY", "CONDITIONAL"):
                is_syn = cid in synthetic_caps
                has_invalid_rcpt = bool(invalid_reasons_by_cap[cid]) or unscoped_invalid
                has_unverified_rcpt = bool(unverified_reasons_by_cap[cid]) or unscoped_unverified
                has_disagree = "CROSS_SOURCE_DISAGREEMENT" in verdict_reason_codes

                if cid == "C1":
                    if st == "READY" and c1_location_valid:
                        verdict = "ACCEPTED_FOR_CLAIM"
                        expl = "C1 location coordinates and CRS verified."
                    else:
                        verdict = "REJECTED"
                        verdict_reason_codes.append("INVALID_LOCATION_OR_CRS")
                        expl = "C1 location validation failed CRS/bounds/land check."

                elif cid in ("C2", "C3", "C5"):
                    adm = admissible_by_cap[cid]
                    has_auth = any(a["is_authentic"] for a in adm)
                    if is_syn:
                        verdict = "DEGRADED_TO_DESCRIPTION"
                        expl = f"Synthetic test fixture used for {cid}; treated strictly as non-authentic description."
                    elif has_invalid_rcpt:
                        verdict = "REJECTED"
                        expl = f"{cid} source receipt failed integrity or provenance verification."
                    elif has_unverified_rcpt or not adm:
                        verdict = "UNDETERMINED"
                        if has_unverified_rcpt and "UNVERIFIED_SOURCE_PROOF" not in verdict_reason_codes:
                            verdict_reason_codes.append("UNVERIFIED_SOURCE_PROOF")
                        verdict_reason_codes.append("MISSING_ADMISSIBLE_EVIDENCE_RECEIPT")
                        expl = f"{cid} status={st} lacks verifiable raw source bytes, store receipt, or live attestation; failing closed."
                    elif has_disagree:
                        verdict = "DEGRADED_TO_DESCRIPTION"
                        expl = f"{cid} downgraded to descriptive comparison because upstream sources disagree substantially."
                    elif st == "READY":
                        if cid == "C2" and isinstance(c2_diag, dict) and c2_diag.get("is_sub_annual_window"):
                            verdict = "ACCEPTED_CONDITIONALLY"
                            expl = "Authentic daily historical weather verified for this sub-annual date window; cannot represent multi-year annual climatology."
                        elif any(rc in ("TIME_STANDARD_DIFFERENCE", "STALE_EVIDENCE_AGE_EXCEEDED") for rc in verdict_reason_codes):
                            verdict = "ACCEPTED_CONDITIONALLY"
                            expl = f"{cid} available with temporal/staleness caveats ({', '.join(sorted(set(verdict_reason_codes)))})."
                        elif has_auth:
                            verdict = "ACCEPTED_FOR_CLAIM"
                            expl = f"{cid} verified for stated regional scope from authentic evidence receipt."
                        else:
                            verdict = "ACCEPTED_CONDITIONALLY"
                            verdict_reason_codes.append("NON_AUTHENTIC_OR_REGIONAL_MAP_ESTIMATE")
                            expl = f"{cid} backed by regional map/scenario estimate only; downgraded from READY claim to conditional."
                    else:  # st == "CONDITIONAL"
                        verdict = "ACCEPTED_CONDITIONALLY"
                        expl = f"{cid} admitted strictly within stated conditional bounds and caveats."

                elif cid == "C4":
                    adm_c4 = admissible_by_cap["C4"]
                    has_derived_adm = any(a["is_derived_c4"] for a in adm_c4)
                    has_user_adm = any(a["is_user_declared"] for a in adm_c4)
                    c3_v = (capability_verdicts.get("C3") or {}).get("verdict")
                    c3_ok = c3_v in ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY")

                    if has_disagree:
                        verdict = "DEGRADED_TO_DESCRIPTION"
                        expl = "C4 downgraded to descriptive comparison because soil retention or PTF sources disagree substantially."
                    elif c4_parent_disconnected:
                        verdict = "REJECTED"
                        verdict_reason_codes.append("DISCONNECTED_OR_UNVERIFIED_PARENT")
                        expl = "C4 derived soil hydraulics lacks valid connected C3 parent evidence SHA-256 chain."
                    elif is_syn:
                        verdict = "DEGRADED_TO_DESCRIPTION"
                        expl = "C4 tainted by synthetic test fixture; treated strictly as test description."
                    elif user_meta_chk["downgraded_to_scenario"] and (has_user_ret_claim or not has_derived_adm):
                        verdict = "DEGRADED_TO_DESCRIPTION"
                        expl = "C4 downgraded to uncalibrated USER_DECLARED_SCENARIO due to missing or invalid measurement metadata."
                    elif has_invalid_rcpt and not adm_c4:
                        verdict = "REJECTED"
                        expl = "C4 evidence receipt failed provenance/hash integrity verification."
                    elif has_unverified_rcpt and not adm_c4:
                        verdict = "UNDETERMINED"
                        if "UNVERIFIED_SOURCE_PROOF" not in verdict_reason_codes:
                            verdict_reason_codes.append("UNVERIFIED_SOURCE_PROOF")
                        verdict_reason_codes.append("MISSING_ADMISSIBLE_EVIDENCE_RECEIPT")
                        expl = "C4 lacks verifiable linked SoilGrids-derived chain or verified user soil retention receipt; failing closed."
                    elif has_derived_adm and c3_ok:
                        if st == "READY":
                            verdict = "ACCEPTED_CONDITIONALLY"
                            verdict_reason_codes.append("PTF_DERIVATION_CONDITIONAL_ONLY")
                            expl = "C4 PTF-derived soil hydraulics capped at ACCEPTED_CONDITIONALLY."
                        else:
                            verdict = "ACCEPTED_CONDITIONALLY"
                            expl = "C4 admitted strictly within stated PTF derivation conditional bounds."
                    elif has_user_adm and has_valid_user_soil_ret and user_meta_chk["verified"]:
                        verdict_reason_codes.append("USER_DECLARED_SCENARIO_ONLY")
                        if st == "READY":
                            verdict = "ACCEPTED_FOR_CLAIM"
                            expl = "C4 user-declared soil retention scenario accepted with valid date, method, and depth (not independent lab certification)."
                        else:
                            verdict = "ACCEPTED_CONDITIONALLY"
                            expl = "C4 user-declared soil retention scenario admitted conditionally."
                    else:
                        verdict = "UNDETERMINED"
                        verdict_reason_codes.append("MISSING_ADMISSIBLE_EVIDENCE_RECEIPT")
                        expl = "C4 lacks valid linked SoilGrids-derived chain or verified user soil retention receipt; failing closed."

                elif cid == "C6":
                    c2_v = (capability_verdicts.get("C2") or {}).get("verdict")
                    c4_v = (capability_verdicts.get("C4") or {}).get("verdict")
                    if is_syn or c2_v == "DEGRADED_TO_DESCRIPTION" or c4_v == "DEGRADED_TO_DESCRIPTION" or has_disagree:
                        verdict = "DEGRADED_TO_DESCRIPTION"
                        if "DEPENDENCY_DEGRADED" not in verdict_reason_codes:
                            verdict_reason_codes.append("DEPENDENCY_DEGRADED")
                        expl = f"C6 degraded because required dependency (C2={c2_v}, C4={c4_v}) is degraded/synthetic/disagreeing."
                    elif c2_v == "REJECTED" or c4_v == "REJECTED":
                        verdict = "REJECTED"
                        verdict_reason_codes.append("DEPENDENCY_REJECTED")
                        expl = f"C6 rejected because required dependency (C2={c2_v}, C4={c4_v}) failed gate verification."
                    elif c2_v not in ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY") or c4_v not in ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY"):
                        verdict = "UNDETERMINED"
                        verdict_reason_codes.append("DEPENDENCY_UNVERIFIED_OR_BLOCKED")
                        expl = f"C6 cannot be accepted while upstream dependencies remain unverified (C2={c2_v}, C4={c4_v})."
                    elif "SUB_ANNUAL_CLIMATE_DESCRIPTION_ONLY" in verdict_reason_codes:
                        verdict = "DEGRADED_TO_DESCRIPTION"
                        expl = "C6 degraded because C2 covers only a sub-annual window."
                    elif st == "READY" and c2_v == "ACCEPTED_FOR_CLAIM" and c4_v == "ACCEPTED_FOR_CLAIM" and not any(
                        rc in ("TIME_STANDARD_DIFFERENCE", "STALE_EVIDENCE_AGE_EXCEEDED") for rc in verdict_reason_codes
                    ):
                        verdict = "ACCEPTED_FOR_CLAIM"
                        expl = "C6 water balance verified from admissible C2 climate and C4 soil retention."
                    else:
                        verdict = "ACCEPTED_CONDITIONALLY"
                        expl = "C6 water balance admitted strictly within conditional upstream C2/C4 bounds."

                elif cid == "C7":
                    c2_v = (capability_verdicts.get("C2") or {}).get("verdict")
                    c4_v = (capability_verdicts.get("C4") or {}).get("verdict")
                    c6_v = (capability_verdicts.get("C6") or {}).get("verdict")
                    deps = (c2_v, c4_v, c6_v)
                    if is_syn or "DEGRADED_TO_DESCRIPTION" in deps or has_disagree:
                        verdict = "DEGRADED_TO_DESCRIPTION"
                        if "DEPENDENCY_DEGRADED" not in verdict_reason_codes:
                            verdict_reason_codes.append("DEPENDENCY_DEGRADED")
                        expl = f"C7 degraded because upstream dependency (C2={c2_v}, C4={c4_v}, C6={c6_v}) is degraded/synthetic."
                    elif "REJECTED" in deps:
                        verdict = "REJECTED"
                        verdict_reason_codes.append("DEPENDENCY_REJECTED")
                        expl = f"C7 rejected because upstream dependency (C2={c2_v}, C4={c4_v}, C6={c6_v}) was rejected."
                    elif any(dv not in ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY") for dv in deps):
                        verdict = "UNDETERMINED"
                        verdict_reason_codes.append("DEPENDENCY_UNVERIFIED_OR_BLOCKED")
                        expl = f"C7 cannot be accepted while upstream dependencies remain unverified (C2={c2_v}, C4={c4_v}, C6={c6_v})."
                    elif "SUB_ANNUAL_CLIMATE_DESCRIPTION_ONLY" in verdict_reason_codes:
                        verdict = "DEGRADED_TO_DESCRIPTION"
                        expl = "C7 degraded because C2 covers only a sub-annual window."
                    else:
                        verdict = "ACCEPTED_CONDITIONALLY"
                        if st == "READY":
                            verdict_reason_codes.append("C7_SCREENING_CONDITIONAL_ONLY")
                        expl = "C7 regional crop water screening admitted strictly conditionally (not a multi-year rotation or field-validated recommendation)."

                elif cid == "C8":
                    if st == "READY":
                        verdict = "REJECTED"
                        verdict_reason_codes.append("C8_CANNOT_BE_READY_GLOBALLY")
                        expl = "C8 native process simulation cannot claim READY."
                    elif user_meta_chk["downgraded_to_scenario"] or unscoped_synthetic:
                        verdict = "DEGRADED_TO_DESCRIPTION"
                        expl = "C8 downgraded to uncalibrated scenario description due to unverified measurement metadata or synthetic input."
                    elif um.get("mineral_n_kg_ha") is not None and _is_finite_number(um.get("mineral_n_kg_ha")):
                        verdict = "ACCEPTED_CONDITIONALLY"
                        expl = "C8 admitted conditionally within pinned research envelope."
                    else:
                        verdict = "UNDETERMINED"
                        verdict_reason_codes.append("MISSING_INITIAL_MINERAL_N")
                        expl = "C8 lacks explicit mineral_n_kg_ha parameter."

                elif cid == "C9":
                    if st == "READY":
                        verdict = "REJECTED"
                        verdict_reason_codes.append("C9_SCENARIO_ONLY")
                        expl = "C9 economic screening cannot claim READY without calibrated profit validation."
                    elif user_meta_chk["downgraded_to_scenario"] or unscoped_synthetic:
                        verdict = "DEGRADED_TO_DESCRIPTION"
                        expl = "C9 downgraded to scenario description."
                    elif um.get("input_cost_eur_ha") is not None and _is_finite_number(um.get("input_cost_eur_ha")):
                        verdict = "ACCEPTED_CONDITIONALLY"
                        expl = "C9 economic cost exposure admitted strictly conditionally (yield/profit null)."
                    else:
                        verdict = "UNDETERMINED"
                        verdict_reason_codes.append("MISSING_COST_SCENARIO")
                        expl = "C9 lacks explicit input_cost_eur_ha scenario input."

            elif st == "OFFICIAL_VERIFICATION_REQUIRED":
                verdict = "REJECTED"
                verdict_reason_codes.append(miss or "official_verification_required")
                expl = "Legal water rights and regulatory clearances cannot be inferred computationally; official local authority verification required."
            else:
                if miss in (
                    "spatial_mismatch",
                    "invalid_coordinates_or_crs",
                    "point_pixel_missing",
                    "geo_distance_exceeded",
                    "mixed_source_support",
                    "spatial_uncertain",
                    "ocean_or_non_land_cell",
                    "corrupt_receipt_or_hash_mismatch",
                    "stale_or_post_cutoff_snapshot",
                    "depth_interval_unavailable",
                    "depth_inconsistency",
                    "prohibited_derivation_blocked",
                    "time_standard_mismatch",
                    "quality_fail",
                ):
                    verdict = "REJECTED"
                elif miss in (
                    "not_identifiable",
                    "source_outage",
                    "source_blocked",
                    "insufficient_parameters",
                    "incomplete_data",
                    "no_data",
                    "temporal_mismatch",
                    "unsupported_crop_profile",
                    "estimator_out_of_domain",
                    "license_unverified",
                ):
                    verdict = "UNDETERMINED"
                else:
                    verdict = "REJECTED" if miss else "UNDETERMINED"
                if miss:
                    verdict_reason_codes.append(miss)
                expl = str(cap.get("detail") or f"{cid} blocked ({miss or 'unspecified'}).")

            capability_verdicts[cid] = {
                "capability_status": st,
                "verdict": verdict,
                "reason_codes": sorted(set(verdict_reason_codes)),
                "explanation": expl,
            }

        # Overall verdict (never falsely upgrades C7/C8/C10 while preserving partial descriptive utility of C2/C3)
        c2_v = (capability_verdicts.get("C2") or {}).get("verdict")
        c3_v = (capability_verdicts.get("C3") or {}).get("verdict")
        c7_v = (capability_verdicts.get("C7") or {}).get("verdict")
        if (capability_verdicts.get("C1") or {}).get("verdict") != "ACCEPTED_FOR_CLAIM" and c2_v not in ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY"):
            overall_verdict = "REJECTED"
            overall_summary = "Primary location validation failed and no usable climate evidence passed quality checks."
        elif c7_v in ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY"):
            overall_verdict = "ACCEPTED_CONDITIONALLY"
            overall_summary = "Screening capabilities passed quality gates with explicit regional uncertainty and non-field-validated caveats."
        elif c2_v in ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY") or c3_v in ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY"):
            overall_verdict = "DEGRADED_TO_DESCRIPTION"
            overall_summary = "Downstream planning claims restricted, while descriptive climate/soil observations remain valid for farmer inspection."
        else:
            overall_verdict = "UNDETERMINED"
            overall_summary = "Insufficient qualified evidence to sustain downstream claims."

        next_ranking = rank_single_next_missing_input(
            capabilities,
            water_supply=ws,
            user_meas=um,
            sensitivity_result=sensitivity_result,
        )

        return {
            "schema": self.schema,
            "gate_version": self.version,
            "overall_verdict": overall_verdict,
            "overall_summary": overall_summary,
            "descriptive_partial_climate_preserved": c2_v in ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY"),
            "descriptive_partial_soil_preserved": c3_v in ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY"),
            "evidence_levels_observed": evidence_levels_observed,
            "user_measurement_audit": user_meta_chk,
            "gate_findings": reasons,
            "capability_verdicts": capability_verdicts,
            "single_next_missing_input": next_ranking["single_next_missing_input"],
            "next_input_ranking": next_ranking,
            "false_upgrades_blocked": sum(
                1 for v in capability_verdicts.values() if v["verdict"] in ("DEGRADED_TO_DESCRIPTION", "REJECTED", "UNDETERMINED")
            ),
            "provenance_trust_summary": {
                "verification_model": "ALLOWLISTED_STORE_OR_IN_PROCESS_ATTESTATION",
                "caller_json_flags_ignored": ["verified", "is_authentic_source", "receipt_path", "access_path"],
                "external_url_fetch_during_gate": False,
                "path_traversal_blocked": True,
                "tiers_observed": sorted(tiers_observed),
                "evidence_verifications": evidence_verifications,
                "limitations": [
                    "Locally re-hashed NASA POWER files verify byte integrity against captured store artifacts, not an upstream NASA TLS/PKI signature.",
                    "Offline cached SoilGrids v2.0 receipts preserve normalized extract JSON (payload_sha256 & receipt_sha256) with original GeoTIFF binaries intentionally omitted offline; offline checks verify capture extract integrity rather than offline raw raster bytes.",
                ],
            },
        }


__all__ = [
    "EvidenceQualityGate",
    "QUALITY_GATE_SCHEMA",
    "QUALITY_GATE_VERSION",
    "QUALITY_VERDICTS",
    "rank_single_next_missing_input",
]
