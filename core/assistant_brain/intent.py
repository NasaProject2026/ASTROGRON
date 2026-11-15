import re
from .providers import INTENTS

SCOPE_KEYS = {"field_id", "source_year", "planning_year_slot", "crop_use_id", "policy_id", "scenario_id", "uncertainty_scenario"}

def understand(text, previous="plan"):
    t = text.lower()
    if re.search(r"\bwhat (?:does|is) (?:my |the )?(?:five.year |crop )?plan|overview|start over", t):return "plan"
    if re.search(r"yield|profit|pesticid|herbicide|insecticide|legal|permission|dose|recommend|field.qualif|approved", t):
        return "unsupported"
    if "why" in t and "change" in t and ("scenario" in t or "result" in t):return "compare"
    if re.search(r"what if|what happens if|^(?:please )?(?:change|decrease|increase|lower|replace)|less rain|more rain", t):
        return "what_if"
    if re.search(r"biomass|dry matter|growth|\buptake\b", t):return "nutrients"
    for intent, pattern in [("compare", r"compar|trade.?off|between scenarios|result differ"),
                            ("why", r"why|prefer|select|chosen|criterion|criteria"),
                            ("missing", r"missing|measurement|improve|blocked|unavailable"),
                            ("risk", r"risk|uncertain|confidence|assum|sensitiv|limitation"),
                            ("sources", r"\bsources\b|citation|source reference|data source|show.*reference|report section|provenance"),
                            ("nutrients", r"nitrogen|phosphorus|potassium|nutrient|\bnpk\b"),
                            ("water", r"water|rain|irrigat|stress|shortfall")]:
        if re.search(pattern, t):
            return intent
    return previous if previous in INTENTS else "plan"

def focus(text, context, previous, explicit=None, intent="plan"):
    scope = dict(previous)
    rows = context.rows
    unknown = False
    if explicit is not None:
        if not isinstance(explicit, dict) or set(explicit) - SCOPE_KEYS:
            from .errors import ChatError
            raise ChatError("INVALID_SCOPE")
        scope.update(explicit)
    t = text.lower()
    # IDs are matched as whole strings, never as instructions or file paths.
    for key in ("field_id", "policy_id", "scenario_id", "crop_use_id"):
        known = sorted({r[key] for r in rows if isinstance(r.get(key), str)}, key=len, reverse=True)
        matches = [v for v in known if re.search(r"(?<![a-z0-9_])" + re.escape(v.lower()) + r"(?![a-z0-9_])", t)]
        if matches:
            if len(matches)>1 and intent!="compare":unknown=True
            scope[key] = matches[0]
    if re.search(r"this field|that field",t) and "field_id" not in scope and len({r.get("field_id") for r in rows})>1:unknown=True
    if re.search(r"this crop|that crop",t) and "crop_use_id" not in scope and len({r.get("crop_use_id") for r in rows})>1:unknown=True
    field = re.search(r"\bfield\s+([a-z0-9_.:-]+)", t)
    if field:
        values = {str(r.get("field_id")).lower(): r.get("field_id") for r in rows}
        if field[1] in values:
            scope["field_id"] = values[field[1]]
        elif field[1] not in {"and", "in", "water", "year", "data", "measurements"}:
            unknown = True
    year = re.search(r"\b(19[0-9]{2}|20[0-9]{2}|21[0-9]{2})\b", t)
    if year:
        value = int(year[1])
        if any(r.get("planning_year_slot") == value for r in rows):
            scope.pop("source_year", None); scope["planning_year_slot"] = value
        elif any(r.get("source_year") == value for r in rows):
            scope.pop("planning_year_slot", None); scope["source_year"] = value
        else:
            unknown = True
    ordinal = re.search(r"\byear\s+([1-5])\b", t)
    words = re.search(r"\b(first|second|third|fourth|fifth)\s+year\b|\byear\s+(one|two|three|four|five)\b", t)
    index = int(ordinal[1])-1 if ordinal else (["first", "second", "third", "fourth", "fifth"].index(words[1]) if words[1] else ["one", "two", "three", "four", "five"].index(words[2])) if words else None
    if index is not None:
        scope.pop("crop_use_id", None)
        years = sorted({r.get("source_year") for r in rows if type(r.get("source_year")) is int})
        if index < len(years):
            scope.pop("planning_year_slot", None); scope["source_year"] = years[index]
        else:
            unknown = True
    for crop in ("potato", "sugarbeet", "sugar_beet", "wheat", "chickpea", "barley", "fallow"):
        if re.search(r"\b" + crop + r"\b", t):
            known = {r.get("crop_use_id") for r in rows if crop in str(r.get("crop_use_id", "")).lower()}
            if len(known) == 1:
                scope["crop_use_id"] = next(iter(known))
            else:
                unknown = True
    if "low" in t or "high" in t or "point" in t:
        for tag in ("LOW", "POINT", "HIGH"):
            if re.search(r"\b" + tag.lower() + r"\b", t):
                scope["uncertainty_scenario"] = tag
    if "uncertainty_scenario" in scope and scope["uncertainty_scenario"] not in {"LOW", "POINT", "HIGH"}:
        unknown = True
    if intent == "compare":
        scope.pop("policy_id", None)
        if re.search(r"those two|both alternatives|two alternatives",t):scope.pop("crop_use_id",None)
    # Match only field-year keys here; uncertainty belongs to the nested annual rows.
    relevant = {k: v for k, v in scope.items() if k != "uncertainty_scenario"}
    if relevant and not any(all(r.get(k) == v for k, v in relevant.items()) for r in rows):
        unknown = True
    return scope, unknown
