import { z } from 'zod';
import {
  isPrivateOrForbiddenHost,
  sanitizeRemoteText,
  validateAllowlistedHttpsUrl,
} from '@/server/ssrf-guard';

export { isPrivateOrForbiddenHost };

export function validateGeocoderEndpointUrl(
  rawUrl: string,
  allowedHosts: string[] = []
): { valid: true; url: URL } | { valid: false; reason: string } {
  return validateAllowlistedHttpsUrl(rawUrl, allowedHosts, 'geocoder endpoint', {
    blockPublicOsmNominatim: true,
  });
}

export const sanitizeGeocodeText = sanitizeRemoteText;

export type GeocoderProviderKind =
  | 'auto'
  | 'generic'
  | 'geoapify'
  | 'maptiler'
  | 'open_meteo'
  | 'photon';

export type GeocoderProviderTier =
  | 'COMMERCIAL_OR_CONFIGURED'
  | 'NON_COMMERCIAL_OR_COMMUNITY'
  | 'UNCONFIGURED';

export interface GeocodedPlaceResult {
  id: string;
  label: string;
  shortName: string;
  country: string;
  countryCode?: string;
  region: string;
  placeType?: string;
  zoomHint?: number;
  bbox?: [number, number, number, number];
  lon: number;
  lat: number;
  source: 'CONFIGURED_GEOCODER_API' | 'OPEN_METEO_NON_COMMERCIAL' | 'PHOTON_OSM_COMMUNITY';
  attribution?: string;
}

export interface RemoteGeocodeOutcome {
  ok: boolean;
  httpStatus: number;
  status:
    | 'OK'
    | 'GEOCODER_NOT_CONFIGURED'
    | 'INVALID_QUERY'
    | 'FORBIDDEN_ENDPOINT'
    | 'RATE_LIMITED'
    | 'UPSTREAM_TIMEOUT'
    | 'UPSTREAM_ERROR'
    | 'INVALID_PROVIDER_RESPONSE';
  providerHost: string | null;
  providerKind?: Exclude<GeocoderProviderKind, 'auto'>;
  providerTier: GeocoderProviderTier;
  attribution: string;
  results: GeocodedPlaceResult[];
  notice: string;
}

export interface GeocodeServiceConfig {
  endpointUrl?: string;
  allowedHosts?: string[];
  apiKey?: string;
  provider?: GeocoderProviderKind;
  disableKeylessFallback?: boolean;
  timeoutMs?: number;
  maxRequestsPerWindow?: number;
  windowMs?: number;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

const MAX_RESULTS = 8;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REQUESTS = 20;
const DEFAULT_WINDOW_MS = 60_000;
const CACHE_TTL_MS = 15 * 60_000;
const MAX_CACHE_ENTRIES = 256;

const OPEN_METEO_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_HOST = 'geocoding-api.open-meteo.com';
const PHOTON_ENDPOINT = 'https://photon.komoot.io/api/';
const PHOTON_HOST = 'photon.komoot.io';

const rateLimitBuckets = new Map<string, number[]>();
const responseCache = new Map<string, { expiresAt: number; outcome: RemoteGeocodeOutcome }>();

export function resetGeocodeRateLimiter(): void {
  rateLimitBuckets.clear();
  responseCache.clear();
}

export function resolveGeocoderProviderKind(
  endpointUrl: URL,
  configuredProvider?: string
): Exclude<GeocoderProviderKind, 'auto'> {
  const pref = (configuredProvider ?? 'auto').trim().toLowerCase();
  if (
    pref === 'geoapify' ||
    pref === 'maptiler' ||
    pref === 'generic' ||
    pref === 'open_meteo' ||
    pref === 'photon'
  ) {
    return pref;
  }
  const host = endpointUrl.hostname.toLowerCase();
  if (host.includes('geoapify')) return 'geoapify';
  if (host.includes('maptiler')) return 'maptiler';
  if (host.includes('open-meteo.com')) return 'open_meteo';
  if (host.includes('photon.komoot.io')) return 'photon';
  return 'generic';
}

const StrictPlaceOutputSchema = z
  .object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(180),
    shortName: z.string().min(1).max(96),
    country: z.string().max(80),
    countryCode: z.string().max(12).optional(),
    region: z.string().max(80),
    placeType: z.string().max(48).optional(),
    zoomHint: z.number().finite().min(1).max(20).optional(),
    bbox: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .optional(),
    lon: z.number().finite().min(-180).max(180),
    lat: z.number().finite().min(-90).max(90),
    source: z.enum([
      'CONFIGURED_GEOCODER_API',
      'OPEN_METEO_NON_COMMERCIAL',
      'PHOTON_OSM_COMMUNITY',
    ]),
    attribution: z.string().max(180).optional(),
  })
  .strict();

