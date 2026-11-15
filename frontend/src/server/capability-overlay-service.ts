import booleanIntersects from '@turf/boolean-intersects';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import booleanWithin from '@turf/boolean-within';
import { point, polygon as turfPolygon } from '@turf/helpers';
import { z } from 'zod';
import {
  CAPABILITY_OVERLAY_META,
  type AnalysisCapabilityStatus,
  type CapabilityFootprintsResponse,
  type CapabilitySeparationMatrix,
  type SiteCapabilityCheckResult,
} from '@/domain/capability-overlay';
import { validatePolygonGeometry } from '@/lib/geometry-validation';
import { sanitizeRemoteText, validateAllowlistedHttpsUrl } from '@/server/ssrf-guard';

interface VerifiedBenchmarkPointDef {
  zoneId: string;
  farmIdMatch: string;
  title: string;
  status: AnalysisCapabilityStatus;
  coordinates: [number, number];
  m4EarthDataCoverage: CapabilitySeparationMatrix['m4EarthDataCoverage'];
  descriptiveEvidence: CapabilitySeparationMatrix['descriptiveEvidence'];
  reasons: string[];
  alternatives: string[];
}

/**
 * Strictly grounded benchmark coordinates derived from protected M4/M14 registries.
 * - Rendered ONLY as point benchmark markers — NEVER fabricated as circles, hexes, or polar bands.
 * - Red exclusion polygons require an authoritative, scoped, versioned remote eligibility feed.
 */
const VERIFIED_BENCHMARK_POINTS: VerifiedBenchmarkPointDef[] = [
  {
    zoneId: 'SITE_UPPSALA_M14_ARCHIVE',
    farmIdMatch: 'uppsala-demo',
    title: 'Uppsala M14 Research Archive Benchmark Site (SE_UPPSALA)',
    status: 'RESEARCH_ONLY',
    coordinates: [17.6389, 59.8586],
    m4EarthDataCoverage: 'SUPPORTED_VERIFIED',
    descriptiveEvidence: 'AVAILABLE',
    reasons: [
      'Fixed 5-year boreal arable research archive verified via protocol SHA-256 receipts (16 tested policies × 9 scenarios = 144 cases; all failed the 100 mm drought-service threshold).',
      'Read-only historical benchmark only; live custom field simulation engine is not attached.',
    ],
    alternatives: [
      'Save your custom parcel outline on this site to track geometry revisions cleanly.',
      'Inspect the verified SE_UPPSALA M14 research archive & downloadable PDF.',
    ],
  },
  {
    zoneId: 'SITE_NYERI_BENCHMARK_UNQUALIFIED',
    farmIdMatch: 'nyeri-kenya',
    title: 'Nyeri M4 Benchmark Site — Crop Model Uncalibrated (KE_NYERI_REGION)',
    status: 'CONFIRMED_UNSUPPORTED',
    coordinates: [36.9476, -0.4201],
    m4EarthDataCoverage: 'PARTIAL_OR_CONDITIONAL',
    descriptiveEvidence: 'AVAILABLE',
    reasons: [
      'Nordic crop coefficients and boreal rotations are strictly barred from extrapolation to equatorial bimodal Kenyan highlands (M4 KE_NYERI_REGION rule).',
      'M4 regional Earth-observation metadata (NASA POWER / GPM IMERG) remains inspectable as descriptive coverage only.',
    ],
    alternatives: [
      'Save your farm and field boundaries freely — local geometry export & PDF summary work here.',
      'Inspect M4 precipitation & reflectance coverage metadata without fake yield advice.',
    ],
  },
  {
    zoneId: 'SITE_WAGGA_BENCHMARK_UNQUALIFIED',
    farmIdMatch: 'wagga-australia',
    title: 'Wagga Wagga M4 Benchmark Site — Crop Model Uncalibrated (AU_WAGGA_RIVERINA)',
    status: 'CONFIRMED_UNSUPPORTED',
    coordinates: [147.3598, -35.1082],
    m4EarthDataCoverage: 'PARTIAL_OR_CONDITIONAL',
    descriptiveEvidence: 'AVAILABLE',
    reasons: [
      'Southern Hemisphere cropping phenology and Murrumbidgee irrigation allocation rules are outside the Swedish M14 calibration.',
      'M4 regional meteorological coverage metadata remains inspectable honestly.',
    ],
    alternatives: [
      'Save your Australian farm plots and download local boundary & M4 coverage reports.',
    ],
  },
  {
    zoneId: 'SITE_SVALBARD_ARCTIC_REF',
    farmIdMatch: 'polar-svalbard',
    title: 'High-Arctic Cryosphere M4 Reference Point (polar-svalbard · 78.22°N)',
    status: 'CONFIRMED_UNSUPPORTED',
    coordinates: [15.6397, 78.2232],
    m4EarthDataCoverage: 'UNKNOWN_UNASSESSED',
    descriptiveEvidence: 'LIMITED',
    reasons: [
      'Protected M4 Svalbard verification site: permafrost / cryosphere snow masks fall outside arable growing-season calibration.',
      'Saving your farm location or coordinates here still works cleanly.',
    ],
    alternatives: [
      'You can still save coordinates or parcels here as a geospatial bookmark.',
      'Explore non-polar cropland regions or inspect NASA GIBS layers in Explore.',
    ],
  },
  {
    zoneId: 'SITE_NORTH_ATLANTIC_MARINE_REF',
    farmIdMatch: 'ocean-atlantic',
    title: 'North Atlantic Pelagic Marine M4 Reference Point (ocean-atlantic)',
    status: 'CONFIRMED_UNSUPPORTED',
    coordinates: [-30.0, 45.0],
    m4EarthDataCoverage: 'UNKNOWN_UNASSESSED',
    descriptiveEvidence: 'LIMITED',
    reasons: [
      'SMAP L4 & agronomic models require terrestrial arable land; verified M4 pelagic marine test site (-30.0° W, 45.0° N).',
    ],
    alternatives: ['Select a terrestrial farm parcel or search an agricultural locality.'],
  },
];

