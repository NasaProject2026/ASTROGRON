"""Unit and integration tests for Stage P1 — Typed Evidence Schema and Source Adapters."""
from __future__ import annotations

import unittest

from adaptive_evidence.adapters import FAOGAEZAdapter, NASAPowerAdapter, SoilGridsWCSAdapter
from adaptive_evidence.schema import (
    TypedEvidenceObject,
    arbitrate_parameter_sources,
    validate_coordinates_and_crs,
    validate_depth_intervals,
    validate_period_and_leap_years,
)


class TestStageP1SchemaAndAdapters(unittest.TestCase):
    def test_coordinate_crs_and_land_validation(self) -> None:
        ok = validate_coordinates_and_crs([17.65, 59.82], "EPSG:4326")
        self.assertTrue(ok["valid"])
        self.assertTrue(ok["is_land"])

        bad_crs = validate_coordinates_and_crs([17.65, 59.82], "EPSG:3857")
        self.assertFalse(bad_crs["valid"])
        self.assertEqual(bad_crs["missing_reason"], "invalid_coordinates_or_crs")

        bad_bounds = validate_coordinates_and_crs([210.0, 95.0], "EPSG:4326")
        self.assertFalse(bad_bounds["valid"])
        self.assertEqual(bad_bounds["missing_reason"], "invalid_coordinates_or_crs")

        ocean = validate_coordinates_and_crs([-140.0, 0.0], "EPSG:4326")
        self.assertTrue(ocean["valid"])
        self.assertFalse(ocean["is_land"])
        self.assertEqual(ocean["missing_reason"], "ocean_or_non_land_cell")

        polar = validate_coordinates_and_crs([0.0, -82.0], "EPSG:4326")
        self.assertTrue(polar["valid"])
        self.assertFalse(polar["is_land"])
        self.assertEqual(polar["missing_reason"], "unsupported_region")

        mismatch = validate_coordinates_and_crs(
            [17.65, 59.82],
            "EPSG:4326",
            geometry={"type": "Point", "coordinates": [18.0, 60.0]},
        )
        self.assertFalse(mismatch["valid"])
        self.assertEqual(mismatch["missing_reason"], "spatial_mismatch")

    def test_depth_and_period_leap_year_validation(self) -> None:
        d_ok = validate_depth_intervals([(0, 5), (5, 15), (15, 30), (30, 60)])
        self.assertTrue(d_ok["valid"])
        self.assertAlmostEqual(d_ok["total_depth_m"], 0.60)

        d_inv = validate_depth_intervals([(30, 15)])
        self.assertFalse(d_inv["valid"])
        self.assertEqual(d_inv["missing_reason"], "depth_inconsistency")

        d_overlap = validate_depth_intervals([(0, 30), (15, 60)])
        self.assertFalse(d_overlap["valid"])
        self.assertEqual(d_overlap["missing_reason"], "depth_inconsistency")

        p_ok = validate_period_and_leap_years("2012-01-01", "2020-12-31", "2026-11-09T00:00:00Z")
        self.assertTrue(p_ok["valid"])
        self.assertEqual(p_ok["leap_days_ymd"], ["20120229", "20160229", "20200229"])

        p_post = validate_period_and_leap_years("2020-01-01", "2025-12-31", "2020-01-01T00:00:00Z")
        self.assertFalse(p_post["valid"])
        self.assertEqual(p_post["missing_reason"], "stale_or_post_cutoff_snapshot")

    def test_nasa_power_authentic_cached_and_offline_reference(self) -> None:
        nasa = NASAPowerAdapter()
        # Authentic cached receipt: Uppsala
        uppsala = nasa.fetch_or_load([17.65, 59.82], "2016-01-01", "2020-12-31")
        self.assertEqual(uppsala["status"], "READY")
        self.assertEqual(uppsala["fixture_origin"], "AUTHENTIC_CACHED_RECEIPT")
        self.assertEqual(uppsala["diagnostics"]["leap_days_verified"], ["20160229", "20200229"])
        self.assertFalse(uppsala["diagnostics"]["future_forecast"])
        self.assertFalse(uppsala["diagnostics"]["field_station_measurement"])

        # Authentic cached receipt: Wagga Wagga
        wagga = nasa.fetch_or_load([147.35, -35.05], "2016-01-01", "2020-12-31")
        self.assertEqual(wagga["status"], "READY")
        self.assertEqual(wagga["fixture_origin"], "AUTHENTIC_CACHED_RECEIPT")

        # Offline reference fixture: Egypt Nile Delta
        tanta = nasa.fetch_or_load(
            [31.01, 30.79],
            "2016-01-01",
            "2020-12-31",
            allow_offline_reference_fixture=True,
            site_id="EG_NILE_DELTA_TANTA",
        )
        self.assertEqual(tanta["status"], "CONDITIONAL")
        self.assertEqual(tanta["fixture_origin"], "REGIONAL_OFFLINE_REFERENCE_FIXTURE")

        # Corrupt receipt & ocean rejection
        corrupt = nasa.fetch_or_load([17.65, 59.82], simulate_corrupt_receipt=True)
        self.assertEqual(corrupt["status"], "BLOCKED")
        self.assertEqual(corrupt["missing_reason"], "corrupt_receipt_or_hash_mismatch")

        ocean = nasa.fetch_or_load([-140.0, 0.0])
        self.assertEqual(ocean["status"], "BLOCKED")
        self.assertEqual(ocean["missing_reason"], "ocean_or_non_land_cell")

    def test_soilgrids_wcs_authentic_cache_units_quantiles_and_prohibitions(self) -> None:
        sg = SoilGridsWCSAdapter()
        wagga = sg.fetch_or_load([147.35, -35.05], [(0, 5)])
        self.assertEqual(wagga["status"], "CONDITIONAL")
        self.assertEqual(wagga["fixture_origin"], "AUTHENTIC_CACHED_RECEIPT")
        props = wagga["diagnostics"]["properties_si"]
        self.assertEqual(
            set(props.keys()),
            {"clay", "silt", "sand", "bdod", "cfvo", "soc", "phh2o"},
        )
        # Check unit conversion and quantiles
        self.assertAlmostEqual(
            props["clay"]["mean"] + props["silt"]["mean"] + props["sand"]["mean"],
            100.0,
            delta=2.0,
        )
        self.assertTrue(0.5 <= props["bdod"]["mean"] <= 2.0)
        self.assertTrue(4.0 <= props["phh2o"]["mean"] <= 9.5)
        self.assertLessEqual(props["clay"]["q05"], props["clay"]["q50"])
        self.assertLessEqual(props["clay"]["q50"], props["clay"]["q95"])
        # Mineral N derivation strictly prohibited
        self.assertFalse(wagga["diagnostics"]["mineral_n_available_from_soilgrids"])
        self.assertEqual(wagga["diagnostics"]["mineral_n_blocked_reason"], "not_identifiable")
        self.assertEqual(
            wagga["prohibited_substitutions"][0]["missing_reason"],
            "not_identifiable",
        )

        # Bad texture sum rejected
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
        self.assertEqual(bad_tex["status"], "BLOCKED")
        self.assertEqual(bad_tex["missing_reason"], "quality_fail")

    def test_fao_gaez_honest_default_and_contract_fixture(self) -> None:
        gaez = FAOGAEZAdapter()
        default_res = gaez.evaluate_suitability([17.65, 59.82], "wheat", "rainfed")
        self.assertEqual(default_res["status"], "BLOCKED")
        self.assertEqual(
            default_res["adapter_status"],
            "SOURCE_UNAVAILABLE_OR_LICENSE_UNVERIFIED",
        )
        self.assertEqual(default_res["missing_reason"], "license_unverified")

        fixture_res = gaez.evaluate_suitability(
            [17.65, 59.82],
            "wheat",
            "rainfed",
            allow_contract_test_fixture=True,
            contract_test_fixture_payload={"suitability_index_0_100": 72.0, "suitability_class": "S"},
        )
        self.assertEqual(fixture_res["status"], "CONDITIONAL")
        self.assertEqual(fixture_res["fixture_origin"], "SYNTHETIC_OFFLINE_CONTROL_FIXTURE")
        self.assertIsNone(fixture_res["diagnostics"]["calibrated_farm_yield_t_ha"])
        self.assertFalse(fixture_res["diagnostics"]["treats_suitability_as_farm_yield"])

    def test_parameter_source_arbitration_and_rejection_log(self) -> None:
        sg = SoilGridsWCSAdapter()
        auth_ev = sg.fetch_or_load([147.35, -35.05], [(0, 5)])["typed_objects"][0]
        ref_ev = sg.fetch_or_load(
            [31.01, 30.79],
            [(0, 5)],
            allow_offline_reference_fixture=True,
            site_id="EG_NILE_DELTA_TANTA",
        )["typed_objects"][0]
        synth_ev = TypedEvidenceObject(
            **{
                ** {k: getattr(ref_ev, k) for k in ref_ev.__dataclass_fields__},
                "source_id": "SYNTHETIC_TEST_CLAY",
                "fixture_origin": "SYNTHETIC_OFFLINE_CONTROL_FIXTURE",
            }
        )
        arb = arbitrate_parameter_sources(
            "soil.clay",
            [synth_ev, ref_ev, auth_ev],
            expected_si_unit="%",
            allow_synthetic_controls=False,
        )
        self.assertEqual(arb["status"], "SELECTED")
        self.assertEqual(arb["selected"]["fixture_origin"], "AUTHENTIC_CACHED_RECEIPT")
        self.assertEqual(len(arb["rejected_substitutes"]), 2)


if __name__ == "__main__":
    unittest.main()
