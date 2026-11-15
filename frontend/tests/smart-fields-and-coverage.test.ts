import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  performServerGeocodeSearch,
  resetGeocodeRateLimiter,
  resolveGeocoderProviderKind,
} from '@/server/geocode-service';
import { validateAllowlistedHttpsUrl, isPrivateOrForbiddenHost } from '@/server/ssrf-guard';
import {
  decodeWkbGeometry,
  querySuggestedFieldBoundaries,
} from '@/server/ftw-boundary-service';
import { GET as getFtwSuggestRoute } from '../app/api/field-boundaries/suggest/route';
import {
  computeGeodesicMetrics,
  detectClippedTileEdgeGeometry,
  evaluateGpsPerimeterSample,
  importFieldBoundaryText,
  polygonContainsPoint,
  validatePolygonGeometry,
} from '@/lib/geometry-validation';
import {
  evaluateSiteCapabilityCheck,
  getVerifiedCapabilityFootprints,
} from '@/server/capability-overlay-service';
import { GET as getFootprintsRoute } from '../app/api/capabilities/footprints/route';
import { POST as postSiteCheckRoute } from '../app/api/capabilities/site-check/route';
import { resolveServerCapabilities } from '@/server/capabilities-service';
import { createAndDispatchAnalysisJob } from '@/server/analysis-job-store';
import { buildReportEnvelopeFromEvaluation } from '@/adapters/storage-adapters';
import {
  DEFAULT_UPPSALA_FARM_DRAFT,
  UPPSALA_REFERENCE_INPUT_REVISION,
} from '@/fixtures/sites-and-coverage';
import { recordedM14Repository } from '@/adapters/repositories';
import { buildReportPdfBytes } from '@/lib/pdf-report';

