# 3D WebGL Globe, Provider Licensing, Outage Failover, DMS Parser & Polygons (`G4–G5`)

## 1. Strict Signed DMS Coordinate Parser & Bidirectional Sync (`G01–G08`)
- Implemented `parseDmsCoordinateString()` and `formatDecimalToDms()` in `src/domain/contracts.ts` and wired bidirectional sync in `src/components/maps/earth-explorer-client.tsx`:
  - **Signed negative & zero values (`G01`, `G02`, `G04`):** `-17°30` parses to `-17.5` (never `+17.5`); `-12°20` parses to `-12.333333`; `-0°30` preserves negative sign (`-0.5`); `W`/`S` suffixes remain numerically equivalent.
  - **Sign/hemisphere conflicts (`G03`):** Ambiguous mixed inputs such as `-17° E` or `-17° 30' N` are rejected with explicit error messages.
  - **Range bounds & GeoJSON (`G05`, `G06`):** Rejects minutes/seconds >= 60, latitude outside `[-90, 90]`, longitude outside `[-180, 180]`, malformed rings (`< 4` positions), and swapped coordinates.
  - **Orbital zoom guard (`G08`):** `VERTEX_EDIT_MIN_ZOOM = 8` prevents accidental boundary vertex mutations while orbiting at planetary scale; clicking `Draw Field Boundary` at `Orbit (z1.45)` informs the user cleanly and locks point edits until zoomed to regional/field scale.

## 2. Verified EOX 2016 CC BY 4.0 Switch & Real 3D WebGL Telemetry (`M01`, `M05`)
- Live verification against EOX WMTS before freeze:
  - `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/0/0/0.jpg` returned **HTTP 200** (`image/jpeg`, `15,002` bytes).
  - `https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml` confirmed **CC BY 4.0** for `s2cloudless_3857` (2016). Later EOX S2Cloudless releases (2018–2025) remain excluded due to `CC BY-NC-SA 4.0`.
- Production browser capture (`review/screenshots/tile-network-proof.json`, Playwright Test 1):
  - **94 HTTP 200** remote map tile/style responses captured cleanly (`13` OpenFreeMap vector tiles, `37` EOX S2Cloudless 2016 tiles, `44` NASA GIBS Blue Marble tiles).
  - Real `MapLibre GL 6.18.0` globe canvas verified with `data-webgl-status="READY"`, `data-countries-loaded >= 170` (Natural Earth 1:110m CC0), `data-render-status="LIVE_REMOTE_AND_VECTOR"`, and non-overlapping attribution bar at `1440px`, `1024px`, and `390px` (`M05`).

## 3. Real WebGL Tile Outage Failover (`M02`, `M04`)
- Fixed a subtle MapLibre `sourcedata` edge case in `src/components/maps/maplibre-globe-canvas.tsx`: previously, aborted tile sources firing trailing `sourcedata` events with `isSourceLoaded: true` (and zero decoded tiles) reset `IMAGERY_PROVIDER_BLOCKED` back to `LIVE_REMOTE_AND_VECTOR`. V4 now checks `ev.tile?.state === 'loaded'` before clearing errors or marking remote recovery, and suppresses `Streaming tiles...` flicker while offline/blocked.
- **Playwright Test 5 (`17_webgl_tile_outage_natural_earth_3d_1440.png`):** Aborting all three remote tile hosts (`tiles.maps.eox.at`, `tiles.openfreemap.org`, `gibs.earthdata.nasa.gov`) inside an active WebGL 3D session transitions cleanly to `IMAGERY_PROVIDER_BLOCKED`, renders bundled **Natural Earth 1:110m (CC0)** Baltic/Scandinavian coastlines on the 3D WebGL canvas at Basin zoom (`z6.5`), and shows the persistent amber warning banner without an indefinite black globe.
- **Simulated WebGL Denial (`M04`):** Navigating with `?mapFallback=1` activates the labeled 2D Natural Earth SVG fallback (`02c_explore_webgl_fallback_2d.png`).
