import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateGeocoderEndpointUrl,
  performServerGeocodeSearch,
  sanitizeGeocodeText,
  resetGeocodeRateLimiter,
} from '@/server/geocode-service';
import { GET as getGeocodeRoute } from '../app/api/geocode/route';
import { ServerBackedGeocodingProvider } from '@/adapters/geocoding-provider';

describe('Gate G4: SSRF-Safe Provider-Neutral Geocoder & Explorer Search', () => {
  beforeEach(() => {
    resetGeocodeRateLimiter();
  });

  it('rejects non-HTTPS, localhost, RFC1918 private IPs, cloud IMDS metadata, credentials, and non-allowlisted hosts', () => {
    expect(validateGeocoderEndpointUrl('https://geo.example.org/search', ['geo.example.org']).valid).toBe(true);

    const blockedUrls: Array<[string, string[]]> = [
      ['http://geo.example.org/search', ['geo.example.org']],
      ['https://user:secret@geo.example.org/search', ['geo.example.org']],
      ['https://localhost/search', ['localhost']],
      ['https://127.0.0.1/search', ['127.0.0.1']],
      ['https://10.0.0.5/search', ['10.0.0.5']],
      ['https://172.16.0.12/search', ['172.16.0.12']],
      ['https://192.168.1.50/search', ['192.168.1.50']],
      ['https://169.254.169.254/latest/meta-data/', ['169.254.169.254']],
      ['https://metadata.google.internal/computeMetadata/v1/', ['metadata.google.internal']],
      ['https://[::1]/search', ['[::1]', '::1']],
      ['https://evil.example.net/search', ['geo.example.org']],
      ['https://geo.example.org/search', []],
    ];

    for (const [url, allowlist] of blockedUrls) {
      const res = validateGeocoderEndpointUrl(url, allowlist);
      expect(res.valid, `Expected ${url} to be blocked`).toBe(false);
    }
  });

  it('explicitly blocks public OpenStreetMap Nominatim endpoints even if added to allowlist', () => {
    const res = validateGeocoderEndpointUrl('https://nominatim.openstreetmap.org/search', [
      'nominatim.openstreetmap.org',
    ]);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toContain('PUBLIC_OSM_NOMINATIM_BLOCKED');
    }

    const explorerSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/maps/earth-explorer-client.tsx'),
      'utf8'
    );
    const providerSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/adapters/geocoding-provider.ts'),
      'utf8'
    );
    expect(explorerSource).not.toContain('nominatim.openstreetmap.org');
    expect(providerSource).not.toContain('nominatim.openstreetmap.org');
  });

  it('returns honest GEOCODER_NOT_CONFIGURED (503) when keyless fallback is explicitly disabled and endpoint is unset', async () => {
    const origEndpoint = process.env.ASTRAGRON_GEOCODER_ENDPOINT;
    const origDisableKeyless = process.env.ASTRAGRON_GEOCODER_DISABLE_KEYLESS;
    delete process.env.ASTRAGRON_GEOCODER_ENDPOINT;
    process.env.ASTRAGRON_GEOCODER_DISABLE_KEYLESS = '1';
    try {
      const res = await getGeocodeRoute(new NextRequest('http://localhost:3000/api/geocode?q=Cairo'));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.status).toBe('GEOCODER_NOT_CONFIGURED');
      expect(body.results).toEqual([]);
    } finally {
      if (origEndpoint !== undefined) process.env.ASTRAGRON_GEOCODER_ENDPOINT = origEndpoint;
      if (origDisableKeyless !== undefined) {
        process.env.ASTRAGRON_GEOCODER_DISABLE_KEYLESS = origDisableKeyless;
      } else {
        delete process.env.ASTRAGRON_GEOCODER_DISABLE_KEYLESS;
      }
    }
  });

  it('invokes allowlisted remote geocoder, strips HTML/XSS labels, and validates WGS84 coordinates', async () => {
    expect(sanitizeGeocodeText('<script>alert(1)</script>  Cairo,\n<b>Egypt</b>')).toBe('Cairo, Egypt');

    let calledUrl = '';
    let seenRedirect: RequestRedirect | undefined;
    const mockFetch: typeof fetch = async (input, init) => {
      calledUrl = String(input);
      seenRedirect = init?.redirect;
      return new Response(
        JSON.stringify({
          features: [
            {
              id: 'egy-cairo',
              properties: {
                label: '<img src=x onerror=alert(1)>Cairo, Egypt',
                name: '<b>Cairo</b>',
                country: 'Egypt',
                region: 'Cairo Governorate',
              },
              geometry: { coordinates: [31.2357, 30.0444] },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const outcome = await performServerGeocodeSearch('Cairo', 'client-a', {
      endpointUrl: 'https://geo.example.org/v1/search',
      allowedHosts: ['geo.example.org'],
      fetchImpl: mockFetch,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.httpStatus).toBe(200);
    expect(calledUrl).toContain('https://geo.example.org/v1/search?q=Cairo');
    expect(seenRedirect).toBe('error');
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.label).toBe('Cairo, Egypt');
    expect(outcome.results[0]?.shortName).toBe('Cairo');
    expect(outcome.results[0]?.lon).toBeCloseTo(31.2357, 4);
    expect(outcome.results[0]?.lat).toBeCloseTo(30.0444, 4);
  });

  it('rejects malformed or out-of-range remote coordinates cleanly with INVALID_PROVIDER_RESPONSE', async () => {
    const badFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify([{ id: 'bad', label: 'Mars Pole', lon: 220, lat: 95 }]),
        { status: 200 }
      );

    const outcome = await performServerGeocodeSearch('Mars Pole', 'client-bad', {
      endpointUrl: 'https://geo.example.org/v1/search',
      allowedHosts: ['geo.example.org'],
      fetchImpl: badFetch,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.httpStatus).toBe(502);
    expect(outcome.status).toBe('INVALID_PROVIDER_RESPONSE');
    expect(outcome.results).toEqual([]);
  });

  it('enforces timeout (504 UPSTREAM_TIMEOUT), sliding-window rate limit (429), and short query validation (400)', async () => {
    const timeoutFetch: typeof fetch = async (_input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    const timedOut = await performServerGeocodeSearch('Nairobi', 'client-timeout', {
      endpointUrl: 'https://geo.example.org/v1/search',
      allowedHosts: ['geo.example.org'],
      timeoutMs: 25,
      fetchImpl: timeoutFetch,
    });
    expect(timedOut.httpStatus).toBe(504);
    expect(timedOut.status).toBe('UPSTREAM_TIMEOUT');

    const okFetch: typeof fetch = async () => new Response(JSON.stringify([]), { status: 200 });
    let clock = 1_000_000;
    const cfg = {
      endpointUrl: 'https://geo.example.org/v1/search',
      allowedHosts: ['geo.example.org'],
      maxRequestsPerWindow: 2,
      windowMs: 60_000,
      fetchImpl: okFetch,
      nowMs: () => clock,
    };

    expect((await performServerGeocodeSearch('Uppsala', 'rl-user', cfg)).httpStatus).toBe(200);
    expect((await performServerGeocodeSearch('Nyeri', 'rl-user', cfg)).httpStatus).toBe(200);
    const limited = await performServerGeocodeSearch('Wagga', 'rl-user', cfg);
    expect(limited.httpStatus).toBe(429);
    expect(limited.status).toBe('RATE_LIMITED');

    // Too-short query fails with 400
    const shortQ = await performServerGeocodeSearch('a', 'other-user', cfg);
    expect(shortQ.httpStatus).toBe(400);
    expect(shortQ.status).toBe('INVALID_QUERY');
  });

  it('provides synchronous local gazetteer lookup and client AbortController support in ServerBackedGeocodingProvider', async () => {
    const provider = new ServerBackedGeocodingProvider();
    expect(provider.searchLocalGazetteer('Uppsala').length).toBeGreaterThanOrEqual(1);

    const ac = new AbortController();
    ac.abort();
    const res = await provider.searchRemoteLocations('Cairo', ac.signal);
    expect(res.ok).toBe(false);
    expect(['ABORTED', 'UPSTREAM_ERROR']).toContain(res.status);
  });

  it('normalizes Open-Meteo settlements and swaps Photon [west, north, east, south] extent bbox cleanly', async () => {
    let seenUrl = '';
    const openMeteoFetch: typeof fetch = async (url) => {
      seenUrl = String(url);
      return new Response(
        JSON.stringify({
          generationtime_ms: 0.4,
          results: [
            {
              id: 2849483,
              name: 'Altenbach',
              latitude: 49.461,
              longitude: 8.758,
              country_code: 'DE',
              country: 'Germany',
              admin1: 'Baden-Württemberg',
              feature_code: 'PPL',
            },
          ],
        }),
        { status: 200 }
      );
    };

    const om = await performServerGeocodeSearch('Altenbach', 'om-user', {
      fetchImpl: openMeteoFetch,
      timeoutMs: 3000,
    });
    expect(seenUrl).toContain('geocoding-api.open-meteo.com');
    expect(om.ok).toBe(true);
    expect(om.providerTier).toBe('NON_COMMERCIAL_OR_COMMUNITY');
    expect(om.results[0]?.source).toBe('OPEN_METEO_NON_COMMERCIAL');
    expect(om.results[0]?.zoomHint).toBeGreaterThanOrEqual(12);

    const photonFetch: typeof fetch = async (url) => {
      seenUrl = String(url);
      return new Response(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [9.2108, 49.1445] },
              properties: {
                osm_id: 12345,
                name: 'Untereisesheimer Straße',
                city: 'Heilbronn',
                postcode: '74072',
                state: 'Baden-Württemberg',
                country: 'Germany',
                countrycode: 'DE',
                osm_value: 'residential',
                extent: [9.205, 49.148, 9.215, 49.141], // [west, north, east, south]
              },
            },
          ],
        }),
        { status: 200 }
      );
    };

    const ph = await performServerGeocodeSearch('Untereisesheimer Straße 74072 Heilbronn', 'ph-user', {
      fetchImpl: photonFetch,
      timeoutMs: 3000,
    });
    expect(seenUrl).toContain('photon.komoot.io');
    expect(ph.ok).toBe(true);
    expect(ph.results[0]?.source).toBe('PHOTON_OSM_COMMUNITY');
    // Photon extent must normalize into [west, south, east, north]
    expect(ph.results[0]?.bbox).toEqual([9.205, 49.141, 9.215, 49.148]);
    expect(ph.results[0]?.zoomHint).toBeGreaterThanOrEqual(14);
  });
});
