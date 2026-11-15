"""Versioned, deliberately unqualified response boundary; no invented physiology."""
SCHEMA = "astragron.nutrient-response.v1"
REQUIRED = [
    "Independent crop/cultivar/site/soil parameter capsule with units, dates, license and hashes",
    "Layer-specific mineral N, hydraulic state and mapped daily water/solute fluxes",
    "Biomass, phenology, root distribution and independently supported N demand/uptake",
    "Qualified transformation/loss rates and uncertainty domain",
    "Held-out crop/site/season observations and applicability review",
]
def evaluate(enabled):
    return {
        "schema": SCHEMA, "status": "EVIDENCE_BLOCKED" if enabled else "DISABLED",
        "provider_id": None, "coupling": "NO_BIOLOGICAL_GROWTH_WATER_COUPLING",
        "inventory_accounting_is_plant_availability": False,
        "biological_uptake": None, "biomass": None, "yield": None, "profit": None,
        "ranking_affected": False, "missing_requirements": REQUIRED if enabled else [],
        "qualification_basis": "Accepted handoff contains no independently qualified numerical crop/site response capsule; no source coefficients admitted.",
    }