function normalizeBbox(raw: unknown, isPhotonExtent = false): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  const nums = raw.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  const [minLon, rawMinLat, maxLon, rawMaxLat] = nums as [number, number, number, number];
  let minLat = rawMinLat;
  let maxLat = rawMaxLat;
  // Photon reports `extent` as [west, north, east, south]; swap lat bounds into GeoJSON [w, s, e, n].
  if (isPhotonExtent || minLat > maxLat) {
    const lowLat = Math.min(minLat, maxLat);
    const highLat = Math.max(minLat, maxLat);
    minLat = lowLat;
    maxLat = highLat;
  }
  if (Math.abs(minLon) > 180 || Math.abs(maxLon) > 180 || Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) {
    return undefined;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function computeGeocodeZoomHint(
  bbox?: [number, number, number, number],
  placeType?: string
): number {
  if (bbox) {
    const maxSpan = Math.max(Math.abs(bbox[2] - bbox[0]), Math.abs(bbox[3] - bbox[1]));
    if (maxSpan > 0 && maxSpan <= 0.015) return 15.0;
    if (maxSpan <= 0.06) return 13.6;
    if (maxSpan <= 0.25) return 12.6;
    if (maxSpan <= 1.2) return 10.6;
    if (maxSpan <= 6.0) return 8.2;
    return 6.0;
  }
  const t = (placeType ?? '').toLowerCase();
  if (/house|street|road|residential|address|suburb|quarter/.test(t)) return 14.8;
  if (/village|hamlet|postcode|town|municipality|locality|ppl/.test(t)) return 13.4;
  if (/city|city_district|admin_city/.test(t)) return 12.6;
  if (/county|region|state|province|adm1/.test(t)) return 8.2;
  if (/country/.test(t)) return 5.8;
  return 12.6;
}

function extractMapTilerContext(feature: Record<string, unknown>) {
  const ctx = Array.isArray(feature.context) ? (feature.context as Array<Record<string, unknown>>) : [];
  let country = '';
  let countryCode = '';
  let region = '';

  for (const item of ctx) {
    const idStr = typeof item.id === 'string' ? item.id.toLowerCase() : '';
    const textStr = sanitizeRemoteText(item.text, 80);
    if (idStr.startsWith('country')) {
      country = country || textStr;
      if (typeof item.short_code === 'string') {
        countryCode = item.short_code.trim().toUpperCase().slice(0, 8);
      }
    } else if (idStr.startsWith('region') || idStr.startsWith('county') || idStr.startsWith('subregion')) {
      region = region || textStr;
    }
  }
  return { country, countryCode, region };
}

function isAddressOrPostcodeQuery(query: string): boolean {
  if (/\d/.test(query)) return true;
  if (query.includes(',')) return true;
  return /\b(str|strasse|straße|weg|platz|allee|gasse|street|road|rd|ave|avenue|blvd|lane|drive|way|gatan|vagen|vägen|rue|via|calle)\b/i.test(
    query
  );
}

function formatPhotonLabel(props: Record<string, unknown>): {
  label: string;
  shortName: string;
} {
  const streetPart =
    props.street && props.housenumber
      ? `${String(props.street)} ${String(props.housenumber)}`
      : props.street
        ? String(props.street)
        : '';
  const primary = sanitizeRemoteText(props.name ?? streetPart ?? props.city ?? props.locality, 96);
  const locality = sanitizeRemoteText(
    props.city ?? props.town ?? props.village ?? props.locality ?? props.county,
    80
  );
  const postcode = sanitizeRemoteText(props.postcode, 24);
  const state = sanitizeRemoteText(props.state ?? props.district, 80);
  const country = sanitizeRemoteText(props.country, 80);

  const cityWithZip = postcode && locality ? `${postcode} ${locality}` : locality || postcode;
  const parts = [primary, cityWithZip, state, country].filter(Boolean);
  const deduped: string[] = [];
  for (const p of parts) {
    if (!deduped.some((existing) => existing.toLowerCase() === p.toLowerCase())) {
      deduped.push(p);
    }
  }
  return {
    label: deduped.join(', ') || primary || 'Unnamed location',
    shortName: primary || cityWithZip || 'Location',
  };
}

function normalizeRawProviderResponse(
  payload: unknown,
  providerKind: Exclude<GeocoderProviderKind, 'auto'>,
  source: GeocodedPlaceResult['source'],
  attribution: string
): GeocodedPlaceResult[] {
  const candidates: Array<{
    id?: unknown;
    label?: unknown;
    shortName?: unknown;
    country?: unknown;
    countryCode?: unknown;
    region?: unknown;
    placeType?: unknown;
    bbox?: [number, number, number, number];
    lon?: unknown;
    lat?: unknown;
  }> = [];

  if (Array.isArray(payload)) {
    for (const item of payload.slice(0, MAX_RESULTS)) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        candidates.push({
          id: rec.id ?? rec.place_id,
          label: rec.label ?? rec.display_name ?? rec.formatted ?? rec.name,
          shortName: rec.shortName ?? rec.name ?? rec.city ?? rec.label,
          country: rec.country ?? '',
          countryCode: rec.countryCode ?? rec.country_code,
          region: rec.region ?? rec.state ?? rec.county ?? '',
          placeType: rec.placeType ?? rec.type ?? rec.result_type,
          bbox: normalizeBbox(rec.bbox),
          lon: rec.lon ?? rec.lng ?? rec.longitude,
          lat: rec.lat ?? rec.latitude,
        });
      }
    }
  } else if (
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as { features?: unknown[] }).features)
  ) {
    const features = (payload as { features: unknown[] }).features.slice(0, MAX_RESULTS);
    for (let idx = 0; idx < features.length; idx += 1) {
      const f = features[idx] as Record<string, unknown> & {
        id?: unknown;
        properties?: Record<string, unknown>;
        geometry?: { coordinates?: unknown[] };
        center?: unknown[];
        bbox?: unknown;
        place_name?: unknown;
        text?: unknown;
        place_type?: unknown[];
      };
      const props = f?.properties ?? {};
      const coords = Array.isArray(f?.geometry?.coordinates)
        ? f.geometry!.coordinates
        : Array.isArray(f?.center)
          ? f.center
          : [];

      const isPhotonFeature = providerKind === 'photon' || props.osm_id !== undefined;
      const mtCtx = extractMapTilerContext(f);
      const cityLike =
        props.city ??
        props.town ??
        props.village ??
        props.hamlet ??
        props.municipality ??
        props.name ??
        f.text;
      const stateLike = props.region ?? props.state ?? props.county ?? props.province ?? mtCtx.region;
      const rawCountry = props.country ?? mtCtx.country ?? props.country_code ?? '';
      const rawCode =
        typeof props.country_code === 'string'
          ? props.country_code.trim().toUpperCase().slice(0, 8)
          : typeof props.countrycode === 'string'
            ? props.countrycode.trim().toUpperCase().slice(0, 8)
            : mtCtx.countryCode || undefined;

      const photonFormatted = isPhotonFeature ? formatPhotonLabel(props) : null;

      candidates.push({
        id: f?.id ?? props.place_id ?? props.osm_id ?? props.id ?? `geo-${idx}`,
        label:
          props.formatted ??
          props.label ??
          props.display_name ??
          f.place_name ??
          photonFormatted?.label ??
          props.name ??
          props.title,
        shortName:
          props.shortName ??
          photonFormatted?.shortName ??
          cityLike ??
          props.address_line1 ??
          props.label ??
          f.place_name,
        country: rawCountry,
        countryCode: rawCode,
        region: stateLike ?? '',
        placeType:
          props.result_type ??
          (Array.isArray(f.place_type) ? f.place_type[0] : undefined) ??
          props.osm_value ??
          props.type,
        bbox: normalizeBbox(f.bbox ?? props.bbox ?? props.extent, Boolean(props.extent)),
        lon: coords[0] ?? props.lon ?? props.lng,
        lat: coords[1] ?? props.lat,
      });
    }
  } else if (payload && typeof payload === 'object' && 'results' in payload) {
    const rawResults = (payload as { results?: unknown[] }).results;
    const items = Array.isArray(rawResults) ? rawResults.slice(0, MAX_RESULTS) : [];
    for (let idx = 0; idx < items.length; idx += 1) {
      const rec = (items[idx] ?? {}) as Record<string, unknown>;
      const isOpenMeteo =
        providerKind === 'open_meteo' || ('latitude' in rec && 'longitude' in rec && !('label' in rec));
      const nameStr = sanitizeRemoteText(rec.name, 96);
      const admin1Str = sanitizeRemoteText(rec.admin1 ?? rec.admin2 ?? rec.region ?? rec.state, 80);
      const countryStr = sanitizeRemoteText(rec.country, 80);
      const omLabel = [nameStr, admin1Str, countryStr].filter(Boolean).join(', ');

      candidates.push({
        id: rec.id ?? rec.place_id ?? `geo-${idx}`,
        label:
          rec.label ??
          rec.formatted ??
          (isOpenMeteo && omLabel ? omLabel : undefined) ??
          rec.name ??
          rec.display_name,
        shortName: rec.shortName ?? rec.city ?? rec.name ?? rec.label,
        country: rec.country ?? '',
        countryCode: rec.countryCode ?? rec.country_code,
        region: rec.region ?? rec.state ?? rec.admin1 ?? rec.admin2 ?? '',
        placeType: rec.placeType ?? rec.result_type ?? rec.type ?? rec.feature_code,
        bbox: normalizeBbox(rec.bbox),
        lon: rec.lon ?? rec.lng ?? rec.longitude,
        lat: rec.lat ?? rec.latitude,
      });
    }
  } else if (
    payload &&
    typeof payload === 'object' &&
    'generationtime_ms' in payload &&
    !('results' in payload)
  ) {
    // Open-Meteo omits `results` completely when no places match the query string.
    return [];
  } else {
    throw new Error('Unsupported geocoder JSON payload structure.');
  }

  return candidates.map((c, idx) => {
    const label = sanitizeRemoteText(c.label, 180);
    const shortRaw = sanitizeRemoteText(c.shortName, 96) || label.slice(0, 96);
    const id =
      sanitizeRemoteText(typeof c.id === 'number' ? String(c.id) : c.id, 120) || `geo-${idx}`;
    const lon = typeof c.lon === 'string' ? Number(c.lon) : (c.lon as number);
    const lat = typeof c.lat === 'string' ? Number(c.lat) : (c.lat as number);
    const countryCode = sanitizeRemoteText(c.countryCode, 12).toUpperCase() || undefined;
    const placeType = sanitizeRemoteText(c.placeType, 48) || undefined;
    const zoomHint = computeGeocodeZoomHint(c.bbox, placeType);

    return StrictPlaceOutputSchema.parse({
      id,
      label,
      shortName: shortRaw,
      country: sanitizeRemoteText(c.country, 80),
      ...(countryCode ? { countryCode } : {}),
      region: sanitizeRemoteText(c.region, 80),
      ...(placeType ? { placeType } : {}),
      zoomHint,
      ...(c.bbox ? { bbox: c.bbox } : {}),
      lon,
      lat,
      source,
      attribution,
    });
  });
}

