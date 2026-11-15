# PRIVATE state transfer — never commit or publish

The operational source archive contains the accepted cached teaching examples. The separate private checkpoint preserves the existing D store, including durable request/state/result/report/manifest files, FIFO metadata and hashed frontend session-ownership files. Existing checkpoint: **11 terminal analyses, zero pending jobs**, 176 hash-verified files at capture. See `PRIVATE_STATE_CHECKPOINT.json` for the exact archive hash. No access-code/bearer files or installed runtime environments are included.

Default recommendation: start clean on the teammate laptop; accepted fixtures are automatically reseeded. Transfer the private checkpoint only if historical durable analyses are needed. Copy it directly/private storage, never GitHub or public hosting.

1. Extract the operational handoff into a NEW directory and run `START_UNIFIED.ps1 -PrepareOnly`. Do not start normal services yet. If they were already started, create a new extraction rather than overlaying their store. Do not touch the currently running original demo.
2. Verify the private ZIP SHA-256 using `Get-FileHash`. While in the new `app` directory, run (replace the archive path/hash with the delivered values):

```powershell
python handoff\RESTORE_PRIVATE_STATE.py C:\Private\COMPETITION_PRIVATE_STATE_20261115T113047Z.zip --sha256 c75e39ed798c36ea2fc023d83d37c451b7d1b1ed4dc03c642a2c75f98e9844db
```

3. Start `START_UNIFIED.ps1`. It generates a new local frontend code and D bearer. D's accepted operator principal remains the same, so restored analysis ownership/run IDs/bytes remain intact. The helper checks the private archive manifest, disallows pending state and rejects any overwrite; original scientific files and provenance are not rewritten.
4. Run the short smoke. Keep all original snapshots until the teammate confirms success.

Session metadata is withheld by default during restore; add `--include-session-metadata` only if retaining historical ownership metadata is explicitly needed. Browser cookies are not in this archive and should not be shared. Existing chat conversations are ephemeral and must be recreated for a persisted analysis. A new browser session is not automatically granted another session's private analysis IDs; retained historical files remain available to the authorized operator. The accepted shared teaching fixtures remain accessible via the catalog.

Do not copy the original `.venv`, `node_modules`, local absolute-path runtime settings, tunnel process files, frontend access code or operator bearer. Recreate dependencies, credentials and the Quick Tunnel on the teammate's machine. A fresh host can legitimately reset queue-duration estimates to Estimating.
