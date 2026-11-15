# ASTRAGRON V7 — Known Limitations & External Service Disclosures

## 1. Live Scientific Compute Engine (`ASTRAGRON_BACKEND_URL`)
- **Status in Standalone Frontend Package:** Not connected by default (`ASTRAGRON_BACKEND_URL` unset).
- **Behavior:**
  - Unmodified `uppsala-demo` (`[17.6389, 59.8586]`, `RECORDED_M14_RESEARCH`) serves the complete, SHA-256-verified M14 research archive (`16 tested policies × 9 scenarios = 144 cases`).
  - All other global locations default to `UNKNOWN_UNASSESSED` unless they match a recorded unsupported benchmark coordinate (`<= 0.0005°` at Svalbard, Atlantic Ocean, Nyeri M4-only, or Wagga Wagga M4-only) or a verified remote capability polygon from `ASTRAGRON_CAPABILITY_FOOTPRINTS_URL`.
  - Farmers can always save their farm and field boundaries in any qualification state (`allowsFarmSave: true`).
  - Attempting to dispatch a live scientific simulation without a reachable Codex backend fails closed immediately with `BACKEND_NOT_CONNECTED` (`progressPct: null`).

## 2. Worldwide Place Geocoding Licensing (`Open-Meteo` & `Photon`)
- **Default Providers:**
  1. **Open-Meteo Geocoding API (`https://geocoding-api.open-meteo.com/v1/search`):** Keyless HTTPS search with GeoNames data (`CC BY 4.0`). Free tier is licensed for **non-commercial use only** (`commercialProductionReady: false`).
  2. **Komoot Photon (`https://photon.komoot.io/api`):** Automatic fallback (`ODbL`, public demo server with fair-use rate limits; `commercialProductionReady: false`).
- **Commercial Production Requirement:** Before commercial production deployment, configure `ASTRAGRON_GEOCODER_URL`, `ASTRAGRON_GEOCODER_ALLOWED_HOSTS`, and `ASTRAGRON_GEOCODER_COMMERCIAL_READY=true` with a commercial geocoding endpoint (e.g., commercial Open-Meteo plan, self-hosted Photon/Pelias, Mapbox, or LocationIQ).
- **Offline / Restricted Network Fallback:** Direct coordinate parsing (`lat, lon` decimal and `DMS`) and the 240+ entry offline multilingual gazetteer operate with zero network requests.

## 3. Fields of The World (FTW) 2nd Edition GeoParquet Coverage & Partition Limits
- **Dataset:** `https://data.source.coop/kerner-lab/fields-of-the-world-2e` (`CC BY 4.0`, Sentinel-2 10m agricultural parcel delineations, partition years `2025, 2024, 2023, 2018`).
- **Scope:** Suggests **agricultural crop field boundaries** (not legal cadastral property deeds) at ~10m resolution (`minimum reliable parcel size >= 500 m²`). Every suggestion requires explicit farmer inspection and confirmation on the map.
- **Budgeted HTTP Range Queries:** Remote UTM zone `.parquet` partitions can be several hundred megabytes. If an HTTP Range scan hits the row-group (`maxRowGroups`), candidate (`maxCandidates`), or time (`timeoutMs`) budget before all matching row groups are inspected, the service returns `status: "SEARCH_INCOMPLETE_LIMIT"` (`queryMeta.searchExhaustive: false`) rather than claiming no field exists, and prompts the farmer to tap closer to the parcel interior or draw corners manually.
