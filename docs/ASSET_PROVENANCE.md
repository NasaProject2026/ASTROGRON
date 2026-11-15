# ASTRAGRON V4 — Asset & Data Provenance (Corrected 2026-11-13)

This ledger describes **files actually present in this V4 portable archive**. It supersedes the stale legacy inventory that listed `orbital-earth-satellite-hero.webp`, `eo-sensor-pass.jpg`, and `hero-earth-orbital.jpg` (none of which is in this release).

## 1. Editorial imagery — ownership and rights

| Path | Current use | Rights and limitations |
| --- | --- | --- |
| `public/assets/orbital-earth-horizon-wide.jpg` | Desktop landing illustration with Earth **and satellite baked into the same JPEG** | Bespoke commissioned/project-controlled editorial art. **Not CC0**. Verify ownership and downstream redistribution rights before commercial distribution. Not NASA imagery or live telemetry. |
| `public/assets/orbital-earth-horizon-mobile.jpg` | Portrait mobile landing equivalent | Same rights and non-telemetry caveat. |
| `public/assets/agricultural-watershed-swath.jpg` | Agricultural watershed editorial illustration | Same rights caveat. |

The image’s satellite **cannot rotate independently from Earth** without replacing this composite with separate assets or a procedurally rendered scene. CSS drift animates the whole image; it is not a genuine orbit simulation.

## 2. Cartography, Earth observation, and runtime

| Path or service | Role | Attribution / rights |
| --- | --- | --- |
| `public/geodata/ne_110m_admin_0_countries.geojson` | Offline natural-earth 177-country fallback | Natural Earth public domain / CC0 1.0 |
| `public/geodata/natural-earth-world.geojson` | Lightweight regional geometries | Natural Earth public domain / CC0 1.0 |
| `public/workers/maplibre-gl-worker.js` | Bundled MapLibre **v6.18.0** worker, must remain in sync with installed MapLibre GL JS | MapLibre BSD-3-Clause |
| OpenFreeMap / OpenStreetMap | Online vector basemap | OpenFreeMap, OpenMapTiles, OSM contributors; observe ODbL/data attribution |
| EOX `s2cloudless_3857` **2016** | Historical Sentinel-2 mosaic, not current measurements | EOX CC BY 4.0 for the documented 2016 layer; includes modified Copernicus Sentinel data. Later EOX editions may use different licenses. |
| NASA GIBS Blue Marble Next Generation | Basemap Earth imagery | NASA Earthdata; no NASA endorsement |

**Data-source separation:** NASA POWER, GPM IMERG, SMAP, and HLS layer names/support footprints in the standalone UI are metadata/reference presentation unless a documented verified backend ingestion has occurred. Their presence in the map legend does not establish current per-field science inputs.

## 3. Typography and brand

`Space Grotesk`, `Plus Jakarta Sans`, and `JetBrains Mono` are loaded via `next/font/google` (SIL Open Font License 1.1). `app/icon.svg` and `public/favicon.ico` are ASTRAGRON-owned iconography, not NASA marks.

## 4. Reference-of-record

See `assets-manifest.json` for each shipped asset's origin and usage, and `review/12_HASHES_AND_DELIVERY_MANIFEST.json` for exact archive integrity hashes. Human-readable project ownership statements are **not** a substitute for signed rights assignments or verified licenses.

## 5. Isolated `/orbit-ab` 3D A/B evaluation assets (lazy-loaded on `/orbit-ab` only; NOT active on `/`)

| Path | Role | Attribution / rights |
| --- | --- | --- |
| `public/orbit-ab-assets/earth_day_4096.jpg` | 4096×2048 equirectangular Earth day albedo | NASA Blue Marble base imagery / distributed under Three.js MIT License (`mrdoob/three.js` examples) |
| `public/orbit-ab-assets/earth_night_4096.jpg` | 4096×2048 night hemisphere city lights | NASA Earth Observatory Black Marble base imagery / Three.js MIT License |
| `public/orbit-ab-assets/earth_bump_roughness_clouds_4096.jpg` | Channel-packed terrain relief (`R`), surface roughness (`G`), cloud cover (`B`) | NASA base imagery / Three.js MIT License |
| `public/orbit-ab-assets/landsat_8.glb` | 3D CAD model of Landsat 8 spacecraft (illustrative orbit only) | NASA 3D Resources U.S. Government Public Domain (free and without copyright; no NASA endorsement implied) |
| `public/orbit-ab-assets/draco/*` | Local offline glTF Draco mesh decoder (`three@0.187.0`) | Google Draco Apache-2.0 / Three.js MIT License |

Note: `three@0.187.0` and all assets in `public/orbit-ab-assets/` are isolated behind dynamic route loading on `/orbit-ab` and add **0 KB** to the public `/` landing page bundle.
