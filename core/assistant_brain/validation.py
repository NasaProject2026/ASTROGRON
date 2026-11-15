"""Fail-closed validation checks every generated value, unit, citation and sentence."""
from .codec import canonical, resolve
from .context import CATEGORIES, RESTRICTIONS
from .localization import message
from .errors import ChatError

DISPLAY_VALUES = {
    "minimize_worst_shortfall": "minimize the worst modeled water shortfall",
    "minimax_regret": "minimize the worst regret within the compared alternatives",
    "pareto": "retain alternatives with different unresolved trade-offs",
    "CONDITIONAL_LEAST_VIOLATING": "conditional least-violating research result",
    "DECLARED_NUTRIENT_CONSTRAINT_FILTER_THEN_UNCHANGED_WATER_CRITERION": "apply declared nutrient constraints, then the existing water criterion",
    "DECLARED_ELEMENT_BUDGET": "declared elemental nutrient budget",
}
DISPLAY_LABELS = {
    "ET_actual_mm": "Actual evapotranspiration", "ET_potential_mm": "Potential evapotranspiration",
    "crop_ET_deficit_mm": "Modeled water shortfall", "source_withdrawal_m3": "Water withdrawn from the source",
    "worst_service_deficit_mm": "Worst water service deficit", "ET_shortfall_m3_equivalent": "Water shortfall volume equivalent",
    "service_pass": "Declared water service requirement satisfied",
    "ET_shortfall_delta_m3": "Engine-reported water shortfall difference from baseline",
    "source_withdrawal_delta_m3": "Engine-reported source withdrawal difference from baseline",
    "crop_use_id": "Evaluated crop", "planning_year_slot": "Planning year", "source_year": "Historical weather year",
}

def fact_line(fact):
    value = "unavailable" if fact.value is None else DISPLAY_VALUES.get(fact.value, canonical(fact.value)) if isinstance(fact.value, str) else canonical(fact.value)
    label = DISPLAY_LABELS.get(fact.pointer.rsplit("/", 1)[-1], fact.label)
    unit = " " + fact.unit if fact.unit else ""
    scope = fact.scope
    parts = []
    if scope.get("policy_id"):
        parts.append("alternative " + scope["policy_id"][:8])
    if scope.get("field_id"):
        parts.append("field " + scope["field_id"])
    if scope.get("planning_year_slot") is not None:
        parts.append("planning year " + str(scope["planning_year_slot"]))
    elif scope.get("source_year") is not None:
        parts.append("historical weather year " + str(scope["source_year"]))
    if scope.get("uncertainty_scenario"):
        parts.append("input scenario " + scope["uncertainty_scenario"])
    prefix = " / ".join(parts) + ": " if parts else ""
    return prefix + label + ": " + value + unit + " [" + fact.evidence_id + "]"

TOOL_MESSAGES = {
    "BACKEND_UNAVAILABLE": "The scientific simulation backend is not connected. You can still discuss this report or compare existing analyses.",
    "UNSUPPORTED_CHANGE": "This change is not supported by the admitted scientific operations. No new prediction was made; the current report remains available for discussion.",
    "COMPUTATION_UNAVAILABLE": "The scientific backend did not produce an accepted result. No substitute quantities were generated; the current report remains available for discussion.",
    "NEW_ANALYSIS_CREATED": "A separate scientific result was created. The conversation stays attached to the original until you explicitly attach the new analysis.",
}

def render(locale, intent, facts, blocked=False, conflict=False, no_scope=False, tool=None, mode=None, reason_code=None):
    lead = message(locale, "conflict" if conflict else "no_scope" if no_scope else intent)
    if mode=="DETERMINISTIC_FALLBACK":
        prefix=("Deterministic explanation from verified scientific results. " if reason_code in {"NO_LLM_REQUIRED","OFFLINE_PROVIDER"}
                else "The live explanation service is temporarily unavailable. Your existing scientific results remain accessible. Deterministic explanation: ")
        lead=prefix+lead
    if tool and tool.get("status") in TOOL_MESSAGES:
        lead += " " + TOOL_MESSAGES[tool["status"]]
    if blocked and not conflict:
        lead += " " + message(locale, "blocked")
    return "\n".join([lead] + [fact_line(f) for f in facts] + RESTRICTIONS)

