"""Compositional, source-bound English. No provider prose enters the answer grammar.

A small typed specification describes topic, depth and safe conversational notices.
Compilation chooses complete scoped fact objects and approved semantic acts. Validation
recompiles the entire plan against the immutable contexts, not merely its numbers.
"""
import re
from .codec import canonical
from .errors import ChatError

TOPICS = {"plan", "why", "compare", "water", "nutrients", "growth", "risk", "missing", "sources", "unsupported", "what_if", "navigation", "security", "language", "rainfall", "irrigation"}
NOTICES = {"profit", "yield", "pesticide", "rights", "premise", "wheat"}
STYLES = {"brief", "simple", "detail"}


def question_spec(text, intent, previous=None):
    t = text.lower()
    style = "simple" if re.search(r"simpl|plain language", t) else "detail" if re.search(r"more detail|in detail|explain further", t) else "brief"
    topic = intent
    if intent == "water" and re.search(r"rainfall|how much rain|rain total",t):topic="rainfall"
    if intent == "water" and re.search(r"irrigat",t):topic="irrigation"
    if re.search(r"dry matter|biomass|growth|uptake", t): topic = "growth"
    if re.search(r"\d+(?:\.\d+)?\s*mm|isn.t it|surely",t) and re.search(r"water|rain|\bet\b|evapotranspiration|shortfall",t):topic="water"
    if re.search(r"simpl|more detail|explain further", t) and previous:
        topic = previous.get("topic", topic)
    notices = []
    for code, pattern in (("profit", r"profit|return|income"), ("yield", r"yield"), ("pesticide", r"pesticid|herbicide|insecticide|legal|permission|dose"), ("rights", r"water rights"), ("wheat", r"wheat")):
        if re.search(pattern, t): notices.append(code)
    if re.search(r"\d+(?:\.\d+)?\s*(?:mm|kg|tonne|%|m3)|isn.t it|surely|guarantee", t): notices.append("premise")
    # Mixed questions retain the supported part without allowing an unsupported tool call.
    if intent == "unsupported" and re.search(r"(?:explain|show|what is|how much).*water.*(?:and|also)|water.*(?:and|also).*(?:profit|yield|pesticid)", t): topic = "water"
    if re.search(r"secret|credential|system prompt|other farms|all farms|ignore.*(?:rule|restriction)|exfiltrat", t): topic = "security"
    elif any(ord(c)>127 and c.isalpha() for c in t) and not re.search(r"\bwater|\bplan|\bexplain", t): topic = "language"
    elif re.fullmatch(r"(?:hello|hi|thanks|thank you)[!. ]*", t) or re.search(r"how (?:do i|can i) use|what can you do|help me navigate", t): topic = "navigation"
    return {"topic": topic, "style": style, "notices": sorted(set(notices))}


def crop_name(value):
    t = str(value).lower()
    named={"research:nl:potato_fontane":"potato (Fontane)","research:nl:sugarbeet_601":"sugarbeet (601)","research:nl:spring_barley_301":"spring barley (301)"}
    if t in named:return named[t]
    if "potato" in t: return "potato"
    if "sugarbeet" in t or "sugar_beet" in t: return "sugarbeet"
    if "barley" in t: return "spring barley"
    if "chickpea" in t: return "chickpea"
    if "wheat" in t: return "wheat"
    if "fallow" in t: return "fallow"
    return "the crop named in the report"


