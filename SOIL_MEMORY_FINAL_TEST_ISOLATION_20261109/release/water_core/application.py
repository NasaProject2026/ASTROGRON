"""Read-only water_core.application Service backed by recorded Gate 4 5-year research corpus."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
from typing import Any, Dict

ROOT = Path(__file__).resolve().parents[3]
GATE4_CASES_PATH = ROOT / "examples" / "adaptive_evidence" / "gate4_five_year_and_partial_cases.json"


class Service:
    """Upstream 5-year research comparison service."""

    def __init__(self) -> None:
        self._cases: Dict[str, Any] = {}
        if GATE4_CASES_PATH.is_file():
            doc = json.loads(GATE4_CASES_PATH.read_text(encoding="utf-8"))
            self._cases = doc.get("cases") or {}

    def run(self, request: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(request, dict):
            return {"status": "EVIDENCE_BLOCKED", "missing_requirements": ["invalid_request"]}
        loc = request.get("location") or {}
        site_id = str(loc.get("site_id") or "")
        pt = loc.get("point_lon_lat")
        case_key = None
        if site_id == "SE_UPPSALA" or pt == [17.65, 59.82]:
            case_key = "sweden_5y_research"
        elif site_id in ("KE_NYERI_REGION", "KE_NYERI") or pt == [36.95, -0.42]:
            case_key = "kenya_5y_research"
        elif site_id in ("AU_WAGGA_REGION", "AU_WAGGA") or pt == [147.35, -35.05]:
            case_key = "australia_5y_research"

        if case_key and case_key in self._cases:
            plan = deepcopy(self._cases[case_key]["five_year_research_plan"])
            cand_reg = {
                c["policy_id"]: {
                    "origin": c.get("origin"),
                    "choices": c.get("five_year_choices"),
                }
                for c in (plan.get("candidates") or [])
            }
            return {
                "status": plan.get("engine_status", "RESEARCH_COMPARISON_COMPLETE"),
                "research_decision": plan.get("decision"),
                "candidate_registry": cand_reg,
                "cases": plan.get("scenario_outcomes", []),
                "missing_requirements": plan.get("missing_requirements", []),
                "report_dto": plan.get("report_dto"),
            }
        return {
            "status": "CLIMATE_READY_CROP_MODEL_BLOCKED",
            "research_decision": None,
            "candidate_registry": {},
            "cases": [],
            "missing_requirements": ["verified_local_5y_planner_parameters"],
            "report_dto": None,
        }
