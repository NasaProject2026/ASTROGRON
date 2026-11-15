"""Stage P5 Geographic Generalization Evaluation, Security, and Scientific Red-Team Suite.

Implements Section 6 (Stage P5) and Section 7 ('Non-Negotiable Scientific & Engineering Guardrails')
of `00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List

from .adapters import FAOGAEZAdapter, SoilGridsWCSAdapter
from .engine import AdaptiveEvidenceEngine
from .estimators import attempt_prohibited_derivation
from .inventory import P0_BASELINE_CASES, compute_p0_baseline_report
from .schema import canonical_digest


def evaluate_p5_generalization_and_redteam() -> Dict[str, Any]:
    """Run P0 vs P5 geographic generalization comparison and 16-case scientific/security red-team suite."""
    engine = AdaptiveEvidenceEngine()
    p0_report = compute_p0_baseline_report()

    geo_cases = [c for c in P0_BASELINE_CASES if c["category"] == "geographic"]
    adv_cases = [c for c in P0_BASELINE_CASES if c["category"] == "adversarial"]

    authentic_cache_results: List[Dict[str, Any]] = []
    conditional_ref_results: List[Dict[str, Any]] = []
    false_qualification_upgrades = 0
    total_evidence_objects = 0
    complete_metadata_objects = 0

    REQUIRED_EVIDENCE_KEYS = (
        "parameter_path",
        "provenance_class",
        "source_id",
        "provider",
        "product",
        "variable",
        "version",
        "permanent_url",
        "citation",
        "crs",
        "spatial_resolution_desc",
        "fixture_origin",
        "license",
        "attribution",
        "evidence_id",
    )

    for case in geo_cases:
        # 1. Authentic Cache Mode (strictly pre-bundled/live-cached authentic receipts only)
        req_auth = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": f"p5-auth-{case['case_id']}",
            "location": {
                "site_id": case["site_id"],
                "name": case["label"],
                "point_lon_lat": case["point_lon_lat"],
                "crs": case["crs"],
            },
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["barley", "wheat", "faba_bean"],
            "water_supply_scenario": {"regime": "rainfed"},
            "options": {
                "acquisition": "CACHE_ONLY",
                "allow_offline_reference_fixture": False,
                "allow_conditional_crop_planning": True,
            },
        }
        resp_auth = engine.evaluate(req_auth)
        authentic_cache_results.append(
            {
                "case_id": case["case_id"],
                "site_id": case["site_id"],
                "agro_climatic_zone": case["region_class"],
                "capability_statuses": resp_auth["capability_statuses"],
            }
        )

        # 2. Offline Regional Reference + Conditional Planning Mode
        user_meas = (
            {"mineral_n_kg_ha": 45.0, "input_cost_eur_ha": 600.0}
            if case["site_id"] == "NL_WAGENINGEN_RESEARCH"
            else {}
        )
        req_cond = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": f"p5-cond-{case['case_id']}",
            "location": {
                "site_id": case["site_id"],
                "name": case["label"],
                "point_lon_lat": case["point_lon_lat"],
                "crs": case["crs"],
            },
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["barley", "wheat", "faba_bean"],
            "water_supply_scenario": {"regime": "rainfed"},
            "user_measurements": user_meas,
            "options": {
                "acquisition": "CACHE_ONLY",
                "allow_offline_reference_fixture": True,
                "allow_conditional_crop_planning": True,
            },
        }
        resp_cond = engine.evaluate(req_cond)
        st = resp_cond["capability_statuses"]

        # Verify zero false qualification upgrades
        if (
            st["C3"] == "READY"
            or st["C4"] == "READY"
            or st["C5"] == "READY"
            or st["C6"] == "READY"
            or st["C7"] == "READY"
            or st["C8"] == "READY"
            or st["C9"] == "READY"
            or st["C10"] == "READY"
            or resp_cond["scientific_guardrails"]["field_validated"] is not False
            or resp_cond["scientific_guardrails"]["marketable_yield"] is not None
            or resp_cond["scientific_guardrails"]["profit"] is not None
        ):
            false_qualification_upgrades += 1

        for ev in resp_cond["provenance_and_uncertainty_ledger"]["evidence_objects"]:
            total_evidence_objects += 1
            if all(ev.get(k) is not None for k in REQUIRED_EVIDENCE_KEYS):
                complete_metadata_objects += 1

        conditional_ref_results.append(
            {
                "case_id": case["case_id"],
                "site_id": case["site_id"],
                "agro_climatic_zone": case["region_class"],
                "capability_statuses": st,
                "c4_missing_reason": resp_cond["capabilities"]["C4"].get("missing_reason"),
                "top_conditional_crop": (
                    resp_cond["capabilities"]["C7"]["diagnostics"]["top_ranked_crop"]
                    if resp_cond["capabilities"]["C7"]["diagnostics"]
                    else None
                ),
            }
        )

    n_geo = len(geo_cases)
    auth_c2_count = sum(1 for r in authentic_cache_results if r["capability_statuses"]["C2"] == "READY")
    auth_c3_count = sum(1 for r in authentic_cache_results if r["capability_statuses"]["C3"] == "CONDITIONAL")
    auth_any_source = sum(
        1
        for r in authentic_cache_results
        if r["capability_statuses"]["C2"] == "READY" or r["capability_statuses"]["C3"] == "CONDITIONAL"
    )
    auth_c7_cond = sum(
        1 for r in authentic_cache_results if r["capability_statuses"]["C7"] == "CONDITIONAL"
    )

    cond_useful_partial = sum(
        1
        for r in conditional_ref_results
        if r["capability_statuses"]["C1"] == "READY"
        and r["capability_statuses"]["C2"] in ("READY", "CONDITIONAL")
        and r["capability_statuses"]["C3"] == "CONDITIONAL"
    )
    cond_c7_planning = sum(
        1 for r in conditional_ref_results if r["capability_statuses"]["C7"] == "CONDITIONAL"
    )

    redteam_results = run_redteam_and_security_suite(engine, adv_cases)

    metrics = {
        "total_geographic_cases": n_geo,
        "total_redteam_cases": len(redteam_results),
        "p0_baseline_comparison": {
            "p0_useful_partial_geographic_cases": p0_report["summary_metrics"]["p0_useful_partial_geographic_cases"],
            "p0_conditional_planning_geographic_cases": p0_report["summary_metrics"]["p0_conditional_planning_geographic_cases"],
            "p0_climate_ready_geographic_cases": p0_report["summary_metrics"]["p0_climate_ready_geographic_cases"],
        },
        "AUTHENTIC_SOURCE_RETRIEVAL": {
            "denominator": n_geo,
            "c2_authentic_climate_ready_count": auth_c2_count,
            "c3_authentic_soilgrids_wcs_count": auth_c3_count,
            "authentic_source_retrieval_count": auth_any_source,
            "authentic_source_retrieval_coverage": round(auth_any_source / n_geo, 4),
            "c7_screening_from_authentic_cache_count": auth_c7_cond,
            "c7_screening_from_authentic_cache_rate": round(auth_c7_cond / n_geo, 4),
            "counts_offline_fixtures": False,
            "note": "Genuine cached NASA POWER / SoilGrids WCS retrievals only; NOT broad live global coverage.",
        },
        "OFFLINE_REFERENCE_SCENARIO": {
            "denominator": n_geo,
            "allow_offline_reference_fixture": True,
            "is_authentic_live_source_retrieval": False,
            "offline_fixture_partial_count": cond_useful_partial,
            "offline_fixture_partial_rate": round(cond_useful_partial / n_geo, 4),
            "offline_fixture_c7_screening_count": cond_c7_planning,
            "offline_fixture_c7_screening_rate": round(cond_c7_planning / n_geo, 4),
            "domain_blocked_peatland_cases": [
                r["site_id"]
                for r in conditional_ref_results
                if r["c4_missing_reason"] == "estimator_out_of_domain"
            ],
            "note": "Offline reference-fixture scenario mode only; NEVER represent as real-world global source availability.",
        },
        "CONDITIONAL_USER_ASSUMPTION": {
            "denominator": n_geo,
            "assumed_water_regime": "rainfed",
            "assumed_candidate_crops": ["barley", "wheat", "faba_bean"],
            "c7_screening_count": cond_c7_planning,
            "c7_screening_rate": round(cond_c7_planning / n_geo, 4),
            "is_verified_5yr_plan": False,
            "note": "Seasonal water-suitability screening under explicit user-assumed rainfed & crop priors; NOT a 5-year rotation plan.",
        },
        "FALSE_QUALIFICATION_UPGRADES": false_qualification_upgrades,
        "EVIDENCE_METADATA_COMPLETENESS": (
            round(complete_metadata_objects / total_evidence_objects, 4)
            if total_evidence_objects > 0
            else 1.0
        ),
        "REDTEAM_PASS_RATE": round(
            sum(1 for r in redteam_results if r["passed"]) / len(redteam_results), 4
        ),
        "prediction_accuracy": "NOT_MEASURED",
    }

    return {
        "schema": "astragron.adaptive-evidence.p5-evaluation-report.v1",
        "stage": "P5",
        "summary_metrics": metrics,
        "authentic_cache_geographic_results": authentic_cache_results,
        "conditional_reference_geographic_results": conditional_ref_results,
        "redteam_and_security_results": redteam_results,
    }


def run_redteam_and_security_suite(
    engine: AdaptiveEvidenceEngine, adv_cases: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Execute 16 adversarial scientific and security red-team probes."""
    results: List[Dict[str, Any]] = []

    # 1-8: The 8 P0 adversarial cases evaluated through the full P3 engine
    for case in adv_cases:
        adv_type = case["adversarial_type"]
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": f"p5-rt-{case['case_id']}",
            "location": {
                "site_id": case["site_id"],
                "point_lon_lat": case["point_lon_lat"],
                "crs": case["crs"],
            },
            "soil_depth_intervals_cm": [[30, 15]] if adv_type == "depth_inconsistency" else [[0, 5]],
            "candidate_crops": (
                ["banana_uncalibrated"]
                if case["case_id"] == "ADV_08_UNSUPPORTED_CROP_AND_PROFIT_CLAIM"
                else ["barley", "wheat"]
            ),
            "options": {
                "simulate_corrupt_receipt": adv_type == "corrupt_receipt_or_hash_mismatch",
            },
        }
        resp = engine.evaluate(req)
        blocked_reasons = [b["missing_reason"] for b in resp["blocked_claims"]]
        passed = (
            len(blocked_reasons) > 0
            and resp["capability_statuses"]["C7"] == "BLOCKED"
            and resp["scientific_guardrails"]["field_validated"] is False
            and resp["scientific_guardrails"]["profit"] is None
        )
        results.append(
            {
                "probe_id": case["case_id"],
                "description": case["label"],
                "expected_adversarial_type": adv_type,
                "observed_blocked_reasons": sorted(set(blocked_reasons)),
                "passed": passed,
            }
        )

    # 9: RT_09_TEXTURE_SUM_VIOLATION
    sg = SoilGridsWCSAdapter()
    bad_tex = sg.fetch_or_load(
        [17.65, 59.82],
        [(0, 5)],
        raw_override={
            "clay": {"q05": 500, "q50": 600, "mean": 600, "q95": 700},
            "silt": {"q05": 400, "q50": 500, "mean": 500, "q95": 600},
            "sand": {"q05": 200, "q50": 300, "mean": 300, "q95": 400},
            "bdod": {"q05": 120, "q50": 130, "mean": 130, "q95": 140},
            "cfvo": {"q05": 10, "q50": 20, "mean": 20, "q95": 30},
            "soc": {"q05": 100, "q50": 150, "mean": 150, "q95": 200},
            "phh2o": {"q05": 60, "q50": 65, "mean": 65, "q95": 70},
        },
    )
    results.append(
        {
            "probe_id": "RT_09_TEXTURE_SUM_VIOLATION",
            "description": "Reject SoilGrids profile where clay + silt + sand = 140% (> 100% +/- 8%).",
            "expected_missing_reason": "quality_fail",
            "observed_blocked_reasons": [bad_tex["missing_reason"]],
            "passed": bad_tex["status"] == "BLOCKED" and bad_tex["missing_reason"] == "quality_fail",
        }
    )

    # 10: RT_10_MINERAL_N_FROM_SOILGRIDS_BLOCKED
    min_n = attempt_prohibited_derivation("soil.mineral_n_kg_ha", {"soc_g_kg": 30.0})
    results.append(
        {
            "probe_id": "RT_10_MINERAL_N_FROM_SOILGRIDS_BLOCKED",
            "description": "Block deriving plant-available NO3/NH4 from SoilGrids SOC or total N.",
            "expected_missing_reason": "not_identifiable",
            "observed_blocked_reasons": [min_n["missing_reason"]],
            "passed": min_n["status"] == "BLOCKED" and min_n["missing_reason"] == "not_identifiable",
        }
    )

    # 11: RT_11_WATER_RIGHTS_FROM_RAINFALL_BLOCKED
    w_perm = attempt_prohibited_derivation("legal.water_abstraction_permit", {"precip_mm": 1900.0})
    results.append(
        {
            "probe_id": "RT_11_WATER_RIGHTS_FROM_RAINFALL_BLOCKED",
            "description": "Block inferring legal irrigation water rights from high regional rainfall.",
            "expected_missing_reason": "official_verification_required",
            "observed_blocked_reasons": [w_perm["missing_reason"]],
            "passed": w_perm["status"] == "BLOCKED"
            and w_perm["missing_reason"] == "official_verification_required",
        }
    )

    # 12: RT_12_GAEZ_SUITABILITY_TO_FARM_YIELD_BLOCKED
    gaez = FAOGAEZAdapter()
    gaez_res = gaez.evaluate_suitability(
        [17.65, 59.82],
        "wheat",
        "rainfed",
        allow_contract_test_fixture=True,
        contract_test_fixture_payload={"suitability_index_0_100": 85.0, "suitability_class": "VS"},
    )
    prohibited_yield = gaez_res["prohibited_substitutions"][0]
    results.append(
        {
            "probe_id": "RT_12_GAEZ_SUITABILITY_TO_FARM_YIELD_BLOCKED",
            "description": "Prohibit converting FAO GAEZ suitability classes into calibrated farm yields.",
            "expected_missing_reason": "not_identifiable",
            "observed_blocked_reasons": [prohibited_yield["missing_reason"]],
            "passed": gaez_res["diagnostics"]["calibrated_farm_yield_t_ha"] is None
            and prohibited_yield["missing_reason"] == "not_identifiable",
        }
    )

    # 13: RT_13_UNSUPPORTED_CROP_GENERIC_KC_BLOCKED
    unsup_resp = engine.evaluate(
        {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "rt-13-unsupported-crop",
            "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["avocado_uncalibrated"],
            "water_supply_scenario": {"regime": "rainfed"},
        }
    )
    results.append(
        {
            "probe_id": "RT_13_UNSUPPORTED_CROP_GENERIC_KC_BLOCKED",
            "description": "Block uncalibrated crop Kc substitution in C6/C7 while preserving C1-C4.",
            "expected_missing_reason": "unsupported_crop_profile",
            "observed_blocked_reasons": [unsup_resp["capabilities"]["C6"]["missing_reason"]],
            "passed": unsup_resp["capability_statuses"]["C6"] == "BLOCKED"
            and unsup_resp["capabilities"]["C6"]["missing_reason"] == "unsupported_crop_profile"
            and unsup_resp["capability_statuses"]["C4"] == "CONDITIONAL",
        }
    )

    # 14: RT_14_PEATLAND_PTF_OUT_OF_DOMAIN_BLOCKED
    oulu_resp = engine.evaluate(
        {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "rt-14-peatland-oulu",
            "location": {"site_id": "FI_OSTROBOTHNIA_OULU", "point_lon_lat": [25.47, 65.01], "crs": "EPSG:4326"},
            "options": {"allow_offline_reference_fixture": True},
        }
    )
    results.append(
        {
            "probe_id": "RT_14_PEATLAND_PTF_OUT_OF_DOMAIN_BLOCKED",
            "description": "Block mineral PTF on organic peatland soil (OM = 11.2% > 8.0%).",
            "expected_missing_reason": "estimator_out_of_domain",
            "observed_blocked_reasons": [oulu_resp["capabilities"]["C4"]["missing_reason"]],
            "passed": oulu_resp["capability_statuses"]["C4"] == "BLOCKED"
            and oulu_resp["capabilities"]["C4"]["missing_reason"] == "estimator_out_of_domain"
            and oulu_resp["capability_statuses"]["C3"] == "CONDITIONAL",
        }
    )

    # 15: RT_15_INVERTED_RETENTION_USER_INPUT_BLOCKED
    inv_ret = engine.evaluate(
        {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "rt-15-inverted-retention",
            "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
            "user_measurements": {"theta_wp": 0.38, "theta_fc": 0.21},
        }
    )
    results.append(
        {
            "probe_id": "RT_15_INVERTED_RETENTION_USER_INPUT_BLOCKED",
            "description": "Reject user soil measurements where theta_wp >= theta_fc.",
            "expected_missing_reason": "quality_fail",
            "observed_blocked_reasons": [inv_ret["capabilities"]["C4"]["missing_reason"]],
            "passed": inv_ret["capability_statuses"]["C4"] == "BLOCKED"
            and inv_ret["capabilities"]["C4"]["missing_reason"] == "quality_fail",
        }
    )

    # 16: RT_16_PATH_TRAVERSAL_AND_BOOLEAN_COORD_GUARD
    sec_resp = engine.evaluate(
        {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "rt-16-security-guard",
            "location": {"site_id": "../../etc/passwd", "point_lon_lat": [True, False], "crs": "EPSG:4326"},
        }
    )
    results.append(
        {
            "probe_id": "RT_16_PATH_TRAVERSAL_AND_BOOLEAN_COORD_GUARD",
            "description": "Reject boolean coordinate spoofing and path-traversal site_id strings safely.",
            "expected_missing_reason": "invalid_coordinates_or_crs",
            "observed_blocked_reasons": [sec_resp["capabilities"]["C1"]["missing_reason"]],
            "passed": sec_resp["capability_statuses"]["C1"] == "BLOCKED"
            and sec_resp["capabilities"]["C1"]["missing_reason"] == "invalid_coordinates_or_crs",
        }
    )

    return results
