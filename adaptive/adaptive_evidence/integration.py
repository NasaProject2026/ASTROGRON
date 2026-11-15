"""Stage P6 Coordinator-Ready Integration Adapter bridging `ClientDecisionService` and `AdaptiveEvidenceEngine`.

Implements Section 6 (Stage P6) of `00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`
without modifying any file in `brain/`, `contracts/`, or `coordination/`.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from brain.service import ClientDecisionService

from .adapters.fao_gaez import FAO_GAEZ_CITATION, FAO_GAEZ_URL
from .adapters.nasa_power import NASA_POWER_CITATION, NASA_POWER_LICENSE, NASA_POWER_URL
from .adapters.soilgrids import SOILGRIDS_CITATION, SOILGRIDS_LICENSE, SOILGRIDS_WCS_BASE
from .engine import AdaptiveEvidenceEngine
from .estimators import HARGREAVES_SAMANI_CITATION, SAXTON_RAWLS_CITATION, WOSTEN_HYPRES_CITATION
from .inventory import ROOT, verify_upstream_integrity
from .sensitivity import DecisionSensitivityAnalyzer

PROVENANCE_AND_LICENSE_LEDGER: List[Dict[str, str]] = [
    {
        "source_or_method_id": "NASA_POWER_MERRA2_DAILY_UTC",
        "provider": "NASA Langley Research Center POWER Project",
        "url": NASA_POWER_URL,
        "license": NASA_POWER_LICENSE,
        "citation": NASA_POWER_CITATION,
        "redistribution_notes": "Public domain / open attribution required; regional 0.625 x 0.5 deg grid.",
    },
    {
        "source_or_method_id": "ISRIC_SOILGRIDS_V2_250M_WCS",
        "provider": "ISRIC - World Soil Information",
        "url": SOILGRIDS_WCS_BASE,
        "license": SOILGRIDS_LICENSE,
        "citation": SOILGRIDS_CITATION,
        "redistribution_notes": "CC-BY-4.0 attribution required; regional 250 m predictions with Q0.05/Q0.50/mean/Q0.95 quantiles.",
    },
    {
        "source_or_method_id": "FAO_IIASA_GAEZ_V4_5ARCMIN",
        "provider": "FAO & IIASA Global Agro-Ecological Zones (GAEZ v4)",
        "url": FAO_GAEZ_URL,
        "license": "SOURCE_UNAVAILABLE_OR_LICENSE_UNVERIFIED_BY_DEFAULT (CC-BY-4.0 when verified)",
        "citation": FAO_GAEZ_CITATION,
        "redistribution_notes": "Blocked by default unless verified local CC-BY receipt is supplied; never converted to farm yield.",
    },
    {
        "source_or_method_id": "SAXTON_RAWLS_2006_PTF_V1",
        "provider": "Published Pedotransfer Literature (Saxton & Rawls, 2006)",
        "url": "https://doi.org/10.2136/sssaj2006.0117",
        "license": "Published scientific formula implementation",
        "citation": SAXTON_RAWLS_CITATION,
        "redistribution_notes": "Valid for mineral soils with OM <= 8.0% and clay <= 60%; outputs strictly CONDITIONAL.",
    },
    {
        "source_or_method_id": "WOSTEN_1999_HYPRES_PTF_V1",
        "provider": "Published Pedotransfer Literature (Wosten et al., 1999)",
        "url": "https://doi.org/10.1016/S0016-7061(98)00132-3",
        "license": "Published scientific formula implementation",
        "citation": WOSTEN_HYPRES_CITATION,
        "redistribution_notes": "Secondary continuous pedotransfer check for cross-model structural comparison.",
    },
    {
        "source_or_method_id": "HARGREAVES_SAMANI_1985_ET0_V1",
        "provider": "Published Agro-Meteorological Literature (Hargreaves & Samani, 1985)",
        "url": "https://doi.org/10.13031/2013.26773",
        "license": "Published scientific formula implementation",
        "citation": HARGREAVES_SAMANI_CITATION,
        "redistribution_notes": "Conditional daily radiation-temperature reference evapotranspiration screening.",
    },
]

ROLLBACK_AND_ISOLATION_PLAN: Dict[str, Any] = {
    "isolation_strategy": (
        "All Global Adaptive Evidence code, schemas, fixtures, and tests reside exclusively in "
        "new conflict-free directories (`adaptive_evidence/`, `tests/adaptive_evidence/`, "
        "`examples/adaptive_evidence/`, `docs/adaptive_evidence/`) on branch `feature/global-adaptive-evidence`."
    ),
    "pre_existing_files_modified": [],
    "protected_baseline_files_touched": 0,
    "growth_input_files_touched": 0,
    "one_step_rollback_commands": [
        "git checkout snapshot/baseline",
        "# Or in a non-git deployment, remove `adaptive_evidence/`, `tests/adaptive_evidence/`, `examples/adaptive_evidence/`, `docs/adaptive_evidence/`.",
    ],
}


class AdaptiveClientDecisionBridge:
    """Non-invasive sidecar bridge pairing `ClientDecisionService` with `AdaptiveEvidenceEngine`."""

    def __init__(
        self,
        upstream_service: Optional[ClientDecisionService] = None,
        adaptive_engine: Optional[AdaptiveEvidenceEngine] = None,
        sensitivity_analyzer: Optional[DecisionSensitivityAnalyzer] = None,
    ) -> None:
        self.upstream = upstream_service or ClientDecisionService()
        self.engine = adaptive_engine or AdaptiveEvidenceEngine()
        self.sensitivity = sensitivity_analyzer or DecisionSensitivityAnalyzer(self.engine)

    def translate_client_request_to_adaptive(
        self,
        client_request: Dict[str, Any],
        *,
        allow_offline_reference_fixture: bool = False,
        allow_conditional_crop_planning: bool = True,
    ) -> Dict[str, Any]:
        """Translate a `client_decision_request_v1` payload into an `adaptive_evidence_request_v1` payload."""
        eng_req = client_request.get("engine_request") or client_request
        loc = eng_req.get("location") or client_request.get("location") or {}
        point = loc.get("point_lon_lat")
        crs = loc.get("crs") or "EPSG:4326"
        geometry = loc.get("geometry")
        site_id = loc.get("site_id")
        name = loc.get("name") or loc.get("jurisdiction")

        scens = eng_req.get("scenarios") or []
        period = (
            {"start": scens[0].get("start", "2016-01-01"), "end": scens[0].get("end", "2020-12-31")}
            if scens and isinstance(scens[0], dict)
            else {"start": "2016-01-01", "end": "2020-12-31"}
        )
        src_cfg = eng_req.get("source") or {}
        acquisition = src_cfg.get("acquisition") or "CACHE_ONLY"
        if acquisition not in ("CACHE_ONLY", "FETCH_ALLOWED"):
            acquisition = "CACHE_ONLY"

        # Preserve requested crop IDs exactly; never silently substitute barley/wheat/faba_bean.
        # Only explicit canonical upstream catalog IDs (`research:<REGION>:<crop>_inventory_scenario`)
        # resolve to their underlying crop key while retaining the exact requested_crop_ids list.
        known_crops = (
            "wheat", "barley", "chickpea", "faba_bean", "rapeseed", "oats",
            "potato", "maize", "soybean", "sorghum", "sunflower", "rice",
        )
        crops: List[str] = []
        requested_crop_ids: List[str] = []
        fields = eng_req.get("fields") or []
        for f in fields:
            for c_id in f.get("crop_candidates") or []:
                c_str = str(c_id).strip()
                if not c_str:
                    continue
                if c_str not in requested_crop_ids:
                    requested_crop_ids.append(c_str)
                resolved = c_str
                if c_str.startswith("research:") and c_str.endswith("_inventory_scenario"):
                    c_low = c_str.lower()
                    for known in known_crops:
                        if f":{known}_inventory_scenario" in c_low:
                            resolved = known
                            break
                if resolved not in crops:
                    crops.append(resolved)

        supply_cfg = eng_req.get("supply") or {}
        annual_m3 = supply_cfg.get("annual_farm_source_m3")
        explicit_regime = supply_cfg.get("regime")
        has_irrig_true = any(f.get("irrigation_access") is True for f in fields) if fields else False
        all_irrig_false = bool(fields) and all(f.get("irrigation_access") is False for f in fields)

        if explicit_regime in ("irrigated", "supplemental", "rainfed"):
            regime: Optional[str] = str(explicit_regime)
        elif has_irrig_true and annual_m3 is not None and float(annual_m3) > 0.0:
            regime = "irrigated"
        elif all_irrig_false:
            regime = "rainfed"
        else:
            # Never silently infer rainfed from missing/unknown water information
            regime = None

        return {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": str(client_request.get("farm_id") or client_request.get("request_id") or "bridge-req"),
            "location": {
                "site_id": site_id,
                "name": name,
                "point_lon_lat": point,
                "crs": crs,
                "geometry": geometry,
            },
            "period": {
                "start": str(period.get("start", "2016-01-01")),
                "end": str(period.get("end", "2020-12-31")),
            },
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": crops,
            "requested_crop_ids": requested_crop_ids,
            "water_supply_scenario": {
                "regime": regime,
                "seasonal_supply_m3_ha": float(annual_m3) / 4.0 if (regime == "irrigated" and annual_m3) else None,
                "official_water_permit_verified": False,
            },
            "options": {
                "acquisition": acquisition,
                "allow_offline_reference_fixture": allow_offline_reference_fixture,
                "allow_conditional_crop_planning": allow_conditional_crop_planning,
                **(
                    {"time_standard": src_cfg["time_standard"]}
                    if src_cfg.get("time_standard")
                    else {}
                ),
                **(
                    {"max_age_days": src_cfg["max_age_days"]}
                    if src_cfg.get("max_age_days") is not None
                    else {}
                ),
                **(
                    {"max_distance_m": src_cfg["max_distance_m"]}
                    if src_cfg.get("max_distance_m") is not None
                    else {}
                ),
            },
        }

    def evaluate_with_adaptive_sidecar(
        self,
        client_request: Dict[str, Any],
        *,
        allow_offline_reference_fixture: bool = False,
        allow_conditional_crop_planning: bool = True,
    ) -> Dict[str, Any]:
        """Run canonical upstream `ClientDecisionService.run` and enrich with `astragron.adaptive-evidence.v1`."""
        upstream_resp = self.upstream.run(client_request)
        ae_req = self.translate_client_request_to_adaptive(
            client_request,
            allow_offline_reference_fixture=allow_offline_reference_fixture,
            allow_conditional_crop_planning=allow_conditional_crop_planning,
        )
        ae_resp = self.engine.evaluate(ae_req)
        sens_resp = self.sensitivity.analyze(ae_req)
        integrity = verify_upstream_integrity()

        return {
            "schema": "astragron.adaptive-evidence.coordinator-envelope.v1",
            "request_id": ae_resp["request_id"],
            "upstream_status": upstream_resp.get("status"),
            "adaptive_overall_status": ae_resp["overall_summary_status"],
            "upstream_client_decision_response": upstream_resp,
            "adaptive_evidence_sidecar": ae_resp,
            "quality_assessment": ae_resp.get("quality_assessment"),
            "single_next_missing_input": ae_resp.get("single_next_missing_input"),
            "evidence_levels_observed": ae_resp.get("evidence_levels_observed", []),
            "decision_sensitivity": sens_resp,
            "provenance_and_license_ledger": PROVENANCE_AND_LICENSE_LEDGER,
            "rollback_and_isolation_plan": ROLLBACK_AND_ISOLATION_PLAN,
            "upstream_integrity_verified": integrity["passed"],
        }
