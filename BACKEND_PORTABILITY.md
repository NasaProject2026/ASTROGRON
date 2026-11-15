# Backend portability and persistent release state

The browser calls only same-origin `/api/core/*`. Next.js holds the backend URL and scoped D token on the server. A later backend move changes deployment configuration, without rewriting the application or changing its frontend origin. No cloud migration was performed in this mission.

Current path: browser HTTPS → one Cloudflare Quick Tunnel → Next.js on Windows → authenticated D on loopback → accepted A/B/C services. Cloudflare never routes directly to D, its filesystem or administrative services.

## Later Google Cloud move (not executed)

1. Keep the frontend and its Cloudflare hostname/tunnel separate from the scientific service. A lasting hostname requires a named Cloudflare tunnel with an owner-controlled domain. The current Quick Tunnel hostname survives frontend/backend restarts while that tunnel process remains alive; it is not permanent and changes if a new Quick Tunnel is created.
2. Use the same immutable CORE release and pinned Windows x64 runtime initially. A Linux port or numerical equivalence on a new host needs separate qualification. No Linux cloud deployment is validated here.
3. Drain/stop the science queue before copying state. Preserve `core/runtime/integration/release-demo/`, including request/result/report/manifest/state files and FIFO metadata, on persistent storage. Retain tenant/subject/farm ownership and analysis IDs. Reinstall environments from bundled locks; do not copy a virtual environment to another host. Preserve required private scientific runtime caches separately. Never edit immutable outputs to change recorded provenance.
4. Keep `runtime/frontend-sessions/` with the frontend so existing browser sessions retain analysis ownership. Backend chat sessions are ephemeral; recreate them for the same persisted analysis after a backend restart. Backend access credentials must map to the same D owner principal. Transfer credentials separately through private operational channels; source and state ZIPs omit them.
5. Put D behind a TLS endpoint and an authenticated proxy/firewall. Keep its direct listener private. Configure Next.js with the new HTTPS origin, exact hostname allowlist and private backend token file. Redirects, metadata addresses, raw remote IPs, URL credentials and unallowlisted hosts fail closed.

Example configuration only, with placeholders:

```powershell
.\START_UNIFIED.ps1 -RemoteBackendUrl https://science-api.example.org `
  -RemoteBackendAllowedHost science-api.example.org `
  -RemoteBackendTokenFile C:\Private\d-access.txt
```

Server environment names are `ASTRAGRON_BACKEND_URL`, `ASTRAGRON_BACKEND_ALLOWED_HOSTS`, and `ASTRAGRON_BACKEND_TOKEN_FILE`. None are `NEXT_PUBLIC_*` variables. Remote mode starts no competing local scientific backend. Four focused configuration tests cover local operation, future TLS routing and rejection cases. No actual remote/GCP service is claimed.

After restoring on a new host, run D's preflight and focused authenticated replay/queue/PDF checks before switching traffic. Preserve original scientific hashes. Queue-duration estimates are host-specific and may correctly return to **Estimating** on another machine.

## Immutable competition snapshots

`package_release.py` writes a deterministic source ZIP, verifies every exported SHA-256 and all 835 CORE hashes, and excludes credentials, installed environments, caches and duplicate WEB experimental engines. A final named competition copy and SHA-256 receipt seal the reviewed state.

`python save_private_state.py` writes a separate private idle-queue state archive under `runtime/checkpoints/`, verifies its hashes and omits access-code/bearer files. It contains private job/session ownership data and is excluded from the source release. Take it after jobs finish. It preserves actual persisted analyses in addition to the accepted public teaching fixtures in CORE.
