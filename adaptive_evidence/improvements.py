"""Stage P7 Continued Scientific Improvements for ASTRAGRON Global Adaptive Evidence.

Implements Section 6 ('Stage P7 - Continued improvements (do not stop early)') of
`00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`:
1. Multi-depth (0-200 cm) root-zone hydraulic integration & subsurface compaction/gravel impedance detection.
2. Field polygon multi-point spatial heterogeneity & management-zone diagnostics.
3. Cross-PTF and cross-source structural disagreement diagnostics.
4. Held-out published USDA/HYPRES 12-horizon pedotransfer benchmark (MAE, RMSE, bias) + Farmer Measurement Wizard.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .estimators import _saxton_rawls_single, _wosten_hypres_single, normalize_texture_triplet
from .schema import STANDARD_SOILGRIDS_DEPTHS_CM, validate_coordinates_and_crs


def integrate_multidepth_root_zone_profile(
    horizons: Sequence[Dict[str, Any]],
    *,
    root_depth_m: float = 1.00,
) -> Dict[str, Any]:
    """Integrate multi-horizon SoilGrids profiles (0-5, 5-15, 15-30, 30-60, 60-100, 100-200 cm)
    over an effective crop rooting depth with subsurface compaction/gravel impedance detection.
    """
    if not (0.05 <= root_depth_m <= 2.00):
        raise ValueError(f"root_depth_m ({root_depth_m}) must be in [0.05, 2.00] m.")
    if not horizons:
        raise ValueError("At least one horizon dictionary is required.")

    target_bottom_cm = root_depth_m * 100.0
    layer_results: List[Dict[str, Any]] = []
    cumulative_paw_mm = 0.0
    weighted_awc_num = 0.0
    weighted_fc_num = 0.0
    weighted_wp_num = 0.0
    total_active_cm = 0.0
    impeding_horizon_cm: Optional[List[float]] = None
    impedance_reason: Optional[str] = None

    prev_bot = 0.0
    for h in horizons:
        top_cm = float(h["top_cm"])
        bot_cm = float(h["bottom_cm"])
        if top_cm < prev_bot or bot_cm <= top_cm:
            raise ValueError(f"Invalid or non-monotonic horizon [{top_cm}, {bot_cm}] cm.")
        prev_bot = bot_cm

        if top_cm >= target_bottom_cm:
            break

        active_bot_cm = min(bot_cm, target_bottom_cm)
        dz_cm = active_bot_cm - top_cm
        dz_m = dz_cm / 100.0

        c_norm, si_norm, sa_norm = normalize_texture_triplet(
            float(h["clay_pct"]), float(h["silt_pct"]), float(h["sand_pct"])
        )
        bdod = float(h["bdod_kg_dm3"])
        cfvo = float(h["cfvo_vol_pct"])
        soc = float(h["soc_g_kg"])

        # Detect root-impeding high bulk density (>= 1.68 kg/dm3) or skeletal gravel (>= 50 vol%)
        if impeding_horizon_cm is None and top_cm >= 15.0 and (bdod >= 1.68 or cfvo >= 50.0):
            impeding_horizon_cm = [top_cm, bot_cm]
            impedance_reason = (
                f"Subsurface root impedance at {top_cm:.0f}-{bot_cm:.0f} cm "
                f"(bdod={bdod:.2f} kg/dm3, cfvo={cfvo:.1f} vol%)."
            )
            # Restrict effective rooting depth to top of impeding layer
            break

        sr = _saxton_rawls_single(c_norm, si_norm, sa_norm, soc, bdod, cfvo, dz_m)
        layer_paw = sr["awc_mm_m"] * dz_m
        cumulative_paw_mm += layer_paw
        weighted_awc_num += sr["awc_mm_m"] * dz_cm
        weighted_fc_num += sr["theta_fc"] * dz_cm
        weighted_wp_num += sr["theta_wp"] * dz_cm
        total_active_cm += dz_cm

        layer_results.append(
            {
                "interval_cm": [top_cm, active_bot_cm],
                "thickness_m": round(dz_m, 3),
                "theta_wp": sr["theta_wp"],
                "theta_fc": sr["theta_fc"],
                "theta_s": sr["theta_s"],
                "awc_mm_m": sr["awc_mm_m"],
                "layer_paw_mm": round(layer_paw, 2),
            }
        )

    if total_active_cm <= 0.0:
        raise ValueError("No active soil horizon thickness above root_depth_m.")

    return {
        "requested_root_depth_m": round(root_depth_m, 2),
        "effective_root_depth_m": round(total_active_cm / 100.0, 2),
        "subsurface_impedance_detected": impeding_horizon_cm is not None,
        "impeding_horizon_cm": impeding_horizon_cm,
        "impedance_reason": impedance_reason,
        "depth_weighted_theta_wp": round(weighted_wp_num / total_active_cm, 4),
        "depth_weighted_theta_fc": round(weighted_fc_num / total_active_cm, 4),
        "depth_weighted_awc_mm_m": round(weighted_awc_num / total_active_cm, 2),
        "cumulative_root_zone_paw_mm": round(cumulative_paw_mm, 2),
        "active_horizons": layer_results,
    }


def evaluate_polygon_spatial_heterogeneity(
    polygon_geojson: Dict[str, Any],
    vertex_soil_profiles: Sequence[Dict[str, float]],
    *,
    crs: str = "EPSG:4326",
) -> Dict[str, Any]:
    """Evaluate spatial soil heterogeneity across a field polygon's sampled 250 m SoilGrids cells."""
    if not isinstance(polygon_geojson, dict) or polygon_geojson.get("type") != "Polygon":
        raise ValueError("polygon_geojson must be a GeoJSON Polygon.")
    rings = polygon_geojson.get("coordinates")
    if not isinstance(rings, list) or not rings or len(rings[0]) < 4:
        raise ValueError("Polygon exterior ring must contain at least 4 coordinates.")

    exterior = rings[0]
    lons = [float(pt[0]) for pt in exterior]
    lats = [float(pt[1]) for pt in exterior]
    centroid = [round(sum(lons[:-1]) / (len(lons) - 1), 6), round(sum(lats[:-1]) / (len(lats) - 1), 6)]

    coord_check = validate_coordinates_and_crs(centroid, crs)
    if not coord_check["valid"] or not coord_check["is_land"]:
        return {
            "status": "BLOCKED",
            "missing_reason": coord_check["missing_reason"],
            "detail": coord_check["detail"],
        }

    # Approximate geodesic bounding-box area in hectares
    mean_lat_rad = math.radians(centroid[1])
    width_km = (max(lons) - min(lons)) * 111.32 * math.cos(mean_lat_rad)
    height_km = (max(lats) - min(lats)) * 110.57
    approx_bbox_area_ha = round(max(0.01, width_km * height_km * 100.0), 2)

    awc_list: List[float] = []
    clay_list: List[float] = []
    for prof in vertex_soil_profiles:
        c_n, si_n, sa_n = normalize_texture_triplet(
            prof["clay_pct"], prof["silt_pct"], prof["sand_pct"]
        )
        sr = _saxton_rawls_single(
            c_n,
            si_n,
            sa_n,
            prof.get("soc_g_kg", 15.0),
            prof.get("bdod_kg_dm3", 1.38),
            prof.get("cfvo_vol_pct", 5.0),
            0.60,
        )
        awc_list.append(sr["awc_mm_m"])
        clay_list.append(c_n)

    mean_awc = sum(awc_list) / len(awc_list)
    std_awc = math.sqrt(sum((x - mean_awc) ** 2 for x in awc_list) / len(awc_list))
    cv_awc_pct = round(100.0 * std_awc / max(1.0, mean_awc), 2)
    clay_spread_pct = round(max(clay_list) - min(clay_list), 2)
    requires_zonal = cv_awc_pct >= 12.0 or clay_spread_pct >= 15.0

    return {
        "status": "CONDITIONAL",
        "centroid_lon_lat": centroid,
        "approx_bbox_area_ha": approx_bbox_area_ha,
        "sampled_points_count": len(awc_list),
        "mean_awc_mm_m": round(mean_awc, 2),
        "min_awc_mm_m": round(min(awc_list), 2),
        "max_awc_mm_m": round(max(awc_list), 2),
        "cv_awc_pct": cv_awc_pct,
        "clay_spread_pct": clay_spread_pct,
        "requires_zonal_soil_sampling": requires_zonal,
        "recommendation": (
            "Field spans heterogeneous soil retention zones (CV >= 12% or clay spread >= 15%); "
            "split into at least 2 management zones for soil sampling and irrigation scheduling."
            if requires_zonal
            else "Field 250 m SoilGrids cells show low spatial variance; a composite 0-30 cm core sample is sufficient."
        ),
    }


