import { buildWageningenProducingPayload } from './wageningen-growth-request';

export type LocationAnalysisMode = 'wageningen_native_growth' | 'strict_uncalibrated';

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
  cropRotationOptimizerQualified: boolean;
  benchmarkNote: string | null;
}

export interface BuiltLocationAnalysisRequest {
  resolvedLocation: ResolvedLocationPoint;
  mode: LocationAnalysisMode;
  payload: Record<string, unknown>;
}

const WAGENINGEN_GROWTH_SITE = {
  keys: ['nl-wageningen', 'nl_wageningen_growth', 'wageningen-nl', 'wageningen'],
  siteId: 'NL_WAGENINGEN_GROWTH',
  countryCode: 'NL',
  jurisdiction: 'NL (declared research point; rights unverified)',
  lon: 5.67,
  lat: 51.97,
  note: 'Only location with source-pinned crop, soil, and 8-variable NASA POWER inputs for live 5-year crop-rotation enumeration (162 -> 2 sequences) and PCSE/WOFOST 8.1 optimization.',
} as const;

const CACHED_CLIMATE_ONLY_BENCHMARKS: ReadonlyArray<{
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
    jurisdiction: 'AU-NSW (declared reference; local crop, soil, and water rights not qualified)',
    lon: 147.35,
    lat: -35.05,
    note: 'Verified offline NASA POWER 4-variable climate exists for [147.35, -35.05], but local crop coefficients, soil hydraulics, winter parameters, and shared supply bounds are absent -> canonical D abstains with EVIDENCE_BLOCKED (zero fabricated rotations).',
  },
  {
    keys: ['nyeri-kenya', 'ke_nyeri_region', 'ke-nyeri'],
    siteId: 'KE_NYERI_REGION',
    countryCode: 'KE',
    jurisdiction: 'KE-Nyeri (declared reference; local crop, soil, and water rights not qualified)',
    lon: 36.95,
    lat: -0.42,
    note: 'Verified offline NASA POWER 4-variable climate exists for [36.95, -0.42], but local crop coefficients, soil hydraulics, winter parameters, and shared supply bounds are absent -> canonical D abstains with EVIDENCE_BLOCKED (zero fabricated rotations).',
  },
  {
    keys: ['berlin-germany', 'de_berlin_region', 'de-berlin'],
    siteId: 'DE_BERLIN_REGION',
    countryCode: 'DE',
    jurisdiction: 'DE-BE (declared reference; local crop, soil, and water rights not qualified)',
    lon: 13.405,
    lat: 52.52,
    note: 'Verified offline NASA POWER 4-variable climate exists for [13.405, 52.52], but local crop coefficients, soil hydraulics, winter parameters, and shared supply bounds are absent -> canonical D abstains with EVIDENCE_BLOCKED (zero fabricated rotations).',
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

  if (
    WAGENINGEN_GROWTH_SITE.keys.some((k) => k === normalizedKey) ||
    coordsMatch(input.lon, input.lat, WAGENINGEN_GROWTH_SITE.lon, WAGENINGEN_GROWTH_SITE.lat, 1e-4)
  ) {
    const shifted = !coordsMatch(input.lon, input.lat, WAGENINGEN_GROWTH_SITE.lon, WAGENINGEN_GROWTH_SITE.lat);
    return {
      siteId: WAGENINGEN_GROWTH_SITE.siteId,
      countryCode: WAGENINGEN_GROWTH_SITE.countryCode,
      jurisdiction: WAGENINGEN_GROWTH_SITE.jurisdiction,
      pointLonLat: [WAGENINGEN_GROWTH_SITE.lon, WAGENINGEN_GROWTH_SITE.lat],
      selectedLonLat: [input.lon, input.lat],
      usedCanonicalBenchmarkCenter: shifted,
      hasCachedNasaPowerForcing: true,
      cropRotationOptimizerQualified: true,
      benchmarkNote: shifted
        ? `${WAGENINGEN_GROWTH_SITE.note} (Explorer selection was [${input.lon.toFixed(4)}, ${input.lat.toFixed(4)}].)`
        : WAGENINGEN_GROWTH_SITE.note,
    };
  }

  for (const bench of CACHED_CLIMATE_ONLY_BENCHMARKS) {
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
        cropRotationOptimizerQualified: false,
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
      cropRotationOptimizerQualified: false,
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
    cropRotationOptimizerQualified: false,
    benchmarkNote: 'Custom coordinates have no verified local calibration or offline NASA POWER cache; canonical D enforces strict EVIDENCE_BLOCKED gates when evidence is missing.',
  };
}

