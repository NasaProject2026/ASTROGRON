import type { StyleSpecification } from 'maplibre-gl';
import { NATURAL_EARTH_WORLD_GEOJSON } from '@/fixtures/natural-earth-world';

export type MapBasemapMode = 'SATELLITE_HYBRID' | 'VECTOR_MAP' | 'OFFLINE_NATURAL_EARTH';

export type MapRenderStatus =
  | 'REMOTE_LOADING'
  | 'LIVE_REMOTE_AND_VECTOR'
  | 'IMAGERY_PROVIDER_BLOCKED'
  | 'VECTOR_LOCAL_OFFLINE'
  | 'FALLBACK_ONLY';

export interface MapProviderDescriptor {
  id: 'orbital-sat-hybrid' | 'openfreemap-vector' | 'eox-s2cloudless-2016' | 'nasa-gibs-blue-marble' | 'natural-earth-110m';
  role: 'EarthGlobeStyle' | 'RegionalVectorBasemap' | 'SatelliteOrAerialImagery' | 'FallbackMap';
  label: string;
  license: string;
  requiresKey: boolean;
  maxNativeZoom: number;
  endpoint: string;
}

export interface EoOverlaySpec {
  id: string;
  label: string;
  shortLabel: string;
  sourceName: string;
  spatialResolution: string;
  boxHalfWidthDeg: number;
  boxHalfHeightDeg: number;
  accentHex: string;
  isSimulatedSupportBoundary: boolean;
  disclosure: string;
}

export const OPENFREEMAP_TILEJSON_URL =
  process.env.NEXT_PUBLIC_MAPLIBRE_STYLE_URL?.trim() || 'https://tiles.openfreemap.org/planet';

export const OPENFREEMAP_GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const OPENFREEMAP_SPRITE_URL = 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm';

export const EOX_S2_CLOUDLESS_2016_TILE_URL =
  process.env.NEXT_PUBLIC_SATELLITE_TILE_URL?.trim() ||
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg';

export const NASA_GIBS_BLUE_MARBLE_TILE_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';

export const NATURAL_EARTH_COUNTRIES_PATH = '/geodata/ne_110m_admin_0_countries.geojson';

export const MAP_PROVIDER_CATALOG: readonly MapProviderDescriptor[] = [
  {
    id: 'nasa-gibs-blue-marble',
    role: 'EarthGlobeStyle',
    label: 'NASA GIBS Blue Marble Next Generation',
    license: 'NASA Earthdata Open Data (Public Domain)',
    requiresKey: false,
    maxNativeZoom: 8,
    endpoint: NASA_GIBS_BLUE_MARBLE_TILE_URL,
  },
  {
    id: 'eox-s2cloudless-2016',
    role: 'SatelliteOrAerialImagery',
    label: 'EOxCloudless Sentinel-2 2016 Global Mosaic (Historical Composite)',
    license: 'CC BY 4.0 (EOX IT Services GmbH — FAQ & WMTSCapabilities aligned; no uptime SLA)',
    requiresKey: false,
    maxNativeZoom: 14,
    endpoint: EOX_S2_CLOUDLESS_2016_TILE_URL,
  },
  {
    id: 'openfreemap-vector',
    role: 'RegionalVectorBasemap',
    label: 'OpenFreeMap / OpenStreetMap Vector Tiles',
    license: 'OpenFreeMap / ODbL OpenStreetMap contributors',
    requiresKey: false,
    maxNativeZoom: 14,
    endpoint: OPENFREEMAP_TILEJSON_URL,
  },
  {
    id: 'natural-earth-110m',
    role: 'FallbackMap',
    label: 'Bundled Natural Earth 1:110m Admin 0 Countries',
    license: 'CC0 1.0 Public Domain',
    requiresKey: false,
    maxNativeZoom: 6,
    endpoint: NATURAL_EARTH_COUNTRIES_PATH,
  },
] as const;