import { UPPSALA_REFERENCE_INPUT_REVISION } from '@/fixtures/sites-and-coverage';

/**
 * Benchmark eligibility requires explicit registered benchmark identity,
 * exact recorded coordinates (zero spatial tolerance), unmodified state,
 * and verified reference input revision.
 * NEVER use a coordinate tolerance halo, 5 km radius halo, or polygon-contains-point inference.
 */
function isRegisteredUnmodifiedBenchmarkMatch(
  b: VerifiedBenchmarkPointDef,
  params: {
    coordinates: [number, number];
    farmId?: string;
    inputRevision?: string;
    isUserModifiedDraft?: boolean;
    isUserCreatedDraft?: boolean;
    hasPolygonInput: boolean;
  }
): boolean {
  if (params.isUserModifiedDraft || params.isUserCreatedDraft || params.hasPolygonInput) {
    return false;
  }
  const normalizedFarmId = params.farmId?.trim();
  if (!normalizedFarmId || normalizedFarmId.startsWith('custom-')) {
    return false;
  }
  const exactCoordMatch =
    params.coordinates[0] === b.coordinates[0] &&
    params.coordinates[1] === b.coordinates[1];
  if (!exactCoordMatch) {
    return false;
  }
  const matchesId =
    normalizedFarmId === b.farmIdMatch ||
    normalizedFarmId === b.zoneId ||
    (b.farmIdMatch === 'uppsala-demo' && normalizedFarmId === 'uppsala-m14');
  if (!matchesId) {
    return false;
  }
  if (b.farmIdMatch === 'uppsala-demo') {
    return params.inputRevision === UPPSALA_REFERENCE_INPUT_REVISION;
  }
  if (params.inputRevision !== undefined) {
    return (
      params.inputRevision === b.zoneId ||
      params.inputRevision === b.farmIdMatch ||
      params.inputRevision === `benchmark:${b.zoneId}`
    );
  }
  return true;
}