export function resolveDefaultLocationMode(point: ResolvedLocationPoint): LocationAnalysisMode {
  return point.cropRotationOptimizerQualified ? 'wageningen_native_growth' : 'strict_uncalibrated';
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
  if (mode !== 'wageningen_native_growth' && mode !== 'strict_uncalibrated') {
    throw new Error(
      `INVALID_ANALYSIS_MODE: Unsupported analysis mode '${String(mode)}'. Expected 'wageningen_native_growth' or 'strict_uncalibrated'.`
    );
  }
  const farmId = sanitizeSiteId(options?.farmId, 'engineering-research-example');
  const asOf = options?.asOf || '2026-11-15T00:00:00+00:00';
  const rawArea = Number.isFinite(input.areaHa) ? Number(input.areaHa) : 4;
  const areaHa = Math.min(Math.max(rawArea, 0.1), 1000);

  if (mode === 'wageningen_native_growth') {
    if (!resolvedLocation.cropRotationOptimizerQualified) {
      throw new Error(
        `UNSUPPORTED_CROP_ROTATION_LOCATION: Site '${resolvedLocation.siteId}' lacks source-pinned crop, soil, and full PCSE weather parameters. Only NL_WAGENINGEN_GROWTH [5.67, 51.97] can execute crop-rotation optimization.`
      );
    }
    return {
      resolvedLocation,
      mode,
      payload: buildWageningenProducingPayload({
        farmId: options?.farmId ? farmId : 'NL_THREE_CROP_PRODUCING_RESEARCH',
        asOf: options?.asOf,
      }),
    };
  }

  const manifestId = `strict_uncalibrated_${resolvedLocation.countryCode.toLowerCase()}`;
  const uncalibratedCropId = `research:${resolvedLocation.countryCode}:local_crop_coefficients_required`;

  return {
    resolvedLocation,
    mode: 'strict_uncalibrated',
    payload: {
      schema: 'astragron.client-decision.request.v1',
      farm_id: farmId,
      engine_request: {
        schema: 'astragron.research-decision.request.v1',
        mode: 'RESEARCH_SCENARIO',
        research_acknowledged: true,
        location: {
          site_id: resolvedLocation.siteId,
          country: resolvedLocation.countryCode,
          jurisdiction: resolvedLocation.jurisdiction,
          point_lon_lat: resolvedLocation.pointLonLat,
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
            area_ha: areaHa,
            area_basis: 'USER_RESEARCH_ASSUMPTION',
            irrigation_access: false,
            history: [],
            crop_candidates: [uncalibratedCropId],
            rotation_constraints: {},
            soil: null,
          },
        ],
        crop_profiles: {},
        winter: null,
        supply: null,
        candidates: [],
        scenarios: [
          {
            scenario_id: 'MEDIAN_5Y_TOTAL_2021',
            start: '2021-01-01',
            end: '2025-12-31',
            rain_factor: 1,
            supply_overrides: {},
          },
        ],
        preference: 'minimize_worst_shortfall',
        search: {
          max_candidates: 2,
          max_evaluations: 2,
          max_generated: 0,
          max_wall_seconds: 60,
          max_cpu_seconds: 60,
          seed: 0,
        },
        assumptions_manifest: [
          {
            id: manifestId,
            evidence_class: 'USER_RESEARCH_ASSUMPTION',
            source:
              'User-selected location submitted honestly with zero fabricated soil, crop, winter, or irrigation-supply parameters so canonical D evaluates real climate availability and strict EVIDENCE_BLOCKED gates.',
            license: 'Research request metadata only; no external third-party publication redistributed.',
            available_at: asOf,
            units: {
              area: 'ha',
              time: 'UTC daily / fixed calendar dates',
            },
            uncertainty:
              'UNQUANTIFIED; qualified local crop, soil, winter, and hydraulic supply parameters are absent for this selected point.',
            applies_to: ['selected field boundary and coordinates'],
          },
        ],
        source: {
          provider: 'NASA_POWER_GLOBAL',
          enabled: true,
          acquisition: 'CACHE_ONLY',
          historical_start: '2011-01-01',
          historical_end: '2025-12-31',
        },
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