describe('ASTRAGRON Smart Fields & Globe Coverage Verification Suite', () => {
  beforeEach(() => {
    resetGeocodeRateLimiter();
  });

  describe('P1: Worldwide Multi-Provider Geocoder & SSRF Guard', () => {
    it('auto-detects Geoapify and MapTiler providers and blocks OSM Nominatim & raw/private IPs', () => {
      expect(resolveGeocoderProviderKind(new URL('https://api.geoapify.com/v1/geocode/search'), 'auto')).toBe(
        'geoapify'
      );
      expect(resolveGeocoderProviderKind(new URL('https://api.maptiler.com/geocoding'), 'auto')).toBe(
        'maptiler'
      );
      expect(resolveGeocoderProviderKind(new URL('https://geo.internal-proxy.org/search'), 'auto')).toBe(
        'generic'
      );

      expect(isPrivateOrForbiddenHost('169.254.169.254').forbidden).toBe(true);
      expect(isPrivateOrForbiddenHost('127.0.0.1').forbidden).toBe(true);
      expect(
        validateAllowlistedHttpsUrl('https://nominatim.openstreetmap.org/search', [
          'nominatim.openstreetmap.org',
        ]).valid
      ).toBe(false);
    });

    it('normalizes Geoapify autocomplete responses and sanitizes HTML fragments', async () => {
      let calledUrl = '';
      const mockFetch: typeof fetch = async (input) => {
        calledUrl = String(input);
        return new Response(
          JSON.stringify({
            features: [
              {
                properties: {
                  place_id: 'geoapify-heilbronn',
                  formatted: '<b>Heilbronn</b>, Baden-Württemberg, Germany',
                  city: 'Heilbronn',
                  state: 'Baden-Württemberg',
                  country: 'Germany',
                  country_code: 'de',
                  place_type: 'city',
                },
                bbox: [9.14, 49.09, 9.28, 49.19],
                geometry: { coordinates: [9.2206, 49.1427] },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const outcome = await performServerGeocodeSearch('Heilbronn', 'client-test-1', {
        endpointUrl: 'https://api.geoapify.com/v1/geocode/search',
        allowedHosts: ['api.geoapify.com'],
        apiKey: 'demo-key-safe',
        provider: 'auto',
        fetchImpl: mockFetch,
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.status).toBe('OK');
      expect(calledUrl).toContain('text=Heilbronn');
      expect(calledUrl).toContain('apiKey=demo-key-safe');
      expect(outcome.results[0]).toMatchObject({
        label: 'Heilbronn, Baden-Württemberg, Germany',
        countryCode: 'DE',
        bbox: [9.14, 49.09, 9.28, 49.19],
        lon: 9.2206,
        lat: 49.1427,
      });
    });

    it('normalizes MapTiler geocoding responses cleanly', async () => {
      let calledUrl = '';
      const mockFetch: typeof fetch = async (input) => {
        calledUrl = String(input);
        return new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                id: 'place.damascus',
                text: 'Damascus',
                place_name: 'Damascus, Syria',
                center: [36.2913, 33.5102],
                bbox: [36.21, 33.45, 36.36, 33.56],
                context: [{ id: 'country.1', text: 'Syria', short_code: 'sy' }],
              },
            ],
          }),
          { status: 200 }
        );
      };

      const outcome = await performServerGeocodeSearch('Damascus', 'client-test-2', {
        endpointUrl: 'https://api.maptiler.com/geocoding',
        allowedHosts: ['api.maptiler.com'],
        apiKey: 'mt-safe-key',
        provider: 'maptiler',
        fetchImpl: mockFetch,
      });

      expect(outcome.ok).toBe(true);
      expect(calledUrl).toContain('/Damascus.json');
      expect(calledUrl).toContain('key=mt-safe-key');
      expect(outcome.results[0]).toMatchObject({
        shortName: 'Damascus',
        country: 'Syria',
        countryCode: 'SY',
        lon: 36.2913,
        lat: 33.5102,
      });
    });
  });

  describe('P2: Intelligent FTW Boundary Suggest & Fragment Rejection', () => {
    it('fails closed with UNAVAILABLE when ASTRAGRON_FTW_SUGGEST_ENDPOINT is unset and live parquet is disabled', async () => {
      const origEndpoint = process.env.ASTRAGRON_FTW_SUGGEST_ENDPOINT;
      const origDisableParquet = process.env.ASTRAGRON_FTW_DISABLE_LIVE_PARQUET;
      delete process.env.ASTRAGRON_FTW_SUGGEST_ENDPOINT;
      process.env.ASTRAGRON_FTW_DISABLE_LIVE_PARQUET = '1';
      try {
        const res = await getFtwSuggestRoute(
          new NextRequest('http://localhost:3000/api/field-boundaries/suggest?lon=9.22&lat=49.14')
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('UNAVAILABLE');
        expect(body.providerConfigured).toBe(false);
        expect(body.suggestions).toEqual([]);
      } finally {
        if (origEndpoint !== undefined) process.env.ASTRAGRON_FTW_SUGGEST_ENDPOINT = origEndpoint;
        if (origDisableParquet !== undefined) {
          process.env.ASTRAGRON_FTW_DISABLE_LIVE_PARQUET = origDisableParquet;
        } else {
          delete process.env.ASTRAGRON_FTW_DISABLE_LIVE_PARQUET;
        }
      }
    });

    it('accepts verified complete FTW polygon containing point while rejecting clipped tile fragments and non-containing polygons', async () => {
      const validPolygon: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [9.218, 49.141],
            [9.223, 49.1412],
            [9.2235, 49.1438],
            [9.2205, 49.1445],
            [9.2175, 49.1426],
            [9.218, 49.141],
          ],
        ],
      };

      const clippedTileBox: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [9.21, 49.14],
            [9.23, 49.14],
            [9.23, 49.15],
            [9.21, 49.15],
            [9.21, 49.14],
          ],
        ],
      };

      const distantPolygon: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [9.30, 49.20],
            [9.305, 49.20],
            [9.305, 49.205],
            [9.30, 49.205],
            [9.30, 49.20],
          ],
        ],
      };

      const mockFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            tileBbox: [9.21, 49.135, 9.23, 49.15],
            features: [
              {
                id: 'ftw-valid-1',
                type: 'Feature',
                properties: {
                  dataset: 'FTW Sentinel-2',
                  year: 2025,
                  confidence: 0.91,
                  license: 'CC BY 4.0',
                  completeness_verified: true,
                },
                geometry: validPolygon,
              },
              {
                id: 'ftw-clipped-tile',
                type: 'Feature',
                properties: { confidence: 0.88 },
                geometry: clippedTileBox,
              },
              {
                id: 'ftw-wrong-place',
                type: 'Feature',
                properties: { confidence: 0.95 },
                geometry: distantPolygon,
              },
            ],
          }),
          { status: 200 }
        );

      const outcome = await querySuggestedFieldBoundaries(9.2205, 49.1425, 2025, {
        endpointUrl: 'https://ftw.example.org/v1/suggest',
        allowedHosts: ['ftw.example.org'],
        fetchImpl: mockFetch,
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.status).toBe('FOUND');
      expect(outcome.suggestions).toHaveLength(1);
      expect(outcome.suggestions[0]?.id).toBe('ftw-valid-1');
      expect(outcome.rejectedFragmentsCount).toBe(1);
      expect(outcome.suggestions[0]?.license).toBe('CC BY 4.0');
      expect(outcome.suggestions[0]?.completenessVerified).toBe(true);
      expect(outcome.suggestions[0]?.sourceVerifiedComplete).toBe(true);
      expect(outcome.suggestions[0]?.geometryPassedLocalChecks).toBe(true);
      expect(outcome.suggestions[0]?.scoreSemantics).toBe('UNRECALIBRATED_MEAN_MODEL_FIELD_PROBABILITY_X100');
      expect(outcome.suggestions[0]?.areaHa).toBeGreaterThan(5);
      expect(outcome.suggestions[0]?.disclaimer).toContain('Satellite-estimated boundary');

      // Honest fallback when custom endpoint omits license/completeness verification
      const uncertifiedOutcome = await querySuggestedFieldBoundaries(9.2205, 49.1425, 2025, {
        endpointUrl: 'https://ftw.example.org/v1/suggest',
        allowedHosts: ['ftw.example.org'],
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              type: 'FeatureCollection',
              features: [
                {
                  id: 'ftw-unlabeled',
                  type: 'Feature',
                  properties: { score: 65 },
                  geometry: validPolygon,
                },
              ],
            }),
            { status: 200 }
          ),
      });
      expect(uncertifiedOutcome.suggestions[0]?.license).toBe('UNSPECIFIED_CUSTOM_SOURCE');
      expect(uncertifiedOutcome.suggestions[0]?.sourceVerifiedComplete).toBe(false);
      expect(uncertifiedOutcome.suggestions[0]?.geometryPassedLocalChecks).toBe(true);
      expect(uncertifiedOutcome.suggestions[0]?.rawModelScore).toBe(65);
    });

    it('decodes ISO little-endian WKB Polygon bytes into GeoJSON polygon rings cleanly', () => {
      // Build ISO WKB Polygon (1 ring, 5 vertices): byteOrder=1, type=3, numRings=1, numPoints=5
      const ring: Array<[number, number]> = [
        [9.101, 49.134],
        [9.102, 49.134],
        [9.102, 49.135],
        [9.101, 49.135],
        [9.101, 49.134],
      ];
      const buf = new ArrayBuffer(1 + 4 + 4 + 4 + ring.length * 16);
      const view = new DataView(buf);
      let off = 0;
      view.setUint8(off, 1); off += 1; // little endian
      view.setUint32(off, 3, true); off += 4; // Polygon
      view.setUint32(off, 1, true); off += 4; // 1 ring
      view.setUint32(off, ring.length, true); off += 4;
      for (const [lon, lat] of ring) {
        view.setFloat64(off, lon, true); off += 8;
        view.setFloat64(off, lat, true); off += 8;
      }
      const decoded = decodeWkbGeometry(new Uint8Array(buf));
      expect(decoded?.type).toBe('Polygon');
      if (decoded?.type === 'Polygon') {
        expect(decoded.coordinates[0]).toHaveLength(5);
        expect(decoded.coordinates[0]?.[0]?.[0]).toBeCloseTo(9.101, 5);
        expect(decoded.coordinates[0]?.[2]?.[1]).toBeCloseTo(49.135, 5);
      }
    });

    it('detects clipped rectangular tile boundaries cleanly', () => {
      const clipped: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [10.0, 50.0],
            [10.05, 50.0],
            [10.05, 50.05],
            [10.0, 50.05],
            [10.0, 50.0],
          ],
        ],
      };
      expect(detectClippedTileEdgeGeometry(clipped, [10.0, 49.99, 10.05, 50.05]).suspectedClipped).toBe(
        true
      );
    });
  });

  describe('P3: Turf Geodesic Metrics, KML/GPX/GeoJSON Import, XXE Security & GPS Trace', () => {
    it('computes geodesic area/perimeter for irregular polygons and rejects self-intersections', () => {
      const lShape: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [17.63, 59.85],
            [17.636, 59.85],
            [17.636, 59.852],
            [17.633, 59.852],
            [17.633, 59.854],
            [17.63, 59.854],
            [17.63, 59.85],
          ],
        ],
      };
      const check = validatePolygonGeometry(lShape);
      expect(check.valid).toBe(true);
      expect(check.metrics?.areaHa).toBeGreaterThan(5);
      expect(check.metrics?.perimeterMeters).toBeGreaterThan(500);
      expect(polygonContainsPoint(lShape, [17.6315, 59.8515])).toBe(true);
      expect(polygonContainsPoint(lShape, [17.635, 59.8535])).toBe(false);

      const bowtie: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [17.63, 59.85],
            [17.64, 59.86],
            [17.63, 59.86],
            [17.64, 59.85],
            [17.63, 59.85],
          ],
        ],
      };
      const bad = validatePolygonGeometry(bowtie);
      expect(bad.valid).toBe(false);
      expect(bad.errors.some((e) => /cross/i.test(e))).toBe(true);
    });

    it('preserves interior holes & MultiPolygons on GeoJSON/KML import, parses GPX, and blocks XML XXE', () => {
      const geojsonHole = JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [17.63, 59.85],
            [17.64, 59.85],
            [17.64, 59.86],
            [17.63, 59.86],
            [17.63, 59.85],
          ],
          [
            [17.633, 59.853],
            [17.637, 59.853],
            [17.637, 59.857],
            [17.633, 59.857],
            [17.633, 59.853],
          ],
        ],
      });
      const resHole = importFieldBoundaryText(geojsonHole, 'field-with-pond.geojson');
      expect(resHole.valid).toBe(true);
      expect(resHole.metrics?.hasHoles).toBe(true);
      expect(resHole.geometry?.type).toBe('Polygon');
      if (resHole.geometry?.type === 'Polygon') {
        expect(resHole.geometry.coordinates).toHaveLength(2);
      }

      const kml = `<?xml version="1.0" encoding="UTF-8"?>
        <kml xmlns="http://www.opengis.net/kml/2.2">
          <Placemark><Polygon>
            <outerBoundaryIs><LinearRing><coordinates>
              9.218,49.141,0 9.222,49.141,0 9.222,49.144,0 9.218,49.144,0 9.218,49.141,0
            </coordinates></LinearRing></outerBoundaryIs>
          </Polygon></Placemark>
        </kml>`;
      const resKml = importFieldBoundaryText(kml, 'parcel.kml');
      expect(resKml.valid).toBe(true);
      expect(resKml.format).toBe('KML');
      expect(computeGeodesicMetrics(resKml.geometry!)?.areaHa).toBeGreaterThan(5);

      const gpx = `<gpx version="1.1"><trk><trkseg>
        <trkpt lat="49.141" lon="9.218" /><trkpt lat="49.141" lon="9.222" />
        <trkpt lat="49.144" lon="9.222" /><trkpt lat="49.144" lon="9.218" />
      </trkseg></trk></gpx>`;
      const resGpx = importFieldBoundaryText(gpx, 'walk.gpx');
      expect(resGpx.valid).toBe(true);
      expect(resGpx.format).toBe('GPX');

      const xxe = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><kml>&xxe;</kml>`;
      const resXxe = importFieldBoundaryText(xxe, 'evil.kml');
      expect(resXxe.valid).toBe(false);
      expect(resXxe.errors.join(' ')).toMatch(/DOCTYPE|ENTITY/i);
    });

    it('filters noisy GPS points, stationary jitter, and extreme jumps on perimeter walks', () => {
      const coarse = evaluateGpsPerimeterSample([], {
        lon: 9.22,
        lat: 49.14,
        accuracyMeters: 120,
        timestampMs: 1000,
      });
      expect(coarse.accepted).toBe(false);

      const first = evaluateGpsPerimeterSample([], {
        lon: 9.22,
        lat: 49.14,
        accuracyMeters: 6,
        timestampMs: 1000,
      });
      expect(first.accepted).toBe(true);
      expect(first.qualityTier).toBe('HIGH');

      const jitter = evaluateGpsPerimeterSample([{ coord: first.coord!, timestampMs: 1000 }], {
        lon: 9.220005,
        lat: 49.140005,
        accuracyMeters: 5,
        timestampMs: 2000,
      });
      expect(jitter.accepted).toBe(false);

      const teleport = evaluateGpsPerimeterSample([{ coord: first.coord!, timestampMs: 1000 }], {
        lon: 11.5,
        lat: 49.9,
        accuracyMeters: 8,
        timestampMs: 2000,
      });
      expect(teleport.accepted).toBe(false);
    });
  });

  describe('P4: Scientifically Grounded Capability Overlay (Neutral vs Confirmed Unsupported)', () => {
    it('keeps unassessed world croplands neutral (UNKNOWN_UNASSESSED) without fabricated red overlays', async () => {
      const neutralCases: Array<readonly [string, [number, number]]> = [
        ['Heilbronn', [9.2206, 49.1427]],
        ['Iowa Corn Belt', [-93.625, 42.03]],
        ['Mato Grosso', [-55.5, -12.5]],
      ];
      for (const [label, coords] of neutralCases) {
        const res = await evaluateSiteCapabilityCheck({ coordinates: coords });
        expect(res.status, label).toBe('UNKNOWN_UNASSESSED');
        expect(res.allowsFarmSave).toBe(true);
      }

      const fpRes = await getFootprintsRoute();
      expect(fpRes.status).toBe(200);
      const fpJson = await fpRes.json();
      expect(fpJson.source).toBe('LOCAL_SCIENTIFIC_REGISTRY');
      expect(fpJson.confirmedUnsupportedCount).toBeGreaterThanOrEqual(4);
    });

    it('flags confirmed-unsupported benchmark locations while keeping unassessed regions strictly neutral and always allowing farm save', async () => {
      const unsupportedCases: Array<readonly [string, string, [number, number]]> = [
        ['Svalbard High Arctic benchmark', 'polar-svalbard', [15.6397, 78.2232]],
        ['Atlantic Ocean benchmark', 'ocean-atlantic', [-30.0, 45.0]],
      ];
      for (const [label, farmId, coords] of unsupportedCases) {
        const res = await evaluateSiteCapabilityCheck({ coordinates: coords, farmId });
        expect(res.status, label).toBe('CONFIRMED_UNSUPPORTED');
        expect(res.allowsAnalysisAction).toBe(false);
        expect(res.allowsFarmSave).toBe(true);
        expect(res.matrix.serviceReadiness).toBe('UNAVAILABLE');
      }

      const neutralCases: Array<readonly [string, [number, number]]> = [
        ['Unassessed Antarctica off-benchmark', [0.0, -72.0]],
        ['Heilbronn cropland', [9.22, 49.14]],
        ['Iowa maize belt', [-93.62, 42.03]],
        ['Mato Grosso', [-55.5, -12.5]],
      ];
      for (const [label, coords] of neutralCases) {
        const res = await evaluateSiteCapabilityCheck({ coordinates: coords });
        expect(res.status, label).toBe('UNKNOWN_UNASSESSED');
        expect(res.matrix.m4EarthDataCoverage).toBe('UNKNOWN_UNASSESSED');
        expect(res.allowsAnalysisAction).toBe(false);
        expect(res.allowsFarmSave).toBe(true);
      }

      const partialM4Cases: Array<readonly [string, string, [number, number]]> = [
        ['Nyeri M4 benchmark', 'nyeri-kenya', [36.9476, -0.4201]],
        ['Wagga Wagga M4 benchmark', 'wagga-australia', [147.3598, -35.1082]],
      ];
      for (const [label, farmId, coords] of partialM4Cases) {
        const res = await evaluateSiteCapabilityCheck({ coordinates: coords, farmId });
        expect(res.status, label).toBe('CONFIRMED_UNSUPPORTED');
        expect(res.matrix.m4EarthDataCoverage).toBe('PARTIAL_OR_CONDITIONAL');
        expect(res.allowsAnalysisAction).toBe(false);
        expect(res.allowsFarmSave).toBe(true);
      }

      const siteCheckHttp = await postSiteCheckRoute(
        new NextRequest('http://localhost:3000/api/capabilities/site-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coordinates: [15.6397, 78.2232], farmId: 'polar-svalbard' }),
        })
      );
      expect(siteCheckHttp.status).toBe(200);
      const httpBody = await siteCheckHttp.json();
      expect(httpBody.check.status).toBe('CONFIRMED_UNSUPPORTED');
      expect(httpBody.check.allowsFarmSave).toBe(true);
    });

    it('never infers benchmark eligibility or unsupported status from radial distance or polygon-contains-benchmark-point (Gate 2)', async () => {
      // Negative proximity tests: 0.5–4 km away from each recorded benchmark point must fail closed to UNKNOWN_UNASSESSED
      const nearbyNonIdenticalCoords: Array<readonly [string, [number, number]]> = [
        ['1.2 km from Uppsala M14 benchmark', [17.65, 59.86]],
        ['1.5 km from Nyeri M4 benchmark', [36.96, -0.43]],
        ['1.5 km from Wagga Wagga M4 benchmark', [147.37, -35.12]],
        ['1.1 km from Svalbard Arctic benchmark', [15.63, 78.22]],
        ['2.2 km from Atlantic Ocean benchmark', [-30.02, 45.02]],
      ];
      for (const [label, coords] of nearbyNonIdenticalCoords) {
        const res = await evaluateSiteCapabilityCheck({
          coordinates: coords,
          farmId: 'custom-nearby-farm',
        });
        expect(res.status, label).toBe('UNKNOWN_UNASSESSED');
        expect(res.allowsAnalysisAction, label).toBe(false);
        expect(res.allowsFarmSave, label).toBe(true);
      }

      // Polygon enclosing Uppsala benchmark point [17.6389, 59.8586] with off-benchmark centroid must NOT inherit RESEARCH_ONLY
      const polygonEnclosingUppsala: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [17.62, 59.84],
            [17.68, 59.84],
            [17.68, 59.89],
            [17.62, 59.89],
            [17.62, 59.84],
          ],
        ],
      };
      const enclosedUppsalaRes = await evaluateSiteCapabilityCheck({
        coordinates: [17.65, 59.865],
        farmId: 'custom-enclosing-uppsala',
        geometry: polygonEnclosingUppsala,
      });
      expect(enclosedUppsalaRes.status).toBe('UNKNOWN_UNASSESSED');

      // Polygon enclosing Nyeri benchmark point [36.9476, -0.4201] with off-benchmark centroid must NOT inherit CONFIRMED_UNSUPPORTED
      const polygonEnclosingNyeri: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [36.93, -0.44],
            [36.98, -0.44],
            [36.98, -0.39],
            [36.93, -0.39],
            [36.93, -0.44],
          ],
        ],
      };
      const enclosedNyeriRes = await evaluateSiteCapabilityCheck({
        coordinates: [36.955, -0.415],
        farmId: 'custom-enclosing-nyeri',
        geometry: polygonEnclosingNyeri,
      });
      expect(enclosedNyeriRes.status).toBe('UNKNOWN_UNASSESSED');
    });

    it('distinguishes Uppsala read-only M14 archive from user-modified parcel, validates remote footprints strictly, and rejects invalid polygons', async () => {
      const fixedUppsala = await evaluateSiteCapabilityCheck({
        coordinates: [17.6389, 59.8586],
        farmId: 'uppsala-demo',
        inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
        isUserModifiedDraft: false,
        isUserCreatedDraft: false,
      });
      expect(fixedUppsala.status).toBe('RESEARCH_ONLY');
      expect(fixedUppsala.reasons.join(' ')).toContain('16 tested policies × 9 scenarios = 144 cases');

      const editedUppsala = await evaluateSiteCapabilityCheck({
        coordinates: [17.6389, 59.8586],
        farmId: 'custom-user-uppsala',
        isUserModifiedDraft: true,
      });
      expect(editedUppsala.status).toBe('UNKNOWN_UNASSESSED');

      // Schema-validated remote capability footprint straddle test (without fabricated hex polygons)
      const straddlePolygon: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [36.92, -0.68],
            [36.98, -0.68],
            [36.98, -0.45],
            [36.92, -0.45],
            [36.92, -0.68],
          ],
        ],
      };
      const verifiedRemotePolygon: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [36.90, -0.60],
            [37.00, -0.60],
            [37.00, -0.25],
            [36.90, -0.25],
            [36.90, -0.60],
          ],
        ],
      };

      const remoteFootprints = await getVerifiedCapabilityFootprints({
        remoteEndpoint: 'https://caps.example.org/footprints.json',
        allowedHosts: ['caps.example.org'],
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  id: 'remote-ke-uncalibrated-1',
                  properties: {
                    zoneId: 'remote-ke-uncalibrated-1',
                    status: 'CONFIRMED_UNSUPPORTED',
                    title: 'Verified Remote Unsupported Zone',
                    version: '2026.1',
                    scope: 'CROP_OPTIMIZATION',
                    sourceDataset: 'Verified Regional Mask v1',
                    assessedAt: '2026-11-01T00:00:00Z',
                    license: 'CC BY 4.0',
                    reasons: ['Verified regional mask restriction.'],
                    alternatives: ['Use M4 context only.'],
                  },
                  geometry: verifiedRemotePolygon,
                },
                {
                  type: 'Feature',
                  id: 'invalid-missing-version',
                  properties: {
                    id: 'invalid-missing-version',
                    status: 'CONFIRMED_UNSUPPORTED',
                    title: 'Missing schema fields',
                    reasons: [],
                  },
                  geometry: straddlePolygon,
                },
              ],
            }),
            { status: 200 }
          ),
      });
      expect(remoteFootprints.validatedRemotePolygonCount).toBe(1);

      const straddleCheck = await evaluateSiteCapabilityCheck({
        coordinates: [36.95, -0.62],
        geometry: straddlePolygon,
        footprintsOverride: remoteFootprints,
      });
      expect(straddleCheck.status).toBe('PARTIAL_OR_CONDITIONAL');
      expect(straddleCheck.overlapsBoundary).toBe(true);
      expect(straddleCheck.allowsFarmSave).toBe(true);

      const fp = await getVerifiedCapabilityFootprints();
      expect(fp.benchmarkPointCount).toBeGreaterThanOrEqual(5);
      expect(fp.validatedRemotePolygonCount).toBe(0);
      expect(fp.featureCollection.features.every((f) => f.geometry.type === 'Point')).toBe(true);
    });
  });

  describe('P6: Backend Health Verification, Fail-Closed Job Dispatch & PDF Parcel Outline', () => {
    it('does not claim liveFarmAnalysis Connected when configured ASTRAGRON_BACKEND_URL health check fails', async () => {
      const caps = await resolveServerCapabilities({
        backendUrl: 'https://engine.astragron.invalid',
        fetchImpl: async () => new Response('Bad Gateway', { status: 502 }),
      });
      expect(caps.liveFarmAnalysis.enabled).toBe(false);
      expect(caps.liveFarmAnalysis.mode).toBe('BACKEND_UNREACHABLE');

      const healthyCaps = await resolveServerCapabilities({
        backendUrl: 'https://engine.astragron.invalid',
        fetchImpl: async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
      });
      expect(healthyCaps.liveFarmAnalysis.enabled).toBe(true);
    });

    it('never leaves a dangling QUEUED job when live backend dispatch fails', async () => {
      const failedJob = await createAndDispatchAnalysisJob(
        'custom-fail',
        {
          farmId: 'custom-fail',
          inputRevision: 'rev-test',
          datasetMode: 'REAL_SCIENTIFIC_BACKEND',
          coordinates: [9.22, 49.14],
          fieldCount: 1,
          inputsModified: true,
          isUserCreatedDraft: true,
        },
        {
          backendUrl: 'https://engine.astragron.invalid',
          allowedHosts: ['engine.astragron.invalid'],
          fetchImpl: async () => {
            throw new Error('ECONNREFUSED');
          },
        }
      );

      expect(failedJob.status).toBe('FAILED');
      expect(failedJob.failClosedStatus).toBe('BACKEND_NOT_CONNECTED');
      expect(failedJob.status).not.toBe('QUEUED');
    });

    it('draws real field polygon vectors cleanly inside generated offline PDF binary reports', () => {
      const farmWithPolygon = structuredClone(DEFAULT_UPPSALA_FARM_DRAFT);
      farmWithPolygon.fields[0]!.geometry = {
        type: 'Polygon',
        coordinates: [
          [
            [17.63, 59.85],
            [17.638, 59.85],
            [17.638, 59.855],
            [17.634, 59.855],
            [17.634, 59.858],
            [17.63, 59.858],
            [17.63, 59.85],
          ],
        ],
      };
      const envelope = buildReportEnvelopeFromEvaluation({
        farm: farmWithPolygon,
        repository: recordedM14Repository,
        datasetMode: 'RECORDED_M14_RESEARCH',
        jobId: 'job-pdf-outline-test',
      });
      const bytes = buildReportPdfBytes(envelope, 'SI_METRIC');
      const ascii = Buffer.from(bytes).toString('latin1');
      expect(ascii.startsWith('%PDF-1.4')).toBe(true);
      expect(ascii).toContain('xref');
      expect(ascii).toContain('%%EOF');
      expect(ascii).toContain('Extent:');
      expect(ascii).toContain('Vector parcel sketch from WGS84 coords');
      expect(ascii).toContain(' re B');
      expect(ascii).toContain(' h B');
    });

    it('distinguishes FTW detailed statuses (COVERAGE_UNKNOWN, UPSTREAM_TIMEOUT, UPSTREAM_UNAVAILABLE, INVALID_RESULT) and never treats incomplete searches as conclusive no-match (Gate 3)', async () => {
      // Unsupported FTW 2e year -> COVERAGE_UNKNOWN
      const unsupportedYear = await querySuggestedFieldBoundaries(9.22, 49.14, 2019, {
        endpointUrl: '',
        disableLiveParquet: false,
      });
      expect(unsupportedYear.status).toBe('COVERAGE_UNKNOWN');
      expect(unsupportedYear.detailedStatus).toBe('COVERAGE_UNKNOWN');

      // Polar out-of-bounds latitude -> COVERAGE_UNKNOWN with coverageDataExists: false
      const polarOut = await querySuggestedFieldBoundaries(15.0, 85.0, 2025, {
        endpointUrl: '',
        disableLiveParquet: false,
      });
      expect(polarOut.status).toBe('COVERAGE_UNKNOWN');
      expect(polarOut.detailedStatus).toBe('COVERAGE_UNKNOWN');
      expect(polarOut.queryMeta?.coverageDataExists).toBe(false);

      // Upstream HTTP 429 -> UPSTREAM_UNAVAILABLE
      const rateLimited = await querySuggestedFieldBoundaries(9.22, 49.14, 2025, {
        endpointUrl: 'https://ftw.astragron.invalid/suggest',
        allowedHosts: ['ftw.astragron.invalid'],
        fetchImpl: async () => new Response('Too Many Requests', { status: 429 }),
      });
      expect(rateLimited.ok).toBe(false);
      expect(rateLimited.status).toBe('ERROR');
      expect(rateLimited.detailedStatus).toBe('UPSTREAM_UNAVAILABLE');

      // Upstream timeout -> UPSTREAM_TIMEOUT
      const timedOut = await querySuggestedFieldBoundaries(9.22, 49.14, 2025, {
        endpointUrl: 'https://ftw.astragron.invalid/suggest',
        allowedHosts: ['ftw.astragron.invalid'],
        fetchImpl: async () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        },
      });
      expect(timedOut.ok).toBe(false);
      expect(timedOut.httpStatus).toBe(504);
      expect(timedOut.detailedStatus).toBe('UPSTREAM_TIMEOUT');
    });
  });
});
