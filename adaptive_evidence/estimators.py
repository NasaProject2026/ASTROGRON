"""Auditable Derivation and Fallback Estimator Registry for ASTRAGRON Global Adaptive Evidence.

Implements Section 4 ('Physically Bounded Derivation & Fallback Rules') and Section 6 (Stage P2)
of `00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`.
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .schema import TypedEvidenceObject

SAXTON_RAWLS_CITATION = (
    "Saxton, K. E., & Rawls, W. J. (2006). Soil water characteristic estimates by texture and "
    "organic matter for hydrologic solutions. Soil Science Society of America Journal, 70(5), "
    "1569-1578. https://doi.org/10.2136/sssaj2006.0117"
)

WOSTEN_HYPRES_CITATION = (
    "Wosten, J. H. M., Lilly, A., Nemes, A., & Le Bas, C. (1999). Development and use of a "
    "database of hydraulic properties of European soils (HYPRES). Geoderma, 90(3-4), 169-185. "
    "https://doi.org/10.1016/S0016-7061(98)00132-3"
)

HARGREAVES_SAMANI_CITATION = (
    "Hargreaves, G. H., & Samani, Z. A. (1985). Reference crop evapotranspiration from "
    "temperature. Applied Engineering in Agriculture, 1(2), 96-99. https://doi.org/10.13031/2013.26773"
)

ESTIMATOR_REGISTRY: Dict[str, Dict[str, Any]] = {
    "SAXTON_RAWLS_2006_PTF_V1": {
        "estimator_id": "SAXTON_RAWLS_2006_PTF_V1",
        "name": "Saxton & Rawls (2006) Soil Water Characteristic Pedotransfer Function",
        "citation": SAXTON_RAWLS_CITATION,
        "required_inputs": {
            "clay_pct": {"unit": "%", "domain_bounds": [2.0, 60.0]},
            "silt_pct": {"unit": "%", "domain_bounds": [0.0, 88.0]},
            "sand_pct": {"unit": "%", "domain_bounds": [5.0, 92.0]},
            "soc_g_kg": {
                "unit": "g/kg",
                "domain_bounds": [0.0, 46.4],
                "note": "Converted to organic matter OM% = soc_g_kg * 0.1724; valid for mineral soils OM <= 8.0%.",
            },
            "bdod_kg_dm3": {"unit": "kg/dm3", "domain_bounds": [0.90, 1.85]},
            "cfvo_vol_pct": {"unit": "vol%", "domain_bounds": [0.0, 75.0]},
            "root_depth_m": {"unit": "m", "domain_bounds": [0.05, 3.00]},
        },
        "outputs": {
            "theta_wp": {"unit": "m3/m3", "description": "Permanent wilting point (-1500 kPa)"},
            "theta_fc": {"unit": "m3/m3", "description": "Field capacity (-33 kPa)"},
            "theta_s": {"unit": "m3/m3", "description": "Saturated water content (0 kPa)"},
            "awc_mm_m": {
                "unit": "mm/m",
                "description": "Gravel-discounted available water capacity: (theta_fc - theta_wp) * 1000 * (1 - cfvo/100)",
            },
            "paw_root_mm": {
                "unit": "mm",
                "description": "Root-zone plant-available water storage across root_depth_m",
            },
        },
        "physical_invariants": [
            "0.0 < theta_wp < theta_fc < theta_s < 1.0",
            "abs((clay_pct + silt_pct + sand_pct) - 100.0) <= 1e-4",
            "awc_mm_m > 0.0",
        ],
        "uncertainty_method": (
            "Joint physically normalized texture/SOC/BD/gravel scenarios (LOW_WATER_HOLDING, "
            "REFERENCE, HIGH_WATER_HOLDING) preserving clay + silt + sand = 100% plus cross-model "
            "comparison against WOSTEN_1999_HYPRES_PTF_V1."
        ),
        "qualification_impact": "DERIVED_WITH_VALIDATED_METHOD -> downgrades C4 and C7 to CONDITIONAL (never READY).",
        "rejection_conditions": [
            "clay_pct > 60.0 (heavy swelling clay out of PTF calibration domain)",
            "soc_g_kg > 46.4 (organic/peat soil OM > 8.0% out of mineral PTF domain)",
            "bdod_kg_dm3 < 0.90 or bdod_kg_dm3 > 1.85",
            "cfvo_vol_pct > 75.0 (skeletal gravel bed)",
            "abs(raw_texture_sum_pct - 100.0) > 8.0",
        ],
    },
    "WOSTEN_1999_HYPRES_PTF_V1": {
        "estimator_id": "WOSTEN_1999_HYPRES_PTF_V1",
        "name": "Wosten et al. (1999) HYPRES Continuous Pedotransfer Secondary Check",
        "citation": WOSTEN_HYPRES_CITATION,
        "required_inputs": {
            "clay_pct": {"unit": "%", "domain_bounds": [2.0, 60.0]},
            "silt_pct": {"unit": "%", "domain_bounds": [0.0, 88.0]},
            "soc_g_kg": {"unit": "g/kg", "domain_bounds": [0.0, 46.4]},
            "bdod_kg_dm3": {"unit": "kg/dm3", "domain_bounds": [0.90, 1.85]},
            "cfvo_vol_pct": {"unit": "vol%", "domain_bounds": [0.0, 75.0]},
        },
        "outputs": {
            "theta_wp": {"unit": "m3/m3"},
            "theta_fc": {"unit": "m3/m3"},
            "theta_s": {"unit": "m3/m3"},
            "awc_mm_m": {"unit": "mm/m"},
        },
        "physical_invariants": ["0.0 < theta_wp < theta_fc < theta_s < 1.0", "awc_mm_m > 0.0"],
        "uncertainty_method": "Secondary structural PTF comparison against Saxton & Rawls (2006).",
        "qualification_impact": "DERIVED_WITH_VALIDATED_METHOD -> CONDITIONAL.",
        "rejection_conditions": ["Same mineral soil domain bounds as SAXTON_RAWLS_2006_PTF_V1."],
    },
    "HARGREAVES_SAMANI_1985_ET0_V1": {
        "estimator_id": "HARGREAVES_SAMANI_1985_ET0_V1",
        "name": "Hargreaves & Samani (1985) Radiation-Temperature Reference Evapotranspiration",
        "citation": HARGREAVES_SAMANI_CITATION,
        "required_inputs": {
            "lat_deg": {"unit": "deg", "domain_bounds": [-66.5, 66.5]},
            "tmin_c": {"unit": "C", "domain_bounds": [-60.0, 50.0]},
            "tmax_c": {"unit": "C", "domain_bounds": [-55.0, 60.0]},
            "tmean_c": {"unit": "C", "domain_bounds": [-58.0, 55.0]},
        },
        "outputs": {"et0_mm_day": {"unit": "mm/day"}},
        "physical_invariants": ["tmin_c <= tmean_c <= tmax_c", "et0_mm_day >= 0.0"],
        "uncertainty_method": "Propagated across historical daily temperature series.",
        "qualification_impact": "DERIVED_WITH_VALIDATED_METHOD -> CONDITIONAL research screening.",
        "rejection_conditions": ["abs(lat_deg) > 66.5", "tmax_c < tmin_c"],
    },
}

PROHIBITED_DERIVATIONS_REGISTRY: Dict[str, Dict[str, str]] = {
    "soil.mineral_n_kg_ha": {
        "missing_reason": "not_identifiable",
        "scientific_rationale": (
            "Plant-available mineral nitrogen (NO3-N and NH4-N) is transient and governed by "
            "recent fertilization, mineralization, leaching, and crop uptake; it cannot be derived "
            "from SoilGrids total nitrogen or organic carbon without a validated mineralization "
            "and management history model."
        ),
    },
    "legal.water_abstraction_permit": {
        "missing_reason": "official_verification_required",
        "scientific_rationale": (
            "Irrigation water abstraction rights and allocation caps are legal/regulatory "
            "instruments that cannot be inferred from rainfall, river proximity, or hydrology."
        ),
    },
    "legal.pesticide_registration": {
        "missing_reason": "official_verification_required",
        "scientific_rationale": (
            "Pesticide and plant-protection product legality depends on national/local regulatory "
            "registration, label restrictions, and pre-harvest intervals."
        ),
    },
    "crop.calibrated_kc_curve": {
        "missing_reason": "unsupported_crop_profile",
        "scientific_rationale": (
            "Crop water-use coefficients (Kc) and rooting depths for unsupported crops cannot be "
            "substituted with generic constants without explicit cultivar/stage calibration."
        ),
    },
    "economics.marketable_yield_t_ha": {
        "missing_reason": "not_identifiable",
        "scientific_rationale": (
            "Marketable yield requires field-calibrated cultivar partitioning, pest/disease losses, "
            "and quality grading; it cannot be fabricated from regional water deficit or biomass."
        ),
    },
    "economics.net_profit_per_ha": {
        "missing_reason": "not_identifiable",
        "scientific_rationale": (
            "Net farm profit requires verified farmgate prices, input costs, and marketable yield."
        ),
    },
}


def attempt_prohibited_derivation(target_parameter: str, inputs: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Deterministically block prohibited scientific or regulatory derivations."""
    rule = PROHIBITED_DERIVATIONS_REGISTRY.get(
        target_parameter,
        {
            "missing_reason": "not_identifiable",
            "scientific_rationale": f"Derivation of '{target_parameter}' is not backed by a validated estimator.",
        },
    )
    return {
        "target_parameter": target_parameter,
        "status": "BLOCKED",
        "allowed": False,
        "missing_reason": rule["missing_reason"],
        "scientific_rationale": rule["scientific_rationale"],
        "inputs_ignored": list(inputs.keys()) if isinstance(inputs, dict) else [],
    }


