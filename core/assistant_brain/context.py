"""Only whitelisted scalar facts cross the scientific -> conversation boundary."""
from dataclasses import dataclass, asdict
from copy import deepcopy
import math
import re
from urllib.parse import urlsplit
from .codec import digest, resolve, canonical
from .errors import ChatError

CATEGORIES = ("observed_or_sourced", "model_derived", "assumed_inputs",
              "uncertain_estimates", "unsupported_or_unavailable")
IDENTIFIER = re.compile(r"[A-Za-z0-9_.: /+-]{1,180}\Z")
STATUSES = {"CONDITIONAL_RESEARCH_COMPLETE", "BOUNDED_PARTIAL", "EVIDENCE_BLOCKED"}
WATER_UNITS = {"crop_ET_deficit_mm": "mm", "ET_actual_mm": "mm",
               "ET_potential_mm": "mm", "source_withdrawal_m3": "m3"}
RESTRICTIONS = [
    "This is conditional research; field agronomic qualification is unavailable.",
    "Historical weather analogues are not forecasts and have no assigned probabilities.",
    "Nutrient inventories do not establish plant availability, biological response or fertilizer rates.",
    "Marketable yield, profit, pesticide permissions and water rights remain unqualified.",
    "The evaluated candidate set does not prove a global optimum.",
]

@dataclass(frozen=True)
class Fact:
    evidence_id: str
    analysis_id: str
    location: str
    pointer: str
    label: str
    value: object
    unit: str | None
    category: str
    scope: dict

    def public(self):
        return asdict(self)