function readDefaultConfig() {
  const endpointUrl = process.env.ASTRAGRON_GEOCODER_ENDPOINT?.trim() ?? '';
  const allowedHosts = (process.env.ASTRAGRON_GEOCODER_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const apiKey = process.env.ASTRAGRON_GEOCODER_API_KEY?.trim() ?? '';
  const providerRaw = process.env.ASTRAGRON_GEOCODER_PROVIDER?.trim().toLowerCase() ?? 'auto';
  const disableKeylessFallback = process.env.ASTRAGRON_GEOCODER_DISABLE_KEYLESS === '1';
  const provider: GeocoderProviderKind =
    providerRaw === 'geoapify' ||
    providerRaw === 'maptiler' ||
    providerRaw === 'generic' ||
    providerRaw === 'open_meteo' ||
    providerRaw === 'photon'
      ? providerRaw
      : 'auto';
  return {
    endpointUrl,
    allowedHosts,
    apiKey,
    provider,
    disableKeylessFallback,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRequestsPerWindow: DEFAULT_MAX_REQUESTS,
    windowMs: DEFAULT_WINDOW_MS,
  };
}

function buildProviderRequestUrl(
  baseUrl: URL,
  providerKind: Exclude<GeocoderProviderKind, 'auto'>,
  query: string,
  apiKey: string
): { url: URL; headers: Record<string, string> } {
  const requestUrl = new URL(baseUrl.toString());
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'ASTRAGRON-Research-UI/1.0',
  };

  if (providerKind === 'geoapify') {
    requestUrl.searchParams.set('text', query);
    requestUrl.searchParams.set('limit', String(MAX_RESULTS));
    requestUrl.searchParams.set('format', 'geojson');
    if (apiKey) requestUrl.searchParams.set('apiKey', apiKey);
    return { url: requestUrl, headers };
  }

  if (providerKind === 'maptiler') {
    const cleanPath = requestUrl.pathname.replace(/\/+$/, '');
    if (!cleanPath.endsWith('.json')) {
      requestUrl.pathname = `${cleanPath}/${encodeURIComponent(query)}.json`;
    }
    requestUrl.searchParams.set('limit', String(MAX_RESULTS));
    if (apiKey) requestUrl.searchParams.set('key', apiKey);
    return { url: requestUrl, headers };
  }

  if (providerKind === 'open_meteo') {
    requestUrl.searchParams.set('name', query);
    requestUrl.searchParams.set('count', String(MAX_RESULTS));
    requestUrl.searchParams.set('language', 'en');
    requestUrl.searchParams.set('format', 'json');
    return { url: requestUrl, headers };
  }

  if (providerKind === 'photon') {
    requestUrl.searchParams.set('q', query);
    requestUrl.searchParams.set('limit', String(MAX_RESULTS));
    requestUrl.searchParams.set('lang', 'en');
    return { url: requestUrl, headers };
  }

  requestUrl.searchParams.set('q', query);
  requestUrl.searchParams.set('limit', String(MAX_RESULTS));
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return { url: requestUrl, headers };
}

