/**
 * Canonical `astragron.growth-rotation-decision.request.v1` builder for the ONLY
 * qualified crop-rotation site in the frozen engine: NL_WAGENINGEN_GROWTH [5.67, 51.97].
 *
 * All P/K control quantities match `core/examples/engine/growth_producing.json` verbatim so
 * `growth_decision.admit` -> `growth_rotation.candidates` (GENERATE 162 -> 2) ->
 * `producing_worker` (PCSE/WOFOST 8.1) -> `growth_rotation.rank` executes without fabricating parameters.
 */

const SOIL_CONTROL_SOURCE_ID = 'NL_DECLARED_PK_CONTROL';
const SOIL_CONTROL_TIMESTAMP = '2016-01-01T00:00:00+00:00';
const SOIL_CONTROL_INTERPRETATION =
  'Explicit numerical-control quantity, not measured or field-calibrated';

const NL_CROP_IDS = [
  'research:NL:potato_Fontane',
  'research:NL:sugarbeet_601',
  'research:NL:spring_barley_301',
] as const;

const NL_LAYER_DEFS = [
  { layer_id: 'L1', depth_mm: [0, 250] as [number, number] },
  { layer_id: 'L2', depth_mm: [250, 400] as [number, number] },
  { layer_id: 'L3', depth_mm: [400, 600] as [number, number] },
  { layer_id: 'L4', depth_mm: [600, 1200] as [number, number] },
];

const POOL_UNITS: ReadonlyArray<readonly [string, string]> = [
  ['NO3_N', 'kg N/ha'],
  ['NH4_N', 'kg N/ha'],
  ['P_INVENTORY', 'kg P/ha'],
  ['K_INVENTORY', 'kg K/ha'],
  ['CROP_N', 'kg N/ha'],
  ['CROP_P', 'kg P/ha'],
  ['CROP_K', 'kg K/ha'],
  ['RESIDUE_N', 'kg N/ha'],
  ['RESIDUE_P', 'kg P/ha'],
  ['RESIDUE_K', 'kg K/ha'],
];

function controlQuantity(
  value: string,
  unit: string,
  layerId: string,
  depthMm: [number, number]
) {
  return {
    value,
    unit,
    source_id: SOIL_CONTROL_SOURCE_ID,
    field_id: 'ALL_FIELDS',
    layer_id: layerId,
    depth_mm: depthMm,
    timestamp: SOIL_CONTROL_TIMESTAMP,
    sampling_date: null,
    uncertainty: {
      low: value,
      high: value,
      interpretation: SOIL_CONTROL_INTERPRETATION,
    },
    blocker: null,
  };
}

function buildLayerState(
  layerId: string,
  depthMm: [number, number],
  overrides: Record<string, string>
) {
  const pools: Record<string, ReturnType<typeof controlQuantity>> = {};
  for (const [poolName, unit] of POOL_UNITS) {
    pools[poolName] = controlQuantity(overrides[poolName] ?? '0', unit, layerId, depthMm);
  }
  return {
    layer_id: layerId,
    depth_mm: depthMm,
    pools,
  };
}

function buildScenarioInitialLayers(l1Overrides: Record<string, string>) {
  return NL_LAYER_DEFS.map((layer, idx) =>
    buildLayerState(layer.layer_id, layer.depth_mm, idx === 0 ? l1Overrides : {})
  );
}

function buildCropBudget(cropId: string, cultivar: string) {
  const l1: [string, [number, number]] = ['L1', [0, 250]];
  return {
    crop_id: cropId,
    cultivar,
    layer_id: 'L1',
    phenology_basis: 'ACTUAL_ADMITTED_HARVEST_DATE',
    uptake: {
      NO3_N: controlQuantity('0', 'kg N/ha', ...l1),
      NH4_N: controlQuantity('0', 'kg N/ha', ...l1),
      P_INVENTORY: controlQuantity('10', 'kg P/ha', ...l1),
      K_INVENTORY: controlQuantity('15', 'kg K/ha', ...l1),
    },
    export_fraction: {
      N: controlQuantity('0', 'fraction', ...l1),
      P: controlQuantity('0.7', 'fraction', ...l1),
      K: controlQuantity('0.7', 'fraction', ...l1),
    },
  };
}