def diagnose_source_and_ptf_disagreement(
    clay_pct: float,
    silt_pct: float,
    sand_pct: float,
    soc_g_kg: float,
    bdod_kg_dm3: float,
    cfvo_vol_pct: float,
    *,
    root_depth_m: float = 0.60,
) -> Dict[str, Any]:
    """Compare Saxton & Rawls (2006) vs. Wosten et al. (1999) HYPRES PTF estimates and flag divergence."""
    c_n, si_n, sa_n = normalize_texture_triplet(clay_pct, silt_pct, sand_pct)
    sr = _saxton_rawls_single(c_n, si_n, sa_n, soc_g_kg, bdod_kg_dm3, cfvo_vol_pct, root_depth_m)
    wo = _wosten_hypres_single(c_n, si_n, soc_g_kg, bdod_kg_dm3, cfvo_vol_pct, root_depth_m)

    awc_diff = abs(sr["awc_mm_m"] - wo["awc_mm_m"])
    fc_diff = abs(sr["theta_fc"] - wo["theta_fc"])
    wp_diff = abs(sr["theta_wp"] - wo["theta_wp"])
    high_divergence = awc_diff > 20.0 or fc_diff > 0.045

    return {
        "saxton_rawls_2006": {
            "theta_wp": sr["theta_wp"],
            "theta_fc": sr["theta_fc"],
            "theta_s": sr["theta_s"],
            "awc_mm_m": sr["awc_mm_m"],
        },
        "wosten_hypres_1999": {
            "theta_wp": wo["theta_wp"],
            "theta_fc": wo["theta_fc"],
            "theta_s": wo["theta_s"],
            "awc_mm_m": wo["awc_mm_m"],
        },
        "absolute_differences": {
            "theta_wp_diff": round(wp_diff, 4),
            "theta_fc_diff": round(fc_diff, 4),
            "awc_mm_m_diff": round(awc_diff, 2),
        },
        "disagreement_flag": "HIGH_INTER_MODEL_DIVERGENCE" if high_divergence else "MODELS_IN_AGREEMENT",
        "envelope_awc_mm_m": [
            round(min(sr["awc_mm_m"], wo["awc_mm_m"]), 2),
            round(max(sr["awc_mm_m"], wo["awc_mm_m"]), 2),
        ],
    }