function writeCache(key: string, outcome: RemoteGeocodeOutcome, now: number): void {
  if (!outcome.ok) return;
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest) responseCache.delete(oldest);
  }
  responseCache.set(key, { expiresAt: now + CACHE_TTL_MS, outcome });
}

async function executeUpstreamGeocode(params: {
  endpointUrl: string;
  allowedHosts: string[];
  providerPref?: GeocoderProviderKind;
  apiKey: string;
  query: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
  providerTier: GeocoderProviderTier;
  source: GeocodedPlaceResult['source'];
  attribution: string;
}): Promise<RemoteGeocodeOutcome> {
  const {
    endpointUrl,
    allowedHosts,
    providerPref,
    apiKey,
    query,
    timeoutMs,
    fetchFn,
    providerTier,
    source,
    attribution,
  } = params;

  const endpointCheck = validateGeocoderEndpointUrl(endpointUrl, allowedHosts);
  if (!endpointCheck.valid) {
    return {
      ok: false,
      httpStatus: 403,
      status: 'FORBIDDEN_ENDPOINT',
      providerHost: null,
      providerTier,
      attribution,
      results: [],
      notice: endpointCheck.reason,
    };
  }

  const providerKind = resolveGeocoderProviderKind(endpointCheck.url, providerPref);
  const { url: requestUrl, headers } = buildProviderRequestUrl(
    endpointCheck.url,
    providerKind,
    query,
    apiKey
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(requestUrl.toString(), {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        ok: false,
        httpStatus: 502,
        status: 'UPSTREAM_ERROR',
        providerHost: endpointCheck.url.hostname,
        providerKind,
        providerTier,
        attribution,
        results: [],
        notice: `Geocoder upstream (${endpointCheck.url.hostname}) returned HTTP ${res.status}.`,
      };
    }

    const rawJson: unknown = await res.json();
    let parsedResults: GeocodedPlaceResult[];
    try {
      parsedResults = normalizeRawProviderResponse(rawJson, providerKind, source, attribution);
    } catch {
      return {
        ok: false,
        httpStatus: 502,
        status: 'INVALID_PROVIDER_RESPONSE',
        providerHost: endpointCheck.url.hostname,
        providerKind,
        providerTier,
        attribution,
        results: [],
        notice: 'Remote geocoder response failed strict WGS84 coordinate & schema validation.',
      };
    }

    const tierCaveat =
      providerTier === 'NON_COMMERCIAL_OR_COMMUNITY'
        ? ` · ${attribution} (no commercial SLA key set)`
        : '';

    return {
      ok: true,
      httpStatus: 200,
      status: 'OK',
      providerHost: endpointCheck.url.hostname,
      providerKind,
      providerTier,
      attribution,
      results: parsedResults,
      notice:
        parsedResults.length > 0
          ? `Resolved ${parsedResults.length} location(s) via ${providerKind} (${endpointCheck.url.hostname})${tierCaveat}.`
          : `No matching location found via ${providerKind} (${endpointCheck.url.hostname})${tierCaveat}.`,
    };
  } catch (err) {
    const isAbort =
      (err instanceof Error && err.name === 'AbortError') ||
      (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError');
    if (isAbort) {
      return {
        ok: false,
        httpStatus: 504,
        status: 'UPSTREAM_TIMEOUT',
        providerHost: endpointCheck.url.hostname,
        providerKind,
        providerTier,
        attribution,
        results: [],
        notice: `Geocoder timed out after ${timeoutMs} ms.`,
      };
    }
    return {
      ok: false,
      httpStatus: 502,
      status: 'UPSTREAM_ERROR',
      providerHost: endpointCheck.url.hostname,
      providerKind,
      providerTier,
      attribution,
      results: [],
      notice: 'Remote geocoder request failed.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function performServerGeocodeSearch(
  rawQuery: string,
  clientKey = 'anonymous',
  overrides?: GeocodeServiceConfig
): Promise<RemoteGeocodeOutcome> {
  const defaults = readDefaultConfig();
  const configuredEndpointUrl = overrides?.endpointUrl ?? defaults.endpointUrl;
  const configuredAllowedHosts = overrides?.allowedHosts ?? defaults.allowedHosts;
  const apiKey = overrides?.apiKey ?? defaults.apiKey;
  const providerPref = overrides?.provider ?? defaults.provider;
  const disableKeylessFallback = overrides?.disableKeylessFallback ?? defaults.disableKeylessFallback;
  const timeoutMs = overrides?.timeoutMs ?? defaults.timeoutMs;
  const maxRequests = overrides?.maxRequestsPerWindow ?? defaults.maxRequestsPerWindow;
  const windowMs = overrides?.windowMs ?? defaults.windowMs;
  const fetchFn = overrides?.fetchImpl ?? fetch;
  const nowMs = overrides?.nowMs ?? (() => Date.now());
  const useCache = !overrides?.fetchImpl;

  const query = sanitizeRemoteText(rawQuery, 120);
  if (query.length < 2) {
    return {
      ok: false,
      httpStatus: 400,
      status: 'INVALID_QUERY',
      providerHost: null,
      providerTier: configuredEndpointUrl ? 'COMMERCIAL_OR_CONFIGURED' : 'UNCONFIGURED',
      attribution: 'None',
      results: [],
      notice: 'Search query must be between 2 and 120 characters.',
    };
  }

  // Validate SSRF before consuming rate-limit budget when an explicit endpoint is set
  if (configuredEndpointUrl) {
    const endpointCheck = validateGeocoderEndpointUrl(configuredEndpointUrl, configuredAllowedHosts);
    if (!endpointCheck.valid) {
      return {
        ok: false,
        httpStatus: 403,
        status: 'FORBIDDEN_ENDPOINT',
        providerHost: null,
        providerTier: 'UNCONFIGURED',
        attribution: 'Blocked',
        results: [],
        notice: endpointCheck.reason,
      };
    }
  } else if (disableKeylessFallback) {
    return {
      ok: false,
      httpStatus: 503,
      status: 'GEOCODER_NOT_CONFIGURED',
      providerHost: null,
      providerTier: 'UNCONFIGURED',
      attribution: 'Offline 16-site examples only',
      results: [],
      notice:
        'Commercial geocoder key/endpoint is unset and keyless fallback is disabled. Using limited 16-site offline examples and coordinate entry.',
    };
  }

  const now = nowMs();
  const cacheKey = `${configuredEndpointUrl || 'KEYLESS'}::${providerPref}::${query.toLowerCase()}`;
  if (useCache) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.outcome;
    }
  }

  const bucketKey = clientKey.slice(0, 64) || 'anonymous';
  const prevTimestamps = (rateLimitBuckets.get(bucketKey) ?? []).filter((t) => now - t < windowMs);
  if (prevTimestamps.length >= maxRequests) {
    rateLimitBuckets.set(bucketKey, prevTimestamps);
    return {
      ok: false,
      httpStatus: 429,
      status: 'RATE_LIMITED',
      providerHost: configuredEndpointUrl ? new URL(configuredEndpointUrl).hostname : null,
      providerTier: configuredEndpointUrl
        ? 'COMMERCIAL_OR_CONFIGURED'
        : 'NON_COMMERCIAL_OR_COMMUNITY',
      attribution: 'Rate limited',
      results: [],
      notice: `Rate limit exceeded (max ${maxRequests} requests per ${Math.round(windowMs / 1000)}s). Wait a moment or enter coordinates.`,
    };
  }
  prevTimestamps.push(now);
  rateLimitBuckets.set(bucketKey, prevTimestamps);

  // Path 1: Explicit commercial / enterprise geocoder endpoint (Geoapify / MapTiler / generic)
  if (configuredEndpointUrl) {
    const outcome = await executeUpstreamGeocode({
      endpointUrl: configuredEndpointUrl,
      allowedHosts: configuredAllowedHosts,
      providerPref,
      apiKey,
      query,
      timeoutMs,
      fetchFn,
      providerTier: 'COMMERCIAL_OR_CONFIGURED',
      source: 'CONFIGURED_GEOCODER_API',
      attribution: `Configured Geocoder (${new URL(configuredEndpointUrl).hostname})`,
    });
    if (useCache) writeCache(cacheKey, outcome, now);
    return outcome;
  }

  // Path 2: Keyless non-commercial / community routing:
  // - Streets & postal codes go straight to Photon OSM Community Demo (rate-limited + cached, ODbL, no SLA)
  // - Clean settlement/village names try Open-Meteo (CC BY 4.0 non-commercial research) first, falling back to Photon on 0 hits
  const routeAddressToPhotonFirst = providerPref === 'photon' || isAddressOrPostcodeQuery(query);

  if (routeAddressToPhotonFirst) {
    const photonOutcome = await executeUpstreamGeocode({
      endpointUrl: PHOTON_ENDPOINT,
      allowedHosts: [PHOTON_HOST],
      providerPref: 'photon',
      apiKey: '',
      query,
      timeoutMs,
      fetchFn,
      providerTier: 'NON_COMMERCIAL_OR_COMMUNITY',
      source: 'PHOTON_OSM_COMMUNITY',
      attribution: 'Photon Community Demo / OpenStreetMap (ODbL, no uptime SLA)',
    });
    if (photonOutcome.ok && photonOutcome.results.length > 0) {
      if (useCache) writeCache(cacheKey, photonOutcome, now);
      return photonOutcome;
    }
    if (providerPref === 'photon') {
      if (useCache) writeCache(cacheKey, photonOutcome, now);
      return photonOutcome;
    }
    // If Photon community demo timed out or returned 0 hits on an address/postcode query,
    // fall back to Open-Meteo (trying full query first, then trailing settlement token if needed)
    const omDirect = await executeUpstreamGeocode({
      endpointUrl: OPEN_METEO_ENDPOINT,
      allowedHosts: [OPEN_METEO_HOST],
      providerPref: 'open_meteo',
      apiKey: '',
      query,
      timeoutMs,
      fetchFn,
      providerTier: 'NON_COMMERCIAL_OR_COMMUNITY',
      source: 'OPEN_METEO_NON_COMMERCIAL',
      attribution: 'Open-Meteo Geocoding (CC BY 4.0, non-commercial research tier)',
    });
    if (omDirect.ok && omDirect.results.length > 0) {
      if (useCache) writeCache(cacheKey, omDirect, now);
      return omDirect;
    }
    const tokens = query
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
    const trailingTown = tokens[tokens.length - 1];
    if (trailingTown && trailingTown.toLowerCase() !== query.toLowerCase()) {
      const omTownFallback = await executeUpstreamGeocode({
        endpointUrl: OPEN_METEO_ENDPOINT,
        allowedHosts: [OPEN_METEO_HOST],
        providerPref: 'open_meteo',
        apiKey: '',
        query: trailingTown,
        timeoutMs,
        fetchFn,
        providerTier: 'NON_COMMERCIAL_OR_COMMUNITY',
        source: 'OPEN_METEO_NON_COMMERCIAL',
        attribution: 'Open-Meteo Geocoding (CC BY 4.0, non-commercial research tier · settlement fallback)',
      });
      if (omTownFallback.ok && omTownFallback.results.length > 0) {
        if (useCache) writeCache(cacheKey, omTownFallback, now);
        return omTownFallback;
      }
    }
    if (useCache) writeCache(cacheKey, photonOutcome, now);
    return photonOutcome;
  }

  const openMeteoOutcome = await executeUpstreamGeocode({
    endpointUrl: OPEN_METEO_ENDPOINT,
    allowedHosts: [OPEN_METEO_HOST],
    providerPref: 'open_meteo',
    apiKey: '',
    query,
    timeoutMs,
    fetchFn,
    providerTier: 'NON_COMMERCIAL_OR_COMMUNITY',
    source: 'OPEN_METEO_NON_COMMERCIAL',
    attribution: 'Open-Meteo Geocoding (CC BY 4.0, non-commercial research tier)',
  });

  if (openMeteoOutcome.ok && openMeteoOutcome.results.length > 0) {
    if (useCache) writeCache(cacheKey, openMeteoOutcome, now);
    return openMeteoOutcome;
  }

  // Fallback to Photon community demo if Open-Meteo had 0 settlement matches or transient failure
  if (providerPref !== 'open_meteo') {
    const photonFallback = await executeUpstreamGeocode({
      endpointUrl: PHOTON_ENDPOINT,
      allowedHosts: [PHOTON_HOST],
      providerPref: 'photon',
      apiKey: '',
      query,
      timeoutMs,
      fetchFn,
      providerTier: 'NON_COMMERCIAL_OR_COMMUNITY',
      source: 'PHOTON_OSM_COMMUNITY',
      attribution: 'Photon Community Demo / OpenStreetMap (ODbL, no uptime SLA)',
    });
    if (photonFallback.ok || !openMeteoOutcome.ok) {
      if (useCache) writeCache(cacheKey, photonFallback, now);
      return photonFallback;
    }
  }

  if (useCache) writeCache(cacheKey, openMeteoOutcome, now);
  return openMeteoOutcome;
}
