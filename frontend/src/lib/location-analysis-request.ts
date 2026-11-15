export type LocationAnalysisMode = 'conditional_water_counterfactual' | 'strict_uncalibrated';

export interface LocationAnalysisSelectionInput {
  siteKey?: string;
  label?: string;
  countryCode?: string;
  regionName?: string;
  lon: number;
  lat: number;
  areaHa?: number;
  mode?: LocationAnalysisMode;
}

export interface ResolvedLocationPoint {
  siteId: string;
  countryCode: string;
  jurisdiction: string;
  pointLonLat: [number, number];
  selectedLonLat: [number, number];
  usedCanonicalBenchmarkCenter: boolean;
  hasCachedNasaPowerForcing: boolean;
  benchmarkNote: string | null;
}

export interface BuiltLocationAnalysisRequest {
  resolvedLocation: ResolvedLocationPoint;
  mode: LocationAnalysisMode;
  payload: Record<string, unknown>;
}

const CACHED_WATER_BENCHMARKS: ReadonlyArray<{
  keys: readonly string[];
  siteId: string;
  countryCode: string;
  jurisdiction: string;
  lon: number;
  lat: number;
  note: string;
}> = [
  {
    keys: ['wagga-australia', 'au_wagga_region', 'au-wagga'],
    siteId: 'AU_WAGGA_REGION',
    countryCode: 'AU',
    jurisdiction: 'AU-NSW (declared reference; parcel and water rights not independently checked)',
    lon: 147.35,
    lat: -35.05,
    note: 'Uses the verified cached NASA POWER grid center [147.35, -35.05] for AU_WAGGA_REGION under explicit conditional counterfactual assumptions.',
  },
  {
    keys: ['nyeri-kenya', 'ke_nyeri_region', 'ke-nyeri'],
    siteId: 'KE_NYERI_REGION',
    countryCode: 'KE',
    jurisdiction: 'KE-Nyeri (declared reference; parcel and water rights not independently checked)',
    lon: 36.95,
    lat: -0.42,
    note: 'Uses the verified cached NASA POWER grid center [36.95, -0.42] for KE_NYERI_REGION under explicit conditional counterfactual assumptions.',
  },
  {
    keys: ['berlin-germany', 'de_berlin_region', 'de-berlin'],
    siteId: 'DE_BERLIN_REGION',
    countryCode: 'DE',
    jurisdiction: 'DE-BE (declared reference; parcel and water rights not independently checked)',
    lon: 13.405,
    lat: 52.52,
    note: 'Uses the verified cached NASA POWER grid center [13.405, 52.52] for DE_BERLIN_REGION under explicit conditional counterfactual assumptions.',
  },
];

function coordsMatch(lonA: number, latA: number, lonB: number, latB: number, eps = 1e-6): boolean {
  return Math.abs(lonA - lonB) <= eps && Math.abs(latA - latB) <= eps;
}

