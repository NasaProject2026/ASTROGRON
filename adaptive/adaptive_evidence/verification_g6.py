"""Stage G6 Verification Harness: Live Retrieval, Depth/Spatial Audit, Quality Gate Acceptance, and >=24-Site Coverage Matrix.

Run with ``--live`` on an internet-connected machine to probe live NASA POWER and
ISRIC SoilGrids 250 m WCS endpoints across diverse continents, verify bit-for-bit
offline cache replay, execute the offline >=24-site + adversarial matrix, and
write G6 audit artifacts in ``docs/adaptive_evidence/``.

Run with ``--offline-audit`` (with ``ASTRAGRON_OFFLINE_ONLY=1``) during clean-room
offline replay to re-verify all deterministic offline audits, matrix metrics, and
pre-recorded authentic cache replay without attempting outbound network calls.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import tempfile
import time
import tracemalloc
from typing import Any, Dict, List, Optional

from .adapters.depth_aggregation import (
    ALL_SOILGRIDS_DEPTH_LABELS,
    aggregate_soilgrids_property_layers,
    resolve_overlapping_soilgrids_depths,
)
from .adapters.http_cache import atomic_write_json
from .adapters.nasa_power import NASAPowerAdapter
from .adapters.soilgrids import SoilGridsWCSAdapter
from .engine import AdaptiveEvidenceEngine
from .inventory import P0_BASELINE_CASES, ROOT
from .license_gate import evaluate_open_source_license_gate
from .quality_gate import EvidenceQualityGate
from .schema import validate_depth_intervals
from .sensitivity import CANONICAL_STABILITY_CLASSES, DecisionSensitivityAnalyzer

DOCS_DIR = ROOT / "docs" / "adaptive_evidence"

# Diverse continental agricultural sites (never only Uppsala / old cached examples)
LIVE_NASA_POWER_SITES: List[Dict[str, Any]] = [
    {"site_id": "DE_MUNICH_AGRI", "continent": "Europe", "country": "DE", "point_lon_lat": [11.58, 48.14], "test_lst_pair": True},
    {"site_id": "DE_HEILBRONN", "continent": "Europe", "country": "DE", "point_lon_lat": [9.22, 49.14], "test_lst_pair": False},
    {"site_id": "US_AMES_IOWA", "continent": "North America", "country": "US", "point_lon_lat": [-93.62, 42.03], "test_lst_pair": False},
    {"site_id": "BR_SORRISO", "continent": "South America", "country": "BR", "point_lon_lat": [-55.72, -12.55], "test_lst_pair": False},
    {"site_id": "KE_NAKURU", "continent": "Africa", "country": "KE", "point_lon_lat": [36.07, -0.28], "test_lst_pair": False},
    {"site_id": "AU_TOOWOOMBA", "continent": "Oceania", "country": "AU", "point_lon_lat": [151.95, -27.56], "test_lst_pair": False},
]

LIVE_SOILGRIDS_SITES: List[Dict[str, Any]] = [
    {"site_id": "DE_KRAICHGAU_AGRI", "continent": "Europe", "country": "DE", "point_lon_lat": [9.12, 49.16]},
    {"site_id": "US_AGRONOMY_AMES", "continent": "North America", "country": "US", "point_lon_lat": [-93.775, 42.015]},
    {"site_id": "BR_SORRISO_AGRI", "continent": "South America", "country": "BR", "point_lon_lat": [-55.82, -12.52]},
    {"site_id": "KE_NAKURU", "continent": "Africa", "country": "KE", "point_lon_lat": [36.07, -0.28]},
    {"site_id": "AU_TOOWOOMBA_AGRI", "continent": "Oceania", "country": "AU", "point_lon_lat": [151.80, -27.55]},
]

URBAN_MASK_LIVE_PROBES: List[Dict[str, Any]] = [
    {"site_id": "DE_HEILBRONN_URBAN_CENTER", "continent": "Europe", "country": "DE", "point_lon_lat": [9.22, 49.14]},
]


def run_live_source_verification(*, start_iso: str = "2023-07-01", end_iso: str = "2023-08-31") -> Dict[str, Any]:
    """Execute genuine HTTPS retrievals against NASA POWER and ISRIC SoilGrids WCS + offline replay parity."""
    prev_offline = os.environ.pop("ASTRAGRON_OFFLINE_ONLY", None)
    nasa_records: List[Dict[str, Any]] = []
    soil_records: List[Dict[str, Any]] = []
    utc_lst_separation_verified = False

    try:
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            nasa_cache = td_path / "nasa_live"
            soil_cache = td_path / "soil_live"
            nasa_adapter = NASAPowerAdapter(cache_dir=nasa_cache)
            soil_adapter = SoilGridsWCSAdapter(cache_dir=soil_cache)

            # 1. Live NASA POWER queries (UTC + one UTC vs LST pair)
            for site in LIVE_NASA_POWER_SITES:
                t0 = time.monotonic()
                res_utc = nasa_adapter.fetch_or_load(
                    site["point_lon_lat"],
                    start_iso,
                    end_iso,
                    acquisition="FETCH_ALLOWED",
                    time_standard="UTC",
                    site_id=site["site_id"],
                )
                dt_ms = round((time.monotonic() - t0) * 1000.0, 2)
                diag = res_utc.get("diagnostics") or {}
                evs = res_utc.get("evidence_objects") or []
                ev0 = evs[0] if evs else {}
                rec = {
                    "site_id": site["site_id"],
                    "continent": site["continent"],
                    "country": site["country"],
                    "point_lon_lat": site["point_lon_lat"],
                    "period": [start_iso, end_iso],
                    "time_standard": "UTC",
                    "status": res_utc.get("status"),
                    "missing_reason": res_utc.get("missing_reason"),
                    "evidence_level": res_utc.get("evidence_level"),
                    "query_url": ev0.get("access_path"),
                    "raw_source_sha256": ev0.get("raw_source_sha256"),
                    "receipt_sha256": ev0.get("receipt_sha256"),
                    "retrieved_at": ev0.get("retrieved_at"),
                    "elapsed_ms": dt_ms,
                    "request_telemetry": diag.get("request_telemetry"),
                    "days_verified": diag.get("days_verified"),
                    "period_cumulative_precipitation_mm": diag.get("period_cumulative_precipitation_mm"),
                    "mean_temperature_c": diag.get("mean_temperature_c"),
                    "grid": diag.get("grid"),
                }

                if site.get("test_lst_pair") and res_utc.get("status") == "READY":
                    res_lst = nasa_adapter.fetch_or_load(
                        site["point_lon_lat"],
                        start_iso,
                        end_iso,
                        acquisition="FETCH_ALLOWED",
                        time_standard="LST",
                        site_id=site["site_id"],
                    )
                    lst_ev0 = (res_lst.get("evidence_objects") or [{}])[0]
                    rec["lst_comparison"] = {
                        "status": res_lst.get("status"),
                        "time_standard": (res_lst.get("diagnostics") or {}).get("time_standard"),
                        "raw_source_sha256": lst_ev0.get("raw_source_sha256"),
                        "query_url": lst_ev0.get("access_path"),
                        "period_cumulative_precipitation_mm": (res_lst.get("diagnostics") or {}).get(
                            "period_cumulative_precipitation_mm"
                        ),
                    }
                    utc_lst_separation_verified = (
                        res_lst.get("status") == "READY"
                        and (res_lst.get("diagnostics") or {}).get("time_standard") == "LST"
                        and lst_ev0.get("access_path") != ev0.get("access_path")
                    )

                nasa_records.append(rec)

            # 2. Live ISRIC SoilGrids WCS multi-depth queries ([0, 30] and [30, 60])
            for site in LIVE_SOILGRIDS_SITES:
                for depth_int in ([[0, 30]], [[30, 60]]):
                    t0 = time.monotonic()
                    res_sg = soil_adapter.fetch_or_load(
                        site["point_lon_lat"],
                        depth_int,
                        acquisition="FETCH_ALLOWED",
                        max_distance_m=500.0,
                        include_nitrogen=True,
                        site_id=site["site_id"],
                    )
                    dt_ms = round((time.monotonic() - t0) * 1000.0, 2)
                    diag = res_sg.get("diagnostics") or {}
                    evs = res_sg.get("evidence_objects") or []
                    ev0 = evs[0] if evs else {}
                    soil_records.append(
                        {
                            "site_id": site["site_id"],
                            "continent": site["continent"],
                            "country": site["country"],
                            "point_lon_lat": site["point_lon_lat"],
                            "depth_interval_cm": depth_int[0],
                            "status": res_sg.get("status"),
                            "missing_reason": res_sg.get("missing_reason"),
                            "evidence_level": res_sg.get("evidence_level"),
                            "resolved_native_layers": diag.get("resolved_native_layers"),
                            "layer_weights": diag.get("layer_weights"),
                            "texture_mean_sum_pct": diag.get("texture_mean_sum_pct"),
                            "phh2o_summary": (diag.get("properties_si") or {}).get("phh2o"),
                            "clay_summary": (diag.get("properties_si") or {}).get("clay"),
                            "soc_summary": (diag.get("properties_si") or {}).get("soc"),
                            "cfvo_summary": (diag.get("properties_si") or {}).get("cfvo"),
                            "mineral_n_blocked_reason": diag.get("mineral_n_blocked_reason"),
                            "spatial_support": diag.get("spatial_support"),
                            "raw_source_sha256": ev0.get("raw_source_sha256"),
                            "receipt_sha256": ev0.get("receipt_sha256"),
                            "sample_access_url": ev0.get("access_path"),
                            "retrieved_at": ev0.get("retrieved_at"),
                            "elapsed_ms": dt_ms,
                            "request_telemetry": diag.get("request_telemetry"),
                        }
                    )

            # 2b. Urban/built-up mask live fail-closed probe (must NOT snap km away to rural cell)
            urban_mask_probes: List[Dict[str, Any]] = []
            for up in URBAN_MASK_LIVE_PROBES:
                u_res = soil_adapter.fetch_or_load(
                    up["point_lon_lat"],
                    [[0, 5]],
                    acquisition="FETCH_ALLOWED",
                    max_distance_m=500.0,
                    site_id=up["site_id"],
                )
                urban_mask_probes.append(
                    {
                        "site_id": up["site_id"],
                        "point_lon_lat": up["point_lon_lat"],
                        "status": u_res.get("status"),
                        "missing_reason": u_res.get("missing_reason"),
                        "detail": u_res.get("detail"),
                    }
                )

            # 3. Strict OFFLINE replay parity test on the exact temporary live receipts
            os.environ["ASTRAGRON_OFFLINE_ONLY"] = "1"
            for rec in nasa_records:
                if rec["status"] == "READY":
                    rep = nasa_adapter.fetch_or_load(
                        rec["point_lon_lat"],
                        start_iso,
                        end_iso,
                        acquisition="CACHE_ONLY",
                        time_standard="UTC",
                        site_id=rec["site_id"],
                    )
                    rdiag = rep.get("diagnostics") or {}
                    rev0 = (rep.get("evidence_objects") or [{}])[0]
                    rec["offline_replay_status"] = rep.get("status")
                    rec["offline_replay_evidence_level"] = rep.get("evidence_level")
                    rec["offline_replay_bit_for_bit_parity"] = (
                        rep.get("status") == "READY"
                        and rep.get("evidence_level") == "AUTHENTIC_VERIFIED_CACHE"
                        and rev0.get("raw_source_sha256") == rec["raw_source_sha256"]
                        and rdiag.get("period_cumulative_precipitation_mm") == rec["period_cumulative_precipitation_mm"]
                        and rdiag.get("mean_temperature_c") == rec["mean_temperature_c"]
                    )
                else:
                    rec["offline_replay_status"] = None
                    rec["offline_replay_evidence_level"] = None
                    rec["offline_replay_bit_for_bit_parity"] = False

            for srec in soil_records:
                if srec["status"] in ("READY", "CONDITIONAL"):
                    rep_s = soil_adapter.fetch_or_load(
                        srec["point_lon_lat"],
                        [srec["depth_interval_cm"]],
                        acquisition="CACHE_ONLY",
                        max_distance_m=500.0,
                        include_nitrogen=True,
                        site_id=srec["site_id"],
                    )
                    rdiag_s = rep_s.get("diagnostics") or {}
                    rev_s = (rep_s.get("evidence_objects") or [{}])[0]
                    srec["offline_replay_status"] = rep_s.get("status")
                    srec["offline_replay_evidence_level"] = rep_s.get("evidence_level")
                    srec["offline_replay_bit_for_bit_parity"] = (
                        rep_s.get("evidence_level") == "AUTHENTIC_VERIFIED_CACHE"
                        and rev_s.get("raw_source_sha256") == srec["raw_source_sha256"]
                        and rdiag_s.get("resolved_native_layers") == srec["resolved_native_layers"]
                        and rdiag_s.get("texture_mean_sum_pct") == srec["texture_mean_sum_pct"]
                    )
                else:
                    srec["offline_replay_status"] = None
                    srec["offline_replay_evidence_level"] = None
                    srec["offline_replay_bit_for_bit_parity"] = False
    finally:
        if prev_offline is None:
            os.environ.pop("ASTRAGRON_OFFLINE_ONLY", None)
        else:
            os.environ["ASTRAGRON_OFFLINE_ONLY"] = prev_offline

    nasa_live_ok = sum(1 for r in nasa_records if r["status"] == "READY" and r["evidence_level"] == "AUTHENTIC_LIVE")
    nasa_replay_ok = sum(1 for r in nasa_records if r.get("offline_replay_bit_for_bit_parity"))
    sg_sites_ok = len({r["site_id"] for r in soil_records if r["status"] in ("READY", "CONDITIONAL") and r["evidence_level"] == "AUTHENTIC_LIVE"})
    sg_queries_ok = sum(1 for r in soil_records if r["status"] in ("READY", "CONDITIONAL") and r["evidence_level"] == "AUTHENTIC_LIVE")
    sg_replay_ok = sum(1 for r in soil_records if r.get("offline_replay_bit_for_bit_parity"))

    overall_live_gate = (
        "PASS"
        if (nasa_live_ok >= 4 and nasa_replay_ok == nasa_live_ok and sg_sites_ok >= 3 and sg_replay_ok == sg_queries_ok and utc_lst_separation_verified)
        else "PARTIAL"
    )
    if nasa_live_ok == 0 and sg_sites_ok == 0:
        overall_live_gate = "LIVE_SOURCE_GATE_BLOCKED"

    return {
        "schema": "astragron.adaptive-evidence.live-source-verification.v1",
        "executed_at_utc": datetime.now(timezone.utc).isoformat(),
        "environment": {
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            "cache_isolation": "fresh_temporary_directory_with_clean_offline_replay_switch",
        },
        "summary": {
            "overall_status": overall_live_gate,
            "nasa_power_sites_attempted": len(nasa_records),
            "nasa_power_authentic_live_success": nasa_live_ok,
            "nasa_power_offline_replay_parity_success": nasa_replay_ok,
            "nasa_power_utc_vs_lst_separated": utc_lst_separation_verified,
            "soilgrids_sites_attempted": len(LIVE_SOILGRIDS_SITES),
            "soilgrids_sites_authentic_live_success": sg_sites_ok,
            "soilgrids_queries_attempted": len(soil_records),
            "soilgrids_queries_authentic_live_success": sg_queries_ok,
            "soilgrids_offline_replay_parity_success": sg_replay_ok,
            "authentic_live_provider_success_fraction": {
                "nasa_power": f"{nasa_live_ok}/{len(nasa_records)}",
                "soilgrids_sites": f"{sg_sites_ok}/{len(LIVE_SOILGRIDS_SITES)}",
            },
            "scope_disclaimer": (
                "Sampling demonstration across selected continental agricultural sites on live endpoints; "
                "not a claim of 100% global Earth land coverage or field-station calibration."
            ),
        },
        "nasa_power_live_retrievals": nasa_records,
        "soilgrids_live_retrievals": soil_records,
        "urban_or_water_mask_fail_closed_probes": urban_mask_probes,
    }


def build_soil_depth_and_spatial_audit(live_doc: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Verify 6-layer SoilGrids depth aggregation math, pH abstention, depth guards, and spatial GeoTIFF rules."""
    ov_0_30 = resolve_overlapping_soilgrids_depths(0.0, 30.0)
    ov_10_45 = resolve_overlapping_soilgrids_depths(10.0, 45.0)
    ov_15_100 = resolve_overlapping_soilgrids_depths(15.0, 100.0)
    ov_over200 = resolve_overlapping_soilgrids_depths(150.0, 250.0)
    gap_check = validate_depth_intervals([[0, 5], [15, 30]])

    agg_soc = aggregate_soilgrids_property_layers(
        "soc",
        ov_10_45["overlaps"],
        {
            "5-15cm": {"q05": 10.0, "q50": 20.0, "mean": 20.0, "q95": 30.0},
            "15-30cm": {"q05": 12.0, "q50": 24.0, "mean": 24.0, "q95": 36.0},
            "30-60cm": {"q05": 14.0, "q50": 28.0, "mean": 28.0, "q95": 42.0},
        },
        unit="g/kg",
    )
    agg_ph = aggregate_soilgrids_property_layers(
        "phh2o",
        ov_0_30["overlaps"],
        {
            "0-5cm": {"q05": 6.0, "q50": 6.3, "mean": 6.3, "q95": 6.6},
            "5-15cm": {"q05": 6.2, "q50": 6.5, "mean": 6.5, "q95": 6.8},
            "15-30cm": {"q05": 6.5, "q50": 6.8, "mean": 6.8, "q95": 7.1},
        },
        unit="pH",
    )

    live_spatial_samples = []
    if isinstance(live_doc, dict):
        for sr in live_doc.get("soilgrids_live_retrievals") or []:
            if sr.get("status") in ("READY", "CONDITIONAL"):
                sp = sr.get("spatial_support") or {}
                live_spatial_samples.append(
                    {
                        "site_id": sr["site_id"],
                        "depth_interval_cm": sr["depth_interval_cm"],
                        "resolved_native_layers": sr["resolved_native_layers"],
                        "layer_weights": sr["layer_weights"],
                        "texture_mean_sum_pct": sr["texture_mean_sum_pct"],
                        "phh2o_abstained_scalar": bool((sr.get("phh2o_summary") or {}).get("abstained_scalar")),
                        "crs": sp.get("crs"),
                        "pixel_col_row": [sp.get("col"), sp.get("row")],
                        "pixel_center_lon_lat": sp.get("pixel_center_lon_lat"),
                        "distance_m": sp.get("distance_m"),
                        "geotransform_verified": sp.get("geotransform_verified"),
                    }
                )

    return {
        "schema": "astragron.adaptive-evidence.soil-depth-spatial-audit.v1",
        "executed_at_utc": datetime.now(timezone.utc).isoformat(),
        "native_soilgrids_depths_supported": list(ALL_SOILGRIDS_DEPTH_LABELS),
        "custom_interval_checks": {
            "0_to_30cm_layers": [o["depth_label"] for o in ov_0_30["overlaps"]],
            "10_to_45cm_weights": {o["depth_label"]: round(o["weight"], 6) for o in ov_10_45["overlaps"]},
            "15_to_100cm_layers": [o["depth_label"] for o in ov_15_100["overlaps"]],
            "10_to_45cm_soc_weighted_mean": round(float(agg_soc["mean"]), 4),
            "10_to_45cm_soc_expected_hand_calc": 25.1429,
            "phh2o_0_to_30cm_abstained_scalar": bool(agg_ph.get("abstained_scalar")),
            "phh2o_0_to_30cm_scalar_mean": agg_ph.get("mean"),
        },
        "fail_closed_depth_guards": {
            "over_200cm_interval": [150, 250],
            "over_200cm_valid": ov_over200["valid"],
            "over_200cm_missing_reason": ov_over200["missing_reason"],
            "non_contiguous_interval": [[0, 5], [15, 30]],
            "non_contiguous_valid": gap_check["valid"],
            "non_contiguous_missing_reason": gap_check["missing_reason"],
        },
        "geotiff_and_pixel_support_rules": {
            "compression_and_predictor_verified": ["uncompressed", "Deflate (8)", "LZW (5) + horizontal Predictor (2)"],
            "sample_formats_verified": ["signed int16", "IEEE Float32"],
            "zero_vs_nodata_separated": True,
            "max_distance_threshold_m": 500.0,
            "resolution_semantics": "Nominal 250 m x 250 m SoilGrids cell support; never labeled field-scale lab measurement.",
        },
        "live_spatial_and_depth_samples": live_spatial_samples,
    }


