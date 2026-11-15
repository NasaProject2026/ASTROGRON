"""Unit tests for Stage P2 — Physically Bounded Derivation & Fallback Registry."""
from __future__ import annotations

import unittest

from adaptive_evidence.adapters import SoilGridsWCSAdapter
from adaptive_evidence.estimators import (
    ESTIMATOR_REGISTRY,
    PROHIBITED_DERIVATIONS_REGISTRY,
    attempt_prohibited_derivation,
    derive_soil_hydraulics_from_soilgrids,
)


class TestStageP2Estimators(unittest.TestCase):
    def test_estimator_registry_metadata_completeness(self) -> None:
        self.assertIn("SAXTON_RAWLS_2006_PTF_V1", ESTIMATOR_REGISTRY)
        self.assertIn("WOSTEN_1999_HYPRES_PTF_V1", ESTIMATOR_REGISTRY)
        self.assertIn("HARGREAVES_SAMANI_1985_ET0_V1", ESTIMATOR_REGISTRY)
        for est_id, meta in ESTIMATOR_REGISTRY.items():
            self.assertEqual(meta["estimator_id"], est_id)
            self.assertTrue(meta["citation"])
            self.assertTrue(meta["required_inputs"])
            self.assertTrue(meta["outputs"])
            self.assertTrue(meta["physical_invariants"])
            self.assertIn("CONDITIONAL", meta["qualification_impact"])

    def test_valid_ptf_derivation_and_physical_invariants(self) -> None:
        sg = SoilGridsWCSAdapter()
        for site_id, coords in (
            ("AU_WAGGA_REGION", [147.35, -35.05]),
            ("SE_UPPSALA", [17.65, 59.82]),
            ("KE_NYERI_REGION", [36.95, -0.42]),
            ("NL_WAGENINGEN_RESEARCH", [5.67, 51.97]),
            ("US_IOWA_AMES", [-93.62, 42.03]),
        ):
            soil_res = sg.fetch_or_load(coords, [(0, 5)], site_id=site_id)
            c4 = derive_soil_hydraulics_from_soilgrids(
                soil_res, root_depth_m=0.60, point_lon_lat=coords
            )
            self.assertEqual(c4["status"], "CONDITIONAL", msg=site_id)
            self.assertEqual(c4["diagnostics"]["qualification_downgrade"], "CONDITIONAL")
            self.assertTrue(c4["diagnostics"]["physical_invariants_satisfied"])
            for scen_name, scen in c4["diagnostics"]["scenarios"].items():
                self.assertAlmostEqual(
                    scen["clay_pct"] + scen["silt_pct"] + scen["sand_pct"],
                    100.0,
                    places=2,
                    msg=f"{site_id}:{scen_name}",
                )
                self.assertGreater(scen["theta_wp"], 0.0)
                self.assertLess(scen["theta_wp"], scen["theta_fc"])
                self.assertLess(scen["theta_fc"], scen["theta_s"])
                self.assertLess(scen["theta_s"], 1.0)
                self.assertGreater(scen["awc_mm_m"], 0.0)

    def test_out_of_domain_organic_peat_and_heavy_clay_rejected(self) -> None:
        sg = SoilGridsWCSAdapter()
        # Boreal peatland Oulu (SOC = 65.0 g/kg -> OM = 11.2% > 8.0%)
        oulu_soil = sg.fetch_or_load(
            [25.47, 65.01],
            [(0, 5)],
            allow_offline_reference_fixture=True,
            site_id="FI_OSTROBOTHNIA_OULU",
        )
        oulu_c4 = derive_soil_hydraulics_from_soilgrids(
            oulu_soil, root_depth_m=0.60, point_lon_lat=[25.47, 65.01]
        )
        self.assertEqual(oulu_c4["status"], "BLOCKED")
        self.assertEqual(oulu_c4["missing_reason"], "estimator_out_of_domain")

        # Ultra-heavy clay (>60%) out-of-domain control
        heavy_clay_soil = sg.fetch_or_load(
            [17.65, 59.82],
            [(0, 5)],
            raw_override={
                "clay": {"q05": 620, "q50": 680, "mean": 680, "q95": 740},
                "silt": {"q05": 150, "q50": 200, "mean": 200, "q95": 250},
                "sand": {"q05": 80, "q50": 120, "mean": 120, "q95": 160},
                "bdod": {"q05": 120, "q50": 130, "mean": 130, "q95": 140},
                "cfvo": {"q05": 10, "q50": 20, "mean": 20, "q95": 30},
                "soc": {"q05": 100, "q50": 150, "mean": 150, "q95": 200},
                "phh2o": {"q05": 60, "q50": 65, "mean": 65, "q95": 70},
            },
        )
        heavy_c4 = derive_soil_hydraulics_from_soilgrids(
            heavy_clay_soil, root_depth_m=0.60, point_lon_lat=[17.65, 59.82]
        )
        self.assertEqual(heavy_c4["status"], "BLOCKED")
        self.assertEqual(heavy_c4["missing_reason"], "estimator_out_of_domain")

    def test_prohibited_derivations_strictly_blocked(self) -> None:
        for param, expected in PROHIBITED_DERIVATIONS_REGISTRY.items():
            res = attempt_prohibited_derivation(param, {"soc_g_kg": 25.0, "precip_mm": 800.0})
            self.assertEqual(res["status"], "BLOCKED")
            self.assertFalse(res["allowed"])
            self.assertEqual(res["missing_reason"], expected["missing_reason"])


if __name__ == "__main__":
    unittest.main()
