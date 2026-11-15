"""Unit tests for Stage P7 — Continued Scientific Improvements."""
from __future__ import annotations

import unittest

from adaptive_evidence.engine import AdaptiveEvidenceEngine
from adaptive_evidence.improvements import (
    build_farmer_measurement_wizard,
    diagnose_source_and_ptf_disagreement,
    evaluate_polygon_spatial_heterogeneity,
    integrate_multidepth_root_zone_profile,
    run_held_out_ptf_benchmark,
)


class TestStageP7Improvements(unittest.TestCase):
    def test_multidepth_root_zone_integration_and_impedance_detection(self) -> None:
        horizons = [
            {"top_cm": 0, "bottom_cm": 5, "clay_pct": 22.0, "silt_pct": 38.0, "sand_pct": 40.0, "soc_g_kg": 24.0, "bdod_kg_dm3": 1.28, "cfvo_vol_pct": 4.0},
            {"top_cm": 5, "bottom_cm": 15, "clay_pct": 24.0, "silt_pct": 37.0, "sand_pct": 39.0, "soc_g_kg": 19.0, "bdod_kg_dm3": 1.34, "cfvo_vol_pct": 5.0},
            {"top_cm": 15, "bottom_cm": 30, "clay_pct": 27.0, "silt_pct": 36.0, "sand_pct": 37.0, "soc_g_kg": 14.0, "bdod_kg_dm3": 1.40, "cfvo_vol_pct": 7.0},
            {"top_cm": 30, "bottom_cm": 60, "clay_pct": 32.0, "silt_pct": 34.0, "sand_pct": 34.0, "soc_g_kg": 9.0, "bdod_kg_dm3": 1.46, "cfvo_vol_pct": 10.0},
            {"top_cm": 60, "bottom_cm": 100, "clay_pct": 35.0, "silt_pct": 33.0, "sand_pct": 32.0, "soc_g_kg": 5.0, "bdod_kg_dm3": 1.72, "cfvo_vol_pct": 18.0},
            {"top_cm": 100, "bottom_cm": 200, "clay_pct": 36.0, "silt_pct": 32.0, "sand_pct": 32.0, "soc_g_kg": 3.0, "bdod_kg_dm3": 1.75, "cfvo_vol_pct": 25.0},
        ]
        res = integrate_multidepth_root_zone_profile(horizons, root_depth_m=1.20)
        self.assertTrue(res["subsurface_impedance_detected"])
        self.assertEqual(res["impeding_horizon_cm"], [60.0, 100.0])
        self.assertEqual(res["effective_root_depth_m"], 0.60)
        self.assertGreater(res["cumulative_root_zone_paw_mm"], 50.0)
        self.assertLess(res["depth_weighted_theta_wp"], res["depth_weighted_theta_fc"])

    def test_polygon_spatial_heterogeneity_diagnostics(self) -> None:
        poly = {
            "type": "Polygon",
            "coordinates": [
                [
                    [147.34, -35.06],
                    [147.36, -35.06],
                    [147.36, -35.04],
                    [147.34, -35.04],
                    [147.34, -35.06],
                ]
            ],
        }
        profiles = [
            {"clay_pct": 14.0, "silt_pct": 16.0, "sand_pct": 70.0, "soc_g_kg": 9.0, "bdod_kg_dm3": 1.52, "cfvo_vol_pct": 12.0},
            {"clay_pct": 38.0, "silt_pct": 34.0, "sand_pct": 28.0, "soc_g_kg": 22.0, "bdod_kg_dm3": 1.32, "cfvo_vol_pct": 3.0},
            {"clay_pct": 26.0, "silt_pct": 30.0, "sand_pct": 44.0, "soc_g_kg": 15.0, "bdod_kg_dm3": 1.40, "cfvo_vol_pct": 6.0},
        ]
        het = evaluate_polygon_spatial_heterogeneity(poly, profiles)
        self.assertEqual(het["status"], "CONDITIONAL")
        self.assertTrue(het["requires_zonal_soil_sampling"])
        self.assertGreaterEqual(het["clay_spread_pct"], 15.0)

    def test_cross_ptf_disagreement_and_held_out_benchmark(self) -> None:
        diag = diagnose_source_and_ptf_disagreement(
            clay_pct=28.0, silt_pct=42.0, sand_pct=30.0, soc_g_kg=18.0, bdod_kg_dm3=1.36, cfvo_vol_pct=5.0
        )
        self.assertIn(diag["disagreement_flag"], ("MODELS_IN_AGREEMENT", "HIGH_INTER_MODEL_DIVERGENCE"))
        self.assertEqual(len(diag["envelope_awc_mm_m"]), 2)

        bench = run_held_out_ptf_benchmark()
        self.assertEqual(bench["sample_count"], 12)
        self.assertLess(bench["theta_wp_mae"], 0.025)
        self.assertLess(bench["theta_fc_mae"], 0.035)
        self.assertLess(bench["awc_mm_m_mae"], 25.0)

    def test_farmer_measurement_wizard_upgrades_engine_capabilities(self) -> None:
        wiz = build_farmer_measurement_wizard(
            hand_texture_class="clay_loam",
            observed_rooting_depth_cm=80.0,
            irrigation_regime="irrigated",
            seasonal_allocation_m3_ha=2200.0,
            measured_mineral_n_kg_ha=52.0,
            official_water_permit_verified=True,
        )
        eng = AdaptiveEvidenceEngine()
        resp = eng.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "p7-wizard-upgrade",
                "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
                "candidate_crops": ["wheat", "barley"],
                "water_supply_scenario": wiz["water_supply_scenario"],
                "user_measurements": wiz["user_measurements"],
            }
        )
        # Hand-texture wizard without date/method/depth stays CONDITIONAL (USER_DECLARED_SCENARIO)
        self.assertEqual(resp["capability_statuses"]["C4"], "CONDITIONAL")
        self.assertEqual(resp["quality_assessment"]["capability_verdicts"]["C4"]["verdict"], "DEGRADED_TO_DESCRIPTION")
        self.assertEqual(resp["capability_statuses"]["C6"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C7"], "CONDITIONAL")

        # Supplying explicit date + lab method + sampling depth promotes C4 cleanly while retaining USER_DECLARED_SCENARIO provenance
        lab_meas = dict(
            wiz["user_measurements"],
            measured_at="2026-03-10",
            method="ISO_11274_pressure_plate",
            depth_interval_cm=[0, 30],
        )
        resp_lab = eng.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "p7-lab-upgrade",
                "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
                "candidate_crops": ["wheat", "barley"],
                "water_supply_scenario": wiz["water_supply_scenario"],
                "user_measurements": lab_meas,
            }
        )
        self.assertEqual(resp_lab["capability_statuses"]["C4"], "READY")
        self.assertEqual(resp_lab["quality_assessment"]["capability_verdicts"]["C4"]["verdict"], "ACCEPTED_FOR_CLAIM")


if __name__ == "__main__":
    unittest.main()