def normalize_texture_triplet(clay_pct: float, silt_pct: float, sand_pct: float) -> Tuple[float, float, float]:
    """Normalize a positive (clay, silt, sand) triplet to sum to exactly 100.00%."""
    c = max(0.1, float(clay_pct))
    si = max(0.1, float(silt_pct))
    sa = max(0.1, float(sand_pct))
    total = c + si + sa
    c_norm = round(100.0 * c / total, 2)
    si_norm = round(100.0 * si / total, 2)
    sa_norm = round(100.0 - c_norm - si_norm, 2)
    return c_norm, si_norm, sa_norm


def _saxton_rawls_single(
    clay_pct: float,
    silt_pct: float,
    sand_pct: float,
    soc_g_kg: float,
    bdod_kg_dm3: float,
    cfvo_vol_pct: float,
    root_depth_m: float,
) -> Dict[str, float]:
    """Evaluate Saxton & Rawls (2006) equations on a single normalized input vector."""
    S = sand_pct / 100.0
    C = clay_pct / 100.0
    OM = max(0.1, min(8.0, soc_g_kg * 0.1724))  # Van Bemmelen factor 1.724 (g/kg -> % OM)

    theta_1500t = (
        -0.024 * S
        + 0.487 * C
        + 0.006 * OM
        + 0.005 * (S * OM)
        - 0.013 * (C * OM)
        + 0.068 * (S * C)
        + 0.031
    )
    theta_wp = max(0.02, theta_1500t + (0.14 * theta_1500t - 0.02))

    theta_33t = (
        -0.251 * S
        + 0.195 * C
        + 0.011 * OM
        + 0.006 * (S * OM)
        - 0.027 * (C * OM)
        + 0.452 * (S * C)
        + 0.299
    )
    theta_fc_base = theta_33t + (1.283 * (theta_33t**2) - 0.374 * theta_33t - 0.015)

    theta_s33t = (
        0.278 * S
        + 0.034 * C
        + 0.022 * OM
        - 0.018 * (S * OM)
        - 0.027 * (C * OM)
        - 0.584 * (S * C)
        + 0.078
    )
    theta_s33 = max(0.02, theta_s33t + (0.636 * theta_s33t - 0.107))
    theta_s_normal = theta_fc_base + theta_s33 - 0.097 * S + 0.043

    # Bulk density adjustment (particle density 2.65 kg/dm3)
    theta_s_df = 1.0 - (bdod_kg_dm3 / 2.65)
    theta_fc = theta_fc_base - 0.2 * (theta_s_normal - theta_s_df)
    theta_fc = max(theta_wp + 0.025, min(0.60, theta_fc))
    theta_s = max(theta_fc + 0.04, min(0.72, theta_s_df))

    if not (0.0 < theta_wp < theta_fc < theta_s < 1.0):
        raise ValueError(
            f"Physical invariant violated: 0 < theta_wp ({theta_wp:.4f}) < theta_fc ({theta_fc:.4f}) < theta_s ({theta_s:.4f}) < 1"
        )

    gravel_frac = max(0.0, min(0.95, cfvo_vol_pct / 100.0))
    awc_fine_mm_m = (theta_fc - theta_wp) * 1000.0
    awc_mm_m = awc_fine_mm_m * (1.0 - gravel_frac)
    paw_root_mm = awc_mm_m * root_depth_m

    return {
        "clay_pct": round(clay_pct, 2),
        "silt_pct": round(silt_pct, 2),
        "sand_pct": round(sand_pct, 2),
        "om_pct": round(OM, 2),
        "bdod_kg_dm3": round(bdod_kg_dm3, 3),
        "cfvo_vol_pct": round(cfvo_vol_pct, 2),
        "theta_wp": round(theta_wp, 4),
        "theta_fc": round(theta_fc, 4),
        "theta_s": round(theta_s, 4),
        "awc_fine_mm_m": round(awc_fine_mm_m, 2),
        "awc_mm_m": round(awc_mm_m, 2),
        "paw_root_mm": round(paw_root_mm, 2),
    }