export const EO_OVERLAY_CATALOG: Record<string, EoOverlaySpec> = {
  NASA_POWER_CLIMATE: {
    id: 'NASA_POWER_CLIMATE',
    label: 'NASA POWER Agro-Climatology (~50 km grid)',
    shortLabel: 'NASA POWER (~50 km)',
    sourceName: 'NASA POWER MERRA-2 / CERES',
    spatialResolution: '~0.5 deg x 0.625 deg (~50 km)',
    boxHalfWidthDeg: 0.3125,
    boxHalfHeightDeg: 0.25,
    accentHex: '#38bdf8',
    isSimulatedSupportBoundary: true,
    disclosure:
      'Displayed grid outlines the nominal ~50 km x 50 km NASA POWER model cell over the active site. Underlying terrain uses EOX S2Cloudless 2016 historical mosaic imagery (not live POWER raster flux).',
  },
  GPM_IMERG_PRECIP: {
    id: 'GPM_IMERG_PRECIP',
    label: 'GPM IMERG Precipitation (~11 km cell)',
    shortLabel: 'GPM IMERG (~11 km)',
    sourceName: 'NASA GPM IMERG V07',
    spatialResolution: '0.1 deg (~11 km)',
    boxHalfWidthDeg: 0.05,
    boxHalfHeightDeg: 0.05,
    accentHex: '#60a5fa',
    isSimulatedSupportBoundary: true,
    disclosure:
      'Displayed footprint indicates the nominal 0.1 deg (~11 km) GPM IMERG precipitation sampling cell. No live rainfall raster pixels are fetched in standalone mode.',
  },
  SMAP_L4_MOISTURE: {
    id: 'SMAP_L4_MOISTURE',
    label: 'SMAP L4 Root-Zone Soil Moisture (~9 km cell)',
    shortLabel: 'SMAP L4 (~9 km)',
    sourceName: 'NASA SMAP SPL4SMGP',
    spatialResolution: '9 km EASE-Grid 2.0',
    boxHalfWidthDeg: 0.045,
    boxHalfHeightDeg: 0.041,
    accentHex: '#34d399',
    isSimulatedSupportBoundary: true,
    disclosure:
      'Displayed footprint shows a 9 km spatial-support reference cell around the site. Uppsala research outputs use Sweden-scoped synthetic/reference moisture tables rather than SMAP ingestion here.',
  },
  HLS_REFLECTANCE: {
    id: 'HLS_REFLECTANCE',
    label: 'Harmonized Landsat/Sentinel-2 Swath (30 m optical)',
    shortLabel: 'HLS Optical (30 m)',
    sourceName: 'NASA HLS v2.0 + EOX S2Cloudless 2016',
    spatialResolution: '30 m native (historical mosaic shown up to z14 / upscaled z15+)',
    boxHalfWidthDeg: 0.012,
    boxHalfHeightDeg: 0.008,
    accentHex: '#fbbf24',
    isSimulatedSupportBoundary: true,
    disclosure:
      'EOxCloudless 2016 historical Sentinel-2 composite imagery (not live observation) renders beneath field vectors. Native EOX imagery tops out at zoom 14; zooming to z15+ upscales tiles cleanly while preserving exact field boundary editing.',
  },
};

export function createWorldGraticuleGeoJson(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lon = -150; lon <= 180; lon += 30) {
    const coords: Array<[number, number]> = [];
    for (let lat = -80; lat <= 80; lat += 10) {
      coords.push([lon, lat]);
    }
    features.push({
      type: 'Feature',
      properties: { kind: 'meridian', value: lon },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const coords: Array<[number, number]> = [];
    for (let lon = -180; lon <= 180; lon += 15) {
      coords.push([lon, lat]);
    }
    features.push({
      type: 'Feature',
      properties: { kind: 'parallel', value: lat },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function buildEoSpatialSupportGeoJson(
  lon: number,
  lat: number,
  layerId: string
): GeoJSON.FeatureCollection {
  const spec = EO_OVERLAY_CATALOG[layerId] ?? EO_OVERLAY_CATALOG.HLS_REFLECTANCE!;
  const clampedLat = Math.max(-85, Math.min(85, lat));
  const cosLat = Math.max(0.2, Math.cos((clampedLat * Math.PI) / 180));
  const halfLon = spec.boxHalfWidthDeg / cosLat;
  const halfLat = spec.boxHalfHeightDeg;

  const minLon = Math.max(-179.9, lon - halfLon);
  const maxLon = Math.min(179.9, lon + halfLon);
  const minLat = Math.max(-84.9, clampedLat - halfLat);
  const maxLat = Math.min(84.9, clampedLat + halfLat);

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          layerId: spec.id,
          label: spec.shortLabel,
          accentHex: spec.accentHex,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [minLon, minLat],
              [maxLon, minLat],
              [maxLon, maxLat],
              [minLon, maxLat],
              [minLon, minLat],
            ],
          ],
        },
      },
    ],
  };
}