def compile_plan(contexts, intent, scope, spec, tool=None, unknown=False, preferred=None):
    if (not isinstance(spec, dict) or set(spec) != {"topic", "style", "notices"}
        or spec["topic"] not in TOPICS or spec["style"] not in STYLES
        or not isinstance(spec["notices"], list) or len(spec["notices"]) > len(NOTICES)
        or spec["notices"] != sorted(set(spec["notices"])) or set(spec["notices"]) - NOTICES):
        raise ChatError("INVALID_ANSWER_SPEC")
    preferred = preferred or []
    allowed = {eid for c in contexts for eid in c.facts}
    if not isinstance(preferred, list) or len(preferred)>24 or len(set(preferred))!=len(preferred) or any(e not in allowed for e in preferred):
        raise ChatError("INVALID_ANSWER_FOCUS")
    acts, chosen = [], {}
    def say(code): acts.append({"kind": "say", "code": code})
    def use(kind, facts, **extra):
        fs = list(facts)
        if not fs: return
        chosen.update((f.evidence_id, f) for f in fs)
        acts.append(dict(kind=kind, refs=[f.evidence_id for f in fs], **extra))
    topic, style = spec["topic"], spec["style"]
    if topic in {"navigation", "security", "language"}:
        say(topic)
    elif unknown:
        say("wheat_unavailable" if "wheat" in spec["notices"] else "clarify")
    else:
        c = contexts[0]
        if any(x.issues for x in contexts):
            say("conflict")
            use("anchor", [f for x in contexts for f in x.facts.values() if f.pointer == "/status"])
        else:
            use("anchor", [f for x in contexts for f in x.facts.values() if f.pointer == "/status"])
            if any(x.restricted for x in contexts): say("blocked")
            if tool and tool.get("reason")=="EXPLICIT_SOURCE_SCENARIO_REQUIRED":say("choose_scenario")
            elif tool:
                say("tool_" + tool["status"] if tool.get("status") in {"NEW_ANALYSIS_CREATED", "BACKEND_UNAVAILABLE", "UNSUPPORTED_CHANGE", "COMPUTATION_UNAVAILABLE", "IDENTICAL_SNAPSHOTS"} else "tool_UNSUPPORTED_CHANGE")
            if topic == "compare" and len(contexts)>1: say("snapshot_compare")
            for ci, ctx in enumerate(contexts):
                allfacts = list(ctx.facts.values())
                find = lambda pointer: [f for f in allfacts if f.pointer == pointer]
                def scoped(f):
                    return all(f.scope.get(k)==v for k,v in scope.items() if v is not None)
                rows = [f for f in allfacts if f.pointer.endswith("/crop_use_id") and scoped(f)]
                if topic in {"plan", "why", "compare"}:
                    pareto = [f for f in allfacts if f.pointer.startswith("/decision/pareto_ids/")]
                    if pareto and not ctx.document.get("decision", {}).get("selected_ids"):
                        use("pareto", pareto)
                    else:
                        use("criterion", find("/decision/preference") or find("/decision/criterion"))
                    if topic in {"why", "compare"}:
                        use("criterion", find("/engine_result/soil_memory/ranking_effect"))
                    if topic != "compare" or ctx.native_growth:
                        # Crop identities can span scenarios only if they agree in every matched row.
                        grouped = {}
                        for f in rows:
                            k = (f.scope.get("policy_id"), f.scope.get("field_id"), f.scope.get("source_year"))
                            grouped.setdefault(k, []).append(f)
                        groups = {}
                        for (pid, field, year), fs in grouped.items():
                            if len({canonical(f.value) for f in fs}) != 1: continue
                            ref = next((f for f in fs if f.scope.get("scenario_id")=="REFERENCE"), fs[0])
                            groups.setdefault((pid,field), []).append(ref)
                        for (pid, field), fs in list(groups.items())[:4]:
                            use("rotation", sorted(fs,key=lambda f:f.scope.get("source_year",0)), context_index=ci)
                if topic in {"water", "nutrients", "growth", "compare", "what_if", "rainfall", "irrigation"}:
                    if topic=="rainfall":
                        use("metrics",[f for f in allfacts if f.pointer.endswith("/rain_factor") and (not scope.get("scenario_id") or f.scope.get("scenario_id")==scope["scenario_id"])],context_index=ci)
                        say("rainfall_limit")
                        continue
                    actual_topic = ("growth" if any(k in scope for k in ("source_year","planning_year_slot")) else "vector") if topic=="compare" and ctx.native_growth else "water" if topic in {"compare","what_if"} else topic
                    scenario_ids = {r.get("scenario_id") for r in ctx.rows}
                    annual = actual_topic in {"nutrients", "growth"} or "source_year" in scope or "planning_year_slot" in scope or "crop_use_id" in scope
                    if len(scenario_ids)>1 and "scenario_id" not in scope and (annual or actual_topic=="vector"):
                        say("choose_scenario")
                    else:
                        selected = []
                        for ai, alt in enumerate(ctx.document.get("alternatives", [])):
                            pid = alt.get("policy_id")
                            if scope.get("policy_id") and scope["policy_id"] != pid: continue
                            pool = [f for f in allfacts if f.scope.get("policy_id")==pid and (scoped(f) if annual else all(f.scope.get(k)==v for k,v in scope.items() if k in {"scenario_id", "policy_id"}))]
                            if actual_topic == "vector":
                                pool = [f for f in pool if f.pointer.startswith("/decision/objectives/")]
                            elif actual_topic == "growth":
                                pool = [f for f in pool if f.pointer.endswith(("/biomass/living_organs/SO", "/biological_uptake/value"))]
                            elif actual_topic == "irrigation":
                                pool = [f for f in pool if f.pointer.endswith("/water/source_withdrawal_m3")] if annual else [f for f in pool if f.pointer.startswith("/alternatives/") and f.pointer.endswith("/source_withdrawal_m3")]
                            elif actual_topic == "water":
                                pool = [f for f in pool if f.pointer.endswith(("/water/crop_ET_deficit_mm", "/water/ET_actual_mm", "/water/source_withdrawal_m3"))] if annual else [f for f in pool if f.pointer.startswith("/alternatives/") and f.pointer.endswith(("/ET_shortfall_m3_equivalent", "/service_pass", "/source_withdrawal_m3"))]
                            else:
                                pool = [f for f in pool if ("/balance/" in f.pointer and f.pointer.endswith("/ending_total")) or (ctx.native_growth and f.pointer.endswith("/biological_uptake/value"))]
                                # Never silently select one uncertainty case.
                                if "uncertainty_scenario" not in scope:
                                    pool = [f for f in pool if f.scope.get("uncertainty_scenario")=="POINT" or f.pointer.endswith("/biological_uptake/value")]
                            pool.sort(key=lambda f: (f.evidence_id not in preferred, f.pointer))
                            cap = 4 if actual_topic=="vector" else 2 if style=="simple" else 3 if style=="detail" or actual_topic=="nutrients" or (ctx.native_growth and actual_topic=="water") else 2
                            selected.extend(pool[:cap])
                        if selected: use("metrics", selected, context_index=ci)
                        elif actual_topic == "growth": say("growth_unavailable")
                        else: say("metric_unavailable")
                        if actual_topic in {"growth","vector"} and ctx.native_growth: say("dry_matter")
                        if actual_topic == "irrigation":say("irrigation_limit")
                        if actual_topic == "nutrients": say("native_n" if ctx.native_growth else "inventory")
                        if actual_topic == "water" and ctx.native_growth: say("native_water")
                if topic in {"missing", "risk", "unsupported"}:
                    use("availability", [f for f in allfacts if f.pointer.startswith("/qualification/") and f.pointer.endswith(("/yield_response", "/economic_ranking", "/plant_availability_P_K"))])
                    if topic in {"missing", "risk"}: say("measurements")
                    else: say("unsupported")
                if topic == "sources":
                    source_facts = sorted([f for f in ctx.retrieve("sources", scope) if f.category=="observed_or_sourced"],key=lambda f:not f.pointer.endswith("/source_url"))[:4]
                    if source_facts: use("sources", source_facts)
                    else: say("source_unavailable")
                if style=="detail" and topic in {"plan", "why", "compare"}: say("pareto_detail" if ctx.native_growth else "criterion_detail")
            say("research")
    for code in spec["notices"]:
        if code != "wheat": say("notice_" + code)
    return {"schema":"astragron.evidence-answer-plan.v1", "spec":spec, "focus":preferred, "acts":acts}, list(chosen.values())


