# 08 — Asset Provenance, Rights & Redistribution Ledger (`G22`)

Machine-readable asset metadata is recorded in `assets-manifest.json` and `review/evidence/eox-license-check.json`.

---

## 1. Local Bundled Public Assets Inside ZIP Archive
| Local File | Bytes | Origin / Classification | License & Redistribution Status |
| --- | --- | --- | --- |
| `public/assets/orbital-earth-horizon-wide.jpg` | `133,739` | Commissioned editorial desktop hero visual (`1376x768`) — illustrative LEO concept | Proprietary project review artwork; **authorized for private review bundle; commercial public redistribution requires explicit creator clearance** |
| `public/assets/orbital-earth-horizon-mobile.jpg` | `155,325` | Commissioned editorial mobile hero visual (`896x1200`) — illustrative LEO concept | Proprietary project review artwork; same commercial redistribution gate |
| `public/assets/agricultural-watershed-swath.jpg` | `283,228` | Commissioned editorial watershed visual (`1376x768`) | Proprietary project review artwork; same commercial redistribution gate |
| `public/geodata/ne_110m_admin_0_countries.geojson` | `838,726` | Natural Earth 1:110m Admin 0 Countries (`naturalearthdata.com`) | **CC0 1.0 Public Domain** (freely redistributable) |
| `public/geodata/natural-earth-world.geojson` | `32,102` | Lightweight synchronous subset derived from Natural Earth 1:110m | **CC0 1.0 Public Domain** (freely redistributable) |
| `public/workers/maplibre-gl-worker.js` | `519,500` | Bundled Web Worker from `maplibre-gl@6.18.0` | **BSD-3-Clause** (redistributable with copyright notice) |
| `public/orbit-ab-assets/earth_day_4096.jpg` | `473,093` | NASA Blue Marble surface texture via `three.js` examples (`4096x2048`) — isolated `/orbit-ab` | NASA Public Domain imagery / **Three.js MIT License** |
| `public/orbit-ab-assets/earth_night_4096.jpg` | `267,061` | NASA Black Marble night city lights via `three.js` examples (`4096x2048`) — isolated `/orbit-ab` | NASA Public Domain imagery / **Three.js MIT License** |
| `public/orbit-ab-assets/earth_bump_roughness_clouds_4096.jpg` | `1,508,389` | Channel-packed bump/roughness/clouds via `three.js` examples (`4096x2048`) — isolated `/orbit-ab` | NASA Public Domain imagery / **Three.js MIT License** |
| `public/orbit-ab-assets/landsat_8.glb` | `780,280` | NASA 3D Resources official Landsat 8 spacecraft model (`/orbit-ab`) | **NASA U.S. Government Public Domain** (explicit non-endorsement rendered) |
| `public/orbit-ab-assets/draco/draco_decoder.js` | `512,465` | Local offline Google Draco glTF decoder (`three@0.187.0`) | **Apache-2.0** (Draco) / **MIT** (Three.js) |
| `public/orbit-ab-assets/draco/draco_decoder.wasm` | `192,420` | Local offline Google Draco glTF WASM decoder (`three@0.187.0`) | **Apache-2.0** (Draco) / **MIT** (Three.js) |
| `public/orbit-ab-assets/draco/draco_wasm_wrapper.js` | `58,456` | Local offline Google Draco glTF WASM wrapper (`three@0.187.0`) | **Apache-2.0** (Draco) / **MIT** (Three.js) |
| `public/orbit-lab.html` | `67,318` | Standalone self-contained HTML/Canvas orbital motion study (`?embed`) with embedded Natural Earth coords & NASA non-endorsement caption | Project-owned wrapper + Natural Earth **CC0** coordinates |
| `public/favicon.ico` / `app/icon.svg` | `1,150` (.ico) | Original ASTRAGRON vector emblem (distinct from NASA insignia) | Project-owned original iconography |

---

## 2. Runtime External Tile Providers, Licensing & Cost Risk
| Provider ID | Endpoint / Layer | License | Vintage & Cost / Fair-Use Disclosure |
| --- | --- | --- | --- |
| `eox-s2cloudless-2016` | `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg` | **CC BY 4.0** (verified against EOX `WMTSCapabilities.xml` for `s2cloudless_3857`) | Strictly **2016** historical mosaic (`maxNativeZoom: 14`); `2018–2025` excluded due to `CC BY-NC-SA 4.0`; free public endpoint with **no commercial uptime SLA** |
| `nasa-gibs-blue-marble` | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg` | NASA EOSDIS Public Domain (non-endorsement required and rendered) | Orbital planetary texture (`maxNativeZoom: 8`); free public endpoint |
| `openfreemap-vector` | `https://tiles.openfreemap.org/planet` | OpenFreeMap · OpenMapTiles · OpenStreetMap contributors (**ODbL**) | Free zero-key vector tiles subject to fair-use limits; high-volume production launch should mirror/self-host tiles |

---

## 3. Fonts, Dependencies & NASA Non-Endorsement
- **Google Fonts (`Space Grotesk`, `Plus Jakarta Sans`, `JetBrains Mono`):** Loaded via `next/font/google` under **SIL Open Font License 1.1**.
- **NPM Open-Source Stack:** `next`, `react`, `maplibre-gl` (`BSD-3-Clause`), `three` (`MIT`), `echarts` (`Apache-2.0`), `@turf/turf` (`MIT`), `zod` (`MIT`), `web-vitals` (`Apache-2.0`), `lucide-react` (`ISC`).
- **NASA Non-Endorsement Policy:** Top bar, `/explore`, `/orbit-ab`, and footer display explicit attribution stating NASA Earth-data concepts / Landsat 8 public-domain CAD are used for research visualization and are **not endorsed, certified, or operated by NASA**.
