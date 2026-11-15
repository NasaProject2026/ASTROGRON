import { loadAndVerifyStagedCorpora } from '@/server/corpus-integrity';
import { evaluateChatGatewayReadiness } from '@/server/chat-gateway-service';
import { validateGeocoderEndpointUrl } from '@/server/geocode-service';
import { resolveAnalysisBackendUrl, validateAllowlistedHttpsUrl } from '@/server/ssrf-guard';
import type { SystemCapabilitiesResponse } from '@/domain/farmer-ux-contracts';

function hasValidGeocoderConfig(): boolean {
  const endpoint = process.env.ASTRAGRON_GEOCODER_ENDPOINT?.trim() ?? '';
  if (!endpoint) return false;
  const allow = (process.env.ASTRAGRON_GEOCODER_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return validateGeocoderEndpointUrl(endpoint, allow).valid;
}

export function hasValidFtwConfig(): boolean {
  const endpoint = process.env.ASTRAGRON_FTW_SUGGEST_ENDPOINT?.trim() ?? '';
  if (endpoint) {
    const allow = (process.env.ASTRAGRON_FTW_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return validateAllowlistedHttpsUrl(endpoint, allow, 'FTW service').valid;
  }
  return process.env.ASTRAGRON_FTW_DISABLE_LIVE_PARQUET !== '1';
}

function resolveGeocodingCapability() {
  const hasCommercialOrCustom = hasValidGeocoderConfig();
  if (hasCommercialOrCustom) {
    return {
      enabled: true,
      mode: 'REMOTE_PROXY',
      reason: 'Configured HTTPS geocoder proxy endpoint verified cleanly.',
    };
  }
  const keylessEnabled = process.env.ASTRAGRON_GEOCODER_DISABLE_KEYLESS !== '1';
  if (keylessEnabled) {
    return {
      enabled: true,
      mode: 'NON_COMMERCIAL_FREE_SEARCH',
      reason:
        'Live place & address search active via Open-Meteo (CC BY 4.0 non-commercial) and Photon Community OSM Demo (ODbL, no uptime SLA). Commercial Geoapify/MapTiler SLA key not configured; 16-site offline examples also active.',
    };
  }
  return {
    enabled: false,
    mode: 'LOCAL_GAZETTEER_ONLY',
    reason:
      'Place lookup uses limited 16-site offline examples & direct coordinates; remote geocoding is disabled.',
  };
}

/**
 * Synchronous capability summary (fail-closed for remote services unless verified asynchronously).
 */
export function buildServerCapabilities(): SystemCapabilitiesResponse {
  const corpus = loadAndVerifyStagedCorpora();
  const rawBackendUrl = process.env.ASTRAGRON_BACKEND_URL?.trim() ?? '';
  const chatReadiness = evaluateChatGatewayReadiness();
  const hasCloudStorage = Boolean(process.env.ASTRAGRON_CLOUD_STORAGE_URL?.trim());

  return {
    coverageLookup: {
      enabled: true,
      mode: corpus.verified ? 'OFFLINE_SNAPSHOT' : 'UNAVAILABLE',
      reason: corpus.verified
        ? 'Verified M4 Earth-observation coverage metadata and reference presets are available locally.'
        : 'Staged M4 snapshot failed verification or is unavailable.',
    },
    liveFarmAnalysis: {
      // Never claim BACKEND_CONNECTED synchronously from an unverified URL string alone
      enabled: false,
      mode: rawBackendUrl ? 'BACKEND_UNREACHABLE' : 'RECORDED_OR_DEMO_ONLY',
      reason: rawBackendUrl
        ? 'ASTRAGRON_BACKEND_URL is set, pending verified runtime health handshake.'
        : 'Live custom-farm simulation backend is not connected in this release; custom farms can still check EO coverage and save PDF reports.',
    },
    recordedM14: {
      enabled: corpus.verified,
      mode: corpus.verified ? 'VERIFIED_READ_ONLY' : 'UNAVAILABLE',
      reason: corpus.verified
        ? 'SHA-256 verified recorded M14 research archive for Uppsala (SE_UPPSALA) is mounted read-only.'
        : corpus.reason,
    },
    pdfExport: {
      enabled: true,
      mode: 'CLIENT_AND_SERVER_PDF',
      reason:
        'Deterministic PDF 1.4 export (with vector field outlines) works locally in browser and via /api/reports/pdf without cloud dependencies.',
    },
    reportGroundedChat: {
      enabled: chatReadiness.enabled,
      mode: chatReadiness.mode,
      reason: chatReadiness.reason,
    },
    cloudFarmStorage: {
      enabled: hasCloudStorage,
      mode: hasCloudStorage ? 'CLOUD_SYNC' : 'LOCAL_DEVICE_ONLY',
      reason: hasCloudStorage
        ? 'Cloud account sync configured.'
        : 'Saved on this device only (browser storage). Export JSON backups from My Farms for portability.',
    },
    geocoding: resolveGeocodingCapability(),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Runtime-verified capabilities check: probes upstream backend `/health` when ASTRAGRON_BACKEND_URL
 * is configured so an unreachable or bogus URL never displays as "Connected".
 */
export async function resolveServerCapabilities(overrides?: {
  backendUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<SystemCapabilitiesResponse> {
  const base = buildServerCapabilities();
  const rawBackendUrl = overrides?.backendUrl ?? process.env.ASTRAGRON_BACKEND_URL?.trim() ?? '';
  if (!rawBackendUrl) return base;

  const allowedBackendHosts = (process.env.ASTRAGRON_BACKEND_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const backendCheck = resolveAnalysisBackendUrl(rawBackendUrl, allowedBackendHosts);
  const targetUrl: URL | null = backendCheck.valid ? backendCheck.url : null;

  if (!targetUrl) {
    return {
      ...base,
      liveFarmAnalysis: {
        enabled: false,
        mode: 'BACKEND_INVALID_CONFIG',
        reason:
          'ASTRAGRON_BACKEND_URL failed HTTPS/allowlist verification; refusing unverified live backend connection.',
      },
    };
  }

  const healthUrl = new URL(targetUrl.toString());
  healthUrl.pathname = `${healthUrl.pathname.replace(/\/+$/, '')}/health`;

  const fetchFn = overrides?.fetchImpl ?? fetch;
  const timeoutMs = overrides?.timeoutMs ?? 1500;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetchFn(healthUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: ac.signal,
    });
    if (!res.ok) {
      return {
        ...base,
        liveFarmAnalysis: {
          enabled: false,
          mode: 'BACKEND_UNREACHABLE',
          reason: `Configured scientific backend health check returned HTTP ${res.status}.`,
        },
      };
    }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; status?: string } | null;
    const healthy = Boolean(body && (body.ok === true || body.status === 'ok' || body.status === 'healthy'));
    return {
      ...base,
      liveFarmAnalysis: healthy
        ? {
            enabled: true,
            mode: 'BACKEND_CONNECTED',
            reason: `Verified healthy live scientific compute service (${targetUrl.hostname}).`,
          }
        : {
            enabled: false,
            mode: 'BACKEND_UNREACHABLE',
            reason: 'Scientific backend health endpoint did not confirm ready status.',
          },
    };
  } catch {
    return {
      ...base,
      liveFarmAnalysis: {
        enabled: false,
        mode: 'BACKEND_UNREACHABLE',
        reason: `Configured scientific backend (${targetUrl.hostname}) could not be reached.`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