SAY = {
"rainfall_limit": "The annual chat rows do not report a rainfall total. The rainfall multiplier is a declared input applied to historical weather, not measured annual rainfall or a forecast.",
"irrigation_limit": "Source withdrawal describes water taken from supply. It does not establish crop-applied irrigation or verified water rights.",
"source_unavailable": "Detailed climate-source references are NOT_SUPPORTED_IN_CHAT_YET for this response profile. Please open the original report; I will not invent a source identity.",
"navigation": "I can help you understand the attached plan, compare its alternatives, explore a particular field or year, or check missing evidence. Try: What about year three?",
"security": "I can discuss only analyses authorized for this conversation. Credentials and internal instructions are not available through chat. You can ask about the attached report or its evidence.",
"language": "This chat currently supports English. Please ask in English, for example: Explain water for field F1 in year three. No new calculation was made.",
"clarify": "Which field, crop, year or scenario do you mean? I cannot match that reference to the attached results. Please name it or select it in the report.",
"wheat_unavailable": "For wheat, the chat result is EVIDENCE_BLOCKED: no supported wheat result is attached for that scope. I cannot infer a successful wheat crop from another crop's result.",
"conflict": "The report contains conflicting evidence. I cannot safely explain its quantities until the host supplies a consistent version.",
"blocked": "Required evidence is missing. This analysis is EVIDENCE_BLOCKED; it does not establish a usable crop recommendation.",
"choose_scenario": "There are several weather or initial-state cases. Please select the exact scenario in the report; I will keep its field and year together.",
"metric_unavailable": "That quantity is not reported for this scope. Missing values are unavailable, not zero. Select a year and scenario to inspect the annual evidence.",
"growth_unavailable": "Native crop growth is NOT_SUPPORTED_IN_CHAT_YET for this response profile. I can explain the available water and nutrient-inventory results; I cannot invent a growth response.",
"dry_matter": "These are modeled living storage-organ dry matter and native N uptake. Dry matter is not saleable yield; this model has no qualified conversion to marketable produce or profit.",
"native_n": "N uptake belongs to the native process model. P/K figures are synthetic inventory controls; they do not model P/K availability, removal coefficients or growth response.",
"inventory": "These nutrient totals are accounting inventories under declared inputs. They do not establish plant availability or fertilizer rates. Input cases are declared assumptions, not confidence estimates.",
"native_water": "This profile leaves legacy annual ET and water-shortfall fields unavailable. A reported zero source withdrawal is an explicit modeled value, separate from an unavailable ET quantity. Native layer water uses total layer water; it cannot be substituted for legacy available-water storage.",
"measurements": "For further qualification, useful inputs include local soil and initial water/mineral-N measurements, crop calendars and observed crop outcomes. Missing physiological coefficients still need scientific evidence; measurements do not authorize guessing them.",
"unsupported": "I cannot establish marketable yield, profit, pesticide legality or a field prescription from this report. I can explain its supported research results and what evidence is needed next.",
"snapshot_compare": "Here are the saved values side by side, in the order you requested. This comparison reads existing results; it does not run a new simulation.",
"pareto_detail": "The comparison keeps each cultivar's dry matter separate and considers modeled N loss across the matched scenarios. A trade-off between those components cannot be converted into an overall economic ranking here.",
"criterion_detail": "That is the declared comparison rule within the evaluated candidate set. It does not prove a global optimum or establish how an untested crop would perform.",
"research": "These are conditional research results; field validation is unavailable. Historical weather cases are not forecasts.",
"tool_IDENTICAL_SNAPSHOTS": "These two saved analyses have identical content. No new simulation was run. The shared report values are shown once.",
"tool_NEW_ANALYSIS_CREATED": "I computed a separate rainfall scenario with the scientific engine. Your original is unchanged and remains attached. You can now ask: Compare with my original.",
"tool_BACKEND_UNAVAILABLE": "The scientific backend is not connected. No new calculation was made. I can still explain or compare saved results.",
"tool_UNSUPPORTED_CHANGE": "That change is not admitted here. Rain-factor changes on the supported water profile are available when the original input and engine are attached. Native-growth changes, initial-N edits and arbitrary crop substitutions are unavailable. No new prediction was made.",
"tool_COMPUTATION_UNAVAILABLE": "The engine did not produce an accepted new result. No substitute prediction was made; your original remains available.",
"notice_profit": "Profit cannot be established: qualified marketable yield and farm price/cost inputs are needed. No guaranteed return follows from this research comparison.",
"notice_yield": "Marketable yield is unqualified. A missing yield is not a zero yield, and simulated dry matter cannot be sold as a yield estimate.",
"notice_pesticide": "This report cannot establish pesticide safety or legal permission. Product, crop and jurisdiction-specific authorization must come from the relevant authority.",
"notice_rights": "Water rights are not verified by this analysis.",
"notice_premise": "I use the saved evidence below rather than accepting numerical assumptions in the question as measured results.",
}
CRITERIA = {
"minimize_worst_shortfall": "minimizing the worst modeled water shortfall",
"minimax_regret": "minimizing worst regret among the evaluated alternatives",
"pareto": "retaining alternatives with unresolved trade-offs",
"DECLARED_NUTRIENT_CONSTRAINT_FILTER_THEN_UNCHANGED_WATER_CRITERION": "checking declared nutrient constraints before applying the water comparison rule",
}
LABELS = {"crop_ET_deficit_mm":"modeled crop water shortfall", "ET_actual_mm":"actual modeled evapotranspiration", "source_withdrawal_m3":"source withdrawal", "ET_shortfall_m3_equivalent":"water shortfall volume equivalent", "service_pass":"declared water service requirement met", "rain_factor":"declared rainfall multiplier", "SO":"modeled storage-organ dry matter", "value":"native modeled N uptake"}


