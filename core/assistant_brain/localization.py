"""Message catalog is separate from retrieval and validation; English is enabled."""
MESSAGES = {"en": {
    "plan": "These are the crop choices evaluated for the attached field and historical weather scenario.",
    "why": "The engine's declared selection criterion and research alternative are shown below. Service compliance and nutrient constraints must be considered separately; a selected option may still violate a constraint.",
    "compare": "Compare the engine-reported alternatives side by side below. Values refer to their stated scenarios and units; no new difference or ranking is calculated here.",
    "water": "Water shortfall measures modeled unmet evapotranspiration demand. It is not predicted yield loss or an irrigation prescription. Rainfall multipliers are declared interventions on historical weather.",
    "nutrients": "These balances track declared elemental nitrogen, phosphorus and potassium inventories. Initial stocks and transfers depend on supplied assumptions. LOW, POINT and HIGH are explicit input scenarios, not confidence probabilities.",
    "risk": "The analysis remains conditional research. The listed evidence restrictions limit what can be concluded from the model outputs.",
    "missing": "Review the reported missing-evidence paths below. Local crop calendars, soil profile and initial stocks, water delivery measurements and independent crop-response observations can improve qualification; the report does not establish their values.",
    "sources": "Each evidence reference below points to an exact location in the attached, hashed analysis. Regional weather data are not parcel measurements. Assumed inputs remain assumptions.",
    "unsupported": "The available analysis cannot establish marketable yield, profit, pesticide permissions or a field-qualified recommendation. No estimate or prescription is generated.",
    "what_if": "A changed assumption requires an approved backend calculation. Supported operations create a separate analysis and preserve the attached original.",
    "no_scope": "The requested field, crop, year or scenario is not present in this analysis. Select an available context before interpreting results.",
    "conflict": "The attached report contains missing or contradictory evidence. Scientific claims are withheld until the data are reconciled.",
    "blocked": "Required evidence is missing, so this result cannot support a crop recommendation. Any displayed quantities are diagnostic only.",
}}

def message(locale, key):
    return MESSAGES[locale][key]
