# Asset Ownership, Licenses, Vintage Policy & Attribution Ledger (`G8` / `P02`)

Full machine-readable inventory lives in `assets-manifest.json` and `review/evidence/eox-license-check.json`.

## 1. Local Bundled Assets Inside Portable Archive
| Local File | Bytes | Origin / Classification | License & Transferability Note |
| --- | --- | --- | --- |
| `public/assets/orbital-earth-horizon-wide.jpg` | `133,739` | Commissioned editorial desktop hero visual (`1376x768`), illustrative LEO scene (NOT NASA photo / live telemetry) | Project-commissioned proprietary artwork; authorized for project review bundle by creator request; not CC0 public domain |
| `public/assets/orbital-earth-horizon-mobile.jpg` | `155,325` | Commissioned editorial mobile hero visual (`896x1200`), illustrative LEO scene | Project-commissioned proprietary artwork; not CC0 public domain |
| `public/assets/agricultural-watershed-swath.jpg` | `283,228` | Commissioned editorial watershed visual (`1376x768`) | Project-commissioned proprietary artwork; not CC0 public domain |
| `public/geodata/ne_110m_admin_0_countries.geojson` | `838,726` | Natural Earth 1:110m Admin 0 Countries (`177` polygons, WGS84) | **CC0 1.0 Public Domain** (`naturalearthdata.com`) |
| `public/geodata/natural-earth-world.geojson` | `32,102` | Lightweight synchronous subset derived from Natural Earth 1:110m (`naturalearthdata.com`) | **CC0 1.0 Public Domain** |
| `public/workers/maplibre-gl-worker.js` | `519,500` | Bundled Web Worker from `maplibre-gl@6.18.0` | **BSD-3-Clause** (MapLibre GL JS) |
| `app/icon.svg` / `public/favicon.ico` | `1,150` (.ico) | Original ASTRAGRON vector emblem (distinct from NASA insignia) | Project-owned original iconography |

## 2. External Runtime Map Providers (Browser-Fetched when Online)
| Provider ID | Live Endpoint Template | Confirmed License & Terms | Vintage & Uptime Policy |
| --- | --- | --- | --- |
| `eox-s2cloudless-2016` | `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg` | **CC BY 4.0** (verified directly in EOX `WMTSCapabilities.xml` for `s2cloudless_3857`); attribution required (`EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)`) | Strictly **2016** historical mosaic; **2018–2025 excluded** due to `CC BY-NC-SA 4.0` non-commercial restrictions; no SLA assumed |
| `nasa-gibs-blue-marble` | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg` | NASA EOSDIS Earth Science Data (Public Domain; explicit non-endorsement acknowledgement rendered) | Orbital Blue Marble mosaic (`maxNativeZoom: 8`); telemetry outages gracefully fail over |
| `openfreemap-vector` | `https://tiles.openfreemap.org/planet` | OpenFreeMap · OpenMapTiles schema · OpenStreetMap data (**ODbL**); attribution displayed | Vector borders/labels/roads; no API key required; offline CC0 vector fallback built in |

## 3. Fonts & Third-Party Service Dependencies
- **Fonts:** `Space Grotesk`, `Plus Jakarta Sans`, `JetBrains Mono` loaded via `next/font/google` under **SIL Open Font License 1.1**.
- **Public Deployment Prerequisites:** Before any public launch outside private review, confirm EOX CC BY 4.0 attribution visibility across all embed sizes, respect OpenFreeMap fair-use policy or mirror self-hosted tiles, and obtain formal legal sign-off on commercial distribution terms for commissioned JPEG hero artwork if commercialized.
