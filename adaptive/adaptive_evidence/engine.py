"""Capability-Level Partial-Results Engine (`astragron.adaptive-evidence.v1`).

Implements Section 1 ('Target Capability Decomposition (C1-C10)'), Section 5
('Farmer-Friendly and API-Ready Output Design'), and Section 6 (Stage P3) of
`00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .adapters import FAOGAEZAdapter, NASAPowerAdapter, SoilGridsWCSAdapter
from .capabilities import CAPABILITY_REGISTRY
from .estimators import (
    ESTIMATOR_REGISTRY,
    PROHIBITED_DERIVATIONS_REGISTRY,
    attempt_prohibited_derivation,
    derive_soil_hydraulics_from_soilgrids,
)
from .quality_gate import EvidenceQualityGate, validate_user_measurement_metadata
from .schema import (
    TypedEvidenceObject,
    canonical_digest,
    validate_coordinates_and_crs,
    validate_depth_intervals,
    validate_period_and_leap_years,
)

# Documented FAO-56 / upstream water_core regional crop screening parameters (Allen et al., 1998)
SUPPORTED_REGIONAL_CROPS: Dict[str, Dict[str, Any]] = {
    "wheat": {"kc_mid": 1.15, "season_days": 150, "root_depth_m": 0.90, "depletion_p": 0.55, "drought_tol": 0.72, "family": "Poaceae"},
    "barley": {"kc_mid": 1.10, "season_days": 130, "root_depth_m": 0.85, "depletion_p": 0.55, "drought_tol": 0.80, "family": "Poaceae"},
    "oats": {"kc_mid": 1.12, "season_days": 135, "root_depth_m": 0.80, "depletion_p": 0.50, "drought_tol": 0.65, "family": "Poaceae"},
    "faba_bean": {"kc_mid": 1.15, "season_days": 140, "root_depth_m": 0.75, "depletion_p": 0.45, "drought_tol": 0.52, "family": "Fabaceae"},
    "rapeseed": {"kc_mid": 1.12, "season_days": 155, "root_depth_m": 0.95, "depletion_p": 0.55, "drought_tol": 0.68, "family": "Brassicaceae"},
    "potato": {"kc_mid": 1.15, "season_days": 130, "root_depth_m": 0.55, "depletion_p": 0.35, "drought_tol": 0.38, "family": "Solanaceae"},
    "maize": {"kc_mid": 1.20, "season_days": 140, "root_depth_m": 1.00, "depletion_p": 0.50, "drought_tol": 0.58, "family": "Poaceae"},
    "soybean": {"kc_mid": 1.15, "season_days": 135, "root_depth_m": 0.85, "depletion_p": 0.50, "drought_tol": 0.60, "family": "Fabaceae"},
    "sorghum": {"kc_mid": 1.05, "season_days": 125, "root_depth_m": 1.10, "depletion_p": 0.60, "drought_tol": 0.86, "family": "Poaceae"},
    "chickpea": {"kc_mid": 1.00, "season_days": 120, "root_depth_m": 0.80, "depletion_p": 0.55, "drought_tol": 0.84, "family": "Fabaceae"},
    "sunflower": {"kc_mid": 1.10, "season_days": 130, "root_depth_m": 1.15, "depletion_p": 0.55, "drought_tol": 0.78, "family": "Asteraceae"},
    "rice": {"kc_mid": 1.25, "season_days": 135, "root_depth_m": 0.50, "depletion_p": 0.25, "drought_tol": 0.25, "family": "Poaceae"},
}


class AdaptiveEvidenceEngine:
    """Evaluates C1-C10 independently and returns usable partial results with full provenance."""

    def __init__(
        self,
        nasa_adapter: Optional[NASAPowerAdapter] = None,
        soilgrids_adapter: Optional[SoilGridsWCSAdapter] = None,
        gaez_adapter: Optional[FAOGAEZAdapter] = None,
    ) -> None:
        self.nasa = nasa_adapter or NASAPowerAdapter()
        self.soilgrids = soilgrids_adapter or SoilGridsWCSAdapter()
        self.gaez = gaez_adapter or FAOGAEZAdapter()

    def evaluate(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate an `astragron.adaptive-evidence.request.v1` payload across C1-C10."""
        if not isinstance(request, dict):
            request = {}
        try:
            default_req_id = f"ae-{canonical_digest(request)[:12]}"
        except Exception:
            default_req_id = f"ae-{hashlib.sha256(repr(request).encode('utf-8')).hexdigest()[:12]}"
        req_id = str(request.get("request_id") or default_req_id)
        loc_raw = request.get("location")
        loc = loc_raw if isinstance(loc_raw, dict) else {}
        point_lon_lat = loc.get("point_lon_lat")
        crs = loc.get("crs", "EPSG:4326")
        geometry = loc.get("geometry")
        site_id = loc.get("site_id")
        as_of = request.get("as_of")

        period_raw = request.get("period")
        period = period_raw if isinstance(period_raw, dict) else {}
        start_iso = str(period.get("start", "2016-01-01"))
        end_iso = str(period.get("end", "2020-12-31"))
        depth_intervals = request.get("soil_depth_intervals_cm") or [[0, 5], [5, 15], [15, 30]]
        raw_candidate_crops = request.get("candidate_crops")
        candidate_crops = [str(c) for c in raw_candidate_crops] if isinstance(raw_candidate_crops, list) else []
        ws_raw = request.get("water_supply_scenario")
        water_supply = ws_raw if isinstance(ws_raw, dict) else {}
        um_raw = request.get("user_measurements")
        user_meas = um_raw if isinstance(um_raw, dict) else {}
        opt_raw = request.get("options")
        options = opt_raw if isinstance(opt_raw, dict) else {}

        acquisition = str(options.get("acquisition", "CACHE_ONLY"))
        allow_offline_ref = bool(options.get("allow_offline_reference_fixture", False))
        allow_cond_planning = bool(options.get("allow_conditional_crop_planning", False))
        allow_gaez_fixture = bool(options.get("allow_gaez_contract_fixture", False))
        sim_nasa_outage = bool(options.get("simulate_nasa_outage", False))
        sim_soil_outage = bool(options.get("simulate_soilgrids_outage", False))
        sim_corrupt = bool(options.get("simulate_corrupt_receipt", False))
        time_standard = str(options.get("time_standard", "UTC"))
        expected_time_standard = str(options.get("expected_time_standard", time_standard))
        max_age_days = options.get("max_age_days")
        max_distance_m = float(options.get("max_distance_m", 500.0))
        include_nitrogen = bool(options.get("include_nitrogen", False))
        soil_properties = options.get("soil_properties")
        soil_max_workers = options.get("soil_max_workers")
        soil_max_wall_time_s = options.get("soil_max_wall_time_s")

        evidence_ledger: List[Dict[str, Any]] = []
        prohibited_ledger: List[Dict[str, Any]] = []

        # --- C1: Geographic, Land, and Coordinate Identity ---
        coord_check = validate_coordinates_and_crs(point_lon_lat, crs, geometry)
        depth_check = validate_depth_intervals(depth_intervals)
        if not coord_check["valid"] or not coord_check["is_land"]:
            c1_status = "BLOCKED"
            c1_reason = coord_check["missing_reason"] or "invalid_coordinates_or_crs"
            c1_detail = coord_check["detail"]
        elif not depth_check["valid"]:
            c1_status = "BLOCKED"
            c1_reason = depth_check["missing_reason"]
            c1_detail = depth_check["detail"]
        else:
            c1_status = "READY"
            c1_reason = None
            c1_detail = coord_check["detail"]

        c1_payload = {
            "capability_id": "C1",
            "name": CAPABILITY_REGISTRY["C1"].name,
            "status": c1_status,
            "missing_reason": c1_reason,
            "detail": c1_detail,
            "point_lon_lat": coord_check.get("point_lon_lat"),
            "crs": crs,
            "land_status": coord_check.get("land_status"),
            "physical_surface": coord_check.get("physical_surface"),
            "distance_to_coast_m": coord_check.get("distance_to_coast_m"),
            "dataset_metadata": coord_check.get("dataset_metadata"),
            "polygon_evaluation": coord_check.get("polygon_evaluation"),
            "hemisphere": (
                "NORTHERN"
                if c1_status == "READY" and float(point_lon_lat[1]) >= 0.0
                else "SOUTHERN"
                if c1_status == "READY"
                else None
            ),
        }

        # If C1 is blocked due to invalid coordinates/CRS or invalid depth, block C2-C10 immediately
        if not coord_check["valid"] or not depth_check["valid"]:
            return self._build_c1_blocked_response(req_id, c1_payload, c1_reason, c1_detail, request=request)

        # --- C2: Historical Regional Climate Characterization ---
        # Non-agricultural climate descriptions remain valid for any valid WGS84 point
        # even when terrestrial land status is OCEAN, POLAR_UNSUPPORTED, or LAND_STATUS_UNVERIFIED.
        c2_res = self.nasa.fetch_or_load(
            point_lon_lat,
            start_iso,
            end_iso,
            crs=crs,
            as_of_iso=as_of,
            acquisition=acquisition,
            allow_offline_reference_fixture=allow_offline_ref,
            site_id=site_id,
            time_standard=time_standard,
            max_age_days=max_age_days,
            simulate_corrupt_receipt=sim_corrupt,
            simulate_outage=sim_nasa_outage,
        )
        evidence_ledger.extend(c2_res.get("evidence_objects", []))
        c2_payload = {
            "capability_id": "C2",
            "name": CAPABILITY_REGISTRY["C2"].name,
            "status": c2_res["status"],
            "fixture_origin": c2_res["fixture_origin"],
            "evidence_level": c2_res.get("evidence_level"),
            "missing_reason": c2_res["missing_reason"],
            "diagnostics": c2_res.get("diagnostics"),
            "detail": c2_res.get("detail", "Historical regional climate evaluated."),
        }

        if c1_status == "BLOCKED":
            return self._build_c1_blocked_response(
                req_id,
                c1_payload,
                c1_reason,
                c1_detail,
                request=request,
                c2_override=c2_payload,
                c2_evidence=c2_res.get("evidence_objects", []),
                c2_res=c2_res,
            )

        # --- C3: Regional Soil Property Characterization ---
        c3_opt_kwargs: Dict[str, Any] = {}
        if soil_properties is not None:
            c3_opt_kwargs["properties"] = soil_properties
        if soil_max_workers is not None:
            c3_opt_kwargs["max_workers"] = int(soil_max_workers)
        if soil_max_wall_time_s is not None:
            c3_opt_kwargs["max_wall_time_s"] = float(soil_max_wall_time_s)
        c3_res = self.soilgrids.fetch_or_load(
            point_lon_lat,
            depth_intervals,
            crs=crs,
            as_of_iso=as_of,
            acquisition=acquisition,
            allow_offline_reference_fixture=allow_offline_ref,
            site_id=site_id,
            max_age_days=max_age_days,
            max_distance_m=max_distance_m,
            include_nitrogen=include_nitrogen,
            simulate_corrupt_receipt=sim_corrupt,
            simulate_outage=sim_soil_outage,
            **c3_opt_kwargs,
        )
        evidence_ledger.extend(c3_res.get("evidence_objects", []))
        prohibited_ledger.extend(c3_res.get("prohibited_substitutions", []))
        c3_payload = {
            "capability_id": "C3",
            "name": CAPABILITY_REGISTRY["C3"].name,
            "status": c3_res["status"],
            "fixture_origin": c3_res["fixture_origin"],
            "evidence_level": c3_res.get("evidence_level"),
            "missing_reason": c3_res["missing_reason"],
            "diagnostics": c3_res.get("diagnostics"),
            "detail": c3_res.get("detail", "Regional 250 m SoilGrids v2.0 properties evaluated."),
        }

        # --- C4: Derived Soil Hydraulic & Water-Holding Screening ---
        def _strict_finite_float(val: Any, label: str) -> float:
            if isinstance(val, bool) or val is None:
                raise ValueError(f"{label} must be a finite numeric value.")
            num = float(val)
            if not math.isfinite(num):
                raise ValueError(f"{label} must be finite, got {val!r}.")
            return num

        root_depth_m = float(depth_check["total_depth_m"] or 0.60)
        root_depth_invalid_err: Optional[str] = None
        if user_meas.get("root_depth_m") is not None:
            try:
                rd_val = _strict_finite_float(user_meas.get("root_depth_m"), "root_depth_m")
                if not (0.0 < rd_val <= 5.0):
                    root_depth_invalid_err = f"User root_depth_m ({rd_val}) must satisfy 0 < root_depth_m <= 5.0 m."
                else:
                    root_depth_m = rd_val
            except (TypeError, ValueError) as exc:
                root_depth_invalid_err = f"Invalid user root_depth_m: {exc}"

        disagreement_diag: Optional[Dict[str, Any]] = None
        if root_depth_invalid_err is not None:
            c4_res = {
                "status": "BLOCKED",
                "estimator_id": "USER_MEASURED_SOIL_RETENTION_V1",
                "fixture_origin": "UNAVAILABLE_NO_DATA",
                "missing_reason": "quality_fail",
                "detail": root_depth_invalid_err,
                "diagnostics": None,
                "evidence_objects": [],
            }
        elif user_meas.get("theta_fc") is not None and user_meas.get("theta_wp") is not None:
            try:
                fc_u = _strict_finite_float(user_meas["theta_fc"], "theta_fc")
                wp_u = _strict_finite_float(user_meas["theta_wp"], "theta_wp")
            except (TypeError, ValueError) as exc:
                c4_res = {
                    "status": "BLOCKED",
                    "estimator_id": "USER_MEASURED_SOIL_RETENTION_V1",
                    "fixture_origin": "UNAVAILABLE_NO_DATA",
                    "missing_reason": "quality_fail",
                    "detail": f"Invalid non-numeric or non-finite soil retention input: {exc}",
                    "diagnostics": None,
                    "evidence_objects": [],
                }
            else:
                if 0.0 < wp_u < fc_u < 0.85:
                    awc_u = round((fc_u - wp_u) * 1000.0, 2)
                    meta_chk = validate_user_measurement_metadata(user_meas, as_of_iso=as_of)
                    verified_user_meta = bool(meta_chk["verified"])
                    c4_status_u = "READY" if verified_user_meta else "CONDITIONAL"
                    c4_est_id = (
                        "USER_MEASURED_SOIL_RETENTION_V1"
                        if verified_user_meta
                        else "USER_DECLARED_SCENARIO_SOIL_RETENTION_V1"
                    )
                    c4_detail_u = (
                        "Dated, method-specified soil retention parameters accepted for field comparison (USER_DECLARED_SCENARIO)."
                        if verified_user_meta
                        else "User-supplied theta_fc/theta_wp lacks valid complete measurement metadata (non-future ISO-8601 date, method, valid depth); treated strictly as USER_DECLARED_SCENARIO (CONDITIONAL)."
                    )
                    raw_depth_iv = user_meas.get("depth_interval_cm")
                    if (
                        isinstance(raw_depth_iv, (list, tuple))
                        and len(raw_depth_iv) == 2
                        and isinstance(raw_depth_iv[0], (int, float))
                        and isinstance(raw_depth_iv[1], (int, float))
                    ):
                        ev_depth_cm: Tuple[float, float] = (float(raw_depth_iv[0]), float(raw_depth_iv[1]))
                    else:
                        ev_depth_cm = (0.0, round(root_depth_m * 100.0, 2))
                    user_ret_payload = {
                        "point_lon_lat": [float(point_lon_lat[0]), float(point_lon_lat[1])],
                        "depth_interval_cm": list(ev_depth_cm),
                        "theta_fc": fc_u,
                        "theta_wp": wp_u,
                        "awc_mm_m": awc_u,
                        "measured_at": user_meas.get("measured_at") or user_meas.get("sampled_at") or user_meas.get("date"),
                        "method": user_meas.get("method") or user_meas.get("lab_method") or user_meas.get("analysis_method"),
                    }
                    user_ret_sha = canonical_digest(user_ret_payload)
                    ev_ret_at = (
                        meta_chk.get("parsed_date_iso")
                        or (
                            str(as_of)
                            if isinstance(as_of, str) and as_of.strip()
                            else datetime.now(timezone.utc).replace(microsecond=0).isoformat()
                        )
                    )
                    user_qflags = (
                        ("USER_DECLARED_SCENARIO", "SELF_DECLARED_METADATA_ONLY")
                        if verified_user_meta
                        else ("USER_DECLARED_SCENARIO", "UNVERIFIED_MEASUREMENT_METADATA")
                    )
                    common_user_ev_kwargs: Dict[str, Any] = {
                        "provenance_class": "USER_SCENARIO_ASSUMPTION",
                        "source_id": "USER_DECLARED_SOIL_RETENTION_INPUT",
                        "provider": "USER_OR_FARMER_SUPPLIED",
                        "product": "USER_DECLARED_SOIL_HYDRAULICS",
                        "version": "user-declared.v1",
                        "permanent_url": "urn:astragron:user-declared-scenario:soil-retention",
                        "citation": "User-supplied soil retention scenario input (treated strictly as USER_DECLARED_SCENARIO; no independent lab verification).",
                        "access_path": "request.user_measurements",
                        "retrieved_at": ev_ret_at,
                        "valid_period": None,
                        "evidence_type": "USER_SUPPLIED",
                        "point_lon_lat": (float(point_lon_lat[0]), float(point_lon_lat[1])),
                        "crs": crs,
                        "spatial_resolution_desc": "User-supplied field point scenario",
                        "pixel_area_km2": None,
                        "depth_interval_cm": ev_depth_cm,
                        "scale_factor": 1.0,
                        "quantiles": None,
                        "uncertainty_semantics": "User-declared scenario values; independent lab authenticity not externally certified.",
                        "quality_flags": user_qflags,
                        "missing_value_handling": "FAIL_CLOSED_PHYSICAL_BOUNDS",
                        "raw_source_sha256": user_ret_sha,
                        "receipt_sha256": user_ret_sha,
                        "fixture_origin": "USER_DECLARED_SCENARIO_INPUT",
                        "transformation_id": "USER_DECLARED_RETENTION_V1",
                        "estimator_id": c4_est_id,
                        "license": "USER_SUPPLIED_SCENARIO_INPUT",
                        "attribution": "User-declared scenario input; not an external observatory or laboratory receipt.",
                        "restrictions": "Must never be promoted to independently certified empirical calibration.",
                        "evidence_level": "USER_DECLARED_SCENARIO",
                    }
                    user_ev_objs = [
                        TypedEvidenceObject(
                            parameter_path="soil_hydraulics.theta_wp",
                            variable="theta_wp",
                            raw_unit="m3/m3",
                            raw_value=wp_u,
                            converted_si_value=wp_u,
                            si_unit="m3/m3",
                            **common_user_ev_kwargs,
                        ).to_dict(),
                        TypedEvidenceObject(
                            parameter_path="soil_hydraulics.theta_fc",
                            variable="theta_fc",
                            raw_unit="m3/m3",
                            raw_value=fc_u,
                            converted_si_value=fc_u,
                            si_unit="m3/m3",
                            **common_user_ev_kwargs,
                        ).to_dict(),
                        TypedEvidenceObject(
                            parameter_path="soil_hydraulics.awc_mm_m",
                            variable="awc_mm_m",
                            raw_unit="mm/m",
                            raw_value=awc_u,
                            converted_si_value=awc_u,
                            si_unit="mm/m",
                            **common_user_ev_kwargs,
                        ).to_dict(),
                    ]
                    c4_res = {
                        "status": c4_status_u,
                        "estimator_id": c4_est_id,
                        "fixture_origin": "USER_DECLARED_SCENARIO_INPUT",
                        "evidence_level": "USER_DECLARED_SCENARIO",
                        "missing_reason": None,
                        "detail": c4_detail_u,
                        "diagnostics": {
                            "root_depth_m": root_depth_m,
                            "physical_invariants_satisfied": True,
                            "metadata_verified": verified_user_meta,
                            "evidence_level": "USER_DECLARED_SCENARIO",
                            "scenarios": {
                                "LOW_WATER_HOLDING": {"theta_wp": wp_u, "theta_fc": fc_u, "theta_s": round(min(0.70, fc_u + 0.10), 4), "awc_mm_m": round(awc_u * 0.9, 2), "paw_root_mm": round(awc_u * 0.9 * root_depth_m, 2)},
                                "REFERENCE": {"theta_wp": wp_u, "theta_fc": fc_u, "theta_s": round(min(0.70, fc_u + 0.10), 4), "awc_mm_m": awc_u, "paw_root_mm": round(awc_u * root_depth_m, 2)},
                                "HIGH_WATER_HOLDING": {"theta_wp": wp_u, "theta_fc": fc_u, "theta_s": round(min(0.70, fc_u + 0.10), 4), "awc_mm_m": round(awc_u * 1.1, 2), "paw_root_mm": round(awc_u * 1.1 * root_depth_m, 2)},
                            },
                        },
                        "evidence_objects": user_ev_objs,
                    }
                    evidence_ledger.extend(c4_res["evidence_objects"])
                    if c3_res.get("status") != "BLOCKED":
                        sg_ptf = derive_soil_hydraulics_from_soilgrids(
                            c3_res, root_depth_m=root_depth_m, point_lon_lat=point_lon_lat, crs=crs
                        )
                        if sg_ptf.get("status") != "BLOCKED" and isinstance(sg_ptf.get("diagnostics"), dict):
                            sg_awc = float(sg_ptf["diagnostics"]["scenarios"]["REFERENCE"]["awc_mm_m"])
                            if abs(awc_u - sg_awc) > 60.0:
                                disagreement_diag = {
                                    "cross_source_disagreement_detected": True,
                                    "user_awc_mm_m": awc_u,
                                    "soilgrids_ptf_awc_mm_m": sg_awc,
                                    "detail": (
                                        f"User-supplied soil AWC ({awc_u} mm/m) diverges from SoilGrids PTF ({sg_awc} mm/m) by "
                                        f"{abs(awc_u - sg_awc):.1f} mm/m (> 60 mm/m); preserve wide uncertainty bounds."
                                    ),
                                }
                                if c4_res["status"] == "READY":
                                    c4_res["status"] = "CONDITIONAL"
                                    c4_res["detail"] = f"{c4_res['detail']} {disagreement_diag['detail']}"
                else:
                    c4_res = {
                        "status": "BLOCKED",
                        "estimator_id": "USER_MEASURED_SOIL_RETENTION_V1",
                        "fixture_origin": "UNAVAILABLE_NO_DATA",
                        "missing_reason": "quality_fail",
                        "detail": f"User theta_wp ({wp_u}) and theta_fc ({fc_u}) violate 0 < theta_wp < theta_fc < 0.85.",
                        "diagnostics": None,
                        "evidence_objects": [],
                    }
        else:
            c4_res = derive_soil_hydraulics_from_soilgrids(
                c3_res, root_depth_m=root_depth_m, point_lon_lat=point_lon_lat, crs=crs
            )
            evidence_ledger.extend(c4_res.get("evidence_objects", []))

        c4_payload = {
            "capability_id": "C4",
            "name": CAPABILITY_REGISTRY["C4"].name,
            "status": c4_res["status"],
            "estimator_id": c4_res.get("estimator_id"),
            "missing_reason": c4_res.get("missing_reason"),
            "diagnostics": c4_res.get("diagnostics"),
            "detail": c4_res.get("detail", "Soil hydraulic water-holding scenarios evaluated."),
        }

        # --- C5: Regional Agro-Ecological Suitability Screening ---
        primary_crop = str(candidate_crops[0]) if candidate_crops else "unspecified"
        c5_res = self.gaez.evaluate_suitability(
            point_lon_lat,
            crop_code=primary_crop,
            water_supply_regime=str(water_supply.get("regime") or "unknown"),
            crs=crs,
            allow_contract_test_fixture=allow_gaez_fixture,
            contract_test_fixture_payload=(
                {"suitability_index_0_100": 70.0, "suitability_class": "S"} if allow_gaez_fixture else None
            ),
        )
        evidence_ledger.extend(c5_res.get("evidence_objects", []))
        prohibited_ledger.extend(c5_res.get("prohibited_substitutions", []))
        c5_payload = {
            "capability_id": "C5",
            "name": CAPABILITY_REGISTRY["C5"].name,
            "status": c5_res["status"],
            "adapter_status": c5_res.get("adapter_status"),
            "missing_reason": c5_res.get("missing_reason"),
            "diagnostics": c5_res.get("diagnostics"),
            "detail": c5_res.get("detail", "Regional agro-ecological suitability evaluated."),
        }

        # --- C6: Scenario-Conditional Water Balance & Irrigation Screening ---
        c6_payload = self._evaluate_c6_water_balance(
            c2_payload, c4_payload, candidate_crops, water_supply
        )

        # --- C7: Regional Crop Water Suitability Screening (C7_SCREENING) ---
        c7_payload = self._evaluate_c7_regional_crop_water_screening(
            c2_payload, c4_payload, c6_payload, candidate_crops, water_supply, allow_cond_planning
        )

        # --- C8: Native Process-Model Crop & Soil-N Simulation (WOFOST / SNOMIN) ---
        c8_payload = self._evaluate_c8_process_growth(point_lon_lat, site_id, user_meas)

        # --- C9: Economic Cost / Scenario Screening ---
        c9_payload = self._evaluate_c9_economics(user_meas)

        # --- C10: Legal, Water-Rights, and Pesticide Compliance ---
        c10_payload = self._evaluate_c10_legal_compliance(water_supply, user_meas)

        capabilities_map = {
            "C1": c1_payload,
            "C2": c2_payload,
            "C3": c3_payload,
            "C4": c4_payload,
            "C5": c5_payload,
            "C6": c6_payload,
            "C7": c7_payload,
            "C8": c8_payload,
            "C9": c9_payload,
            "C10": c10_payload,
        }
        statuses = {cid: cap["status"] for cid, cap in capabilities_map.items()}
        any_usable = any(s in ("READY", "CONDITIONAL") for s in statuses.values())

        usable_outputs = self._compile_usable_outputs(capabilities_map)
        conditional_outputs = self._compile_conditional_outputs(capabilities_map)
        blocked_claims = self._compile_blocked_claims(capabilities_map)
        minimal_measurements = self._compile_minimal_next_measurements(capabilities_map, water_supply, user_meas)
        status_outcome = self._classify_status_outcome(capabilities_map)

        nasa_dirs, sg_dirs = self._trusted_adapter_dirs()
        quality_assessment = EvidenceQualityGate().evaluate(
            request,
            capabilities=capabilities_map,
            evidence_objects=evidence_ledger,
            c2_res=c2_res,
            c3_res=c3_res,
            disagreement_diagnostics=disagreement_diag,
            max_age_days=int(max_age_days) if max_age_days is not None else None,
            expected_time_standard=expected_time_standard,
            trusted_nasa_dirs=nasa_dirs,
            trusted_soilgrids_dirs=sg_dirs,
        )

        return {
            "schema": "astragron.adaptive-evidence.response.v1",
            "request_id": req_id,
            "status_outcome": status_outcome,
            "overall_summary_status": (
                "PARTIAL_OR_CONDITIONAL_READY" if any_usable else "ALL_CAPABILITIES_BLOCKED"
            ),
            "capability_statuses": statuses,
            "capabilities": capabilities_map,
            "usable_outputs": usable_outputs,
            "conditional_outputs": conditional_outputs,
            "blocked_claims": blocked_claims,
            "minimal_next_measurements": minimal_measurements,
            "evidence_levels_observed": quality_assessment["evidence_levels_observed"],
            "single_next_missing_input": quality_assessment["single_next_missing_input"],
            "quality_assessment": quality_assessment,
            "sensitivity_scope_note": (
                "Adaptive evidence capability C7 and its sensitivity analyzer cover regional water screening only; "
                "use CanonicalDecisionSensitivityRunner against ClientDecisionService for 5-year whole-farm decision sensitivity."
            ),
            "provenance_and_uncertainty_ledger": {
                "evidence_objects": evidence_ledger,
                "prohibited_substitutions": prohibited_ledger,
                "registered_estimators_used": (
                    [c4_payload["estimator_id"]] if c4_payload.get("estimator_id") else []
                ),
            },
            "scientific_guardrails": {
                "field_validated": False,
                "marketable_yield": None,
                "profit": None,
                "prediction_accuracy": "NOT_MEASURED",
                "false_qualification_upgrades": 0,
            },
        }

    def _evaluate_c6_water_balance(
        self,
        c2: Dict[str, Any],
        c4: Dict[str, Any],
        candidate_crops: Sequence[str],
        water_supply: Dict[str, Any],
    ) -> Dict[str, Any]:
        if c2["status"] == "BLOCKED":
            return {
                "capability_id": "C6",
                "name": CAPABILITY_REGISTRY["C6"].name,
                "status": "BLOCKED",
                "missing_reason": c2["missing_reason"] or "source_outage",
                "diagnostics": None,
                "detail": "Blocked because C2 historical regional climate is unavailable.",
            }
        if c4["status"] == "BLOCKED":
            return {
                "capability_id": "C6",
                "name": CAPABILITY_REGISTRY["C6"].name,
                "status": "BLOCKED",
                "missing_reason": c4["missing_reason"] or "insufficient_parameters",
                "diagnostics": None,
                "detail": f"Blocked because C4 soil hydraulic screening is unavailable ({c4.get('missing_reason')}).",
            }

        unsupported = [c for c in candidate_crops if c not in SUPPORTED_REGIONAL_CROPS]
        if unsupported:
            return {
                "capability_id": "C6",
                "name": CAPABILITY_REGISTRY["C6"].name,
                "status": "BLOCKED",
                "missing_reason": "unsupported_crop_profile",
                "diagnostics": {
                    "unsupported_crop_profiles": unsupported,
                    "independent_analyses_available": ["C1", "C2", "C3", "C4"],
                },
                "detail": (
                    f"Unsupported crop profile(s) {unsupported}; generic uncalibrated Kc substitution is prohibited. "
                    "Independent climate (C2) and soil hydraulic (C3/C4) analyses remain available."
                ),
            }

        clim_diag = c2.get("diagnostics") or {}
        if (
            clim_diag.get("annual_basis_available") is False
            or clim_diag.get("mean_annual_precipitation_mm") is None
            or clim_diag.get("conditional_hs_et0_mm_year") is None
        ):
            return {
                "capability_id": "C6",
                "name": CAPABILITY_REGISTRY["C6"].name,
                "status": "BLOCKED",
                "missing_reason": "temporal_mismatch",
                "diagnostics": {
                    "annual_basis_available": False,
                    "c2_temporal_diagnostics": {
                        k: clim_diag.get(k)
                        for k in ("is_sub_annual_window", "covered_days", "year_count")
                        if k in clim_diag
                    },
                },
                "detail": (
                    "Blocked because C2 covers only a sub-annual or incomplete period and cannot be extrapolated "
                    "to annual water-balance totals without multi-year climatology."
                ),
            }

        soil_scens = c4["diagnostics"]["scenarios"]
        raw_regime = water_supply.get("regime")
        regime = str(raw_regime) if raw_regime else "UNKNOWN_NOT_ASSUMED"
        supply_m3_ha = float(water_supply.get("seasonal_supply_m3_ha") or 0.0)
        supply_mm = supply_m3_ha / 10.0 if regime in ("irrigated", "supplemental") else 0.0

        crop_screenings: Dict[str, Any] = {}
        for crop in candidate_crops:
            c_meta = SUPPORTED_REGIONAL_CROPS[crop]
            season_frac = c_meta["season_days"] / 365.0
            etc_season_mm = clim_diag["conditional_hs_et0_mm_year"] * season_frac * c_meta["kc_mid"]
            p_eff_ref_mm = clim_diag["mean_annual_precipitation_mm"] * season_frac * 0.78
            p_eff_dry_mm = clim_diag["driest_year_precipitation_mm"] * season_frac * 0.72

            paw_low = soil_scens["LOW_WATER_HOLDING"]["awc_mm_m"] * c_meta["root_depth_m"] * c_meta["depletion_p"]
            paw_ref = soil_scens["REFERENCE"]["awc_mm_m"] * c_meta["root_depth_m"] * c_meta["depletion_p"]
            paw_high = soil_scens["HIGH_WATER_HOLDING"]["awc_mm_m"] * c_meta["root_depth_m"] * c_meta["depletion_p"]

            def_ref = max(0.0, etc_season_mm - (p_eff_ref_mm + paw_ref + supply_mm))
            def_worst = max(0.0, etc_season_mm * 1.08 - (p_eff_dry_mm + paw_low + supply_mm))
            def_best = max(0.0, etc_season_mm * 0.92 - (p_eff_ref_mm * 1.15 + paw_high + supply_mm))

            crop_screenings[crop] = {
                "seasonal_etc_mm": round(etc_season_mm, 1),
                "effective_precip_ref_mm": round(p_eff_ref_mm, 1),
                "readily_available_soil_water_ref_mm": round(paw_ref, 1),
                "net_deficit_best_mm": round(def_best, 1),
                "net_deficit_ref_mm": round(def_ref, 1),
                "net_deficit_worst_mm": round(def_worst, 1),
                "deficit_ratio_ref": round(def_ref / max(1.0, etc_season_mm), 3),
                "deficit_ratio_worst": round(def_worst / max(1.0, etc_season_mm * 1.08), 3),
            }

        return {
            "capability_id": "C6",
            "name": CAPABILITY_REGISTRY["C6"].name,
            "status": "CONDITIONAL",
            "missing_reason": None,
            "diagnostics": {
                "water_supply_regime": regime,
                "seasonal_irrigation_supply_mm": round(supply_mm, 1),
                "crop_water_balance_screening": crop_screenings,
            },
            "detail": (
                "Scenario-conditional seasonal water balance evaluated across LOW/REFERENCE/HIGH "
                "soil water-holding and historical climate envelopes."
            ),
        }

    def _evaluate_c7_regional_crop_water_screening(
        self,
        c2: Dict[str, Any],
        c4: Dict[str, Any],
        c6: Dict[str, Any],
        candidate_crops: Sequence[str],
        water_supply: Dict[str, Any],
        allow_cond_planning: bool,
    ) -> Dict[str, Any]:
        if c6["status"] == "BLOCKED":
            return {
                "capability_id": "C7",
                "capability_tag": "C7_SCREENING",
                "name": CAPABILITY_REGISTRY["C7"].name,
                "status": "BLOCKED",
                "missing_reason": c6["missing_reason"],
                "diagnostics": c6.get("diagnostics"),
                "detail": f"Blocked because C6 water-balance screening is blocked ({c6['missing_reason']}).",
            }
        if len(candidate_crops) == 0:
            return {
                "capability_id": "C7",
                "capability_tag": "C7_SCREENING",
                "name": CAPABILITY_REGISTRY["C7"].name,
                "status": "BLOCKED",
                "missing_reason": "insufficient_parameters",
                "diagnostics": {
                    "independent_analyses_available": ["C1", "C2", "C3", "C4", "C6"],
                },
                "detail": (
                    "Regional crop water suitability screening requires explicit candidate_crops; "
                    "no default crop list is silently substituted."
                ),
            }
        regime = str(water_supply.get("regime") or "")
        if not regime:
            return {
                "capability_id": "C7",
                "capability_tag": "C7_SCREENING",
                "name": CAPABILITY_REGISTRY["C7"].name,
                "status": "BLOCKED",
                "missing_reason": "insufficient_parameters",
                "diagnostics": {
                    "water_supply_regime": "UNKNOWN_NOT_ASSUMED",
                    "independent_analyses_available": ["C1", "C2", "C3", "C4", "C6"],
                },
                "detail": (
                    "Regional crop water suitability screening requires an explicit water_supply_scenario "
                    "(e.g., regime='rainfed' or 'irrigated' with seasonal_supply_m3_ha); unknown water "
                    "availability is never silently inferred as rainfed."
                ),
            }
        if regime in ("irrigated", "supplemental") and water_supply.get("seasonal_supply_m3_ha") is None:
            return {
                "capability_id": "C7",
                "capability_tag": "C7_SCREENING",
                "name": CAPABILITY_REGISTRY["C7"].name,
                "status": "BLOCKED",
                "missing_reason": "insufficient_parameters",
                "diagnostics": None,
                "detail": "Irrigated/supplemental crop water screening requires seasonal_supply_m3_ha.",
            }

        # Rank candidate crops by seasonal water-stress resilience score under reference and worst-case scenarios
        wb = c6["diagnostics"]["crop_water_balance_screening"]
        ranked: List[Dict[str, Any]] = []
        for crop in candidate_crops:
            c_wb = wb[crop]
            c_meta = SUPPORTED_REGIONAL_CROPS[crop]
            ref_score = max(0.0, 1.0 - c_wb["deficit_ratio_ref"] * (1.25 - 0.5 * c_meta["drought_tol"]))
            worst_score = max(0.0, 1.0 - c_wb["deficit_ratio_worst"] * (1.25 - 0.5 * c_meta["drought_tol"]))
            composite_score = round(0.60 * ref_score + 0.40 * worst_score, 4)
            ranked.append(
                {
                    "crop": crop,
                    "botanical_family": c_meta["family"],
                    "composite_water_adequacy_score": composite_score,
                    "reference_adequacy_score": round(ref_score, 4),
                    "worst_case_adequacy_score": round(worst_score, 4),
                    "net_deficit_ref_mm": c_wb["net_deficit_ref_mm"],
                    "net_deficit_worst_mm": c_wb["net_deficit_worst_mm"],
                }
            )
        ranked.sort(key=lambda item: (-item["composite_water_adequacy_score"], item["crop"]))

        # C7_SCREENING is strictly CONDITIONAL and is NOT a 5-year rotation plan or WOFOST/CP-SAT output.
        c7_status = "CONDITIONAL"
        return {
            "capability_id": "C7",
            "capability_tag": "C7_SCREENING",
            "name": CAPABILITY_REGISTRY["C7"].name,
            "status": c7_status,
            "missing_reason": None,
            "diagnostics": {
                "capability_tag": "C7_SCREENING",
                "qualification": "REGIONAL_CROP_WATER_SUITABILITY_SCREENING_ONLY",
                "is_multiyear_rotation_plan": False,
                "not_for_farmer_submission": True,
                "water_supply_regime": regime,
                "top_ranked_crop": ranked[0]["crop"] if ranked else None,
                "candidate_ranking": ranked,
                "illustrative_unvalidated_crop_list": [item["crop"] for item in ranked],
                "field_validated": False,
                "marketable_yield": None,
                "profit": None,
            },
            "detail": (
                "Regional seasonal crop water suitability screening (C7_SCREENING) under regional climate "
                "and PTF-derived soil hydraulic scenarios. This is NOT a 5-year rotation plan or "
                "WOFOST/CP-SAT optimization and cannot be submitted to a farmer as a verified rotation plan."
            ),
        }

    def _evaluate_c8_process_growth(
        self,
        point_lon_lat: Sequence[float],
        site_id: Optional[str],
        user_meas: Dict[str, Any],
    ) -> Dict[str, Any]:
        lon, lat = float(point_lon_lat[0]), float(point_lon_lat[1])
        is_wageningen = site_id == "NL_WAGENINGEN_RESEARCH" or (
            abs(lon - 5.67) <= 0.05 and abs(lat - 51.97) <= 0.05
        )
        if not is_wageningen:
            return {
                "capability_id": "C8",
                "name": CAPABILITY_REGISTRY["C8"].name,
                "status": "BLOCKED",
                "missing_reason": "unsupported_region",
                "diagnostics": {
                    "pinned_research_site": [5.67, 51.97],
                    "mineral_n_derived_from_soilgrids": False,
                },
                "detail": (
                    "Native WOFOST/SNOMIN process simulation (brain/growth_decision.py) is locked to the "
                    "pinned Wageningen research envelope [5.67, 51.97] and cannot be extrapolated globally "
                    "without local cultivar calibration and measured initial mineral NO3/NH4."
                ),
            }
        if user_meas.get("mineral_n_kg_ha") is None:
            return {
                "capability_id": "C8",
                "name": CAPABILITY_REGISTRY["C8"].name,
                "status": "BLOCKED",
                "missing_reason": "not_identifiable",
                "diagnostics": {
                    "pinned_research_site": [5.67, 51.97],
                    "mineral_n_derived_from_soilgrids": False,
                },
                "detail": (
                    "WOFOST/SNOMIN requires measured or explicitly declared initial mineral nitrogen "
                    "(NO3/NH4 kg/ha); deriving mineral N from SoilGrids total N or SOC is prohibited."
                ),
            }
        return {
            "capability_id": "C8",
            "name": CAPABILITY_REGISTRY["C8"].name,
            "status": "CONDITIONAL",
            "missing_reason": None,
            "diagnostics": {
                "pinned_research_site": [5.67, 51.97],
                "initial_mineral_n_kg_ha": float(user_meas["mineral_n_kg_ha"]),
                "qualification": "CONDITIONAL_RESEARCH_ENVELOPE_ONLY",
                "field_validated": False,
                "marketable_yield": None,
            },
            "detail": "Conditional Wageningen research-envelope process simulation screening enabled.",
        }

    def _evaluate_c9_economics(self, user_meas: Dict[str, Any]) -> Dict[str, Any]:
        if user_meas.get("input_cost_eur_ha") is None:
            return {
                "capability_id": "C9",
                "name": CAPABILITY_REGISTRY["C9"].name,
                "status": "BLOCKED",
                "missing_reason": "insufficient_parameters",
                "diagnostics": {"marketable_yield": None, "profit": None},
                "detail": (
                    "Economic cost screening requires user-supplied local input costs; net profit and "
                    "marketable yield remain strictly null without field-validated yield calibration."
                ),
            }
        cost = float(user_meas["input_cost_eur_ha"])
        return {
            "capability_id": "C9",
            "name": CAPABILITY_REGISTRY["C9"].name,
            "status": "CONDITIONAL",
            "missing_reason": None,
            "diagnostics": {
                "declared_input_cost_eur_ha": cost,
                "five_year_nominal_cost_exposure_eur_ha": round(cost * 5.0, 2),
                "marketable_yield": None,
                "profit": None,
            },
            "detail": (
                "Conditional input-cost exposure evaluated from user-supplied cost scenario; "
                "marketable_yield=null and profit=null enforced."
            ),
        }

    def _evaluate_c10_legal_compliance(
        self, water_supply: Dict[str, Any], user_meas: Dict[str, Any]
    ) -> Dict[str, Any]:
        water_ok = bool(water_supply.get("official_water_permit_verified", False))
        pest_ok = bool(user_meas.get("official_pesticide_clearance_verified", False))
        if water_ok and pest_ok:
            return {
                "capability_id": "C10",
                "name": CAPABILITY_REGISTRY["C10"].name,
                "status": "CONDITIONAL",
                "missing_reason": None,
                "diagnostics": {
                    "official_water_permit_verified": True,
                    "official_pesticide_clearance_verified": True,
                },
                "detail": "User-supplied regulatory verification declarations recorded.",
            }
        return {
            "capability_id": "C10",
            "name": CAPABILITY_REGISTRY["C10"].name,
            "status": "BLOCKED",
            "missing_reason": "official_verification_required",
            "diagnostics": {
                "official_water_permit_verified": water_ok,
                "official_pesticide_clearance_verified": pest_ok,
            },
            "detail": (
                "Water abstraction rights and pesticide registration compliance cannot be inferred "
                "from global environmental datasets; official local regulatory verification is required."
            ),
        }

    def _compile_usable_outputs(self, caps: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "location_identity": {
                "point_lon_lat": caps["C1"]["point_lon_lat"],
                "crs": caps["C1"]["crs"],
                "hemisphere": caps["C1"]["hemisphere"],
            }
        }
        if caps["C2"]["status"] in ("READY", "CONDITIONAL"):
            out["historical_regional_climate"] = caps["C2"]["diagnostics"]
        if caps["C3"]["status"] in ("READY", "CONDITIONAL"):
            out["regional_soil_properties_250m"] = caps["C3"]["diagnostics"]
        if caps["C4"]["status"] in ("READY", "CONDITIONAL"):
            out["soil_hydraulic_retention_scenarios"] = caps["C4"]["diagnostics"]
        if caps["C5"]["status"] in ("READY", "CONDITIONAL"):
            out["regional_suitability_screening"] = caps["C5"]["diagnostics"]
        if caps["C6"]["status"] in ("READY", "CONDITIONAL"):
            out["water_balance_screening"] = caps["C6"]["diagnostics"]
        if caps["C7"]["status"] in ("READY", "CONDITIONAL"):
            out["regional_crop_water_screening"] = caps["C7"]["diagnostics"]
        if caps["C9"]["status"] in ("READY", "CONDITIONAL"):
            out["input_cost_exposure"] = caps["C9"]["diagnostics"]
        return out

    def _compile_conditional_outputs(self, caps: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        conds: List[Dict[str, Any]] = []
        for cid, cap in caps.items():
            if cap["status"] == "CONDITIONAL":
                conds.append(
                    {
                        "capability_id": cid,
                        "name": cap["name"],
                        "status": "CONDITIONAL",
                        "assumption_and_limitation": cap["detail"],
                    }
                )
        return conds

    def _compile_blocked_claims(self, caps: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        blocked: List[Dict[str, Any]] = []
        for cid, cap in caps.items():
            if cap["status"] == "BLOCKED":
                blocked.append(
                    {
                        "capability_id": cid,
                        "name": cap["name"],
                        "status": "BLOCKED",
                        "missing_reason": cap["missing_reason"],
                        "explanation": cap["detail"],
                    }
                )
        return blocked

    def _compile_minimal_next_measurements(
        self,
        caps: Dict[str, Dict[str, Any]],
        water_supply: Dict[str, Any],
        user_meas: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        if user_meas.get("theta_fc") is None or user_meas.get("theta_wp") is None:
            items.append(
                {
                    "priority_rank": len(items) + 1,
                    "parameter": "soil_hydraulics.theta_fc_and_theta_wp",
                    "measurement_action": (
                        "Collect a 0-30 cm topsoil core/jar texture + bulk density sample to narrow the "
                        "regional SoilGrids 250 m available water capacity envelope."
                    ),
                    "upgrades_capabilities": ["C3", "C4", "C6", "C7"],
                }
            )
        if not water_supply.get("regime"):
            items.append(
                {
                    "priority_rank": len(items) + 1,
                    "parameter": "water_supply_scenario.regime_and_seasonal_supply_m3_ha",
                    "measurement_action": (
                        "Declare whether the field is strictly rainfed or specify the verified seasonal "
                        "irrigation allocation cap (m3/ha)."
                    ),
                    "upgrades_capabilities": ["C6", "C7"],
                }
            )
        if caps["C10"]["status"] == "BLOCKED":
            items.append(
                {
                    "priority_rank": len(items) + 1,
                    "parameter": "legal.water_abstraction_permit_and_pesticide_label",
                    "measurement_action": (
                        "Verify local water-basin abstraction permit and national pesticide product registration."
                    ),
                    "upgrades_capabilities": ["C10"],
                }
            )
        if user_meas.get("mineral_n_kg_ha") is None:
            items.append(
                {
                    "priority_rank": len(items) + 1,
                    "parameter": "soil.mineral_n_kg_ha",
                    "measurement_action": (
                        "Measure pre-sowing 0-60 cm soil mineral nitrogen (NO3-N + NH4-N in kg/ha); "
                        "cannot be derived from regional SoilGrids total N."
                    ),
                    "upgrades_capabilities": ["C8"],
                }
            )
        return items

    def _classify_status_outcome(self, caps: Dict[str, Dict[str, Any]]) -> str:
        """Classify response into one of the 6 explicit Gate V status outcomes."""
        c1 = caps.get("C1") or {}
        c2 = caps.get("C2") or {}
        c3 = caps.get("C3") or {}
        c4 = caps.get("C4") or {}
        c6 = caps.get("C6") or {}
        c7 = caps.get("C7") or {}
        c8 = caps.get("C8") or {}

        if c1.get("status") == "BLOCKED":
            reason = c1.get("missing_reason") or ""
            if reason in ("invalid_coordinates_or_crs", "spatial_mismatch", "invalid_depth_interval"):
                return "INVALID_LOCATION_OR_GEOMETRY"
            return "WATER_OR_UNVERIFIED_LOCATION"

        c2_ok = c2.get("status") in ("READY", "CONDITIONAL")
        c3_ok = c3.get("status") in ("READY", "CONDITIONAL")
        c4_ok = c4.get("status") in ("READY", "CONDITIONAL")
        c6_ok = c6.get("status") in ("READY", "CONDITIONAL")
        c7_ok = c7.get("status") in ("READY", "CONDITIONAL")
        c8_ok = c8.get("status") in ("READY", "CONDITIONAL")

        if c8_ok:
            return "CONDITIONAL_RESEARCH_COMPARISON"
        if c2_ok and not c3_ok and not c4_ok:
            return "CLIMATE_READY_SOIL_PARTIAL"
        if (c3_ok or c4_ok) and not c2_ok and not c6_ok and not c7_ok:
            return "SOIL_READY_CLIMATE_PARTIAL"
        if c7_ok or c6_ok or c4_ok or c3_ok:
            return "REGIONAL_SCREENING_ONLY"
        return "EVIDENCE_BLOCKED"

    def _trusted_adapter_dirs(self) -> Tuple[Tuple[Path, ...], Tuple[Path, ...]]:
        """Collect configured Path directories from internal adapter instances (never from JSON inputs)."""
        nasa_dirs = tuple(
            p
            for p in (
                getattr(self.nasa, "local_cache_dir", None),
                getattr(self.nasa, "upstream_source_cache", None),
                getattr(self.nasa, "upstream_data_dir", None),
            )
            if isinstance(p, Path)
        )
        sg_dirs = tuple(
            p
            for p in (
                getattr(self.soilgrids, "local_cache_dir", None),
                getattr(self.soilgrids, "bundled_cache_dir", None),
            )
            if isinstance(p, Path)
        )
        return nasa_dirs, sg_dirs

    def _build_c1_blocked_response(
        self,
        req_id: str,
        c1_payload: Dict[str, Any],
        missing_reason: str,
        detail: str,
        *,
        request: Optional[Dict[str, Any]] = None,
        c2_override: Optional[Dict[str, Any]] = None,
        c2_evidence: Optional[List[Dict[str, Any]]] = None,
        c2_res: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        caps: Dict[str, Dict[str, Any]] = {"C1": c1_payload}
        for cid in ("C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"):
            if cid == "C2" and c2_override is not None:
                caps["C2"] = c2_override
                continue
            caps[cid] = {
                "capability_id": cid,
                "name": CAPABILITY_REGISTRY[cid].name,
                "status": "BLOCKED",
                "missing_reason": missing_reason,
                "diagnostics": None,
                "detail": f"Blocked because C1 geographic/land validation failed ({missing_reason}): {detail}",
            }
        usable: Dict[str, Any] = {}
        overall = "ALL_CAPABILITIES_BLOCKED"
        if caps["C2"]["status"] in ("READY", "CONDITIONAL"):
            usable["historical_regional_climate"] = caps["C2"]["diagnostics"]
            overall = "PARTIAL_OR_CONDITIONAL_READY"
        ev_list = list(c2_evidence or [])
        req_opts = (request or {}).get("options") if isinstance((request or {}).get("options"), dict) else {}
        max_age = req_opts.get("max_age_days")
        time_std = str(req_opts.get("time_standard", "UTC"))
        expected_std = str(req_opts.get("expected_time_standard", time_std))
        nasa_dirs, sg_dirs = self._trusted_adapter_dirs()
        quality_assessment = EvidenceQualityGate().evaluate(
            request or {},
            capabilities=caps,
            evidence_objects=ev_list,
            c2_res=c2_res,
            max_age_days=int(max_age) if max_age is not None else None,
            expected_time_standard=expected_std,
            trusted_nasa_dirs=nasa_dirs,
            trusted_soilgrids_dirs=sg_dirs,
        )
        return {
            "schema": "astragron.adaptive-evidence.response.v1",
            "request_id": req_id,
            "status_outcome": self._classify_status_outcome(caps),
            "overall_summary_status": overall,
            "capability_statuses": {cid: caps[cid]["status"] for cid in caps},
            "capabilities": caps,
            "usable_outputs": usable,
            "conditional_outputs": self._compile_conditional_outputs(caps),
            "blocked_claims": self._compile_blocked_claims(caps),
            "minimal_next_measurements": [
                {
                    "priority_rank": 1,
                    "parameter": "location.point_lon_lat",
                    "measurement_action": "Supply valid terrestrial agricultural coordinates in EPSG:4326.",
                    "upgrades_capabilities": [cid for cid in caps if caps[cid]["status"] == "BLOCKED"],
                }
            ],
            "evidence_levels_observed": quality_assessment["evidence_levels_observed"],
            "single_next_missing_input": quality_assessment["single_next_missing_input"],
            "quality_assessment": quality_assessment,
            "sensitivity_scope_note": (
                "Adaptive evidence capability C7 and its sensitivity analyzer cover regional water screening only; "
                "use CanonicalDecisionSensitivityRunner against ClientDecisionService for 5-year whole-farm decision sensitivity."
            ),
            "provenance_and_uncertainty_ledger": {
                "evidence_objects": ev_list,
                "prohibited_substitutions": [],
                "registered_estimators_used": [],
            },
            "scientific_guardrails": {
                "field_validated": False,
                "marketable_yield": None,
                "profit": None,
                "prediction_accuracy": "NOT_MEASURED",
                "false_qualification_upgrades": 0,
            },
        }