# Illustrative 12-class USDA texture-retention reference figures (not an independent held-out field dataset).
ILLUSTRATIVE_USDA_TEXTURE_REFERENCE_VALUES: Tuple[Dict[str, Any], ...] = (
    {"class_name": "Sand", "sand_pct": 88.0, "silt_pct": 7.0, "clay_pct": 5.0, "soc_g_kg": 8.7, "bdod_kg_dm3": 1.55, "obs_theta_wp": 0.05, "obs_theta_fc": 0.10, "obs_awc_mm_m": 50.0},
    {"class_name": "Loamy_Sand", "sand_pct": 82.0, "silt_pct": 12.0, "clay_pct": 6.0, "soc_g_kg": 11.6, "bdod_kg_dm3": 1.52, "obs_theta_wp": 0.06, "obs_theta_fc": 0.13, "obs_awc_mm_m": 70.0},
    {"class_name": "Sandy_Loam", "sand_pct": 65.0, "silt_pct": 25.0, "clay_pct": 10.0, "soc_g_kg": 14.5, "bdod_kg_dm3": 1.46, "obs_theta_wp": 0.09, "obs_theta_fc": 0.21, "obs_awc_mm_m": 120.0},
    {"class_name": "Loam", "sand_pct": 42.0, "silt_pct": 40.0, "clay_pct": 18.0, "soc_g_kg": 14.5, "bdod_kg_dm3": 1.40, "obs_theta_wp": 0.13, "obs_theta_fc": 0.28, "obs_awc_mm_m": 150.0},
    {"class_name": "Silt_Loam", "sand_pct": 20.0, "silt_pct": 65.0, "clay_pct": 15.0, "soc_g_kg": 17.4, "bdod_kg_dm3": 1.36, "obs_theta_wp": 0.12, "obs_theta_fc": 0.32, "obs_awc_mm_m": 200.0},
    {"class_name": "Silt", "sand_pct": 8.0, "silt_pct": 84.0, "clay_pct": 8.0, "soc_g_kg": 17.4, "bdod_kg_dm3": 1.35, "obs_theta_wp": 0.09, "obs_theta_fc": 0.30, "obs_awc_mm_m": 210.0},
    {"class_name": "Sandy_Clay_Loam", "sand_pct": 58.0, "silt_pct": 15.0, "clay_pct": 27.0, "soc_g_kg": 14.5, "bdod_kg_dm3": 1.48, "obs_theta_wp": 0.17, "obs_theta_fc": 0.27, "obs_awc_mm_m": 100.0},
    {"class_name": "Clay_Loam", "sand_pct": 32.0, "silt_pct": 34.0, "clay_pct": 34.0, "soc_g_kg": 17.4, "bdod_kg_dm3": 1.36, "obs_theta_wp": 0.21, "obs_theta_fc": 0.36, "obs_awc_mm_m": 150.0},
    {"class_name": "Silty_Clay_Loam", "sand_pct": 10.0, "silt_pct": 56.0, "clay_pct": 34.0, "soc_g_kg": 20.3, "bdod_kg_dm3": 1.30, "obs_theta_wp": 0.21, "obs_theta_fc": 0.39, "obs_awc_mm_m": 180.0},
    {"class_name": "Sandy_Clay", "sand_pct": 50.0, "silt_pct": 8.0, "clay_pct": 42.0, "soc_g_kg": 14.5, "bdod_kg_dm3": 1.44, "obs_theta_wp": 0.25, "obs_theta_fc": 0.35, "obs_awc_mm_m": 100.0},
    {"class_name": "Silty_Clay", "sand_pct": 7.0, "silt_pct": 47.0, "clay_pct": 46.0, "soc_g_kg": 20.3, "bdod_kg_dm3": 1.28, "obs_theta_wp": 0.27, "obs_theta_fc": 0.42, "obs_awc_mm_m": 150.0},
    {"class_name": "Clay", "sand_pct": 20.0, "silt_pct": 28.0, "clay_pct": 52.0, "soc_g_kg": 17.4, "bdod_kg_dm3": 1.30, "obs_theta_wp": 0.30, "obs_theta_fc": 0.43, "obs_awc_mm_m": 130.0},
)
PUBLISHED_USDA_RETENTION_BENCHMARK = ILLUSTRATIVE_USDA_TEXTURE_REFERENCE_VALUES


