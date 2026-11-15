"""Capability dependency graph (C1-C10) and non-negotiable scientific guardrails.

Models the per-capability dependency graph for `astragron.adaptive-evidence.v1`
instead of a single global readiness boolean.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple

CAPABILITY_STATUSES = (
    "READY",
    "CONDITIONAL",
    "BLOCKED",
    "NOT_EVALUATED",
)

PARAMETER_PROVENANCE_CLASSES = (
    "OBSERVED_OR_AUTHENTIC_SOURCE",
    "DERIVED_WITH_VALIDATED_METHOD",
    "USER_SCENARIO_ASSUMPTION",
    "NOT_RETRIEVABLE",
    "OFFICIAL_VERIFICATION_REQUIRED",
)

MISSING_REASONS = (
    "source_outage",
    "unsupported_region",
    "insufficient_parameters",
    "spatial_mismatch",
    "temporal_mismatch",
    "quality_fail",
    "license_unverified",
    "not_identifiable",
    "ocean_or_non_land_cell",
    "land_status_unverified",
    "invalid_coordinates_or_crs",
    "depth_inconsistency",
    "corrupt_receipt_or_hash_mismatch",
    "stale_or_post_cutoff_snapshot",
    "prohibited_derivation_blocked",
    "official_local_verification_required",
    "official_verification_required",
    "estimator_out_of_domain",
    "unsupported_crop_profile",
    "nodata",
    "runtime_dependency_unavailable",
    "point_pixel_missing",
    "geo_distance_exceeded",
    "mixed_source_support",
    "spatial_uncertain",
    "incomplete_data",
    "no_data",
    "source_blocked",
    "depth_interval_unavailable",
    "time_standard_mismatch",
)

FORBIDDEN_DERIVATIONS = {
    "MINERAL_N_FROM_SOILGRIDS_TOTAL_N": (
        "Never derive farm-level mineral N (NO3/NH4) or plant-available N from "
        "SoilGrids total nitrogen maps; mineralization depends on dynamic moisture, "
        "temperature, management, and C:N history."
    ),
    "WATER_RIGHTS_FROM_REMOTE_SENSING": (
        "Never infer legal water extraction rights or allocation caps from "
        "satellite imagery, climate grids, or self-declaration."
    ),
    "PESTICIDE_OR_LEGAL_CLEARANCE_INFERENCE": (
        "Never infer pesticide authorization, dosage legality, or regulatory "
        "compliance without verified official local registries."
    ),
    "INVENTED_CROP_PHYSIOLOGY_COEFFICIENTS": (
        "Never fabricate crop Kc, stage durations, rooting depths, or WOFOST/PCSE "
        "cultivar parameters for unsupported crops."
    ),
    "SIMULATED_DM_TO_MARKETABLE_YIELD_OR_PROFIT": (
        "Never convert modeled storage-organ dry matter or water deficit into "
        "calibrated marketable yield or profit without independent field-validated "
        "conversion and dated price/cost evidence."
    ),
    "NULL_TO_ZERO_COERCION": (
        "Never coerce null, missing, or unverified quantities into numeric zero."
    ),
}


@dataclass(frozen=True)
class CapabilityDefinition:
    capability_id: str
    name: str
    short_label: str
    upstream_dependencies: Tuple[str, ...]
    required_parameters: Tuple[str, ...]
    admissible_provenance_classes: Tuple[str, ...]
    supported_claims_when_ready_or_conditional: Tuple[str, ...]
    strictly_prohibited_claims: Tuple[str, ...]
    farmer_explanation_template: str
    default_next_action: str
    can_proceed_independently_of_planner: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "capability_id": self.capability_id,
            "name": self.name,
            "short_label": self.short_label,
            "upstream_dependencies": list(self.upstream_dependencies),
            "required_parameters": list(self.required_parameters),
            "admissible_provenance_classes": list(self.admissible_provenance_classes),
            "supported_claims_when_ready_or_conditional": list(
                self.supported_claims_when_ready_or_conditional
            ),
            "strictly_prohibited_claims": list(self.strictly_prohibited_claims),
            "farmer_explanation_template": self.farmer_explanation_template,
            "default_next_action": self.default_next_action,
            "can_proceed_independently_of_planner": self.can_proceed_independently_of_planner,
            "ready_implies_field_validated": False,
        }


CAPABILITY_REGISTRY: Dict[str, CapabilityDefinition] = {
    "C1": CapabilityDefinition(
        capability_id="C1",
        name="Coordinates, land/geographic identity and source coverage",
        short_label="Geographic & Land Identity",
        upstream_dependencies=(),
        required_parameters=(
            "location.point_lon_lat",
            "location.crs",
            "location.land_mask_status",
        ),
        admissible_provenance_classes=(
            "OBSERVED_OR_AUTHENTIC_SOURCE",
            "USER_SCENARIO_ASSUMPTION",
        ),
        supported_claims_when_ready_or_conditional=(
            "Validated WGS84 (EPSG:4326) coordinate bounds and geometry consistency",
            "Terrestrial land-cell vs. open-ocean/ice-sheet screening",
            "Regional data provider grid-cell mapping and spatial support metadata",
        ),
        strictly_prohibited_claims=(
            "Cadastral parcel ownership or legal boundary survey verification",
            "Field-level micro-topography or drainage infrastructure certification",
        ),
        farmer_explanation_template=(
            "Your farm coordinates are valid and map to a terrestrial land area "
            "where regional weather and soil screening datasets can be queried."
        ),
        default_next_action=(
            "Provide valid EPSG:4326 [longitude, latitude] coordinates on land."
        ),
    ),
    "C2": CapabilityDefinition(
        capability_id="C2",
        name="Historical regional climate profile and limitations",
        short_label="Historical Regional Climate",
        upstream_dependencies=("C1",),
        required_parameters=(
            "climate.T2M",
            "climate.T2M_MIN",
            "climate.T2M_MAX",
            "climate.PRECTOTCORR",
            "climate.period_utc",
        ),
        admissible_provenance_classes=("OBSERVED_OR_AUTHENTIC_SOURCE",),
        supported_claims_when_ready_or_conditional=(
            "Multi-year historical daily temperature and precipitation statistics from NASA POWER (MERRA-2)",
            "Seasonal rainfall distribution, dry/wet historical year envelopes, and frost-day frequency",
            "Conditional Hargreaves-Samani reference evapotranspiration (ET0) screening",
        ),
        strictly_prohibited_claims=(
            "Deterministic future weather forecast for upcoming seasons",
            "Local on-farm weather station measurement equivalence",
        ),
        farmer_explanation_template=(
            "Historical regional satellite and reanalysis weather (NASA POWER, ~50 km grid) "
            "is available to show past rainfall and temperature patterns, though it is not "
            "an on-farm weather station or a future weather forecast."
        ),
        default_next_action=(
            "Fetch or load an authenticated historical NASA POWER snapshot for this location."
        ),
    ),
    "C3": CapabilityDefinition(
        capability_id="C3",
        name="Soil property screening with depth, spatial resolution and uncertainty",
        short_label="Regional Soil Property Screening",
        upstream_dependencies=("C1",),
        required_parameters=(
            "soil.clay_g_kg",
            "soil.sand_g_kg",
            "soil.silt_g_kg",
            "soil.bdod_kg_dm3",
            "soil.cfvo_cm3_dm3",
            "soil.soc_dg_kg",
            "soil.phh2o",
            "soil.depth_intervals_cm",
        ),
        admissible_provenance_classes=(
            "OBSERVED_OR_AUTHENTIC_SOURCE",
            "USER_SCENARIO_ASSUMPTION",
        ),
        supported_claims_when_ready_or_conditional=(
            "Depth-stratified soil texture (clay, silt, sand), bulk density, coarse fragments, SOC, and pH screening",
            "Spatial resolution (250 m ISRIC SoilGrids v2.0) and quantile uncertainty (Q0.05, Q0.50, Q0.95) reporting",
        ),
        strictly_prohibited_claims=(
            "Direct field laboratory soil test equivalence when using SoilGrids",
            "Available mineral nitrogen (NO3/NH4) or plant-available P/K from total N or texture",
        ),
        farmer_explanation_template=(
            "Regional modeled soil layers (ISRIC SoilGrids 250 m) or user soil records provide "
            "an initial picture of soil texture, organic carbon, and pH by depth, with explicit "
            "uncertainty ranges. They do not replace a local laboratory soil test."
        ),
        default_next_action=(
            "Retrieve ISRIC SoilGrids v2.0 depth-layer profiles or supply dated laboratory soil test results."
        ),
    ),
    "C4": CapabilityDefinition(
        capability_id="C4",
        name="Derived hydrologic soil-property range, only if a qualified estimator applies",
        short_label="Derived Soil Hydraulic Range",
        upstream_dependencies=("C1", "C3"),
        required_parameters=(
            "hydraulics.theta_fc_m3_m3",
            "hydraulics.theta_wp_m3_m3",
            "hydraulics.awc_mm_m",
            "hydraulics.estimator_domain_valid",
        ),
        admissible_provenance_classes=(
            "OBSERVED_OR_AUTHENTIC_SOURCE",
            "DERIVED_WITH_VALIDATED_METHOD",
            "USER_SCENARIO_ASSUMPTION",
        ),
        supported_claims_when_ready_or_conditional=(
            "Physically bounded field capacity (theta_fc), wilting point (theta_wp), saturation (theta_s), and coarse-fragment-adjusted available water capacity (AWC) range",
            "Published pedotransfer function (Saxton & Rawls 2006 / Van Genuchten) low/reference/high envelope",
        ),
        strictly_prohibited_claims=(
            "Direct field tensiometer or pressure-plate hydraulic calibration",
            "Unbounded extrapolation to organic peats (OM > 8 wt%), extreme clays (> 60%), or bedrock layers",
        ),
        farmer_explanation_template=(
            "Using your soil texture, organic matter, bulk density, and gravel fraction, "
            "a published soil-water equation estimates how much water the root zone can hold "
            "between field capacity and wilting point across low, reference, and high scenarios."
        ),
        default_next_action=(
            "Verify soil texture/SOC/bulk density stay within pedotransfer validity bounds or measure field water retention directly."
        ),
    ),
    "C5": CapabilityDefinition(
        capability_id="C5",
        name="Regional crop suitability screening from a licensed and accessible source, if actually obtained",
        short_label="Regional Crop Suitability Screening",
        upstream_dependencies=("C1",),
        required_parameters=(
            "suitability.source_receipt",
            "suitability.crop_id",
            "suitability.input_level",
            "suitability.water_supply_regime",
            "suitability.license_verified",
        ),
        admissible_provenance_classes=("OBSERVED_OR_AUTHENTIC_SOURCE",),
        supported_claims_when_ready_or_conditional=(
            "Regional agro-ecological suitability class screening (~9 km grid) under declared input/water assumptions",
        ),
        strictly_prohibited_claims=(
            "Calibrated farm-level crop yield prediction or local variety recommendation",
            "Unlicensed or fabricated FAO GAEZ live data substitution",
        ),
        farmer_explanation_template=(
            "Regional agro-ecological suitability maps indicate broad regional climate/terrain "
            "compatibility when a verified licensed source snapshot is present, but never predict "
            "your specific field's yield."
        ),
        default_next_action=(
            "Provide a license-verified FAO GAEZ v5 regional suitability extract or rely on explicit crop/climate diagnostics."
        ),
    ),
    "C6": CapabilityDefinition(
        capability_id="C6",
        name="Historical water-demand/deficit research diagnostics with qualified inputs",
        short_label="Historical Water-Demand Diagnostics",
        upstream_dependencies=("C1", "C2", "C4"),
        required_parameters=(
            "water_diag.climate_series",
            "water_diag.hydraulic_range",
            "water_diag.crop_or_reference_et_profile",
        ),
        admissible_provenance_classes=(
            "OBSERVED_OR_AUTHENTIC_SOURCE",
            "DERIVED_WITH_VALIDATED_METHOD",
            "USER_SCENARIO_ASSUMPTION",
        ),
        supported_claims_when_ready_or_conditional=(
            "Historical reference evapotranspiration (ET0) vs. precipitation deficit distribution",
            "Root-zone soil moisture buffer range and drought-stress exposure under historical weather scenarios",
        ),
        strictly_prohibited_claims=(
            "Guaranteed future irrigation volume sufficiency or legal water abstraction approval",
        ),
        farmer_explanation_template=(
            "Combining historical NASA weather with your soil's estimated water-holding range "
            "shows seasonal water demand, rainfall shortfall, and drought sensitivity across past dry and wet years."
        ),
        default_next_action=(
            "Ensure historical climate (C2) and soil hydraulic bounds (C4) are available; add crop calendar/Kc for crop-specific ET."
        ),
    ),
    "C7": CapabilityDefinition(
        capability_id="C7",
        name="Regional crop water suitability screening (C7_SCREENING; not a 5-year rotation plan)",
        short_label="C7_SCREENING (Regional Water Suitability)",
        upstream_dependencies=("C1", "C2", "C4", "C6"),
        required_parameters=(
            "screening.candidate_crops",
            "screening.water_supply_scenario",
            "screening.climate_series",
            "screening.hydraulic_range",
        ),
        admissible_provenance_classes=(
            "OBSERVED_OR_AUTHENTIC_SOURCE",
            "DERIVED_WITH_VALIDATED_METHOD",
            "USER_SCENARIO_ASSUMPTION",
        ),
        supported_claims_when_ready_or_conditional=(
            "Seasonal regional crop water-adequacy ranking under historical weather and PTF soil-water bounds",
            "Decision-sensitivity classification (DECISION_SENSITIVE, DECISION_STABLE_WITHIN_TESTED_SCENARIOS, UNDETERMINED) across soil/climate uncertainty",
        ),
        strictly_prohibited_claims=(
            "Multi-year rotation optimization, 5-year farm plan, or WOFOST/CP-SAT planner substitute",
            "Global agronomic optimum or field-validated commercial rotation prescription",
            "Silently substituting unsupported crops or inferring rainfed regime from missing water info",
        ),
        farmer_explanation_template=(
            "Ranks supported crops by seasonal water adequacy against historical weather and soil water-holding bounds "
            "as a screening aid only; never a multi-year rotation plan or farm-ready prescription."
        ),
        default_next_action=(
            "To generate a verified 5-year rotation plan, supply complete local calibration to the canonical ClientDecisionService planner."
        ),
        can_proceed_independently_of_planner=False,
    ),
    "C8": CapabilityDefinition(
        capability_id="C8",
        name="Native crop-growth and nutrient-response research only for validated model input coverage",
        short_label="Native Crop-Growth & N Research",
        upstream_dependencies=("C1", "C2"),
        required_parameters=(
            "growth.profile_id",
            "growth.point_lon_lat_5_67_51_97",
            "growth.complete_8var_nasa_forcing",
            "growth.admitted_crops_potato_sugarbeet",
            "growth.pinned_pcse_runtime",
        ),
        admissible_provenance_classes=("OBSERVED_OR_AUTHENTIC_SOURCE",),
        supported_claims_when_ready_or_conditional=(
            "Coupled WOFOST 8.1 / SNOMIN daily crop dry matter and soil N process research for [5.67, 51.97] (NL, 2016-2020, Fontane potato / Sugarbeet_601)",
        ),
        strictly_prohibited_claims=(
            "Worldwide crop physiology transfer outside the admitted Wageningen research profile",
            "Field-validated yield prediction, marketable fresh tuber/root yield, or fertilizer prescription",
        ),
        farmer_explanation_template=(
            "Native daily crop-growth and soil-nitrogen simulation (WOFOST/SNOMIN) is restricted "
            "to the validated Dutch research benchmark [5.67, 51.97] for potato and sugarbeet with "
            "complete solar/weather forcing and pinned PCSE runtime; it is blocked elsewhere rather than faked."
        ),
        default_next_action=(
            "Use the admitted Wageningen research profile [5.67, 51.97] with cached 8-variable NASA forcing and pinned PCSE environment, or abstain from native growth simulation."
        ),
        can_proceed_independently_of_planner=False,
    ),
    "C9": CapabilityDefinition(
        capability_id="C9",
        name="Optional conditional economics using user-supplied or licensed and dated price/cost/yield sources",
        short_label="Conditional Scenario Economics",
        upstream_dependencies=("C1",),
        required_parameters=(
            "economics.currency",
            "economics.basis",
            "economics.source_id",
            "economics.available_at",
            "economics.uncertainty",
            "economics.rows_yield_price_cost",
        ),
        admissible_provenance_classes=("USER_SCENARIO_ASSUMPTION",),
        supported_claims_when_ready_or_conditional=(
            "Conditional scenario margin arithmetic: area_ha * (supplied_yield_t_ha * supplied_price_per_t - supplied_cost_per_ha)",
        ),
        strictly_prohibited_claims=(
            "Model-predicted commercial profit or market price forecasting",
            "Altering biophysical water/soil feasibility rankings based on unverified economic assumptions",
        ),
        farmer_explanation_template=(
            "Calculates conditional gross margins only when you explicitly supply your own expected "
            "yields, crop prices, and per-hectare costs with dates and currency; missing values remain null, never zero."
        ),
        default_next_action=(
            "Supply explicit dated farm yield_t_ha, price_per_t, and cost_per_ha rows in one ISO currency."
        ),
    ),
    "C10": CapabilityDefinition(
        capability_id="C10",
        name="Pesticide, water-right and legal clearance",
        short_label="Legal, Water-Right & Pesticide Clearance",
        upstream_dependencies=("C1",),
        required_parameters=(
            "legal.official_water_abstraction_permit",
            "legal.official_pesticide_registration_authority",
            "legal.environmental_compliance_certificate",
        ),
        admissible_provenance_classes=("OFFICIAL_VERIFICATION_REQUIRED",),
        supported_claims_when_ready_or_conditional=(),
        strictly_prohibited_claims=(
            "Inferring water abstraction rights, pesticide dosage legality, or environmental permits from satellite data or user self-assertion",
        ),
        farmer_explanation_template=(
            "Legal water abstraction rights, pesticide approvals, and regulatory compliance cannot "
            "be determined from satellite or soil data and always require verification with your "
            "official local water and agricultural authorities."
        ),
        default_next_action=(
            "Consult your local water management authority and official national pesticide registration agency."
        ),
    ),
}


def capability_dependency_graph() -> Dict[str, Any]:
    """Return the machine-readable capability dependency DAG and invariants."""
    order = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"]
    edges: List[Dict[str, str]] = []
    for cid in order:
        defn = CAPABILITY_REGISTRY[cid]
        for dep in defn.upstream_dependencies:
            edges.append({"from": dep, "to": cid})
    return {
        "schema": "astragron.capability-dependency-registry.v1",
        "capabilities": {cid: CAPABILITY_REGISTRY[cid].to_dict() for cid in order},
        "topological_order": order,
        "dependency_edges": edges,
        "independent_partial_capabilities": [
            cid
            for cid in order
            if CAPABILITY_REGISTRY[cid].can_proceed_independently_of_planner
        ],
        "planner_gated_capabilities": [
            cid
            for cid in order
            if not CAPABILITY_REGISTRY[cid].can_proceed_independently_of_planner
        ],
        "always_official_verification_required": ["C10"],
        "forbidden_derivations": FORBIDDEN_DERIVATIONS,
        "non_negotiable_rules": {
            "ready_implies_field_validated": False,
            "null_converted_to_zero": False,
            "c7_block_suppresses_c2_or_c3": False,
            "soilgrids_total_n_to_mineral_n_allowed": False,
            "satellite_to_water_rights_allowed": False,
            "simulated_dm_to_marketable_yield_allowed": False,
        },
    }