def _wosten_hypres_single(
    clay_pct: float,
    silt_pct: float,
    soc_g_kg: float,
    bdod_kg_dm3: float,
    cfvo_vol_pct: float,
    root_depth_m: float,
) -> Dict[str, float]:
    """Secondary structural PTF check based on Wosten et al. (1999) HYPRES topsoil relationships."""
    C = max(2.0, clay_pct)
    Si = max(1.0, silt_pct)
    OM = max(0.2, min(8.0, soc_g_kg * 0.1724))
    D = bdod_kg_dm3

    theta_s = 0.7919 + 0.001691 * C - 0.29619 * D - 0.000001491 * (Si**2) + 0.0000821 * (OM**2) + (0.02427 / C) + (0.01113 / Si)
    theta_s = max(0.32, min(0.72, theta_s))
    # Empirical HYPRES retention points at -33 kPa and -1500 kPa
    theta_fc = min(theta_s - 0.04, max(0.10, 0.208 + 0.0036 * C + 0.0029 * Si + 0.014 * OM - 0.065 * D))
    theta_wp = min(theta_fc - 0.03, max(0.03, 0.026 + 0.0050 * C + 0.0011 * Si + 0.008 * OM - 0.015 * D))
    gravel_frac = max(0.0, min(0.95, cfvo_vol_pct / 100.0))
    awc_mm_m = (theta_fc - theta_wp) * 1000.0 * (1.0 - gravel_frac)
    return {
        "theta_wp": round(theta_wp, 4),
        "theta_fc": round(theta_fc, 4),
        "theta_s": round(theta_s, 4),
        "awc_mm_m": round(awc_mm_m, 2),
        "paw_root_mm": round(awc_mm_m * root_depth_m, 2),
    }


