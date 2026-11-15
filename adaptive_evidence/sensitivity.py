"""Uncertainty Propagation, Decision-Stability Classification, and Minimal Next Measurements.

Implements Section 4 ('Uncertainty propagation and decision stability') and Section 6 (Stage P4)
of `00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .engine import SUPPORTED_REGIONAL_CROPS, AdaptiveEvidenceEngine

STABILITY_CLASSES = (
    "DECISION_STABLE_WITHIN_TESTED_SCENARIOS",
    "DECISION_SENSITIVE",
    "UNDETERMINED",
)

CANONICAL_STABILITY_CLASSES = (
    "CHANGED_WITHIN_TESTED_SCENARIOS",
    "UNCHANGED_WITHIN_TESTED_SCENARIOS",
    "CANONICAL_DECISION_SENSITIVITY_UNDETERMINED",
)


def evaluate_crop_under_joint_scenario(
    crop: str,
    *,
    precip_mm_yr: float,
    et0_mm_yr: float,
    awc_mm_m: float,
    supply_mm: float,
    root_depth_multiplier: float = 1.0,
    feasibility_deficit_threshold: float = 0.35,
) -> Dict[str, Any]:
    """Evaluate a supported crop's seasonal water adequacy under a specific joint scenario."""
    c_meta = SUPPORTED_REGIONAL_CROPS[crop]
    season_frac = c_meta["season_days"] / 365.0
    etc_mm = et0_mm_yr * season_frac * c_meta["kc_mid"]
    p_eff_mm = precip_mm_yr * season_frac * 0.76
    eff_root_m = max(0.20, min(2.50, c_meta["root_depth_m"] * root_depth_multiplier))
    paw_mm = awc_mm_m * eff_root_m * c_meta["depletion_p"]

    net_deficit_mm = max(0.0, etc_mm - (p_eff_mm + paw_mm + supply_mm))
    deficit_ratio = net_deficit_mm / max(1.0, etc_mm)
    # Crop-specific water adequacy score in [0, 1]
    adequacy_score = max(0.0, min(1.0, 1.0 - deficit_ratio * (1.35 - 0.55 * c_meta["drought_tol"])))
    is_feasible = deficit_ratio <= feasibility_deficit_threshold

    return {
        "crop": crop,
        "seasonal_etc_mm": round(etc_mm, 1),
        "effective_precip_mm": round(p_eff_mm, 1),
        "available_soil_water_mm": round(paw_mm, 1),
        "irrigation_supply_mm": round(supply_mm, 1),
        "net_deficit_mm": round(net_deficit_mm, 1),
        "deficit_ratio": round(deficit_ratio, 4),
        "adequacy_score": round(adequacy_score, 4),
        "feasible_within_deficit_threshold": is_feasible,
    }