const RemoteFootprintSchema = z
  .object({
    type: z.literal('Feature'),
    id: z.union([z.string().min(1).max(120), z.number()]).optional(),
    properties: z.object({
      zoneId: z.string().min(1).max(120),
      title: z.string().min(1).max(180),
      status: z.enum([
        'SUPPORTED_VERIFIED',
        'PARTIAL_OR_CONDITIONAL',
        'CONFIRMED_UNSUPPORTED',
        'UNKNOWN_UNASSESSED',
        'TEMPORARILY_UNAVAILABLE',
        'RESEARCH_ONLY',
      ]),
      version: z.string().min(1).max(64),
      scope: z.string().min(1).max(120),
      sourceDataset: z.string().min(1).max(120),
      assessedAt: z.string().min(4).max(64),
      license: z.string().min(1).max(80),
      m4EarthDataCoverage: z
        .enum(['SUPPORTED_VERIFIED', 'PARTIAL_OR_CONDITIONAL', 'UNKNOWN_UNASSESSED'])
        .optional(),
      reasons: z.array(z.string().max(320)).max(8).optional(),
      alternatives: z.array(z.string().max(320)).max(6).optional(),
    }),
    geometry: z.object({
      type: z.enum(['Polygon', 'MultiPolygon']),
      coordinates: z.any(),
    }),
  })
  .strict();

function validateRemoteScopedFeature(raw: unknown): GeoJSON.Feature | null {
  const parsed = RemoteFootprintSchema.safeParse(raw);
  if (!parsed.success) return null;
  const geom = parsed.data.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  const topo = validatePolygonGeometry(geom);
  if (!topo.valid) return null;

  const st = parsed.data.properties.status;
  const meta = CAPABILITY_OVERLAY_META[st];
  return {
    type: 'Feature',
    id: parsed.data.id ?? parsed.data.properties.zoneId,
    properties: {
      zoneId: sanitizeRemoteText(parsed.data.properties.zoneId, 120),
      title: sanitizeRemoteText(parsed.data.properties.title, 180),
      status: st,
      shortLabel: meta.shortLabel,
      fillColor: meta.fillColor,
      fillOpacity: meta.fillOpacity,
      strokeColor: meta.strokeColor,
      featureKind: 'AUTHORITATIVE_SCOPED_POLYGON',
      version: sanitizeRemoteText(parsed.data.properties.version, 64),
      scope: sanitizeRemoteText(parsed.data.properties.scope, 120),
      sourceDataset: sanitizeRemoteText(parsed.data.properties.sourceDataset, 120),
      assessedAt: sanitizeRemoteText(parsed.data.properties.assessedAt, 64),
      license: sanitizeRemoteText(parsed.data.properties.license, 80),
      m4EarthDataCoverage: parsed.data.properties.m4EarthDataCoverage ?? 'UNKNOWN_UNASSESSED',
      reasons: (parsed.data.properties.reasons ?? []).map((r) => sanitizeRemoteText(r, 320)).filter(Boolean),
      alternatives: (parsed.data.properties.alternatives ?? []).map((a) => sanitizeRemoteText(a, 320)).filter(Boolean),
    },
    geometry: geom,
  };
}