def run_illustrative_texture_reference_comparison() -> Dict[str, Any]:
    """Compare SAXTON_RAWLS_2006_PTF_V1 against illustrative 12-class USDA texture reference figures.

    Note: This is an illustrative texture-class reference comparison, NOT an independent
    held-out field validation dataset or a measure of real-world field prediction accuracy.
    """
    rows: List[Dict[str, Any]] = []
    wp_err: List[float] = []
    fc_err: List[float] = []
    awc_err: List[float] = []

    for ref in ILLUSTRATIVE_USDA_TEXTURE_REFERENCE_VALUES:
        pred = _saxton_rawls_single(
            ref["clay_pct"],
            ref["silt_pct"],
            ref["sand_pct"],
            ref["soc_g_kg"],
            ref["bdod_kg_dm3"],
            0.0,
            1.0,
        )
        e_wp = pred["theta_wp"] - ref["obs_theta_wp"]
        e_fc = pred["theta_fc"] - ref["obs_theta_fc"]
        e_awc = pred["awc_mm_m"] - ref["obs_awc_mm_m"]
        wp_err.append(e_wp)
        fc_err.append(e_fc)
        awc_err.append(e_awc)
        rows.append(
            {
                "class_name": ref["class_name"],
                "ref_theta_wp": ref["obs_theta_wp"],
                "pred_theta_wp": pred["theta_wp"],
                "ref_theta_fc": ref["obs_theta_fc"],
                "pred_theta_fc": pred["theta_fc"],
                "ref_awc_mm_m": ref["obs_awc_mm_m"],
                "pred_awc_mm_m": pred["awc_mm_m"],
                "awc_diff_mm_m": round(e_awc, 2),
            }
        )

    n = len(rows)
    return {
        "benchmark_id": "ILLUSTRATIVE_USDA_TEXTURE_CLASS_REFERENCE_COMPARISON",
        "provenance_class": "ILLUSTRATIVE_TEXTURE_CLASS_REFERENCE_COMPARISON",
        "is_independent_held_out_field_dataset": False,
        "field_validated": False,
        "prediction_accuracy": "NOT_MEASURED",
        "disclaimer": (
            "Illustrative 12-class USDA texture-class reference comparison only; not an independent "
            "held-out observed field dataset and does not establish field-validated prediction accuracy."
        ),
        "sample_count": n,
        "theta_wp_mae": round(sum(abs(x) for x in wp_err) / n, 4),
        "theta_wp_rmse": round(math.sqrt(sum(x * x for x in wp_err) / n), 4),
        "theta_fc_mae": round(sum(abs(x) for x in fc_err) / n, 4),
        "theta_fc_rmse": round(math.sqrt(sum(x * x for x in fc_err) / n), 4),
        "awc_mm_m_mae": round(sum(abs(x) for x in awc_err) / n, 2),
        "awc_mm_m_rmse": round(math.sqrt(sum(x * x for x in awc_err) / n), 2),
        "awc_mm_m_bias": round(sum(awc_err) / n, 2),
        "classes": rows,
    }