export function buildWageningenProducingPayload(options?: {
  farmId?: string;
  asOf?: string;
}): Record<string, unknown> {
  const farmId = options?.farmId || 'NL_THREE_CROP_PRODUCING_RESEARCH';
  const asOf = options?.asOf || '2026-11-14T07:37:36.869462+00:00';

  const standardL1 = { NO3_N: '30', NH4_N: '5', P_INVENTORY: '50', K_INVENTORY: '100' };
  const lowNitrogenL1 = { NO3_N: '0', NH4_N: '0', P_INVENTORY: '50', K_INVENTORY: '100' };

  return {
    schema: 'astragron.client-decision.request.v1',
    farm_id: farmId,
    engine_request: {
      schema: 'astragron.research-decision.request.v1',
      mode: 'RESEARCH_SCENARIO',
      research_acknowledged: true,
      location: {
        site_id: 'NL_WAGENINGEN_GROWTH',
        country: 'NL',
        jurisdiction: 'NL (declared research point; rights unverified)',
        point_lon_lat: [5.67, 51.97],
        crs: 'EPSG:4326',
      },
      as_of: asOf,
      horizon_years: 5,
      planning_start_year: 2027,
      units: {
        area: 'ha',
        depth: 'mm',
        soil_depth: 'm',
        water_volume: 'm3',
        temperature: 'C',
        time_standard: 'UTC',
      },
      fields: [
        {
          field_id: 'F1',
          area_ha: 1,
          area_basis: 'USER_RESEARCH_ASSUMPTION',
          irrigation_access: false,
          history: [],
          crop_candidates: [...NL_CROP_IDS],
          rotation_constraints: {
            minimum_return_gap_slots: {
              'research:NL:potato_Fontane': 3,
              'research:NL:sugarbeet_601': 3,
              'research:NL:spring_barley_301': 1,
            },
          },
          soil: {
            layer_thickness_m: [0.25, 0.15, 0.2, 0.6],
          },
        },
      ],
      crop_profiles: {},
      supply: {
        annual_farm_source_m3: 0,
        source_daily_m3: 0,
        pump_daily_m3: 0,
        rights_basis: 'ASSUMED_NOT_VERIFIED',
      },
      candidates: [],
      scenarios: [
        {
          scenario_id: 'REFERENCE',
          start: '2016-01-01',
          end: '2020-12-31',
          rain_factor: 1,
          supply_overrides: {},
        },
        {
          scenario_id: 'LOW_INITIAL_MINERAL_N',
          start: '2016-01-01',
          end: '2020-12-31',
          rain_factor: 1,
          supply_overrides: {},
        },
        {
          scenario_id: 'HALF_RAIN',
          start: '2016-01-01',
          end: '2020-12-31',
          rain_factor: 0.5,
          supply_overrides: {},
        },
      ],
      preference: null,
      search: {
        max_candidates: 2,
        max_evaluations: 6,
        max_generated: 2,
        max_wall_seconds: 240,
        max_cpu_seconds: 240,
        seed: 0,
      },
      assumptions_manifest: [
        {
          id: 'native_process_research',
          evidence_class: 'USER_RESEARCH_ASSUMPTION',
          source:
            'Pinned Netherlands Fontane/Sugarbeet_601 parameters and teaching-example soil are an uncalibrated process experiment. Water 300mm, CO2 400ppm, annual April21/September24 calendar and area 1ha are explicit research assumptions, not measurements. Identical P/K budgets for both crop labels reuse numerical controls, not physiological removal coefficients. Native SNOMIN exclusively owns N.; barley immutable upstream 1ca91d7; WUR CGN cereal months; root-soil setup adapter.',
          license:
            'Small cited numerical facts with source attribution; engineering scenario supplied under user authorization for private research; no reproduction license asserted for full FAO/NSW publications',
          available_at: '2026-11-13T22:00:27+00:00',
          units: {
            Kc: '1',
            roots_layers: 'm',
            FC_WP: 'm3/m3',
            rain_ET_storage: 'mm',
            source_water: 'm3',
            area: 'ha',
            time: 'UTC daily / fixed calendar dates',
          },
          uncertainty:
            'Original unmeasured teaching soil and initial states, fixed CO2, declared source-consistent crop calendars. Producing research sequence; no local field validation or plant-health clearance.',
          applies_to: ['all declared field and scenario inputs'],
        },
      ],
      source: {
        provider: 'NASA_POWER_GLOBAL',
        enabled: true,
        acquisition: 'CACHE_ONLY',
        snapshot_policy: 'REQUEST_CUTOFF',
        historical_start: '2016-01-01',
        historical_end: '2020-12-31',
      },
      require_N: false,
      require_yield: false,
      economic_sidecar: null,
      extensions: {
        soil_memory: {
          schema: 'astragron.soil-memory.request.v1',
          enabled: true,
          acknowledgment: 'EXPLICIT_CONDITIONAL_ELEMENT_BUDGET_NOT_FIELD_RESPONSE',
          sources: [
            {
              id: 'NL_DECLARED_PK_CONTROL',
              evidence_class: 'RESEARCH_ASSUMPTION',
              source_uri: 'operator-scenario:NL-three-crop-identical-PK-accounting-control',
              factual_scope:
                'Synthetic operator-declared identical annual P/K inventory withdrawals for all three labels, solely an accounting control. These are not barley or root-crop uptake/removal coefficients or measurements. Auxiliary N placeholders never enter native N physiology.',
              license: 'Private authorized engineering scenario; no new public license or field-data rights asserted',
              available_at: '2026-11-13T22:00:27+00:00',
              geographic_scope: {
                site_id: 'NL_WAGENINGEN_GROWTH',
                country: 'NL',
                point_lon_lat: [5.67, 51.97],
              },
              crop_scope: [...NL_CROP_IDS],
              cultivar_scope: 'Fontane / Sugarbeet_601 / Spring_barley_301 labels; P/K biological response is not modeled',
              parameter_version: 'declared-pk-v1',
              uncertainty: 'Exact declared point inputs; no calibrated bounds',
              source_sha256: '70195fc32025131f56d313dcf07d7c02578970b3775faca2481eda809cb8f805',
            },
          ],
          initial_states: {
            REFERENCE: { F1: buildScenarioInitialLayers(standardL1) },
            LOW_INITIAL_MINERAL_N: { F1: buildScenarioInitialLayers(lowNitrogenL1) },
            HALF_RAIN: { F1: buildScenarioInitialLayers(standardL1) },
          },
          crop_budgets: {
            'research:NL:potato_Fontane': buildCropBudget('research:NL:potato_Fontane', 'Fontane'),
            'research:NL:sugarbeet_601': buildCropBudget('research:NL:sugarbeet_601', 'Sugarbeet_601'),
            'research:NL:spring_barley_301': buildCropBudget('research:NL:spring_barley_301', 'Spring_barley_301'),
          },
          process_coverage: {
            fertilizer: 'EXPLICIT_RESEARCH_ZERO',
            manure: 'EXPLICIT_RESEARCH_ZERO',
            atmospheric_deposition: 'EXPLICIT_RESEARCH_ZERO',
            fixation: 'EXPLICIT_RESEARCH_ZERO',
            mineralization: 'EXPLICIT_RESEARCH_ZERO',
            nitrification: 'EXPLICIT_RESEARCH_ZERO',
            leaching: 'EXPLICIT_RESEARCH_ZERO',
            denitrification: 'EXPLICIT_RESEARCH_ZERO',
            harvest: 'DECLARED_EVENTS_ONLY',
            residue_fate: 'DECLARED_EVENTS_ONLY',
            P_inputs: 'EXPLICIT_RESEARCH_ZERO',
            K_inputs: 'EXPLICIT_RESEARCH_ZERO',
          },
          management_events: [],
          observations: [],
          uncertainty_scenarios: ['POINT'],
          max_daily_steps: 200,
          constraint: {
            version: 'DECLARED_TERMINAL_INVENTORY_V1',
            enabled: false,
            minimum_terminal: {},
            source_id: 'NL_DECLARED_PK_CONTROL',
            justification: 'No minimum P/K filter imposed in this numerical control; inventories are not plant availability.',
          },
          parameter_id: 'c0b5d4a67e48bdc6d8e3cb718147e2cec6f993aab10ce1e987aeb81312c4fae2',
        },
      },
    },
    features: {
      soil_memory: true,
      nutrient_response: true,
    },
    growth_decision: {
      schema: 'astragron.growth-rotation-decision.request.v1',
      profile_id: 'wageningen-three-crop-producing-research-v1',
      objective: {
        version: 'FIVE_YEAR_THREE_CROP_SERVICE_N_LOSS_VECTOR_V1',
        criterion: 'pareto',
        target_years: [2016, 2017, 2018, 2019, 2020],
        acknowledgment: 'SEPARATE_CROP_DRY_MATTER_SERVICES_AND_N_LOSS_NOT_OVERALL_FARM_VALUE',
      },
      scenarios: [
        { scenario_id: 'REFERENCE', initial_mineral_N_factor: 1 },
        { scenario_id: 'LOW_INITIAL_MINERAL_N', initial_mineral_N_factor: 0 },
        { scenario_id: 'HALF_RAIN', initial_mineral_N_factor: 1 },
      ],
      constraints: {
        max_modeled_N_leaching: null,
      },
      pk_scope: 'DECLARED_P_K_ONLY_NATIVE_N_FROM_PCSE',
      rotation: {
        version: 'BOUNDED_THREE_CROP_PRODUCTION_SCREEN_V1',
        mode: 'GENERATE',
        year_options: [
          ['research:NL:potato_Fontane', 'research:NL:sugarbeet_601'],
          [...NL_CROP_IDS],
          [...NL_CROP_IDS],
          [...NL_CROP_IDS],
          [...NL_CROP_IDS],
        ],
        minimum_crop_slots: {
          'research:NL:potato_Fontane': 1,
          'research:NL:sugarbeet_601': 1,
          'research:NL:spring_barley_301': 2,
        },
        profile_acknowledgment: 'SOURCE_PINNED_THREE_CROP_RESEARCH_NOT_FIELD_VALIDATION',
      },
    },
  };
}
