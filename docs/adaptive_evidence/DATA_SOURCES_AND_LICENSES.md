# Data Sources, Evidence Levels, and License Boundaries

Every retrieved or derived environmental quantity inside `adaptive_evidence` carries an explicit `evidence_level` and machine-readable provenance receipt:

| Source / Artifact | Evidence Level | License / Terms | Distribution & Scope Rules |
|---|---|---|---|
| NASA POWER Daily API (live TLS fetch) | `AUTHENTIC_LIVE` | NASA Open Data / Public Domain | HTTPS allow-listed `power.larc.nasa.gov`, UTC/LST separated, `-999` fill checked |
| NASA POWER Verified Receipt Cache | `AUTHENTIC_VERIFIED_CACHE` | NASA Open Data / Public Domain | SHA-256 verified raw payload + time_standard tag; max_age_days enforceable |
| ISRIC SoilGrids v2.0 WCS GeoTIFF (live/cached) | `AUTHENTIC_LIVE` / `AUTHENTIC_VERIFIED_CACHE` -> `VERIFIED_OPEN_SOURCE_MAP_ESTIMATE` | `CC BY 4.0` (NOT Apache-2.0) | 250 m model estimates; per-depth retrieval (`0-5`..`100-200cm`); `phh2o` scalar multi-horizon mean abstained |
| Natural Earth 10m Land/Lakes/Minor Islands | Bundled Spatial Mask | Public Domain | Offline shapefile vectors SHA-256 pinned; no coastline/lake guessing on miss |
| FAO GAEZ v4 / v5 | `BLOCKED` by default | Per-layer check required | Disabled unless verified non-NC per-layer CC-BY receipt is explicitly supplied |
| User soil/water declarations | `USER_DECLARED_SCENARIO` | User supplied | Downgraded from "measured" claim unless date + method (+ depth) metadata are present |
| PTF & Hargreaves-Samani derivations | `SCIENTIFIC_DERIVATION` | Code: Apache-2.0; Equations: cited | Out-of-domain organic peat (`SOC >= 120 g/kg`) and heavy clay (`>= 80%`) fail closed |
| Offline test controls | `SYNTHETIC_TEST_FIXTURE` | Test fixture only | Never upgraded to claim verification; rejected as authentic field/source evidence |