class DecisionSensitivityAnalyzer:
    """Evaluates candidate x joint-scenario stability and ranks minimal next measurements."""

    def __init__(self, engine: Optional[AdaptiveEvidenceEngine] = None) -> None:
        self.engine = engine or AdaptiveEvidenceEngine()

    def analyze(
        self,
        request: Dict[str, Any],
        *,
        feasibility_deficit_threshold: float = 0.35,
    ) -> Dict[str, Any]:
        """Run P3 evaluation followed by bounded joint-scenario sensitivity & stability analysis."""
        if not isinstance(request, dict):
            request = {}
        p3_resp = self.engine.evaluate(request)
        c2 = p3_resp["capabilities"]["C2"]
        c4 = p3_resp["capabilities"]["C4"]
        raw_crops = request.get("candidate_crops")
        candidate_crops = [str(c) for c in raw_crops] if isinstance(raw_crops, list) else []
        unsupported = [c for c in candidate_crops if c not in SUPPORTED_REGIONAL_CROPS]

        water_supply = request.get("water_supply_scenario") or {}
        regime_raw = water_supply.get("regime")
        if (
            c2["status"] == "BLOCKED"
            or c4["status"] == "BLOCKED"
            or len(unsupported) > 0
            or len(candidate_crops) == 0
            or not regime_raw
        ):
            reason = (
                "unsupported_crop_profile"
                if unsupported
                else (c2.get("missing_reason") or c4.get("missing_reason"))
                if (c2["status"] == "BLOCKED" or c4["status"] == "BLOCKED")
                else "insufficient_parameters"
            )
            return {
                "schema": "astragron.adaptive-evidence.sensitivity.v1",
                "analysis_kind": "REGIONAL_WATER_SCREENING_SENSITIVITY",
                "canonical_decision_sensitivity_executed": False,
                "scope_disclaimer": (
                    "Evaluates regional crop-water screening (C6/C7) only; NOT a 5-year ClientDecisionService whole-farm rotation/nutrient check."
                ),
                "request_id": p3_resp["request_id"],
                "stability_classification": "UNDETERMINED",
                "sensitivity_gate_status": "DECISION_SENSITIVITY_UNDETERMINED",
                "undetermined_reason": reason,
                "tested_scenario_count": 0,
                "scenario_matrix": [],
                "flip_witnesses": [],
                "stability_witness": None,
                "parameter_influence_ranking": [],
                "prioritized_next_measurements": p3_resp["minimal_next_measurements"],
                "economic_voi_usd": None,
                "fabricated_voi": False,
            }

        clim_diag = c2["diagnostics"]
        soil_scens = c4["diagnostics"]["scenarios"]
        wosten_awc = (
            c4["diagnostics"].get("secondary_ptf_wosten_1999_reference", {}).get(
                "awc_mm_m", soil_scens["REFERENCE"]["awc_mm_m"]
            )
        )

        water_supply = request.get("water_supply_scenario") or {}
        regime = str(water_supply.get("regime", "rainfed"))
        base_supply_mm = (
            float(water_supply.get("seasonal_supply_m3_ha") or 0.0) / 10.0
            if regime in ("irrigated", "supplemental")
            else 0.0
        )

        climate_states = [
            (
                "CLIM_DRY_Q05",
                float(clim_diag["driest_year_precipitation_mm"]),
                float(clim_diag["conditional_hs_et0_mm_year"]) * 1.08,
            ),
            (
                "CLIM_REF_MEAN",
                float(clim_diag["mean_annual_precipitation_mm"]),
                float(clim_diag["conditional_hs_et0_mm_year"]),
            ),
            (
                "CLIM_WET_Q95",
                float(clim_diag["wettest_year_precipitation_mm"]),
                float(clim_diag["conditional_hs_et0_mm_year"]) * 0.93,
            ),
        ]

        soil_states = [
            ("SOIL_LOW_AWC", float(soil_scens["LOW_WATER_HOLDING"]["awc_mm_m"]), 0.85),
            ("SOIL_REF_AWC", float(soil_scens["REFERENCE"]["awc_mm_m"]), 1.00),
            ("SOIL_HIGH_AWC", float(soil_scens["HIGH_WATER_HOLDING"]["awc_mm_m"]), 1.15),
            ("SOIL_WOSTEN_PTF", float(wosten_awc), 1.00),
        ]

        supply_states = (
            [
                ("SUPPLY_LOW_75PCT", base_supply_mm * 0.75),
                ("SUPPLY_REF_100PCT", base_supply_mm),
                ("SUPPLY_HIGH_125PCT", base_supply_mm * 1.25),
            ]
            if base_supply_mm > 0.0
            else [("SUPPLY_RAINFED_0MM", 0.0)]
        )

        scenario_matrix: List[Dict[str, Any]] = []
        for clim_id, p_mm, et0_mm in climate_states:
            for soil_id, awc_val, root_mult in soil_states:
                for sup_id, sup_mm in supply_states:
                    scen_id = f"{clim_id}__{soil_id}__{sup_id}"
                    evals = [
                        evaluate_crop_under_joint_scenario(
                            crop,
                            precip_mm_yr=p_mm,
                            et0_mm_yr=et0_mm,
                            awc_mm_m=awc_val,
                            supply_mm=sup_mm,
                            root_depth_multiplier=root_mult,
                            feasibility_deficit_threshold=feasibility_deficit_threshold,
                        )
                        for crop in candidate_crops
                    ]
                    evals.sort(key=lambda item: (-item["adequacy_score"], item["crop"]))
                    top_crop = evals[0]["crop"]
                    top_feasible = evals[0]["feasible_within_deficit_threshold"]
                    scenario_matrix.append(
                        {
                            "scenario_id": scen_id,
                            "climate_state": clim_id,
                            "soil_state": soil_id,
                            "supply_state": sup_id,
                            "inputs": {
                                "precip_mm_yr": round(p_mm, 1),
                                "et0_mm_yr": round(et0_mm, 1),
                                "awc_mm_m": round(awc_val, 2),
                                "irrigation_supply_mm": round(sup_mm, 1),
                                "root_depth_multiplier": root_mult,
                            },
                            "top_crop": top_crop,
                            "top_crop_adequacy_score": evals[0]["adequacy_score"],
                            "top_crop_feasible": top_feasible,
                            "feasible_crops": [
                                e["crop"] for e in evals if e["feasible_within_deficit_threshold"]
                            ],
                            "candidate_evaluations": evals,
                        }
                    )

        ref_scen = next(
            (
                s
                for s in scenario_matrix
                if s["climate_state"] == "CLIM_REF_MEAN"
                and s["soil_state"] == "SOIL_REF_AWC"
                and s["supply_state"] in ("SUPPLY_REF_100PCT", "SUPPLY_RAINFED_0MM")
            ),
            scenario_matrix[0],
        )

        flip_witnesses: List[Dict[str, Any]] = []
        for s in scenario_matrix:
            if s["scenario_id"] == ref_scen["scenario_id"]:
                continue
            top_changed = s["top_crop"] != ref_scen["top_crop"]
            feas_changed = s["feasible_crops"] != ref_scen["feasible_crops"]
            if top_changed or feas_changed:
                flip_witnesses.append(
                    {
                        "reference_scenario_id": ref_scen["scenario_id"],
                        "perturbed_scenario_id": s["scenario_id"],
                        "top_crop_flipped": top_changed,
                        "feasibility_set_flipped": feas_changed,
                        "reference_top_crop": ref_scen["top_crop"],
                        "perturbed_top_crop": s["top_crop"],
                        "reference_feasible_crops": ref_scen["feasible_crops"],
                        "perturbed_feasible_crops": s["feasible_crops"],
                        "reference_inputs": ref_scen["inputs"],
                        "perturbed_inputs": s["inputs"],
                    }
                )

        if flip_witnesses:
            stability_class = "DECISION_SENSITIVE"
            stability_witness = None
        else:
            stability_class = "DECISION_STABLE_WITHIN_TESTED_SCENARIOS"
            stability_witness = {
                "invariant_top_crop": ref_scen["top_crop"],
                "invariant_feasible_crops": ref_scen["feasible_crops"],
                "tested_scenario_ids": [s["scenario_id"] for s in scenario_matrix],
            }

        influence_ranking = self._compute_parameter_influence(
            scenario_matrix, ref_scen, flip_witnesses, base_supply_mm > 0.0
        )

        return {
            "schema": "astragron.adaptive-evidence.sensitivity.v1",
            "analysis_kind": "REGIONAL_WATER_SCREENING_SENSITIVITY",
            "canonical_decision_sensitivity_executed": False,
            "scope_disclaimer": (
                "Evaluates regional crop-water screening (C6/C7) across correlated hot-dry/cool-wet climate and PTF soil bounds only; "
                "NOT a 5-year ClientDecisionService whole-farm rotation/nutrient sensitivity analysis."
            ),
            "correlation_note": "CLIM_DRY_Q05 pairs lowest precip with elevated ET0 (+8%); CLIM_WET_Q95 pairs highest precip with reduced ET0 (-7%).",
            "request_id": p3_resp["request_id"],
            "stability_classification": stability_class,
            "undetermined_reason": None,
            "tested_scenario_count": len(scenario_matrix),
            "reference_scenario_id": ref_scen["scenario_id"],
            "reference_top_crop": ref_scen["top_crop"],
            "reference_feasible_crops": ref_scen["feasible_crops"],
            "flip_witness_count": len(flip_witnesses),
            "flip_witnesses": flip_witnesses[:10],
            "stability_witness": stability_witness,
            "parameter_influence_ranking": influence_ranking,
            "prioritized_next_measurements": self._rank_measurements_from_influence(
                influence_ranking, p3_resp["minimal_next_measurements"]
            ),
            "scenario_matrix": scenario_matrix,
            "economic_voi_usd": None,
            "fabricated_voi": False,
        }

    def _compute_parameter_influence(
        self,
        scenario_matrix: List[Dict[str, Any]],
        ref_scen: Dict[str, Any],
        flip_witnesses: List[Dict[str, Any]],
        has_irrigation: bool,
    ) -> List[Dict[str, Any]]:
        """Quantify how much soil AWC/rooting depth vs climate vs irrigation supply drives score swings & flips."""
        soil_flips = sum(
            1
            for w in flip_witnesses
            if w["perturbed_scenario_id"].split("__")[1] != ref_scen["soil_state"]
            and w["perturbed_scenario_id"].split("__")[0] == ref_scen["climate_state"]
        )
        clim_flips = sum(
            1
            for w in flip_witnesses
            if w["perturbed_scenario_id"].split("__")[0] != ref_scen["climate_state"]
            and w["perturbed_scenario_id"].split("__")[1] == ref_scen["soil_state"]
        )
        sup_flips = sum(
            1
            for w in flip_witnesses
            if w["perturbed_scenario_id"].split("__")[2] != ref_scen["supply_state"]
        )

        soil_scores = [
            s["top_crop_adequacy_score"]
            for s in scenario_matrix
            if s["climate_state"] == "CLIM_REF_MEAN"
        ]
        clim_scores = [
            s["top_crop_adequacy_score"]
            for s in scenario_matrix
            if s["soil_state"] == "SOIL_REF_AWC"
        ]
        soil_swing = round(max(soil_scores) - min(soil_scores), 4) if soil_scores else 0.0
        clim_swing = round(max(clim_scores) - min(clim_scores), 4) if clim_scores else 0.0

        ranking = [
            {
                "parameter_group": "soil_hydraulics.awc_mm_m_and_root_depth_m",
                "single_factor_flips_caused": soil_flips,
                "adequacy_score_swing": soil_swing,
                "user_measurable_on_farm": True,
                "recommended_measurement": (
                    "0-60 cm soil texture/bulk-density core + effective rooting depth trench check"
                ),
            },
            {
                "parameter_group": "climate.interannual_precipitation_envelope",
                "single_factor_flips_caused": clim_flips,
                "adequacy_score_swing": clim_swing,
                "user_measurable_on_farm": True,
                "recommended_measurement": (
                    "On-farm rain gauge record + seasonal supplemental irrigation buffer target"
                ),
            },
        ]
        if has_irrigation:
            sup_scores = [
                s["top_crop_adequacy_score"]
                for s in scenario_matrix
                if s["climate_state"] == "CLIM_REF_MEAN" and s["soil_state"] == "SOIL_REF_AWC"
            ]
            sup_swing = round(max(sup_scores) - min(sup_scores), 4) if sup_scores else 0.0
            ranking.append(
                {
                    "parameter_group": "water_supply_scenario.seasonal_supply_m3_ha",
                    "single_factor_flips_caused": sup_flips,
                    "adequacy_score_swing": sup_swing,
                    "user_measurable_on_farm": True,
                    "recommended_measurement": (
                        "Verified flow-meter allocation and legal water abstraction permit (m3/ha)"
                    ),
                }
            )
        ranking.sort(
            key=lambda x: (-x["single_factor_flips_caused"], -x["adequacy_score_swing"])
        )
        return ranking

    def _rank_measurements_from_influence(
        self,
        influence_ranking: List[Dict[str, Any]],
        base_measurements: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for idx, inf in enumerate(influence_ranking):
            out.append(
                {
                    "priority_rank": idx + 1,
                    "parameter": inf["parameter_group"],
                    "single_factor_flips_resolved": inf["single_factor_flips_caused"],
                    "adequacy_score_swing_reduced": inf["adequacy_score_swing"],
                    "measurement_action": inf["recommended_measurement"],
                    "economic_voi_usd": None,
                }
            )
        for bm in base_measurements:
            if not any(bm["parameter"] in item["parameter"] for item in out):
                out.append(
                    {
                        "priority_rank": len(out) + 1,
                        "parameter": bm["parameter"],
                        "single_factor_flips_resolved": 0,
                        "adequacy_score_swing_reduced": 0.0,
                        "measurement_action": bm["measurement_action"],
                        "economic_voi_usd": None,
                    }
                )
        return out


class CanonicalDecisionSensitivityRunner:
    """Read-only sensitivity runner calling unmodified brain.service.ClientDecisionService across correlated scenarios."""

    def __init__(self, client_service: Optional[Any] = None) -> None:
        if client_service is not None:
            self._service = client_service
        else:
            from brain.service import ClientDecisionService
            from .inventory import ROOT

            self._service = ClientDecisionService(runtime_dir=ROOT / "runtime" / "agent-a")

    @staticmethod
    def _extract_outcome_snapshot(scenario_id: str, resp: Dict[str, Any]) -> Dict[str, Any]:
        dec = resp.get("decision") or {}
        alts = resp.get("alternatives") or []
        alt_statuses: Dict[str, List[str]] = {}
        shortfalls: List[float] = []
        seq_map: Dict[str, Any] = {}
        for alt in alts:
            pid = str(alt.get("policy_id") or "")
            seq_map[pid] = deepcopy(alt.get("choices"))
            sc_stats: List[str] = []
            for sc in alt.get("scenarios") or []:
                st = str(sc.get("status") or "")
                sc_stats.append(st)
                sf = sc.get("ET_shortfall_m3_equivalent")
                if isinstance(sf, (int, float)):
                    shortfalls.append(float(sf))
            alt_statuses[pid] = sc_stats

        sel_ids = list(dec.get("selected_ids") or [])
        sel_sequences = {pid: seq_map.get(pid) for pid in sel_ids if pid in seq_map}
        return {
            "scenario_id": scenario_id,
            "client_status": resp.get("status"),
            "decision_status": dec.get("status"),
            "selected_ids": sel_ids,
            "service_compliant_ids": list(dec.get("service_compliant_ids") or []),
            "alternative_case_statuses": alt_statuses,
            "worst_et_shortfall_m3": round(max(shortfalls), 4) if shortfalls else None,
            "min_et_shortfall_m3": round(min(shortfalls), 4) if shortfalls else None,
            "selected_sequences": sel_sequences,
        }

    @staticmethod
    def _default_correlated_scenarios(base_req: Dict[str, Any]) -> List[Dict[str, Any]]:
        er = base_req.get("engine_request") or {}
        scens = er.get("scenarios") or [{}]
        base_rf = float(scens[0].get("rain_factor", 1.0)) if scens and isinstance(scens[0], dict) else 1.0
        fields = er.get("fields") or [{}]
        soil0 = fields[0].get("soil") if fields and isinstance(fields[0], dict) else {}
        base_fc = float((soil0 or {}).get("theta_fc", 0.25))
        base_wp = float((soil0 or {}).get("theta_wp", 0.10))
        base_iaf = float((soil0 or {}).get("initial_available_fraction", 0.5))
        sup0 = er.get("supply") or {}
        base_sup = float(sup0.get("annual_farm_source_m3", 0.0))

        return [
            {"scenario_id": "CANONICAL_REFERENCE"},
            {
                "scenario_id": "CANONICAL_CORRELATED_DRY_LOW_RETENTION",
                "rain_factor": round(max(0.05, min(1.0, base_rf * 0.78)), 4),
                "theta_fc": round(max(base_wp + 0.015, min(0.84, base_fc * 0.84)), 4),
                "initial_available_fraction": round(max(0.05, min(1.0, base_iaf * 0.60)), 4),
                "annual_farm_source_m3": round(max(0.0, min(10000.0, base_sup * 0.70)), 2),
            },
            {
                "scenario_id": "CANONICAL_CORRELATED_MODERATE_STRESS",
                "rain_factor": round(max(0.05, min(1.0, base_rf * 0.88)), 4),
                "theta_fc": round(max(base_wp + 0.02, min(0.84, base_fc * 0.92)), 4),
                "initial_available_fraction": round(max(0.05, min(1.0, base_iaf * 0.80)), 4),
                "annual_farm_source_m3": round(max(0.0, min(10000.0, base_sup * 0.85)), 2),
            },
            {
                "scenario_id": "CANONICAL_CORRELATED_HIGH_RETENTION_FULL_SUPPLY",
                "rain_factor": round(max(0.05, min(1.0, max(base_rf, 0.98))), 4),
                "theta_fc": round(max(base_wp + 0.03, min(0.80, base_fc * 1.18)), 4),
                "initial_available_fraction": round(max(base_iaf, min(0.95, base_iaf * 1.25)), 4),
                "annual_farm_source_m3": round(max(0.0, min(10000.0, base_sup * 1.15)), 2),
            },
        ]

    @staticmethod
    def _apply_scenario_spec(base_req: Dict[str, Any], spec: Dict[str, Any]) -> Dict[str, Any]:
        req = deepcopy(base_req)
        er = req.get("engine_request")
        if not isinstance(er, dict):
            return req
        if "rain_factor" in spec and isinstance(er.get("scenarios"), list):
            rf = max(0.0, min(1.0, float(spec["rain_factor"])))
            for sc in er["scenarios"]:
                if isinstance(sc, dict):
                    sc["rain_factor"] = rf
        if isinstance(er.get("fields"), list):
            for fld in er["fields"]:
                if not isinstance(fld, dict):
                    continue
                if "area_multiplier" in spec and fld.get("area_ha") is not None:
                    fld["area_ha"] = round(max(0.05, float(fld["area_ha"]) * float(spec["area_multiplier"])), 4)
                soil = fld.get("soil")
                if isinstance(soil, dict):
                    wp_new = max(0.01, min(0.75, float(spec.get("theta_wp", soil.get("theta_wp", 0.10)))))
                    fc_raw = float(spec.get("theta_fc", soil.get("theta_fc", 0.25)))
                    fc_new = max(wp_new + 0.01, min(0.84, fc_raw))
                    soil["theta_wp"] = round(wp_new, 4)
                    soil["theta_fc"] = round(fc_new, 4)
                    if "initial_available_fraction" in spec:
                        soil["initial_available_fraction"] = round(
                            max(0.0, min(1.0, float(spec["initial_available_fraction"]))), 4
                        )
        if "annual_farm_source_m3" in spec and isinstance(er.get("supply"), dict):
            er["supply"]["annual_farm_source_m3"] = round(
                max(0.0, min(10000.0, float(spec["annual_farm_source_m3"]))), 2
            )
        if "service_limit_crop_ET_deficit_mm_per_harvest_year" in spec and isinstance(er.get("supply"), dict):
            er["supply"]["service_limit_crop_ET_deficit_mm_per_harvest_year"] = round(
                max(0.0, float(spec["service_limit_crop_ET_deficit_mm_per_harvest_year"])), 2
            )
        return req

    def run(
        self,
        client_request: Dict[str, Any],
        *,
        scenarios: Optional[Sequence[Dict[str, Any]]] = None,
        max_scenarios: int = 5,
        use_cache: bool = False,
    ) -> Dict[str, Any]:
        """Run unmodified ClientDecisionService across bounded correlated scenarios without mutating canonical code."""
        if not isinstance(client_request, dict) or max_scenarios < 1:
            return {
                "schema": "astragron.canonical-decision-sensitivity.v1",
                "analysis_kind": "CANONICAL_DECISION_SENSITIVITY",
                "canonical_service_used": "brain.service.ClientDecisionService",
                "canonical_stability_status": "CANONICAL_DECISION_SENSITIVITY_UNDETERMINED",
                "undetermined_reason": "invalid_request_or_scenario_budget",
                "tested_scenario_count": 0,
                "max_scenarios_budget": max_scenarios,
                "reference_outcome": None,
                "scenario_outcomes": [],
                "flip_witness_count": 0,
                "flip_witnesses": [],
                "max_et_shortfall_delta_m3": None,
                "sequence_comparison": [],
                "economic_voi_usd": None,
                "fabricated_voi": False,
                "caveats": ["Invalid canonical request or max_scenarios < 1."],
            }

        raw_specs = list(scenarios) if scenarios is not None else self._default_correlated_scenarios(client_request)
        budget = min(7, int(max_scenarios))
        specs = raw_specs[:budget]

        snapshots: List[Dict[str, Any]] = []
        ref_snap: Optional[Dict[str, Any]] = None
        for idx, spec in enumerate(specs):
            sc_id = str(spec.get("scenario_id") or f"SCENARIO_{idx + 1}")
            req_copy = self._apply_scenario_spec(client_request, spec)
            try:
                resp = self._service.run(req_copy, use_cache=use_cache)
                snap = self._extract_outcome_snapshot(sc_id, resp)
                snap["applied_overrides"] = {k: v for k, v in spec.items() if k != "scenario_id"}
            except Exception as exc:
                return {
                    "schema": "astragron.canonical-decision-sensitivity.v1",
                    "analysis_kind": "CANONICAL_DECISION_SENSITIVITY",
                    "canonical_service_used": "brain.service.ClientDecisionService",
                    "canonical_stability_status": "CANONICAL_DECISION_SENSITIVITY_UNDETERMINED",
                    "undetermined_reason": f"canonical_service_error:{type(exc).__name__}:{exc}",
                    "tested_scenario_count": len(snapshots),
                    "max_scenarios_budget": budget,
                    "reference_outcome": ref_snap,
                    "scenario_outcomes": snapshots,
                    "flip_witness_count": 0,
                    "flip_witnesses": [],
                    "max_et_shortfall_delta_m3": None,
                    "sequence_comparison": [],
                    "economic_voi_usd": None,
                    "fabricated_voi": False,
                    "caveats": ["Unmodified ClientDecisionService rejected scenario inputs or raised validation error."],
                }
            if idx == 0:
                ref_snap = snap
                if snap["client_status"] != "CONDITIONAL_RESEARCH_COMPLETE":
                    return {
                        "schema": "astragron.canonical-decision-sensitivity.v1",
                        "analysis_kind": "CANONICAL_DECISION_SENSITIVITY",
                        "canonical_service_used": "brain.service.ClientDecisionService",
                        "canonical_stability_status": "CANONICAL_DECISION_SENSITIVITY_UNDETERMINED",
                        "undetermined_reason": f"canonical_reference_status_{snap['client_status']}",
                        "tested_scenario_count": 1,
                        "max_scenarios_budget": budget,
                        "reference_outcome": ref_snap,
                        "scenario_outcomes": [snap],
                        "flip_witness_count": 0,
                        "flip_witnesses": [],
                        "max_et_shortfall_delta_m3": None,
                        "sequence_comparison": [],
                        "economic_voi_usd": None,
                        "fabricated_voi": False,
                        "caveats": ["Canonical reference run did not reach CONDITIONAL_RESEARCH_COMPLETE; cannot perturb decision stability."],
                    }
            snapshots.append(snap)

        assert ref_snap is not None
        flip_witnesses: List[Dict[str, Any]] = []
        seq_comp: List[Dict[str, Any]] = []
        et_deltas: List[float] = []
        ref_worst_et = ref_snap.get("worst_et_shortfall_m3")

        for snap in snapshots[1:]:
            et_delta = (
                round(snap["worst_et_shortfall_m3"] - ref_worst_et, 4)
                if snap.get("worst_et_shortfall_m3") is not None and ref_worst_et is not None
                else None
            )
            if et_delta is not None:
                et_deltas.append(et_delta)
            top_status_changed = snap["client_status"] != ref_snap["client_status"]
            dec_status_changed = snap["decision_status"] != ref_snap["decision_status"]
            selected_changed = snap["selected_ids"] != ref_snap["selected_ids"]
            service_comp_changed = snap["service_compliant_ids"] != ref_snap["service_compliant_ids"]
            alt_case_changed = snap["alternative_case_statuses"] != ref_snap["alternative_case_statuses"]
            seq_changed = snap["selected_sequences"] != ref_snap["selected_sequences"]

            seq_comp.append(
                {
                    "scenario_id": snap["scenario_id"],
                    "selected_ids_unchanged": not selected_changed,
                    "service_compliant_ids_unchanged": not service_comp_changed,
                    "selected_sequences_identical": not seq_changed,
                    "et_shortfall_delta_m3": et_delta,
                }
            )
            if (
                top_status_changed
                or dec_status_changed
                or selected_changed
                or service_comp_changed
                or alt_case_changed
            ):
                flip_witnesses.append(
                    {
                        "reference_scenario_id": ref_snap["scenario_id"],
                        "perturbed_scenario_id": snap["scenario_id"],
                        "top_status_changed": top_status_changed,
                        "decision_status_changed": dec_status_changed,
                        "selected_ids_changed": selected_changed,
                        "service_compliance_changed": service_comp_changed,
                        "alternative_case_status_changed": alt_case_changed,
                        "reference_selected_ids": ref_snap["selected_ids"],
                        "perturbed_selected_ids": snap["selected_ids"],
                        "reference_service_compliant_ids": ref_snap["service_compliant_ids"],
                        "perturbed_service_compliant_ids": snap["service_compliant_ids"],
                        "reference_worst_et_shortfall_m3": ref_worst_et,
                        "perturbed_worst_et_shortfall_m3": snap.get("worst_et_shortfall_m3"),
                        "et_shortfall_delta_m3": et_delta,
                    }
                )

        canonical_status = (
            "CHANGED_WITHIN_TESTED_SCENARIOS"
            if flip_witnesses
            else "UNCHANGED_WITHIN_TESTED_SCENARIOS"
        )
        return {
            "schema": "astragron.canonical-decision-sensitivity.v1",
            "analysis_kind": "CANONICAL_DECISION_SENSITIVITY",
            "canonical_service_used": "brain.service.ClientDecisionService",
            "canonical_stability_status": canonical_status,
            "undetermined_reason": None,
            "tested_scenario_count": len(snapshots),
            "max_scenarios_budget": budget,
            "reference_outcome": ref_snap,
            "scenario_outcomes": snapshots,
            "flip_witness_count": len(flip_witnesses),
            "flip_witnesses": flip_witnesses,
            "max_et_shortfall_delta_m3": round(max((abs(d) for d in et_deltas), default=0.0), 4),
            "sequence_comparison": seq_comp,
            "economic_voi_usd": None,
            "fabricated_voi": False,
            "caveats": [
                "Scenarios are bounded engineering stress tests across correlated climate/soil/supply assumptions; no probabilities implied.",
                "Unmodified brain.service.ClientDecisionService executed read-only; no global optimality or field-validation claim.",
            ],
        }


__all__ = [
    "STABILITY_CLASSES",
    "CANONICAL_STABILITY_CLASSES",
    "evaluate_crop_under_joint_scenario",
    "DecisionSensitivityAnalyzer",
    "CanonicalDecisionSensitivityRunner",
]