export async function getVerifiedCapabilityFootprints(overrides?: {
  remoteEndpoint?: string;
  allowedHosts?: string[];
  fetchImpl?: typeof fetch;
}): Promise<CapabilityFootprintsResponse> {
  const remoteEndpoint =
    overrides?.remoteEndpoint ??
    process.env.ASTRAGRON_CAPABILITY_FOOTPRINTS_ENDPOINT?.trim() ??
    '';
  const allowedHosts =
    overrides?.allowedHosts ??
    (process.env.ASTRAGRON_CAPABILITY_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const benchmarkFeatures: GeoJSON.Feature[] = VERIFIED_BENCHMARK_POINTS.map((b) => {
    const meta = CAPABILITY_OVERLAY_META[b.status];
    return {
      type: 'Feature',
      id: b.zoneId,
      properties: {
        zoneId: b.zoneId,
        farmIdMatch: b.farmIdMatch,
        title: b.title,
        status: b.status,
        shortLabel: meta.shortLabel,
        fillColor: meta.fillColor,
        strokeColor: meta.strokeColor,
        featureKind: 'BENCHMARK_SITE_POINT',
        m4EarthDataCoverage: b.m4EarthDataCoverage,
        descriptiveEvidence: b.descriptiveEvidence,
        version: 'M4-M14-BENCHMARKS-V1',
        scope: 'EXACT_BENCHMARK_COORDINATE_ONLY',
        sourceDataset: 'Protected M4/M14 Registries',
        license: 'Research Archive / CC BY 4.0',
        reasons: b.reasons,
        alternatives: b.alternatives,
      },
      geometry: {
        type: 'Point',
        coordinates: b.coordinates,
      },
    };
  });

  let source: CapabilityFootprintsResponse['source'] = 'LOCAL_SCIENTIFIC_REGISTRY';
  const validatedRemotePolygons: GeoJSON.Feature[] = [];

  if (remoteEndpoint) {
    const check = validateAllowlistedHttpsUrl(
      remoteEndpoint,
      allowedHosts,
      'capability footprints service',
      { blockPublicOsmNominatim: true }
    );
    if (check.valid) {
      try {
        const fetchFn = overrides?.fetchImpl ?? fetch;
        const res = await fetchFn(check.url.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
        });
        if (res.ok) {
          const fc = (await res.json()) as { type?: string; features?: unknown[] };
          if (fc?.type === 'FeatureCollection' && Array.isArray(fc.features)) {
            for (const item of fc.features.slice(0, 64)) {
              const validFeat = validateRemoteScopedFeature(item);
              if (validFeat) validatedRemotePolygons.push(validFeat);
            }
            if (validatedRemotePolygons.length > 0) {
              source = 'BACKEND_ELIGIBILITY_API';
            }
          }
        }
      } catch {
        // Fail closed silently to verified benchmark markers only
      }
    }
  }

  const allFeatures = [...benchmarkFeatures, ...validatedRemotePolygons];
  const confirmedUnsupportedCount = allFeatures.filter(
    (f) => f.properties?.status === 'CONFIRMED_UNSUPPORTED'
  ).length;

  return {
    ok: true,
    source,
    assessedScopeNote:
      source === 'BACKEND_ELIGIBILITY_API'
        ? 'Displaying verified M4/M14 benchmark markers plus scoped, versioned capability polygons from the backend eligibility feed. Unassessed regions remain neutral.'
        : 'Displaying strictly verified M4/M14 benchmark coordinates only (no synthetic circles or polar strips). All unassessed land areas remain neutral.',
    totalAssessedFeatures: allFeatures.length,
    confirmedUnsupportedCount,
    benchmarkPointCount: benchmarkFeatures.length,
    validatedRemotePolygonCount: validatedRemotePolygons.length,
    featureCollection: {
      type: 'FeatureCollection',
      features: allFeatures,
    },
  };
}