export function sanitizeAsciiText(value: string | undefined, fallback: string, maxLen = 96): string {
  const cleaned = (value || '')
    .replace(/[^A-Za-z0-9 .,;:_()+/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLen).trim() || fallback;
}

export function sanitizeSiteId(value: string | undefined, fallback: string): string {
  const cleaned = (value || '')
    .replace(/[^A-Za-z0-9_:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

export function isValidLonLat(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

export function resolveLocationPoint(input: LocationAnalysisSelectionInput): ResolvedLocationPoint {
  if (!isValidLonLat(input.lon, input.lat)) {
    throw new Error('INVALID_COORDINATES: lon must be in [-180, 180] and lat in [-90, 90].');
  }
  const normalizedKey = (input.siteKey || '').trim().toLowerCase();
  const normalizedCountry = sanitizeAsciiText(input.countryCode, 'XX', 8).toUpperCase().replace(/[^A-Z]/g, '') || 'XX';

  for (const bench of CACHED_WATER_BENCHMARKS) {
    if (bench.keys.includes(normalizedKey) || coordsMatch(input.lon, input.lat, bench.lon, bench.lat)) {
      const shifted = !coordsMatch(input.lon, input.lat, bench.lon, bench.lat);
      return {
        siteId: bench.siteId,
        countryCode: bench.countryCode,
        jurisdiction: bench.jurisdiction,
        pointLonLat: [bench.lon, bench.lat],
        selectedLonLat: [input.lon, input.lat],
        usedCanonicalBenchmarkCenter: shifted,
        hasCachedNasaPowerForcing: true,
        benchmarkNote: shifted
          ? `${bench.note} (Explorer selection was [${input.lon.toFixed(4)}, ${input.lat.toFixed(4)}].)`
          : bench.note,
      };
    }
  }

  if (normalizedKey === 'uppsala-demo' || normalizedKey === 'se_uppsala') {
    return {
      siteId: 'SE_UPPSALA',
      countryCode: 'SE',
      jurisdiction: 'SE-C (declared uncalibrated location; local crop, soil, and NASA cache not qualified)',
      pointLonLat: [input.lon, input.lat],
      selectedLonLat: [input.lon, input.lat],
      usedCanonicalBenchmarkCenter: false,
      hasCachedNasaPowerForcing: false,
      benchmarkNote: 'No local soil/crop calibration or offline NASA POWER cache is registered for Uppsala; canonical D is expected to abstain with EVIDENCE_BLOCKED.',
    };
  }

  const labelFallback = `CUSTOM_${normalizedCountry}_${input.lon.toFixed(2)}_${input.lat.toFixed(2)}`;
  const siteId = sanitizeSiteId(input.siteKey && !input.siteKey.startsWith('coord:') ? input.siteKey : labelFallback, labelFallback);
  const regionLabel = sanitizeAsciiText(input.regionName || input.label, 'Custom coordinates', 72);

  return {
    siteId,
    countryCode: normalizedCountry,
    jurisdiction: `${normalizedCountry} (${regionLabel}; unverified coordinates, parcel, and local data)`,
    pointLonLat: [input.lon, input.lat],
    selectedLonLat: [input.lon, input.lat],
    usedCanonicalBenchmarkCenter: false,
    hasCachedNasaPowerForcing: false,
    benchmarkNote: 'Custom coordinates have no verified local calibration or offline NASA POWER cache; canonical D enforces strict EVIDENCE_BLOCKED gates when evidence is missing.',
  };
}

export function resolveDefaultLocationMode(point: ResolvedLocationPoint): LocationAnalysisMode {
  return point.hasCachedNasaPowerForcing ? 'conditional_water_counterfactual' : 'strict_uncalibrated';
}

export function buildLocationAnalysisRequest(
  input: LocationAnalysisSelectionInput,
  options?: {
    farmId?: string;
    asOf?: string;
  }
): BuiltLocationAnalysisRequest {
  const resolvedLocation = resolveLocationPoint(input);
  const mode: LocationAnalysisMode = input.mode ?? resolveDefaultLocationMode(resolvedLocation);
  const farmId = sanitizeSiteId(options?.farmId, 'engineering-research-example');
  const asOf = options?.asOf || '2026-11-15T00:00:00+00:00';
  const rawArea = Number.isFinite(input.areaHa) ? Number(input.areaHa) : 4;
  const areaHa = Math.min(Math.max(rawArea, 0.1), 1000);

  const manifestId = `explicit_location_counterfactual_${resolvedLocation.countryCode.toLowerCase()}`;
  const cerealId = `research:${resolvedLocation.countryCode}:wheat_surrogate`;
  const legumeId = `research:${resolvedLocation.countryCode}:chickpea_surrogate`;
  const provenanceRef = { manifest_ids: [manifestId] };

  const locationBlock = {
    site_id: resolvedLocation.siteId,
    country: resolvedLocation.countryCode,
    jurisdiction: resolvedLocation.jurisdiction,
    point_lon_lat: resolvedLocation.pointLonLat,
    crs: 'EPSG:4326',
  };

  const sourceBlock = {
    provider: 'NASA_POWER_GLOBAL',
    enabled: true,
    acquisition: 'CACHE_ONLY',
    historical_start: '2011-01-01',
    historical_end: '2025-12-31',
  };

  const scenariosBlock = [
    {
      scenario_id: 'MEDIAN_5Y_TOTAL_2021',
      start: '2021-01-01',
      end: '2025-12-31',
      rain_factor: 1,
      supply_overrides: {},
    },
  ];

  const baseSearch = {
    max_candidates: 2,
    max_evaluations: 2,
    max_generated: 0,
    max_wall_seconds: 60,
    max_cpu_seconds: 60,
    seed: 0,
  };

  if (mode === 'strict_uncalibrated') {
    const earlierId = `research:${resolvedLocation.countryCode}:earlier_sowing_uncalibrated`;
    const laterId = `research:${resolvedLocation.countryCode}:later_sowing_uncalibrated`;

    return {
      resolvedLocation,
      mode,
      payload: {
        schema: 'astragron.client-decision.request.v1',
        farm_id: farmId,
        engine_request: {
          schema: 'astragron.research-decision.request.v1',
          mode: 'RESEARCH_SCENARIO',
          research_acknowledged: true,
          location: locationBlock,
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
              area_ha: areaHa,
              area_basis: 'USER_RESEARCH_ASSUMPTION',
              irrigation_access: false,
              history: [],
              crop_candidates: [earlierId, laterId],
              rotation_constraints: {},
              soil: null,
            },
          ],
          crop_profiles: {},
          winter: null,
          supply: null,
          candidates: [
            {
              label: 'Uncalibrated sowing pattern A (submitted to verify strict qualification gate)',
              choices: {
                F1: [earlierId, laterId, earlierId, laterId, earlierId],
              },
            },
            {
              label: 'Uncalibrated sowing pattern B (submitted to verify strict qualification gate)',
              choices: {
                F1: [laterId, earlierId, laterId, earlierId, laterId],
              },
            },
          ],
          scenarios: scenariosBlock,
          preference: 'minimize_worst_shortfall',
          search: baseSearch,
          assumptions_manifest: [
            {
              id: manifestId,
              evidence_class: 'USER_RESEARCH_ASSUMPTION',
              source: 'User-selected location submitted without fabricated local soil, crop, winter, or irrigation-supply measurements to test genuine engine qualification gates.',
              license: 'Research request metadata only; no external third-party publication redistributed.',
              available_at: asOf,
              units: {
                area: 'ha',
                time: 'UTC daily / fixed calendar dates',
              },
              uncertainty: 'UNQUANTIFIED; soil, crop, winter, and hydraulic supply parameters are absent for this selected point.',
              applies_to: ['selected field boundary and coordinates'],
            },
          ],
          source: sourceBlock,
          require_N: false,
          require_yield: false,
          economic_sidecar: null,
        },
        features: {
          soil_memory: false,
          nutrient_response: false,
        },
      },
    };
  }

  // Conditional water counterfactual: explicit generic FAO56 water priors + location's real NASA POWER grid cell (if cached).
  const isSouthern = resolvedLocation.pointLonLat[1] < 0;
  const plantingMmDd = isSouthern ? '05-15' : '04-01';
  const autumnRootEndMmDd = isSouthern ? '06-01' : '11-01';

  const makeSurrogateProfile = (cropUseId: string) => ({
    crop_use_id: cropUseId,
    phenology: 'SPRING',
    planting_mm_dd: plantingMmDd,
    stage_days: [30, 40, 60, 30],
    kc: [0.3, 1.15, 0.25],
    root_start_m: 0.15,
    root_max_m: 1.3,
    p: 0.55,
    evidence_tier: 'EXPLICIT_IDENTICAL_WATER_SURROGATE_COUNTERFACTUAL; NOT_LOCALLY_CALIBRATED',
    provenance: provenanceRef,
  });

  return {
    resolvedLocation,
    mode,
    payload: {
      schema: 'astragron.client-decision.request.v1',
      farm_id: farmId,
      engine_request: {
        schema: 'astragron.research-decision.request.v1',
        mode: 'RESEARCH_SCENARIO',
        research_acknowledged: true,
        location: locationBlock,
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
            area_ha: areaHa,
            area_basis: 'USER_RESEARCH_ASSUMPTION',
            irrigation_access: false,
            history: [],
            crop_candidates: [cerealId, legumeId],
            rotation_constraints: {},
            soil: {
              layer_thickness_m: [0.25, 1.35],
              theta_fc: 0.15,
              theta_wp: 0.06,
              initial_available_fraction: 0.6,
              bare_Kc: 0.15,
              bare_extraction_depth_m: 0.25,
              runoff_fraction: 0.06,
              capillary_rise_mm_day: 0,
              provenance: provenanceRef,
            },
          },
        ],
        crop_profiles: {
          [cerealId]: makeSurrogateProfile(cerealId),
          [legumeId]: makeSurrogateProfile(legumeId),
        },
        winter: {
          snowfall_Tmean_threshold_C: 0,
          melt_mm_per_C_day: 2,
          frozen_infiltration_fraction: 0.5,
          snow_sublimation_mm_day: 0,
          initial_snow_mm: 0,
          autumn_root_end_mm_dd: autumnRootEndMmDd,
          provenance: provenanceRef,
        },
        supply: {
          annual_farm_source_m3: 6000,
          source_daily_m3: 60,
          pump_daily_m3: 60,
          field_delivered_cap_mm_day: 6,
          conveyance_efficiency: 0.85,
          application_efficiency: 0.75,
          storage_mode: 'DIRECT_NO_RESERVOIR',
          storage_capacity_m3: 0,
          initial_storage_m3: 0,
          rights_basis: 'ASSUMED_NOT_VERIFIED',
          service_limit_crop_ET_deficit_mm_per_harvest_year: 75,
          delivery_windows: [],
          provenance: provenanceRef,
        },
        candidates: [
          {
            label: `${resolvedLocation.siteId}: Continuous cereal water-surrogate counterfactual (not calibrated advice)`,
            choices: {
              F1: [cerealId, cerealId, cerealId, cerealId, cerealId],
            },
          },
          {
            label: `${resolvedLocation.siteId}: Legume-then-cereal water-surrogate counterfactual (no assumed fixation bonus)`,
            choices: {
              F1: [legumeId, cerealId, cerealId, cerealId, cerealId],
            },
          },
        ],
        scenarios: scenariosBlock,
        preference: 'minimize_worst_shortfall',
        search: baseSearch,
        assumptions_manifest: [
          {
            id: manifestId,
            evidence_class: 'USER_RESEARCH_ASSUMPTION',
            source: 'Conditional counterfactual research run using generic FAO56 Table 12/19/22 soil and water-surrogate priors paired with verified offline NASA POWER daily forcing when available for the exact selected coordinate. Not locally calibrated agronomy or yield advice.',
            license: 'Cited scientific parameter priors with attribution; no field dataset rights claimed.',
            available_at: asOf,
            units: {
              Kc: '1',
              roots_layers: 'm',
              FC_WP: 'm3/m3',
              rain_ET_storage: 'mm',
              source_water: 'm3',
              area: 'ha',
              time: 'UTC daily / fixed calendar dates',
            },
            uncertainty: 'UNQUANTIFIED; soil hydraulic parameters, planting windows, and supply caps are declared research assumptions held constant across locations to isolate climate-water forcing differences.',
            applies_to: ['soil', 'crop_profiles', 'winter', 'supply counterfactual priors'],
          },
        ],
        source: sourceBlock,
        require_N: false,
        require_yield: false,
        economic_sidecar: null,
      },
      features: {
        soil_memory: false,
        nutrient_response: false,
      },
    },
  };
}
