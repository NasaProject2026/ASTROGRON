# NASA Data Sources, Open-Data Attributions & Third-Party Notices

This project makes no claim of NASA endorsement. Every Earth-observation dataset, static web asset, and third-party dependency carries explicit source classification so live data, cached research replays, metadata references, and illustrative visuals are never conflated.

## 1. NASA Earth Science & Public Domain Assets

| Source / Asset | Role in ASTROGRON | License / Terms | Classification & Honest Status |
|---|---|---|---|
| **NASA LaRC POWER Project (Daily Point API v2)** | Meteorological forcing (`T2M_MIN`, `T2M_MAX`, `PRECTOTCORR`, `ALLSKY_SFC_SW_DWN`) | NASA Open Data / Public Domain (`17 U.S.C. 105`) | Used for historical Wageningen research forcing and recorded evidence paths; raw cache extracts are excluded from Git (`PRIVATE_BASE_EXCLUSIONS.json`). |
| **NASA Blue Marble Next Generation & Earth Observatory Black Marble** | Day, night, bump/cloud globe textures (`frontend/public/orbit-ab-assets/earth_*.jpg`) | NASA Public Domain base imagery / Three.js `MIT` | Visual orbital backdrop rendered in isolated `/orbit-ab` evaluation view. |
| **NASA 3D Resources — Landsat 8** | Spacecraft 3D mesh (`frontend/public/orbit-ab-assets/landsat_8.glb`) | NASA U.S. Government Public Domain (no NASA endorsement implied) | Illustrative 3D spacecraft model (`orbit-ab` stage), not live telemetry. |
| **NASA SMAP L4 (`NASA_SMAP_L4_SM_V007`), GPM IMERG (`NASA_GPM_IMERG_V07B`), HLS v2 (`NASA_HLS_V2_S30_L30`)** | Capability registry metadata entries in `/explore` | NASA Earthdata Open Data (NSIDC DAAC / GSFC PPS / LP DAAC) | **Metadata reference entries only** in UI presets unless an authorized live capability provider is configured. Never presented as live downloaded satellite rasters when offline. |

## 2. Other Geospatial, Agronomic & Web Open Data

- **ISRIC SoilGrids v2.0 (`250 m` WCS):** Poggio et al. (2021), *SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty*, SOIL 7, 217-240. Governed by **`CC-BY-4.0`** (`https://creativecommons.org/licenses/by/4.0/`). Cached raw extracts are withheld from this public repository.
- **Natural Earth 1:110m Physical/Cultural Vectors (`frontend/public/geodata/*.geojson`, `frontend/src/fixtures/natural-earth-world.ts`):** Public Domain (**`CC0-1.0`**), naturalearthdata.com. Higher-resolution 1:10m shapefile caches in `adaptive/examples/` are withheld.
- **Fields of The World (FTW) 2nd Edition (`global-data-2e`):** **`CC-BY-4.0`**. Queried over HTTP Range GeoParquet only when enabled (see `frontend/.env.example`).
- **Open-Meteo Geocoding API & Photon OSM:** `CC-BY-4.0` (Open-Meteo non-commercial research/educational) and `ODbL` (Photon community demo). Public OSM Nominatim is explicitly blocked by SSRF/policy guards.
- **FAO / IIASA GAEZ v4 & v5:** **`DISABLED_BY_DEFAULT`**. No FAO datasets or non-commercial (`CC-BY-NC`) layers are included or permitted unless an explicit, non-NC open license receipt is supplied and verified at runtime.

## 3. Open-Source Web & Simulation Software Components

- **MapLibre GL JS Worker** (`frontend/public/workers/maplibre-gl-worker.js`): `BSD-3-Clause`
- **Three.js / Google Draco glTF Decoder** (`frontend/public/orbit-ab-assets/draco/*`): `MIT` / `Apache-2.0`
- **Next.js, React, ECharts, Tailwind CSS, Vitest, Playwright**: Respective open-source licenses installed via `frontend/package-lock.json`
- **Python Scientific Runtime Dependencies** (installed locally outside Git from authorized archive/environment): `pcse==6.0.13`, `shapely==2.2.0` (`BSD-3-Clause`, wheels bundle `GEOS` under `LGPL-2.1-or-later`), `pyproj==3.8.0` (`MIT` / `PROJ`), `pyshp==3.1.8` (`MIT`), `numpy==2.5.4` (`BSD-3-Clause`), `certifi==2026.10.23` (`MPL-2.0`), `jsonschema==4.26.0` (`MIT`).