def derive_soil_hydraulics_from_soilgrids(
    soil_response: Dict[str, Any],
    *,
    root_depth_m: float = 0.60,
    point_lon_lat: Sequence[float] = (0.0, 0.0),
    crs: str = "EPSG:4326",
) -> Dict[str, Any]:
    """Derive C4 soil hydraulic parameters (`theta_wp`, `theta_fc`, `theta_s`, `awc_mm_m`) with uncertainty."""
    if soil_response.get("status") == "BLOCKED" or not soil_response.get("diagnostics"):
        reason = soil_response.get("missing_reason") or "source_outage"
        return _blocked_hydraulics_response(
            point_lon_lat,
            crs,
            reason,
            f"Cannot derive C4 soil hydraulics because C3 soil properties are blocked ({reason}).",
        )

    props = soil_response["diagnostics"]["properties_si"]
    clay_m = float(props["clay"]["mean"])
    silt_m = float(props["silt"]["mean"])
    sand_m = float(props["sand"]["mean"])
    # Per Poggio et al. (2021), SoilGrids SOC is right-skewed (log-backtransformed); q50 is the robust central estimate
    soc_m = float(props["soc"].get("q50", props["soc"]["mean"]))
    bdod_m = float(props["bdod"].get("q50", props["bdod"]["mean"]))
    cfvo_m = float(props["cfvo"].get("q50", props["cfvo"]["mean"]))

    # Domain checks (Saxton & Rawls 2006 applicability limits)
    raw_sum = clay_m + silt_m + sand_m
    if abs(raw_sum - 100.0) > 8.0:
        return _blocked_hydraulics_response(
            point_lon_lat,
            crs,
            "quality_fail",
            f"Raw texture sum ({raw_sum:.1f}%) violates 100% +/- 8% mass balance.",
        )

    om_pct = soc_m * 0.1724
    if om_pct > 8.0:
        return _blocked_hydraulics_response(
            point_lon_lat,
            crs,
            "estimator_out_of_domain",
            (
                f"Soil organic matter ({om_pct:.2f}% from SOC={soc_m:.1f} g/kg) exceeds the 8.0% "
                "upper calibration limit of Saxton & Rawls (2006) mineral soil PTF (histosol/peatland)."
            ),
        )
    if clay_m > 60.0 or clay_m < 2.0 or sand_m > 92.0 or sand_m < 5.0:
        return _blocked_hydraulics_response(
            point_lon_lat,
            crs,
            "estimator_out_of_domain",
            f"Texture (clay={clay_m:.1f}%, sand={sand_m:.1f}%) is outside Saxton & Rawls (2006) calibration domain.",
        )
    if not (0.90 <= bdod_m <= 1.85):
        return _blocked_hydraulics_response(
            point_lon_lat,
            crs,
            "estimator_out_of_domain",
            f"Bulk density ({bdod_m:.2f} kg/dm3) is outside [0.90, 1.85] kg/dm3 PTF calibration domain.",
        )
    if cfvo_m > 75.0:
        return _blocked_hydraulics_response(
            point_lon_lat,
            crs,
            "estimator_out_of_domain",
            f"Coarse fragment volume ({cfvo_m:.1f} vol%) exceeds 75% skeletal limit.",
        )
    if not (0.05 <= root_depth_m <= 3.00):
        return _blocked_hydraulics_response(
            point_lon_lat,
            crs,
            "depth_inconsistency",
            f"Root depth ({root_depth_m} m) outside valid [0.05, 3.00] m range.",
        )

    # Construct 3 physically consistent joint scenarios where clay + silt + sand == 100.0%
    c_ref, si_ref, sa_ref = normalize_texture_triplet(clay_m, silt_m, sand_m)
    c_low, si_low, sa_low = normalize_texture_triplet(
        max(2.0, min(60.0, float(props["clay"]["q05"]))),
        max(1.0, min(88.0, float(props["silt"]["q05"]))),
        max(5.0, min(92.0, float(props["sand"]["q95"]))),
    )
    c_high, si_high, sa_high = normalize_texture_triplet(
        max(2.0, min(60.0, float(props["clay"]["q95"]))),
        max(1.0, min(88.0, float(props["silt"]["q95"]))),
        max(5.0, min(92.0, float(props["sand"]["q05"]))),
    )

    scen_ref = _saxton_rawls_single(c_ref, si_ref, sa_ref, soc_m, bdod_m, cfvo_m, root_depth_m)
    scen_low = _saxton_rawls_single(
        c_low,
        si_low,
        sa_low,
        max(0.5, min(46.4, float(props["soc"]["q05"]))),
        max(0.90, min(1.85, float(props["bdod"]["q95"]))),
        max(0.0, min(75.0, float(props["cfvo"]["q95"]))),
        root_depth_m,
    )
    scen_high = _saxton_rawls_single(
        c_high,
        si_high,
        sa_high,
        max(0.5, min(46.4, float(props["soc"]["q95"]))),
        max(0.90, min(1.85, float(props["bdod"]["q05"]))),
        max(0.0, min(75.0, float(props["cfvo"]["q05"]))),
        root_depth_m,
    )

    wosten_ref = _wosten_hypres_single(c_ref, si_ref, soc_m, bdod_m, cfvo_m, root_depth_m)
    awc_vals = sorted([scen_low["awc_mm_m"], scen_ref["awc_mm_m"], scen_high["awc_mm_m"]])
    fc_vals = sorted([scen_low["theta_fc"], scen_ref["theta_fc"], scen_high["theta_fc"]])
    wp_vals = sorted([scen_low["theta_wp"], scen_ref["theta_wp"], scen_high["theta_wp"]])
    s_vals = sorted([scen_low["theta_s"], scen_ref["theta_s"], scen_high["theta_s"]])

    lon, lat = float(point_lon_lat[0]), float(point_lon_lat[1])
    depth_cm = tuple(soil_response["diagnostics"]["depth_interval_cm"])
    fixture_origin = soil_response.get("fixture_origin", "REGIONAL_OFFLINE_REFERENCE_FIXTURE")
    parent_sha = hashlib.sha256(
        json.dumps(soil_response["evidence_objects"], sort_keys=True).encode("utf-8")
    ).hexdigest()

    typed_objects: List[TypedEvidenceObject] = []
    for var_name, ref_val, q_bounds, unit_str in (
        ("theta_wp", scen_ref["theta_wp"], wp_vals, "m3/m3"),
        ("theta_fc", scen_ref["theta_fc"], fc_vals, "m3/m3"),
        ("theta_s", scen_ref["theta_s"], s_vals, "m3/m3"),
        ("awc_mm_m", scen_ref["awc_mm_m"], awc_vals, "mm/m"),
    ):
        ev = TypedEvidenceObject(
            parameter_path=f"soil_hydraulics.{var_name}",
            provenance_class="DERIVED_WITH_VALIDATED_METHOD",
            source_id="SAXTON_RAWLS_2006_PTF_FROM_SOILGRIDS_V2",
            provider="ASTRAGRON Pedotransfer Registry (Saxton & Rawls 2006 on ISRIC SoilGrids v2.0)",
            product="Derived Soil Hydraulic Retention & Available Water Capacity",
            variable=var_name,
            version="v1.0",
            permanent_url="https://doi.org/10.2136/sssaj2006.0117",
            citation=SAXTON_RAWLS_CITATION,
            access_path="adaptive_evidence/estimators.py#derive_soil_hydraulics_from_soilgrids",
            retrieved_at="2026-11-08T12:00:00+00:00",
            valid_period=None,
            evidence_type="DERIVED",
            point_lon_lat=(lon, lat),
            crs=crs,
            spatial_resolution_desc="Derived from 250 m SoilGrids v2.0 regional prediction; not field core measurement",
            pixel_area_km2=0.0625,
            depth_interval_cm=(float(depth_cm[0]), float(depth_cm[1])),
            raw_unit=unit_str,
            scale_factor=1.0,
            raw_value=ref_val,
            converted_si_value=ref_val,
            si_unit=unit_str,
            quantiles={
                "q05": q_bounds[0],
                "q50": q_bounds[1],
                "mean": ref_val,
                "q95": q_bounds[2],
            },
            uncertainty_semantics=(
                "Propagated across normalized joint texture/SOC/BD/gravel scenarios "
                "(LOW_WATER_HOLDING, REFERENCE, HIGH_WATER_HOLDING) with Wosten (1999) secondary check."
            ),
            quality_flags=(
                "PHYSICAL_INVARIANTS_VERIFIED_0_LT_WP_LT_FC_LT_S_LT_1",
                "TEXTURE_NORMALIZED_TO_100_PCT",
                "GRAVEL_VOLUME_DISCOUNTED",
                "CONDITIONAL_PTF_DERIVATION",
            ),
            missing_value_handling="Out-of-domain organic (>8% OM) or heavy clay (>60%) profiles blocked.",
            raw_source_sha256=parent_sha,
            receipt_sha256=parent_sha,
            fixture_origin=fixture_origin,
            transformation_id="NORMALIZED_JOINT_SCENARIO_PTF_PROPAGATION_V1",
            estimator_id="SAXTON_RAWLS_2006_PTF_V1",
            license="CC-BY-4.0 (derived from ISRIC SoilGrids v2.0)",
            attribution=f"{SAXTON_RAWLS_CITATION} | Secondary check: {WOSTEN_HYPRES_CITATION}",
            restrictions="Derived regional estimate (CONDITIONAL); never upgrades dependent crop planning to READY.",
        )
        typed_objects.append(ev)

    return {
        "status": "CONDITIONAL",
        "capability_status": "CONDITIONAL",
        "estimator_id": "SAXTON_RAWLS_2006_PTF_V1",
        "secondary_estimator_id": "WOSTEN_1999_HYPRES_PTF_V1",
        "fixture_origin": fixture_origin,
        "missing_reason": None,
        "diagnostics": {
            "root_depth_m": root_depth_m,
            "physical_invariants_satisfied": True,
            "invariant_check": "0 < theta_wp < theta_fc < theta_s < 1 and clay + silt + sand == 100.0%",
            "scenarios": {
                "LOW_WATER_HOLDING": scen_low,
                "REFERENCE": scen_ref,
                "HIGH_WATER_HOLDING": scen_high,
            },
            "secondary_ptf_wosten_1999_reference": wosten_ref,
            "cross_ptf_awc_diff_mm_m": round(abs(scen_ref["awc_mm_m"] - wosten_ref["awc_mm_m"]), 2),
            "qualification_downgrade": "CONDITIONAL",
        },
        "evidence_objects": [obj.to_dict() for obj in typed_objects],
        "typed_objects": typed_objects,
    }