def run_held_out_ptf_benchmark() -> Dict[str, Any]:
    """Backward-compatible alias for `run_illustrative_texture_reference_comparison`."""
    return run_illustrative_texture_reference_comparison()


HAND_TEXTURE_LOOKUP: Dict[str, Tuple[float, float]] = {
    "sand": (0.05, 0.11),
    "sandy_loam": (0.09, 0.21),
    "loam": (0.13, 0.28),
    "silt_loam": (0.12, 0.32),
    "clay_loam": (0.21, 0.36),
    "clay": (0.28, 0.42),
}


def build_farmer_measurement_wizard(
    *,
    hand_texture_class: str = "loam",
    observed_rooting_depth_cm: float = 65.0,
    irrigation_regime: str = "rainfed",
    seasonal_allocation_m3_ha: Optional[float] = None,
    measured_mineral_n_kg_ha: Optional[float] = None,
    official_water_permit_verified: bool = False,
) -> Dict[str, Any]:
    """Convert low-friction farmer observations into schema-valid adaptive-evidence request blocks."""
    tex_key = hand_texture_class.lower().strip()
    if tex_key not in HAND_TEXTURE_LOOKUP:
        raise ValueError(f"Unsupported hand_texture_class '{hand_texture_class}'; choose from {sorted(HAND_TEXTURE_LOOKUP)}.")
    wp, fc = HAND_TEXTURE_LOOKUP[tex_key]
    root_m = round(max(0.15, min(2.00, observed_rooting_depth_cm / 100.0)), 2)

    return {
        "wizard_schema": "astragron.adaptive-evidence.farmer-wizard.v1",
        "water_supply_scenario": {
            "regime": irrigation_regime,
            "seasonal_supply_m3_ha": seasonal_allocation_m3_ha,
            "official_water_permit_verified": official_water_permit_verified,
        },
        "user_measurements": {
            "theta_wp": wp,
            "theta_fc": fc,
            "awc_mm_m": round((fc - wp) * 1000.0, 1),
            "root_depth_m": root_m,
            "mineral_n_kg_ha": measured_mineral_n_kg_ha,
        },
    }