def validate_response(response, contexts):
    catalog = {key: fact for context in contexts for key, fact in context.facts.items()}
    expected_keys = {"schema", "locale", "analysis_id", "attached_analysis_id", "analysis_status", "intent", "scope",
                     "scope_unavailable", "field_agronomy_qualified", "claims", "evidence_categories", "evidence_issues",
                     "limitations", "provider_status", "tool", "text"}
    runtime_keys={"answer_plan","answer","mode","provider","model","citations","scientific_status","scenario_reference","reason_code","provider_latency_ms","usage","report_reference"}
    if not expected_keys.issubset(response) or set(response)-expected_keys-runtime_keys or response.get("schema") != "astragron.conversation-response.v1":
        raise ChatError("RESPONSE_CONTRACT_CHANGED")
    issues = sorted({issue for context in contexts for issue in context.issues})
    expected_status = "EVIDENCE_BLOCKED" if any(c.restricted for c in contexts) else "BOUNDED_PARTIAL" if any(c.document["status"] == "BOUNDED_PARTIAL" for c in contexts) else contexts[0].document["status"]
    if response["analysis_status"] != expected_status or response["evidence_issues"] != issues:
        raise ChatError("ANALYSIS_RESTRICTION_CHANGED")
    claims = response.get("claims", [])
    if not isinstance(claims, list) or len(claims) > 48:
        raise ChatError("CLAIM_LIMIT")
    facts = []
    for claim in claims:
        if not isinstance(claim, dict) or claim.get("evidence_id") not in catalog:
            raise ChatError("UNSUPPORTED_CITATION")
        fact = catalog[claim["evidence_id"]]
        if canonical(claim) != canonical(fact.public()):
            raise ChatError("UNSUPPORTED_NUMERICAL_OR_SCIENTIFIC_CLAIM")
        context = next(c for c in contexts if c.analysis_id == fact.analysis_id)
        if canonical(resolve(context.document, fact.pointer)) != canonical(fact.value):
            raise ChatError("EVIDENCE_CHANGED")
        facts.append(fact)
    if "answer_plan" in response:
        from .dialogue import compile_plan, render_plan
        supplied = response["answer_plan"]
        if not isinstance(supplied,dict) or set(supplied)!={"schema","spec","focus","acts"}:raise ChatError("INVALID_ANSWER_PLAN")
        plan, expected_facts = compile_plan(contexts,response["intent"],response["scope"],supplied["spec"],response.get("tool"),response["scope_unavailable"],supplied["focus"])
        if canonical(supplied)!=canonical(plan) or canonical(response["claims"])!=canonical([f.public() for f in expected_facts]):
            raise ChatError("ANSWER_PLAN_EVIDENCE_MISMATCH")
        expected = render_plan(plan,facts,contexts,response.get("mode"),response.get("reason_code"))
    else:
        expected = render(response["locale"], response["intent"], facts,
                      response["analysis_status"] == "EVIDENCE_BLOCKED", bool(response["evidence_issues"]), response["scope_unavailable"], response.get("tool"),response.get("mode"),response.get("reason_code"))
    if response.get("text") != expected:
        raise ChatError("UNSUPPORTED_RESPONSE_TEXT")
    if response.get("field_agronomy_qualified") is not False:
        raise ChatError("UNSUPPORTED_FIELD_QUALIFICATION")
    expected_categories = {category: [f.evidence_id for f in facts if f.category == category] for category in CATEGORIES}
    if response.get("evidence_categories") != expected_categories:
        raise ChatError("EVIDENCE_CLASSIFICATION_CHANGED")
    if response.get("limitations") != RESTRICTIONS:
        raise ChatError("RESTRICTION_REMOVED")
    if "mode" in response:
        if not (runtime_keys-{"answer_plan"}).issubset(response):raise ChatError("RUNTIME_METADATA_INCOMPLETE")
        if response["answer"]!=response["text"] or response["scientific_status"]!=response["analysis_status"]:
            raise ChatError("ANSWER_ALIAS_CHANGED")
        if response["citations"]!=[f.evidence_id for f in facts]:raise ChatError("RUNTIME_CITATION_CHANGED")
        if response["report_reference"]!={"href":"/v1/analyses/"+response["analysis_id"]+"/report","source_contract":"astragron.client-report-dto.v1"}:
            raise ChatError("REPORT_REFERENCE_CHANGED")
        mode,provider=response["mode"],response["provider"]
        if mode=="DETERMINISTIC_FALLBACK":
            if provider is not None or response["model"] is not None or response["provider_status"]=="LIVE":
                raise ChatError("FAKE_LIVE_RESPONSE")
        elif provider not in {"gemini","groq","ollama"} or mode!="LIVE_"+provider.upper() or response["provider_status"]!="LIVE":
            raise ChatError("PROVIDER_MODE_MISMATCH")
    return True