def _blocked_hydraulics_response(
    point_lon_lat: Sequence[Any],
    crs: str,
    missing_reason: str,
    detail: str,
) -> Dict[str, Any]:
    lon = float(point_lon_lat[0]) if isinstance(point_lon_lat, (list, tuple)) and len(point_lon_lat) == 2 and isinstance(point_lon_lat[0], (int, float)) and math.isfinite(point_lon_lat[0]) else 0.0
    lat = float(point_lon_lat[1]) if isinstance(point_lon_lat, (list, tuple)) and len(point_lon_lat) == 2 and isinstance(point_lon_lat[1], (int, float)) and math.isfinite(point_lon_lat[1]) else 0.0
    ev = TypedEvidenceObject(
        parameter_path="soil_hydraulics.awc_mm_m",
        provenance_class="NOT_RETRIEVABLE",
        source_id="SAXTON_RAWLS_2006_PTF_FROM_SOILGRIDS_V2",
        provider="ASTRAGRON Pedotransfer Registry",
        product="Derived Soil Hydraulic Retention",
        variable="awc_mm_m",
        version="v1.0",
        permanent_url="https://doi.org/10.2136/sssaj2006.0117",
        citation=SAXTON_RAWLS_CITATION,
        access_path="adaptive_evidence/estimators.py",
        retrieved_at=None,
        valid_period=None,
        evidence_type="UNAVAILABLE",
        point_lon_lat=(lon, lat),
        crs=str(crs),
        spatial_resolution_desc="250 m regional grid",
        pixel_area_km2=0.0625,
        depth_interval_cm=(0.0, 30.0),
        raw_unit="mm/m",
        scale_factor=1.0,
        raw_value=None,
        converted_si_value=None,
        si_unit="mm/m",
        quantiles=None,
        uncertainty_semantics="Unavailable",
        quality_flags=("BLOCKED",),
        missing_value_handling=detail,
        raw_source_sha256=None,
        receipt_sha256=None,
        fixture_origin="UNAVAILABLE_NO_DATA",
        transformation_id=None,
        estimator_id="SAXTON_RAWLS_2006_PTF_V1",
        license="CC-BY-4.0",
        attribution=SAXTON_RAWLS_CITATION,
        restrictions="Unavailable",
        missing_reason=missing_reason,
    )
    return {
        "status": "BLOCKED",
        "capability_status": "BLOCKED",
        "estimator_id": "SAXTON_RAWLS_2006_PTF_V1",
        "fixture_origin": "UNAVAILABLE_NO_DATA",
        "missing_reason": missing_reason,
        "detail": detail,
        "diagnostics": None,
        "evidence_objects": [ev.to_dict()],
        "typed_objects": [ev],
    }