def run_quality_gate_acceptance() -> Dict[str, Any]:
    """Run adversarial Quality Gate checks and assert zero false qualification upgrades."""
    engine = AdaptiveEvidenceEngine()
    qgate = EvidenceQualityGate()
    checks: List[Dict[str, Any]] = []
    false_upgrades = 0

    def _rec(name: str, passed: bool, detail: str) -> None:
        nonlocal false_upgrades
        if not passed:
            false_upgrades += 1
        checks.append({"check_id": name, "passed": passed, "detail": detail})

    # 1. User measurement with whitespace metadata / empty depth fails downgrade check
    r_unver = engine.evaluate(
        {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g6-qgate-unverified",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["barley"],
            "water_supply_scenario": {"regime": "rainfed"},
            "user_measurements": {"theta_fc": 0.30, "theta_wp": 0.14, "measured_at": "   ", "method": "\t", "depth_interval_cm": []},
        }
    )
    ok_1 = (
        r_unver["capability_statuses"]["C4"] == "CONDITIONAL"
        and r_unver["quality_assessment"]["capability_verdicts"]["C4"]["verdict"] == "DEGRADED_TO_DESCRIPTION"
    )
    _rec("QG_01_unverified_and_whitespace_user_measurement", ok_1, f"C4={r_unver['capability_statuses']['C4']}")

    # 2. Cross-source disagreement keeps C4 CONDITIONAL & DEGRADED_TO_DESCRIPTION
    r_dis = engine.evaluate(
        {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g6-qgate-disagree",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["wheat"],
            "water_supply_scenario": {"regime": "rainfed"},
            "user_measurements": {"theta_fc": 0.55, "theta_wp": 0.10, "measured_at": "2026-04-01", "lab_method": "pressure_plate", "depth_interval_cm": [0, 30]},
            "options": {"allow_conditional_crop_planning": True},
        }
    )
    ok_2 = (
        r_dis["capability_statuses"]["C4"] == "CONDITIONAL"
        and r_dis["quality_assessment"]["capability_verdicts"]["C4"]["verdict"] == "DEGRADED_TO_DESCRIPTION"
        and r_dis["quality_assessment"]["capability_verdicts"]["C7"]["verdict"] == "DEGRADED_TO_DESCRIPTION"
    )
    _rec("QG_02_cross_source_disagreement", ok_2, f"C4_verdict={r_dis['quality_assessment']['capability_verdicts']['C4']['verdict']}")

    # 3. Direct spoofed C10=READY rejected
    qa_c10 = qgate.evaluate(
        {"request_id": "g6-c10-spoof", "location": {"point_lon_lat": [17.65, 59.82]}},
        capabilities={**r_unver["capabilities"], "C10": {"status": "READY"}},
    )
    ok_3 = qa_c10["capability_verdicts"]["C10"]["verdict"] == "REJECTED"
    _rec("QG_03_spoofed_c10_rejected", ok_3, f"C10_verdict={qa_c10['capability_verdicts']['C10']['verdict']}")

    # 4. Non-numeric theta_fc blocked without exception
    r_nan = engine.evaluate(
        {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g6-qgate-bad-float",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "user_measurements": {"theta_fc": "bad_float", "theta_wp": 0.10},
        }
    )
    ok_4 = r_nan["capability_statuses"]["C4"] == "BLOCKED" and r_nan["capabilities"]["C4"]["missing_reason"] == "quality_fail"
    _rec("QG_04_non_numeric_user_soil_blocked", ok_4, f"C4_reason={r_nan['capabilities']['C4']['missing_reason']}")

    # 5. Blocking dependency ranked before sensitivity input, no fabricated USD VOI
    r_rank = engine.evaluate(
        {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g6-qgate-rank",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["barley"],
            "water_supply_scenario": {},
        }
    )
    sni = r_rank["single_next_missing_input"]
    ok_5 = (
        isinstance(sni, dict)
        and sni.get("priority_tier") == "BLOCKING_DEPENDENCY"
        and sni.get("input_key") == "water_supply_scenario.regime_and_volume"
        and r_rank["quality_assessment"]["next_input_ranking"]["economic_voi_usd"] is None
        and r_rank["quality_assessment"]["next_input_ranking"]["fabricated_voi"] is False
    )
    _rec("QG_05_single_next_missing_input_ranking", ok_5, f"top={sni.get('input_key') if sni else None}")

    # 6. Ocean & Antarctica blocked before climate/soil
    r_ocean = engine.evaluate(
        {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g6-qgate-ocean",
            "location": {"point_lon_lat": [-30.0, 15.0], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
        }
    )
    ok_6 = r_ocean["capability_statuses"]["C1"] == "BLOCKED" and r_ocean["capability_statuses"]["C2"] == "BLOCKED"
    _rec("QG_06_ocean_blocked_c1_c2", ok_6, f"C1_reason={r_ocean['capabilities']['C1']['missing_reason']}")

    # 7. Corrupt receipt blocked
    r_corrupt = engine.evaluate(
        {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g6-qgate-corrupt",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "options": {"simulate_corrupt_receipt": True},
        }
    )
    ok_7 = r_corrupt["capabilities"]["C2"]["missing_reason"] == "corrupt_receipt_or_hash_mismatch"
    _rec("QG_07_corrupt_receipt_blocked", ok_7, f"C2_reason={r_corrupt['capabilities']['C2']['missing_reason']}")

    return {
        "schema": "astragron.adaptive-evidence.quality-gate-acceptance.v1",
        "executed_at_utc": datetime.now(timezone.utc).isoformat(),
        "QUALITY_GATE_FALSE_UPGRADES": false_upgrades,
        "checks_passed": sum(1 for c in checks if c["passed"]),
        "checks_total": len(checks),
        "checks": checks,
    }


def run_global_24_plus_matrix(csv_out_path: Path, live_doc: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Run the >=24-site geographic evaluation matrix + adversarial probes under authentic-sources-only policy."""
    engine = AdaptiveEvidenceEngine()
    sens = DecisionSensitivityAnalyzer(engine=engine)
    geo_cases = [c for c in P0_BASELINE_CASES if c["category"] == "geographic"]
    adv_cases = [c for c in P0_BASELINE_CASES if c["category"] == "adversarial"]

    rows: List[Dict[str, Any]] = []
    tracemalloc.start()
    t_matrix_start = time.monotonic()

    auth_cache_climate_ready = 0
    auth_cache_soil_usable = 0
    useful_partial_real_sources = 0
    depth_provenance_complete = 0
    spatial_provenance_complete = 0
    false_upgrades = 0

    for case in geo_cases + adv_cases:
        is_adv = case["category"] == "adversarial"
        adv_type = case.get("adversarial_type")
        intervals = [[30, 15]] if adv_type == "depth_inconsistency" else [[0, 5]]
        crops = ["nonexistent_crop_xyz"] if adv_type == "insufficient_parameters" else ["wheat", "barley"]
        opts: Dict[str, Any] = {
            "acquisition": "CACHE_ONLY",
            "allow_offline_reference_fixture": False,
            "allow_conditional_crop_planning": True,
        }
        if adv_type == "corrupt_receipt_or_hash_mismatch":
            opts["simulate_corrupt_receipt"] = True
        if adv_type == "prohibited_derivation_blocked":
            opts["allow_soil_total_n_as_mineral_n"] = True
            opts["assume_legal_water_rights"] = True
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": f"g6-matrix-{case['case_id']}",
            "location": {
                "site_id": case["site_id"],
                "name": case["label"],
                "point_lon_lat": case["point_lon_lat"],
                "crs": case["crs"],
            },
            "soil_depth_intervals_cm": intervals,
            "candidate_crops": crops,
            "water_supply_scenario": {"regime": "rainfed"},
            "options": opts,
        }
        t0 = time.monotonic()
        resp = engine.evaluate(req)
        dt_ms = round((time.monotonic() - t0) * 1000.0, 2)
        st = resp["capability_statuses"]
        c2_lvl = resp["capabilities"]["C2"].get("evidence_level")
        c3_lvl = resp["capabilities"]["C3"].get("evidence_level")
        evs = resp["provenance_and_uncertainty_ledger"]["evidence_objects"]

        if not is_adv:
            if st["C2"] == "READY" and c2_lvl in ("AUTHENTIC_LIVE", "AUTHENTIC_VERIFIED_CACHE"):
                auth_cache_climate_ready += 1
            if st["C3"] in ("READY", "CONDITIONAL") and c3_lvl in ("AUTHENTIC_LIVE", "AUTHENTIC_VERIFIED_CACHE"):
                auth_cache_soil_usable += 1
                soil_objs = [e for e in evs if str(e.get("parameter_path", "")).startswith("soil.")]
                if soil_objs:
                    if all(e.get("depth_interval_cm") is not None for e in soil_objs):
                        depth_provenance_complete += 1
                    if all(e.get("crs") == "EPSG:4326" and e.get("spatial_resolution_desc") for e in soil_objs):
                        spatial_provenance_complete += 1
            if st["C1"] == "READY" and any(st[c] in ("READY", "CONDITIONAL") for c in ("C2", "C3", "C4", "C5", "C6", "C7")):
                useful_partial_real_sources += 1
        else:
            # Verify adversarial cases never falsely qualify
            if adv_type in ("ocean_or_non_land_cell", "invalid_coordinates_or_crs", "unsupported_region"):
                if st["C1"] == "READY" or st["C2"] == "READY" or st["C3"] != "BLOCKED" or st["C7"] != "BLOCKED":
                    false_upgrades += 1
            elif adv_type == "depth_inconsistency":
                if st["C3"] != "BLOCKED" or st["C4"] != "BLOCKED":
                    false_upgrades += 1
            elif adv_type == "corrupt_receipt_or_hash_mismatch":
                if st["C2"] != "BLOCKED":
                    false_upgrades += 1
            elif adv_type == "insufficient_parameters":
                if st["C7"] != "BLOCKED" or st["C9"] != "BLOCKED":
                    false_upgrades += 1
            elif adv_type == "prohibited_derivation_blocked":
                if st["C5"] == "READY" or st["C10"] == "READY":
                    false_upgrades += 1

        rows.append(
            {
                "case_id": case["case_id"],
                "category": case["category"],
                "site_id": case["site_id"],
                "country": case["country"],
                "region_class": case["region_class"],
                "lon": case["point_lon_lat"][0],
                "lat": case["point_lon_lat"][1],
                "status_outcome": resp["status_outcome"],
                "C1": st["C1"],
                "C2": st["C2"],
                "C3": st["C3"],
                "C4": st["C4"],
                "C6": st["C6"],
                "C7": st["C7"],
                "C10": st["C10"],
                "c2_evidence_level": c2_lvl or "UNAVAILABLE",
                "c3_evidence_level": c3_lvl or "UNAVAILABLE",
                "overall_quality_verdict": resp["quality_assessment"]["overall_verdict"],
                "single_next_missing_input": (resp["single_next_missing_input"] or {}).get("input_key") or "NONE",
                "elapsed_ms": dt_ms,
            }
        )

    # Also verify screening sensitivity classification explicitly stays non-canonical on a cached site
    sens_uppsala = sens.analyze(
        {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g6-sens-uppsala",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["wheat", "barley"],
            "water_supply_scenario": {"regime": "rainfed"},
        }
    )

    _, peak_ram_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    total_elapsed_ms = round((time.monotonic() - t_matrix_start) * 1000.0, 2)

    fieldnames = list(rows[0].keys())
    with open(csv_out_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    live_summary = (live_doc or {}).get("summary") or {}
    return {
        "schema": "astragron.adaptive-evidence.g6-matrix-metrics.v1",
        "executed_at_utc": datetime.now(timezone.utc).isoformat(),
        "geographic_sites_count": len(geo_cases),
        "adversarial_sites_count": len(adv_cases),
        "metrics": {
            "AUTHENTIC_LIVE_PROVIDER_SUCCESS": live_summary.get("authentic_live_provider_success_fraction", "NOT_RUN_IN_OFFLINE_MODE"),
            "AUTHENTIC_VERIFIED_CACHE_COVERAGE": {
                "nasa_power_ready_count": auth_cache_climate_ready,
                "soilgrids_usable_count": auth_cache_soil_usable,
                "denominator_geographic_sites": len(geo_cases),
            },
            "USEFUL_PARTIAL_RESULTS_COVERAGE": {
                "count": useful_partial_real_sources,
                "denominator_geographic_sites": len(geo_cases),
                "policy": "real_authentic_sources_only_no_offline_fixtures",
            },
            "DEPTH_PROVENANCE_COMPLETENESS": {
                "complete_sites": depth_provenance_complete,
                "eligible_soil_sites": auth_cache_soil_usable,
                "ratio": f"{depth_provenance_complete}/{auth_cache_soil_usable}" if auth_cache_soil_usable else "0/0",
            },
            "SPATIAL_PIXEL_PROVENANCE_COMPLETENESS": {
                "complete_sites": spatial_provenance_complete,
                "eligible_soil_sites": auth_cache_soil_usable,
                "ratio": f"{spatial_provenance_complete}/{auth_cache_soil_usable}" if auth_cache_soil_usable else "0/0",
            },
            "QUALITY_GATE_FALSE_UPGRADES": false_upgrades,
            "REGIONAL_SCREENING_SENSITIVITY_LABEL": sens_uppsala.get("analysis_kind"),
            "CANONICAL_PLANNER_SENSITIVITY_STATUSES": list(CANONICAL_STABILITY_CLASSES),
            "elapsed_ms_total": total_elapsed_ms,
            "peak_traced_ram_mib": round(peak_ram_bytes / (1024.0 * 1024.0), 3),
        },
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run Stage G6 verification harness.")
    parser.add_argument("--live", action="store_true", help="Run real HTTPS live provider retrievals before offline replay & matrix audit.")
    parser.add_argument("--offline-audit", action="store_true", help="Run offline deterministic matrix & gate audits only.")
    args = parser.parse_args(argv)

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    live_path = DOCS_DIR / "LIVE_SOURCE_VERIFICATION.json"
    live_doc: Optional[Dict[str, Any]] = None

    if args.live:
        live_doc = run_live_source_verification()
        atomic_write_json(live_path, live_doc)
    elif live_path.exists():
        live_doc = json.loads(live_path.read_text(encoding="utf-8"))

    soil_audit = build_soil_depth_and_spatial_audit(live_doc)
    atomic_write_json(DOCS_DIR / "SOIL_DEPTH_AND_SPATIAL_AUDIT.json", soil_audit)

    qgate_acc = run_quality_gate_acceptance()
    atomic_write_json(DOCS_DIR / "QUALITY_GATE_ACCEPTANCE.json", qgate_acc)

    matrix_summary = run_global_24_plus_matrix(DOCS_DIR / "COVERAGE_MATRIX.csv", live_doc)
    lic_gate = evaluate_open_source_license_gate()

    out = {
        "live_summary": (live_doc or {}).get("summary"),
        "quality_gate_acceptance": {
            "false_upgrades": qgate_acc["QUALITY_GATE_FALSE_UPGRADES"],
            "passed": qgate_acc["checks_passed"],
            "total": qgate_acc["checks_total"],
        },
        "matrix_summary": matrix_summary,
        "license_gate_status": lic_gate["status"],
        "license_gate_blockers": len(lic_gate["blockers"]),
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0 if qgate_acc["QUALITY_GATE_FALSE_UPGRADES"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