export function buildEarthGlobeStyle(options: {
  basemapMode: MapBasemapMode;
  countriesData?: GeoJSON.FeatureCollection;
}): StyleSpecification {
  const { basemapMode, countriesData } = options;
  const fallbackCountries = countriesData ?? NATURAL_EARTH_WORLD_GEOJSON;
  const useRemoteTiles = basemapMode !== 'OFFLINE_NATURAL_EARTH';

  const sources: StyleSpecification['sources'] = {
    'world-countries-fallback': {
      type: 'geojson',
      data: fallbackCountries,
    },
    graticule: {
      type: 'geojson',
      data: createWorldGraticuleGeoJson(),
    },
    'eo-support-footprint': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    'capability-footprints': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    'ftw-suggestion': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    'gps-track': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    'field-polygon': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    'drawing-midpoints': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    'site-point': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    'drawing-vertices': {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
  };

  if (useRemoteTiles) {
    sources['openfreemap'] = {
      type: 'vector',
      url: OPENFREEMAP_TILEJSON_URL,
      attribution: '© OpenFreeMap · © OpenStreetMap contributors',
    };
  }

  if (basemapMode === 'SATELLITE_HYBRID') {
    sources['nasa-blue-marble'] = {
      type: 'raster',
      tiles: [NASA_GIBS_BLUE_MARBLE_TILE_URL],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 8,
      attribution: 'NASA GIBS Blue Marble',
    };
    sources['eox-sentinel2'] = {
      type: 'raster',
      tiles: [EOX_S2_CLOUDLESS_2016_TILE_URL],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 14,
      attribution:
        'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016, CC BY 4.0)',
    };
  }

  const layers: StyleSpecification['layers'] = [
    {
      id: 'space-ocean-backdrop',
      type: 'background',
      paint: {
        'background-color': '#030816',
      },
    },
    {
      id: 'fallback-countries-fill',
      type: 'fill',
      source: 'world-countries-fallback',
      paint: {
        'fill-color': basemapMode === 'VECTOR_MAP' ? '#132238' : '#102d38',
        'fill-opacity': useRemoteTiles ? 0.94 : 0.97,
      },
    },
    {
      id: 'fallback-countries-outline',
      type: 'line',
      source: 'world-countries-fallback',
      paint: {
        'line-color': '#334e6f',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.45, 5, 1.15],
        'line-opacity': 0.8,
      },
    },
  ];

  if (basemapMode === 'SATELLITE_HYBRID') {
    layers.push(
      {
        id: 'nasa-blue-marble-layer',
        type: 'raster',
        source: 'nasa-blue-marble',
        paint: {
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.98, 4.5, 0.96, 7.0, 0],
          'raster-saturation': 0.14,
          'raster-contrast': 0.08,
        },
      },
      {
        id: 'eox-sentinel2-layer',
        type: 'raster',
        source: 'eox-sentinel2',
        minzoom: 2.5,
        paint: {
          'raster-opacity': ['interpolate', ['linear'], ['zoom'], 2.5, 0, 4.5, 0.96, 18, 0.96],
          'raster-contrast': 0.06,
          'raster-saturation': 0.12,
          'raster-brightness-min': 0.02,
        },
      }
    );
  } else if (basemapMode === 'VECTOR_MAP') {
    layers.push(
      {
        id: 'ofm-water',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'water',
        paint: {
          'fill-color': '#07172d',
        },
      },
      {
        id: 'ofm-landcover-wood',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'landcover',
        paint: {
          'fill-color': [
            'match',
            ['get', 'class'],
            'wood',
            '#102a24',
            'grass',
            '#132b24',
            'farmland',
            '#1c3024',
            'wetland',
            '#0d282f',
            '#102030',
          ],
          'fill-opacity': 0.72,
        },
      },
      {
        id: 'ofm-landuse-farm',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['farmland', 'farm', 'orchard', 'vineyard']]],
        paint: {
          'fill-color': '#1d3625',
          'fill-opacity': 0.65,
        },
      },
      {
        id: 'ofm-buildings',
        type: 'fill',
        source: 'openfreemap',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-color': '#1e293b',
          'fill-outline-color': '#334155',
          'fill-opacity': 0.8,
        },
      }
    );
  }

  layers.push({
    id: 'orbital-graticule-lines',
    type: 'line',
    source: 'graticule',
    paint: {
      'line-color': '#7dd3fc',
      'line-width': 0.55,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.18, 5, 0.08, 7, 0],
    },
  });

  if (useRemoteTiles) {
    layers.push(
      {
        id: 'ofm-waterway-rivers',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'waterway',
        minzoom: 6,
        paint: {
          'line-color': basemapMode === 'SATELLITE_HYBRID' ? 'rgba(103, 232, 249, 0.45)' : '#1d4ed8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 1.8],
        },
      },
      {
        id: 'ofm-roads',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'transportation',
        minzoom: 8,
        filter: [
          'in',
          ['get', 'class'],
          ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']],
        ],
        paint: {
          'line-color':
            basemapMode === 'SATELLITE_HYBRID'
              ? 'rgba(226, 232, 240, 0.42)'
              : 'rgba(148, 163, 184, 0.55)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 13, 1.9, 16, 2.8],
        },
      },
      {
        id: 'ofm-admin-boundaries',
        type: 'line',
        source: 'openfreemap',
        'source-layer': 'boundary',
        filter: ['==', ['get', 'admin_level'], 2],
        paint: {
          'line-color': 'rgba(186, 230, 253, 0.5)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.35],
        },
      },
      {
        id: 'ofm-country-labels',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'place',
        minzoom: 1,
        maxzoom: 6.5,
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9.5, 4, 12],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.08,
        },
        paint: {
          'text-color': '#f1f5f9',
          'text-halo-color': 'rgba(2, 6, 17, 0.92)',
          'text-halo-width': 1.8,
        },
      },
      {
        id: 'ofm-city-labels',
        type: 'symbol',
        source: 'openfreemap',
        'source-layer': 'place',
        minzoom: 3.5,
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village']]],
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 13],
        },
        paint: {
          'text-color': '#e2e8f0',
          'text-halo-color': 'rgba(2, 6, 17, 0.92)',
          'text-halo-width': 1.6,
        },
      }
    );
  }

  // Capability Overlay + Honest EO Footprint + FTW Preview + GPS Track + Parcel Polygon + Touch Vertices
  layers.push(
    {
      id: 'capability-footprints-fill',
      type: 'fill',
      source: 'capability-footprints',
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
      paint: {
        'fill-color': ['coalesce', ['get', 'fillColor'], '#ef4444'],
        'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.14],
      },
    },
    {
      id: 'capability-footprints-stroke',
      type: 'line',
      source: 'capability-footprints',
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
      paint: {
        'line-color': ['coalesce', ['get', 'strokeColor'], '#f87171'],
        'line-width': 1.25,
        'line-dasharray': [2, 2],
        'line-opacity': 0.72,
      },
    },
    {
      id: 'capability-footprints-points',
      type: 'circle',
      source: 'capability-footprints',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 8,
        'circle-color': ['coalesce', ['get', 'fillColor'], '#ef4444'],
        'circle-opacity': 0.85,
        'circle-stroke-width': 2,
        'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], '#f87171'],
      },
    },
    {
      id: 'eo-support-fill',
      type: 'fill',
      source: 'eo-support-footprint',
      paint: {
        'fill-color': ['coalesce', ['get', 'accentHex'], '#38bdf8'],
        'fill-opacity': 0.14,
      },
    },
    {
      id: 'eo-support-stroke',
      type: 'line',
      source: 'eo-support-footprint',
      paint: {
        'line-color': ['coalesce', ['get', 'accentHex'], '#38bdf8'],
        'line-width': 1.75,
        'line-dasharray': [3, 2],
        'line-opacity': 0.9,
      },
    },
    {
      id: 'ftw-suggestion-fill',
      type: 'fill',
      source: 'ftw-suggestion',
      paint: {
        'fill-color': '#38bdf8',
        'fill-opacity': 0.2,
      },
    },
    {
      id: 'ftw-suggestion-stroke',
      type: 'line',
      source: 'ftw-suggestion',
      paint: {
        'line-color': '#38bdf8',
        'line-width': 2.4,
        'line-dasharray': [4, 2],
      },
    },
    {
      id: 'gps-track-line',
      type: 'line',
      source: 'gps-track',
      paint: {
        'line-color': '#22d3ee',
        'line-width': 2.5,
      },
    },
    {
      id: 'field-polygon-fill',
      type: 'fill',
      source: 'field-polygon',
      paint: {
        'fill-color': '#34d399',
        'fill-opacity': 0.28,
      },
    },
    {
      id: 'field-polygon-stroke',
      type: 'line',
      source: 'field-polygon',
      paint: {
        'line-color': '#6ee7b7',
        'line-width': 2.8,
      },
    },
    {
      id: 'drawing-midpoints-circles',
      type: 'circle',
      source: 'drawing-midpoints',
      minzoom: 9,
      paint: {
        'circle-radius': 5.5,
        'circle-color': '#38bdf8',
        'circle-opacity': 0.85,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
      },
    },
    {
      id: 'drawing-vertices-touch-target',
      type: 'circle',
      source: 'drawing-vertices',
      minzoom: 8,
      paint: {
        'circle-radius': 22,
        'circle-color': '#000000',
        'circle-opacity': 0.01,
      },
    },
    {
      id: 'drawing-vertices-halo',
      type: 'circle',
      source: 'drawing-vertices',
      minzoom: 8,
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], true], 10.5, 7.5],
        'circle-color': '#020611',
        'circle-opacity': 0.85,
      },
    },
    {
      id: 'drawing-vertices-circles',
      type: 'circle',
      source: 'drawing-vertices',
      minzoom: 8,
      paint: {
        'circle-radius': ['case', ['==', ['get', 'selected'], true], 7, 5],
        'circle-color': ['case', ['==', ['get', 'selected'], true], '#fbbf24', '#f472b6'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    },
    {
      id: 'site-point-ring',
      type: 'circle',
      source: 'site-point',
      filter: ['!=', ['get', 'role'], 'field-pin'],
      paint: {
        'circle-radius': 13,
        'circle-color': '#38bdf8',
        'circle-opacity': 0.25,
        'circle-stroke-width': 1.75,
        'circle-stroke-color': '#7dd3fc',
      },
    },
    {
      id: 'site-point-core',
      type: 'circle',
      source: 'site-point',
      filter: ['!=', ['get', 'role'], 'field-pin'],
      paint: {
        'circle-radius': 5.5,
        'circle-color': '#f59e0b',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    },
    {
      id: 'field-pin-halo',
      type: 'circle',
      source: 'site-point',
      filter: ['==', ['get', 'role'], 'field-pin'],
      paint: {
        'circle-radius': 11,
        'circle-color': '#22d3ee',
        'circle-opacity': 0.28,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#22d3ee',
      },
    },
    {
      id: 'field-pin-core',
      type: 'circle',
      source: 'site-point',
      filter: ['==', ['get', 'role'], 'field-pin'],
      paint: {
        'circle-radius': 4.5,
        'circle-color': '#22d3ee',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#061320',
      },
    }
  );

  return {
    version: 8,
    projection: { type: 'globe' },
    sky: {
      'sky-color': '#020611',
      'sky-horizon-blend': 0.72,
      'horizon-color': '#38bdf8',
      'horizon-fog-blend': 0.6,
      'fog-color': '#071a38',
      'fog-ground-blend': 0.48,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1.0, 5.5, 0.72, 7.5, 0],
    },
    glyphs: OPENFREEMAP_GLYPHS_URL,
    sources,
    layers,
  };
}