class ScientificContext:
    def __init__(self, analysis_id, response):
        self.analysis_id = analysis_id
        self.document = deepcopy(response)
        if response.get("schema") != "astragron.client-decision.response.v1":
            raise ChatError("UNSUPPORTED_ANALYSIS_CONTRACT")
        if response.get("status") not in STATUSES:
            raise ChatError("UNKNOWN_ANALYSIS_RESTRICTION")
        self.sha256 = digest(response)
        self.farm_id = response.get("farm_id")
        if not isinstance(self.farm_id, str) or not IDENTIFIER.fullmatch(self.farm_id):
            raise ChatError("INVALID_FARM_ID")
        self.facts, self.issues = {}, []
        self.rows = response.get("report_dto", {}).get("five_year_rows", [])
        if not isinstance(self.rows, list) or len(self.rows) > 10000:
            raise ChatError("INVALID_REPORT_ROWS")
        self.native_growth = response.get("growth_evaluation", {}).get("schema") == "astragron.growth-decision.response.v1"
        self._build()

    def add(self, pointer, label, category="model_derived", unit=None, scope=None):
        try:
            value = resolve(self.document, pointer)
        except (KeyError, IndexError, TypeError, ValueError):
            return
        if not (value is None or type(value) in (str, int, float, bool)):
            return
        source_url = (pointer.endswith("/source_url") and isinstance(value, str) and len(value) < 1500
                      and urlsplit(value).scheme == "https" and urlsplit(value).hostname == "power.larc.nasa.gov"
                      and urlsplit(value).path == "/api/temporal/daily/point"
                      and not urlsplit(value).username and not urlsplit(value).fragment)
        if isinstance(value, str) and not IDENTIFIER.fullmatch(value) and not source_url:
            return  # Never emit arbitrary source prose, paths, HTML or instructions.
        if isinstance(value, float) and not math.isfinite(value):
            self.issues.append("NONFINITE_FACT")
            return
        eid = "ev_" + digest([self.sha256, pointer])[:24]
        self.facts[eid] = Fact(eid, self.analysis_id, "analysis:sha256:" + self.sha256 + "#" + pointer,
                               pointer, label, value, unit, category, deepcopy(scope or {}))

    def _build(self):
        d = self.document
        self.add("/status", "Analysis status", "unsupported_or_unavailable")
        q = d.get("qualification", {})
        if not isinstance(q, dict) or q.get("field_agronomy_qualified") is not False:
            self.issues.append("FIELD_QUALIFICATION_CONTRADICTION")
        for key in ("field_agronomy_qualified", "climate_ready", "water_rights",
                    "soil_accounting_status", "nutrient_response_status", "plant_availability",
                    "biological_uptake", "yield_response", "economic_ranking", "plant_availability_P_K"):
            self.add("/qualification/" + key, key.replace("_", " "), "unsupported_or_unavailable")
        for key in ("preference", "criterion", "status", "global_optimum", "objective_version"):
            self.add("/decision/" + key, "Selection " + key.replace("_", " "))
        for i, pid in enumerate(d.get("decision", {}).get("selected_ids", [])):
            self.add(f"/decision/selected_ids/{i}", "Selected research alternative")
        for i, pid in enumerate(d.get("decision", {}).get("pareto_ids", [])):
            self.add(f"/decision/pareto_ids/{i}", "Pareto research alternative")
        if d["status"] == "EVIDENCE_BLOCKED" and d.get("decision", {}).get("selected_ids"):
            self.issues.append("BLOCKED_SELECTION_CONTRADICTION")
        self.add("/engine_result/normalized_request/horizon_years", "Planning horizon", "assumed_inputs", "years")
        for i, scenario in enumerate(d.get("engine_result", {}).get("normalized_request", {}).get("scenarios", [])):
            scope = {"scenario_id": scenario.get("scenario_id")}
            self.add(f"/engine_result/normalized_request/scenarios/{i}/rain_factor", "Rainfall multiplier", "assumed_inputs", "1", scope)
        for i, assumption in enumerate(d.get("assumptions", [])):
            if isinstance(assumption, dict):
                for key in ("id", "evidence_class"):
                    self.add(f"/assumptions/{i}/{key}", "Declared assumption " + key, "assumed_inputs")
        self.add("/engine_result/soil_memory/ranking_effect", "Nutrient constraint effect on selection")
        for i, gap in enumerate(d.get("missing_requirements", [])):
            if isinstance(gap, dict):
                for key in ("path", "reason"):
                    self.add(f"/missing_requirements/{i}/{key}", "Missing evidence " + key, "unsupported_or_unavailable")
        if self.native_growth:
            fields = d.get("engine_result", {}).get("normalized_request", {}).get("fields", [])
            field_scope = {"field_id":fields[0].get("field_id")} if len(fields)==1 else {}
            for oi, objective in enumerate(d.get("decision", {}).get("objectives", [])):
                for si, scenario in enumerate(objective.get("scenarios", [])):
                    scope = dict(field_scope,policy_id=objective.get("policy_id"),scenario_id=scenario.get("scenario_id"))
                    base = f"/decision/objectives/{oi}/scenarios/{si}"
                    self.add(base+"/N_leaching_kg_N_field", "Five-year modeled bottom N leaching", unit="kg N/field over five crop years",scope=scope)
                    for crop, value in scenario.get("crop_storage_DM_kg_field_by_crop", {}).items():
                        if not isinstance(crop,str) or not IDENTIFIER.fullmatch(crop):continue
                        pointer=base+"/crop_storage_DM_kg_field_by_crop/"+crop.replace("~","~0").replace("/","~1")
                        if type(value) not in (int,float) or value<0:self.issues.append("NATIVE_GROWTH_PARAMETER_LIMIT")
                        self.add(pointer,"Five-year named-cultivar storage-organ dry matter",unit="kg DM/field over five crop years",scope=dict(scope,crop_use_id=crop))
        # Exact DTO vs canonical outcome parity, including nulls and nutrient decimals.
        canonical_rows = {}
        for ai, alternative in enumerate(d.get("alternatives", [])):
            pid = alternative.get("policy_id")
            for si, scenario in enumerate(alternative.get("scenarios", [])):
                scope = {"policy_id": pid, "scenario_id": scenario.get("scenario_id")}
                base = f"/alternatives/{ai}/scenarios/{si}"
                for key, unit in (("worst_service_deficit_mm", "mm"), ("ET_shortfall_m3_equivalent", "m3 equivalent"),
                                  ("source_withdrawal_m3", "m3"), ("service_pass", None)):
                    self.add(base + "/" + key, key.replace("_", " "), unit=unit, scope=scope)
                self.add(base + "/first_violated_constraint/kind", "First violated constraint", scope=scope)
                for ci, check in enumerate(scenario.get("soil_constraint_checks", [])):
                    cscope = dict(scope, uncertainty_scenario=check.get("uncertainty_scenario"))
                    self.add(f"{base}/soil_constraint_checks/{ci}/passes", "Declared nutrient constraint satisfied", scope=cscope)
                for row in scenario.get("field_years", []):
                    key = tuple(row.get(k) for k in ("policy_id", "scenario_id", "field_id", "source_year"))
                    if key in canonical_rows:
                        self.issues.append("DUPLICATE_CANONICAL_ROW")
                    canonical_rows[key] = row
            for bi, comparison in enumerate(alternative.get("baseline_comparison", [])):
                scope = {"policy_id": pid, "scenario_id": comparison.get("scenario_id")}
                for key in ("ET_shortfall_delta_m3", "source_withdrawal_delta_m3"):
                    self.add(f"/alternatives/{ai}/baseline_comparison/{bi}/{key}", key.replace("_", " "), unit="m3", scope=scope)
        seen = set()
        for i, row in enumerate(self.rows):
            if not isinstance(row, dict):
                self.issues.append("INVALID_REPORT_ROW")
                continue
            scope = {k: row.get(k) for k in ("policy_id", "scenario_id", "field_id", "source_year", "planning_year_slot", "crop_use_id")}
            key = tuple(row.get(k) for k in ("policy_id", "scenario_id", "field_id", "source_year"))
            if key in seen or key not in canonical_rows or canonical(row) != canonical(canonical_rows[key]):
                self.issues.append("REPORT_CANONICAL_CONTRADICTION")
                continue
            seen.add(key)
            base = f"/report_dto/five_year_rows/{i}"
            for name in ("crop_use_id", "source_year", "planning_year_slot"):
                self.add(base + "/" + name, name.replace("_", " "), "assumed_inputs", scope=scope)
            self.add(base + "/area_ha", "Declared field area", "assumed_inputs", "ha", scope)
            for name, unit in WATER_UNITS.items():
                self.add(base + "/water/" + name, name.replace("_", " "), unit=unit, scope=scope)
            for j, annual in enumerate(row.get("soil_accounting") or []):
                uscope = dict(scope, uncertainty_scenario=annual.get("uncertainty_scenario"))
                native_n = self.native_growth and d.get("engine_result", {}).get("soil_memory", {}).get("scope") == "P_K_ONLY; N_FROM_NATIVE_SNOMIN"
                for element in (("P", "K") if native_n else ("N", "P", "K")):
                    for quantity in ("initial_total", "external_inputs", "external_outputs", "ending_total", "mass_residual"):
                        p = f"{base}/soil_accounting/{j}/balance/{element}"
                        unit = annual.get("balance", {}).get(element, {}).get("unit")
                        if unit != f"kg {element}/ha":
                            self.issues.append("NUTRIENT_UNIT_CONTRADICTION")
                            continue
                        self.add(p + "/" + quantity, element + " " + quantity.replace("_", " "),
                                 "assumed_inputs" if quantity in {"initial_total", "external_inputs"} else "uncertain_estimates", unit, uscope)
            if self.native_growth:
                g = row.get("growth_model", {})
                b = row.get("biomass", {})
                n = row.get("biological_uptake", {})
                if (g.get("provider") != "wageningen-three-crop-producing-research-v1"
                    or g.get("field_validated") is not False or b.get("unit") != "kg DM/ha"
                    or b.get("marketable_yield") is not None or n.get("unit") != "kg N/ha"
                    or n.get("quality") != "NATIVE_PROCESS_MODELED_UNVALIDATED"):
                    self.issues.append("NATIVE_GROWTH_CONTRACT_NOT_SUPPORTED")
                else:
                    for organ in ("LV", "ST", "RT", "SO"):
                        value = b.get("living_organs", {}).get(organ)
                        if type(value) not in (int, float) or value < 0:
                            self.issues.append("NATIVE_GROWTH_PARAMETER_LIMIT")
                        self.add(base + "/biomass/living_organs/" + organ, "Modeled living " + organ + " dry matter", unit="kg DM/ha", scope=scope)
                    value = n.get("value")
                    if type(value) not in (int, float) or value < 0:
                        self.issues.append("NATIVE_GROWTH_PARAMETER_LIMIT")
                    self.add(base + "/biological_uptake/value", "Native modeled N uptake", unit="kg N/ha", scope=scope)
                    self.add(base + "/growth_model/field_validated", "Native model field validation", "unsupported_or_unavailable", scope=scope)
            for name in ("predicted_yield", "plant_available_nutrients", "biological_uptake"):
                if row.get(name) is None:
                    self.add(base + "/" + name, name.replace("_", " "), "unsupported_or_unavailable", scope=scope)
        if len(seen) != len(canonical_rows):
            self.issues.append("MISSING_REPORT_ROWS")
        # Only public raw-source identities, never internal filesystem paths or prompts.
        provenance = d.get("engine_result", {}).get("provenance", {})
        for sid, source in provenance.get("scenario_sources", {}).items():
            if not IDENTIFIER.fullmatch(sid):
                continue
            safe_sid = sid.replace("~", "~0").replace("/", "~1")
            if isinstance(source, dict):
                for name in ("raw_sha256", "source_raw_sha256", "receipt_sha256", "source_url", "available_at", "classification", "time_standard"):
                    self.add(f"/engine_result/provenance/scenario_sources/{safe_sid}/{name}", "Regional weather source " + name,
                             "observed_or_sourced", scope={"scenario_id": sid})
                for variable in ("T2M_MIN", "T2M_MAX", "T2M", "PRECTOTCORR"):
                    self.add(f"/engine_result/provenance/scenario_sources/{safe_sid}/units/{variable}", "Regional weather " + variable + " unit",
                             "observed_or_sourced", scope={"scenario_id": sid})
        self.issues = sorted(set(self.issues))

    @property
    def restricted(self):
        return bool(self.issues) or self.document["status"] == "EVIDENCE_BLOCKED"

    def retrieve(self, intent, scope, limit=36):
        facts = list(self.facts.values())
        if intent == "sources":
            facts = [f for f in facts if f.pointer.startswith(("/engine_result/provenance/", "/assumptions/", "/engine_result/normalized_request/"))]
        relevant_scope = {k: v for k, v in scope.items() if intent != "sources" or k == "scenario_id"}
        for key, value in relevant_scope.items():
            if value is not None:
                facts = [f for f in facts if not f.scope or (key in f.scope and f.scope[key] == value)]
        if self.issues:
            return [f for f in facts if f.pointer == "/status"]
        def score(f):
            p = f.pointer
            if intent in {"risk", "missing", "unsupported"}:
                return (0 if f.category == "unsupported_or_unavailable" else 3, p)
            if intent == "nutrients":
                return (0 if "/balance/" in p else 2, p)
            if intent == "water":
                return (0 if "/water/" in p else 1 if "deficit" in p or "withdrawal" in p else 3, p)
            if intent == "compare":
                return (0 if p.startswith("/alternatives/") and ("service_pass" in p or "ET_shortfall_m3_equivalent" in p or "source_withdrawal_m3" in p or "first_violated_constraint" in p) else 1 if "baseline_comparison" in p else 2, p)
            if intent == "why":
                return (0 if p.startswith("/decision/") or "ranking_effect" in p else 1 if "soil_constraint_checks" in p or "first_violated_constraint" in p else 2 if p.startswith("/alternatives/") else 3, p)
            if intent == "sources":
                return (0 if f.category == "observed_or_sourced" else 1 if p.startswith("/assumptions/") else 2, p)
            return (0 if "crop_use_id" in p else 1 if "/decision/" in p else 2, p)
        return sorted(facts, key=score)[:limit]