export async function evaluateSiteCapabilityCheck(params: {
  coordinates: [number, number];
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  farmId?: string;
  inputRevision?: string;
  isUserModifiedDraft?: boolean;
  isUserCreatedDraft?: boolean;
  backendHealthy?: boolean;
  footprintsOverride?: CapabilityFootprintsResponse;
}): Promise<SiteCapabilityCheckResult> {
  const {
    coordinates,
    geometry,
    farmId,
    isUserModifiedDraft,
    backendHealthy = false,
    footprintsOverride,
  } = params;

  const footprints = footprintsOverride ?? (await getVerifiedCapabilityFootprints());
  const ptFeature = point(coordinates);
  const serviceReadiness: CapabilitySeparationMatrix['serviceReadiness'] = backendHealthy
    ? 'AVAILABLE'
    : process.env.ASTRAGRON_BACKEND_URL?.trim()
      ? 'UNVERIFIED'
      : 'UNAVAILABLE';

  const inputPolys =
    geometry?.type === 'Polygon'
      ? [turfPolygon(geometry.coordinates)]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates.map((rings) => turfPolygon(rings))
        : [];

  // 1. Check authoritative scoped/versioned polygons (if backend eligibility feed supplied valid ones)
  const intersectingPolys: Array<{
    zoneId: string;
    title: string;
    status: AnalysisCapabilityStatus;
    m4EarthDataCoverage: CapabilitySeparationMatrix['m4EarthDataCoverage'];
    reasons: string[];
    alternatives: string[];
    fullyWithin: boolean;
  }> = [];

  for (const feat of footprints.featureCollection.features) {
    if (!feat.geometry || (feat.geometry.type !== 'Polygon' && feat.geometry.type !== 'MultiPolygon')) {
      continue;
    }
    const zonePolys =
      feat.geometry.type === 'Polygon'
        ? [turfPolygon(feat.geometry.coordinates)]
        : feat.geometry.coordinates.map((rings) => turfPolygon(rings));

    let hits = false;
    let fullyWithin = false;
    try {
      if (inputPolys.length > 0) {
        hits = inputPolys.some((p) => zonePolys.some((z) => booleanIntersects(p, z)));
        fullyWithin = hits
          ? inputPolys.every((p) => zonePolys.some((z) => booleanWithin(p, z)))
          : false;
      } else {
        hits = zonePolys.some((z) => booleanPointInPolygon(ptFeature, z));
        fullyWithin = hits;
      }
    } catch {
      hits = zonePolys.some((z) => booleanPointInPolygon(ptFeature, z));
      fullyWithin = hits;
    }

    if (hits) {
      const p = (feat.properties ?? {}) as Record<string, unknown>;
      intersectingPolys.push({
        zoneId: String(p.zoneId ?? feat.id ?? 'ZONE'),
        title: String(p.title ?? 'Verified Capability Zone'),
        status: (p.status as AnalysisCapabilityStatus) ?? 'UNKNOWN_UNASSESSED',
        m4EarthDataCoverage:
          (p.m4EarthDataCoverage as CapabilitySeparationMatrix['m4EarthDataCoverage']) ??
          'UNKNOWN_UNASSESSED',
        reasons: Array.isArray(p.reasons) ? (p.reasons as string[]) : [],
        alternatives: Array.isArray(p.alternatives) ? (p.alternatives as string[]) : [],
        fullyWithin,
      });
    }
  }

  const now = new Date().toISOString();

  if (
    inputPolys.length > 0 &&
    intersectingPolys.some((z) => z.status === 'CONFIRMED_UNSUPPORTED' && !z.fullyWithin)
  ) {
    const z = intersectingPolys.find((i) => i.status === 'CONFIRMED_UNSUPPORTED' && !i.fullyWithin)!;
    return {
      status: 'PARTIAL_OR_CONDITIONAL',
      zoneId: z.zoneId,
      zoneTitle: z.title,
      coordinates,
      overlapsBoundary: true,
      allowsFarmSave: true,
      allowsAnalysisAction: false,
      headline: 'Your field partially crosses an unsupported capability zone',
      explanation: `Part of the drawn boundary intersects "${z.title}". Full field optimization is blocked across mixed/unqualified footprints, though you can save the parcel cleanly.`,
      reasons: z.reasons,
      alternatives: z.alternatives,
      matrix: {
        m4EarthDataCoverage: 'PARTIAL_OR_CONDITIONAL',
        descriptiveEvidence: 'LIMITED',
        recordedM14Research: 'NOT_APPLICABLE',
        fieldCropOptimization: 'PARTIAL_OR_CONDITIONAL',
        serviceReadiness,
      },
      assessedScopeNote: footprints.assessedScopeNote,
      checkedAt: now,
    };
  }

  if (intersectingPolys[0]) {
    const z = intersectingPolys[0];
    const effectiveStatus: AnalysisCapabilityStatus =
      z.status === 'RESEARCH_ONLY' && (isUserModifiedDraft || (farmId && farmId !== 'uppsala-demo'))
        ? 'PARTIAL_OR_CONDITIONAL'
        : z.status;
    const meta = CAPABILITY_OVERLAY_META[effectiveStatus];
    return {
      status: effectiveStatus,
      zoneId: z.zoneId,
      zoneTitle: z.title,
      coordinates,
      overlapsBoundary: Boolean(inputPolys.length > 0 && !z.fullyWithin),
      allowsFarmSave: true,
      allowsAnalysisAction: meta.allowsCropOptimization && backendHealthy,
      headline: meta.farmerHeadline,
      explanation:
        effectiveStatus === 'CONFIRMED_UNSUPPORTED'
          ? "This analysis isn't available here yet. You can still select and save your field."
          : meta.description,
      reasons: z.reasons,
      alternatives: z.alternatives.length
        ? z.alternatives
        : ['Save this farm outline to your local portfolio for boundary management.'],
      matrix: {
        m4EarthDataCoverage: z.m4EarthDataCoverage,
        descriptiveEvidence: effectiveStatus === 'CONFIRMED_UNSUPPORTED' ? 'LIMITED' : 'AVAILABLE',
        recordedM14Research:
          effectiveStatus === 'RESEARCH_ONLY' ? 'RESEARCH_ONLY' : 'NOT_APPLICABLE',
        fieldCropOptimization: effectiveStatus,
        serviceReadiness,
      },
      assessedScopeNote: footprints.assessedScopeNote,
      checkedAt: now,
    };
  }

  // 2. Strict Benchmark Identity, Exact Coordinate & Verified Revision Check (zero coordinate tolerance, no 5 km radius halo, no polygon containment inheritance)
  const matchedBenchmark = VERIFIED_BENCHMARK_POINTS.find((b) =>
    isRegisteredUnmodifiedBenchmarkMatch(b, {
      coordinates,
      farmId,
      inputRevision: params.inputRevision,
      isUserModifiedDraft,
      isUserCreatedDraft: params.isUserCreatedDraft,
      hasPolygonInput: inputPolys.length > 0,
    })
  );

  if (matchedBenchmark) {
    const hasCustomModification =
      Boolean(isUserModifiedDraft) ||
      inputPolys.length > 0 ||
      Boolean(farmId && farmId !== matchedBenchmark.farmIdMatch);
    const effectiveStatus: AnalysisCapabilityStatus =
      matchedBenchmark.status === 'RESEARCH_ONLY' && hasCustomModification
        ? 'PARTIAL_OR_CONDITIONAL'
        : matchedBenchmark.status;
    const meta = CAPABILITY_OVERLAY_META[effectiveStatus];
    const reasons =
      effectiveStatus === 'PARTIAL_OR_CONDITIONAL' && matchedBenchmark.status === 'RESEARCH_ONLY'
        ? [
            'Location matches the Uppsala M14 research benchmark coordinates, but custom-drawn or edited inputs do not automatically inherit fixed M14 archive verification.',
            'Connect a live agronomic compute backend to re-evaluate custom boundaries.',
          ]
        : matchedBenchmark.reasons;

    return {
      status: effectiveStatus,
      zoneId: matchedBenchmark.zoneId,
      zoneTitle: matchedBenchmark.title,
      coordinates,
      overlapsBoundary: false,
      allowsFarmSave: true,
      allowsAnalysisAction: meta.allowsCropOptimization && backendHealthy,
      headline: meta.farmerHeadline,
      explanation:
        effectiveStatus === 'CONFIRMED_UNSUPPORTED'
          ? "This analysis isn't available here yet. You can still select and save your field."
          : meta.description,
      reasons,
      alternatives: matchedBenchmark.alternatives,
      matrix: {
        m4EarthDataCoverage: matchedBenchmark.m4EarthDataCoverage,
        descriptiveEvidence: matchedBenchmark.descriptiveEvidence,
        recordedM14Research:
          matchedBenchmark.status === 'RESEARCH_ONLY' &&
          !isUserModifiedDraft &&
          (!farmId || farmId === 'uppsala-demo')
            ? 'RESEARCH_ONLY'
            : 'NOT_APPLICABLE',
        fieldCropOptimization: effectiveStatus,
        serviceReadiness,
      },
      assessedScopeNote: footprints.assessedScopeNote,
      checkedAt: now,
    };
  }

  // 3. Strictly Neutral Default for All Unassessed Land Areas (no fabricated M4 or service claims)
  return {
    status: 'UNKNOWN_UNASSESSED',
    zoneId: null,
    zoneTitle: 'Unassessed / Neutral Global Location',
    coordinates,
    overlapsBoundary: false,
    allowsFarmSave: true,
    allowsAnalysisAction: false,
    headline: CAPABILITY_OVERLAY_META.UNKNOWN_UNASSESSED.farmerHeadline,
    explanation:
      'No verified M4 regional assessment or calibrated crop model covers these coordinates yet. You can save your farm freely, trace field boundaries, and inspect global base maps.',
    reasons: [
      'ASTRAGRON keeps unassessed farmland neutral instead of assuming regional exclusion or availability.',
      backendHealthy
        ? 'Live backend service is reachable, but site-specific model qualification is not verified yet.'
        : 'Live multi-year crop optimization service is unavailable or not verified on this host.',
    ],
    alternatives: [
      'Save your farm and download a verified boundary & coverage PDF.',
      'Check regional Earth imagery & M4 benchmark sites in Explore Map.',
    ],
    matrix: {
      m4EarthDataCoverage: 'UNKNOWN_UNASSESSED',
      descriptiveEvidence: 'LIMITED',
      recordedM14Research: 'NOT_APPLICABLE',
      fieldCropOptimization: 'UNKNOWN_UNASSESSED',
      serviceReadiness,
    },
    assessedScopeNote: footprints.assessedScopeNote,
    checkedAt: now,
  };
}