def render_plan(plan, facts, contexts, mode=None, reason=None):
    catalog = {f.evidence_id:f for f in facts}
    def scope_label(f):
        ctx = next(c for c in contexts if c.analysis_id==f.analysis_id)
        policies = [a.get("policy_id") for a in ctx.document.get("alternatives", [])]
        parts = []
        if f.scope.get("policy_id") in policies: parts.append("Alternative " + str(policies.index(f.scope["policy_id"])+1))
        if f.scope.get("field_id"):
            name=f.scope["field_id"]
            parts.append("field " + name if isinstance(name,str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,40}",name) else "the selected field")
        if f.scope.get("planning_year_slot") is not None: parts.append("planning year " + str(f.scope["planning_year_slot"]))
        if f.scope.get("source_year") is not None: parts.append("historical weather " + str(f.scope["source_year"]))
        if f.scope.get("crop_use_id"): parts.append(crop_name(f.scope["crop_use_id"]))
        sid=f.scope.get("scenario_id")
        if sid: parts.append({"REFERENCE":"reference", "HALF_RAIN":"half rain", "LOW_INITIAL_MINERAL_N":"low initial mineral N"}.get(sid,"the attached weather case"))
        if f.scope.get("uncertainty_scenario"):parts.append(f.scope["uncertainty_scenario"] + " input case")
        if len(contexts)>1:parts.insert(0,"Result " + str(contexts.index(ctx)+1))
        return ", ".join(parts)
    lines=[]
    if mode=="DETERMINISTIC_FALLBACK" and reason not in {"OFFLINE_PROVIDER", "NO_LLM_REQUIRED"}:
        lines.append("The live explanation service is unavailable; your existing scientific results remain accessible. I am using verified report evidence.")
    for act in plan["acts"]:
        kind=act["kind"]
        if kind=="say":lines.append(SAY[act["code"]]);continue
        fs=[catalog[e] for e in act["refs"]]
        if kind=="anchor":continue
        if kind=="pareto":
            lines.append(("There are " + str(len(fs)) + " research alternatives. Neither is an overall economic winner; each has different trade-offs.") if plan["spec"]["style"]=="simple" and len(fs)==2 else "The report retains " + str(len(fs)) + " Pareto alternatives: each has unresolved trade-offs. There is no qualified overall economic winner.")
        elif kind=="criterion":
            for f in fs:
                if f.value in CRITERIA:
                    lines.append(("In simpler terms, the report uses " if plan["spec"]["style"]=="simple" else "The declared rule is ") + CRITERIA[f.value] + ".")
        elif kind=="rotation":
            prefix=scope_label(fs[0])
            # For a rotation, weather case and annual identity are given for every entry.
            entries=[str(f.scope.get("planning_year_slot",f.scope.get("source_year")))+": "+crop_name(f.value)+" (weather "+str(f.scope.get("source_year"))+")" for f in fs]
            if plan["spec"]["style"]=="simple" and len(fs)>1:
                entries=[crop_name(f.value) for f in fs]
                lines.append(prefix.split(", planning year")[0]+": in planning order, "+" then ".join(entries)+".")
            else:
                lines.append(prefix.split(", planning year")[0]+" — "+"; ".join(entries)+".")
        elif kind=="metrics":
            for f in fs:
                label=LABELS.get(f.pointer.rsplit("/",1)[-1],f.label)
                if "/balance/" in f.pointer: label=f.pointer.split("/balance/")[1].split("/")[0]+" ending inventory"
                value="unavailable (not zero)" if f.value is None else "yes" if f.value is True else "no" if f.value is False else str(f.value)+( " "+f.unit if f.unit else "")
                lines.append(scope_label(f)+": "+label+" is "+value+".")
        elif kind=="sources":
            lines.append("The source evidence identifies NASA POWER regional historical weather. Open the citations or report reference for its source identity and provenance. Regional weather is not a parcel measurement.")
        elif kind=="availability":continue
    return "\n".join(dict.fromkeys(lines))
