"""Versioned Evidence Quality Gate and Quality Assessment sidecar (`astragron.quality-gate.v1`).

Evaluates and enforces claim admissibility across location, spatial pixel support,
depth physical basis, temporal cutoff / time-standard / staleness, units & sentinel vs
legitimate zero semantics, provenance / evidence levels / user measurement metadata,
and cross-source disagreement before downstream screening or planner routing.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

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


def _is_non_empty_text(value: Any) -> bool:
    """Return True only when value is a non-empty, non-whitespace string (or date/datetime)."""
    if isinstance(value, str):
        return bool(value.strip())
    if hasattr(value, "isoformat"):
        return True
    return False


def _is_valid_depth_spec(user_meas: Dict[str, Any]) -> bool:
    """Validate depth_interval_cm ([top, bottom] finite cm) or positive root_depth_m."""
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
        return True
    root_d = user_meas.get("root_depth_m")
    if root_d is not None and not isinstance(root_d, bool) and isinstance(root_d, (int, float)):
        return math.isfinite(float(root_d)) and 0.0 < float(root_d) <= 5.0
    return False


def validate_user_measurement_metadata(user_meas: Dict[str, Any]) -> Dict[str, bool]:
    """Return strict metadata presence/validity flags for user-supplied measurements."""
    if not isinstance(user_meas, dict):
        return {"has_date": False, "has_method": False, "has_depth": False, "verified": False}
    has_date = any(
        _is_non_empty_text(user_meas.get(k))
        for k in ("measured_at", "sampled_at", "date", "available_at")
    )
    has_method = any(
        _is_non_empty_text(user_meas.get(k))
        for k in ("method", "lab_method", "analysis_method")
    )
    has_depth = _is_valid_depth_spec(user_meas)
    return {
        "has_date": has_date,
        "has_method": has_method,
        "has_depth": has_depth,
        "verified": bool(has_date and has_method and has_depth),
    }


def _check_user_measured_metadata(user_meas: Dict[str, Any]) -> Dict[str, Any]:
    """Enforce rule: user 'measured' inputs without date+method(+depth) degrade to USER_DECLARED_SCENARIO."""
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
        meta_flags = validate_user_measurement_metadata(user_meas)
        has_date = meta_flags["has_date"]
        has_method = meta_flags["has_method"]
        has_depth = meta_flags["has_depth"]
        if not (has_date and has_method and (not soil_claims or has_depth)):
            missing_parts = []
            if not has_date:
                missing_parts.append("date (measured_at/sampled_at)")
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
    ) -> Dict[str, Any]:
        req = request if isinstance(request, dict) else {}
        um = req.get("user_measurements") if isinstance(req.get("user_measurements"), dict) else {}
        ws = req.get("water_supply_scenario") if isinstance(req.get("water_supply_scenario"), dict) else {}
        as_of_iso = req.get("as_of")

        reasons: List[Dict[str, Any]] = []
        capability_verdicts: Dict[str, Dict[str, Any]] = {}
        ev_level_set = {
            str(ev.get("evidence_level") or "UNAVAILABLE")
            for ev in evidence_objects
            if isinstance(ev, dict)
        }
        if um or ws.get("regime"):
            ev_level_set.add("USER_DECLARED_SCENARIO")
        evidence_levels_observed = sorted(ev_level_set)

        # 1. Domain & Provenance integrity checks
        has_synthetic = any(
            isinstance(ev, dict) and ev.get("evidence_level") == "SYNTHETIC_TEST_FIXTURE"
            for ev in evidence_objects
        )
        if has_synthetic:
            reasons.append(
                {
                    "code": "SYNTHETIC_FIXTURE_DETECTED",
                    "severity": "WARNING",
                    "capability_ids": ["C2", "C3", "C4", "C6", "C7"],
                    "message": "Synthetic offline control fixtures are present; outputs must never be reported as authentic retrieved environmental measurements.",
                }
            )

        # 2. User 'measured' metadata check
        user_meta_chk = _check_user_measured_metadata(um)
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
            ref_dt = (
                datetime.fromisoformat(str(as_of_iso).replace("Z", "+00:00"))
                if as_of_iso
                else datetime.now(timezone.utc)
            )
            for ev in evidence_objects:
                ret = ev.get("retrieved_at") if isinstance(ev, dict) else None
                if not ret:
                    continue
                try:
                    ret_dt = datetime.fromisoformat(str(ret).replace("Z", "+00:00"))
                    age_d = (ref_dt - ret_dt).total_seconds() / 86400.0
                    if age_d > float(max_age_days):
                        reasons.append(
                            {
                                "code": "STALE_EVIDENCE_AGE_EXCEEDED",
                                "severity": "WARNING",
                                "capability_ids": ["C2", "C3"],
                                "message": f"Cached snapshot {ev.get('source_id')} age {age_d:.1f} days exceeds max_age_days={max_age_days}.",
                            }
                        )
                        break
                except ValueError:
                    pass

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

        # 6. Per-capability quality verdict assignment
        for cid in ("C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"):
            cap = capabilities.get(cid) or {}
            st = cap.get("status", "BLOCKED")
            miss = cap.get("missing_reason")
            verdict_reason_codes: List[str] = []
            for r in reasons:
                if cid in r["capability_ids"]:
                    verdict_reason_codes.append(r["code"])

            if cid == "C10" and st in ("READY", "CONDITIONAL"):
                verdict = "REJECTED"
                if "official_verification_required" not in verdict_reason_codes:
                    verdict_reason_codes.append("official_verification_required")
                expl = "Legal water rights and regulatory clearances cannot be promoted to READY or ACCEPTED_FOR_CLAIM; official local authority verification required."
            elif st == "READY":
                if cid == "C2" and has_synthetic:
                    verdict = "DEGRADED_TO_DESCRIPTION"
                    expl = "Synthetic test inputs used; treated strictly as test description, not authentic climate evidence."
                elif cid in ("C3", "C4", "C6", "C7") and any(
                    rc == "CROSS_SOURCE_DISAGREEMENT" for rc in verdict_reason_codes
                ):
                    verdict = "DEGRADED_TO_DESCRIPTION"
                    expl = f"{cid} downgraded to descriptive comparison because upstream sources disagree substantially."
                elif cid == "C2" and isinstance(c2_diag, dict) and c2_diag.get("is_sub_annual_window"):
                    verdict = "ACCEPTED_CONDITIONALLY"
                    expl = "Authentic daily historical weather verified for this sub-annual date window; cannot represent multi-year annual climatology."
                elif verdict_reason_codes and any(
                    rc in ("TIME_STANDARD_DIFFERENCE", "STALE_EVIDENCE_AGE_EXCEEDED") for rc in verdict_reason_codes
                ):
                    verdict = "ACCEPTED_CONDITIONALLY"
                    expl = f"{cid} available with temporal/staleness caveats ({', '.join(verdict_reason_codes)})."
                else:
                    verdict = "ACCEPTED_FOR_CLAIM"
                    expl = f"{cid} verified for stated regional scope without gate violations."
            elif st == "CONDITIONAL":
                if cid in ("C4", "C6", "C7", "C8", "C9") and (has_synthetic or user_meta_chk["downgraded_to_scenario"]):
                    verdict = "DEGRADED_TO_DESCRIPTION"
                    expl = f"{cid} downgraded to uncalibrated scenario description due to unverified measurement metadata or synthetic input."
                elif cid in ("C3", "C4", "C6", "C7") and any(
                    rc == "CROSS_SOURCE_DISAGREEMENT" for rc in verdict_reason_codes
                ):
                    verdict = "DEGRADED_TO_DESCRIPTION"
                    expl = f"{cid} degraded to exploratory comparison because upstream sources disagree substantially."
                else:
                    verdict = "ACCEPTED_CONDITIONALLY"
                    expl = f"{cid} admitted strictly within stated conditional bounds and caveats."
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
        if capabilities.get("C1", {}).get("status") != "READY" and c2_v not in ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY"):
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
                1 for v in capability_verdicts.values() if v["verdict"] in ("DEGRADED_TO_DESCRIPTION", "REJECTED")
            ),
        }


__all__ = [
    "EvidenceQualityGate",
    "QUALITY_GATE_SCHEMA",
    "QUALITY_GATE_VERSION",
    "QUALITY_VERDICTS",
    "rank_single_next_missing_input",
]
