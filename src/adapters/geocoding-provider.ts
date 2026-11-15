import type { LocalGazetteerEntry } from '@/fixtures/sites-and-coverage';
import { searchLocationsViaAdapter } from '@/adapters/repositories';

export interface RemoteGeocodePlace {
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
  source:
    | 'CONFIGURED_GEOCODER_API'
    | 'OPEN_METEO_NON_COMMERCIAL'
    | 'PHOTON_OSM_COMMUNITY';
  attribution?: string;
}

export interface RemoteGeocodeClientResult {
  ok: boolean;
  status:
    | 'OK'
    | 'GEOCODER_NOT_CONFIGURED'
    | 'INVALID_QUERY'
    | 'FORBIDDEN_ENDPOINT'
    | 'RATE_LIMITED'
    | 'UPSTREAM_TIMEOUT'
    | 'UPSTREAM_ERROR'
    | 'INVALID_PROVIDER_RESPONSE'
    | 'ABORTED';
  results: RemoteGeocodePlace[];
  notice: string;
  providerHost: string | null;
  providerTier?: 'COMMERCIAL_OR_CONFIGURED' | 'NON_COMMERCIAL_OR_COMMUNITY' | 'UNCONFIGURED';
  attribution?: string;
}

export interface GeocodingProvider {
  readonly id: string;
  searchLocalGazetteer(query: string): LocalGazetteerEntry[];
  searchRemoteLocations(query: string, signal?: AbortSignal): Promise<RemoteGeocodeClientResult>;
}

/**
 * Provider-neutral client geocoding adapter:
 * - Always supports offline limited 16-site example lookup synchronously.
 * - Remote global lookup routes strictly through our own SSRF-protected `/api/geocode` proxy,
 *   never calling public third-party autocomplete endpoints directly from the browser.
 */
export class ServerBackedGeocodingProvider implements GeocodingProvider {
  readonly id = 'server-proxy-geocoding-provider';

  searchLocalGazetteer(query: string): LocalGazetteerEntry[] {
    return searchLocationsViaAdapter(query).results;
  }

  async searchRemoteLocations(
    query: string,
    signal?: AbortSignal
  ): Promise<RemoteGeocodeClientResult> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return {
        ok: false,
        status: 'INVALID_QUERY',
        results: [],
        notice: 'Enter at least 2 characters to search remote locations.',
        providerHost: null,
      };
    }

    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });

      const body = (await response.json()) as {
        ok?: boolean;
        status?: RemoteGeocodeClientResult['status'];
        results?: RemoteGeocodePlace[];
        notice?: string;
        providerHost?: string | null;
        providerTier?: RemoteGeocodeClientResult['providerTier'];
        attribution?: string;
      };

      return {
        ok: Boolean(body.ok),
        status: body.status ?? (response.ok ? 'OK' : 'UPSTREAM_ERROR'),
        results: Array.isArray(body.results) ? body.results : [],
        notice: body.notice ?? 'Remote geocoder response received.',
        providerHost: body.providerHost ?? null,
        providerTier: body.providerTier,
        attribution: body.attribution,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          ok: false,
          status: 'ABORTED',
          results: [],
          notice: 'Previous search request superseded.',
          providerHost: null,
        };
      }
      return {
        ok: false,
        status: 'UPSTREAM_ERROR',
        results: [],
        notice:
          'Remote geocoder service is unreachable; limited 16-site offline examples and coordinate entry remain active.',
        providerHost: null,
      };
    }
  }
}

export const defaultGeocodingProvider = new ServerBackedGeocodingProvider();
