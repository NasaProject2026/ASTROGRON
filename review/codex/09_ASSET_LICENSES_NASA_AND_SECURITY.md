# 09 — Asset Licensing, NASA Non-Endorsement & API Security Audit

## 1. Visual & Imagery Asset Licenses
- **Basemap Historical Mosaic (`EOX S2Cloudless 2016` / `s2cloudless_3857`):** Verified via `review/evidence/eox-license-check.json` (WMTS Capabilities HTTP `200`, `Creative Commons Attribution 4.0 International (CC BY 4.0)` — *"Contains modified Copernicus Sentinel data 2016"*). `2018-2025` vintages are intentionally excluded because of `CC BY-NC-SA 4.0` non-commercial restrictions. No external tile SLA is assumed.
- **Vector Map / Fallback Geometry:** `© OpenFreeMap / OpenStreetMap` contributors (`ODbL`) + bundled CC0 Natural Earth offline fallback.
- **V5 Hero Artwork (`public/assets/*.jpg`):** Preserved untouched per `UNPACKED_FRONTEND_V5_SLIM`; attribution documented in `review/08_ASSET_PROVENANCE_AND_REDISTRIBUTION.md`.

## 2. NASA Branding & Scientific Non-Endorsement
- UI header/banner and methodology screens consistently display:
  `Research experience using selected NASA Earth-data concepts. Not endorsed, certified, or operated by NASA.`
- No claim of official NASA certification, operational real-time SLA, or agronomy endorsement appears anywhere in UI copy or exports.

## 3. Read-Only Route Handler & Security Review
- `app/api/research/m14/route.ts` and `app/api/research/m4-coverage/route.ts` enforce strict Zod validation, strict site allowlisting (`../etc/passwd` -> HTTP `400`), SHA-256 verification before reading (`SOURCE_NOT_PROVIDED` on tamper), and zero filesystem write or shell-command execution paths.
- `app/api/geocode/route.ts` and `src/server/geocode-service.ts` prohibit public Nominatim autocomplete, forbid arbitrary URLs/SSRF targets, and fail closed (`503 GEOCODER_NOT_CONFIGURED`) when credentials are unset.
- Delivery package exclusions: zero `.env*` secrets, `node_modules`, `.next`, `.git`, `test-results`, or `playwright-report` directories.
