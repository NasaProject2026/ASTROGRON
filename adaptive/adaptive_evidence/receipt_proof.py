"""Cryptographic source-byte and trusted receipt-store proof verification for ASTRAGRON Adaptive Evidence.

This module enforces the provenance trust boundary between caller-supplied or
advisory JSON metadata and independently verifiable source artifacts:
- Arbitrary caller-controlled booleans (`verified`, `is_authentic_source`),
  arbitrary `receipt_path`/`access_path` strings, arbitrary `source_id` strings,
  or unbacked SHA-256 hex strings NEVER suffice to authenticate observations.
- No external URLs are fetched and no arbitrary filesystem paths from JSON payloads
  are opened (blocking path traversal and symlink escapes).
- NASA POWER claims (`AUTHENTIC_LIVE` / `AUTHENTIC_VERIFIED_CACHE`) are verified
  against allowlisted on-disk receipt + raw daily JSON bytes, coordinate/window/
  time-standard alignment, and recomputed numerical summaries.
- SoilGrids v2.0 claims are verified against allowlisted on-disk normalized
  extract `.receipt.json` stores (`payload_sha256`, `receipt_sha256`, coordinate,
  native depth overlap, and scaled SI value alignment), explicitly distinguishing:
  1) in-process live GeoTIFF decode attestations (`AUTHENTIC_VERIFIED_RAW_SOURCE`,
     `raw_bytes_verified=True`), and
  2) offline normalized JSON cache extracts where raw `.tif` binaries are
     intentionally omitted (`LOCALLY_INTEGRITY_VERIFIED_CACHE_EXTRACT`,
     `raw_bytes_verified=False`, `captured_extract_integrity_verified=True`).
"""
from __future__ import annotations

from collections import deque
import hashlib
import hmac
import json
import math
from pathlib import Path
import re
import secrets
import threading
from typing import Any, Deque, Dict, Iterable, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parent.parent
WATER_CORE_DIR = ROOT / "SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109" / "release" / "water_core"

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def validate_sha256_hex(value: Any) -> bool:
    return isinstance(value, str) and bool(_SHA256_RE.match(value))

# Per-process unpredictable CSPRNG key for unforgeable live adapter fetch attestations.
# Never serialized to disk, never exposed in JSON responses, and never predictable across runs.
_PROCESS_ATTESTATION_KEY = secrets.token_bytes(32)
_MAX_LIVE_ATTESTATIONS = 4096
_ATTESTATION_LOCK = threading.Lock()
_LIVE_ATTESTATIONS: Dict[str, Dict[str, Any]] = {}
_LIVE_ORDER: Deque[str] = deque()

DEFAULT_TRUSTED_NASA_STORES: Tuple[Path, ...] = (
    WATER_CORE_DIR / "data",
    WATER_CORE_DIR / "source_cache",
    ROOT / "adaptive_evidence" / "data" / "nasa_power_global_cache",
    ROOT / "runtime" / "agent-a" / "adaptive_evidence_nasa_cache",
)

DEFAULT_TRUSTED_SOILGRIDS_STORES: Tuple[Path, ...] = (
    ROOT / "examples" / "adaptive_evidence" / "soilgrids_wcs_cache",
    ROOT / "adaptive_evidence" / "data" / "soilgrids_global_cache",
    ROOT / "runtime" / "agent-a" / "adaptive_evidence_soilgrids_cache",
)

SOILGRIDS_CANONICAL_NATIVE_LAYERS: Tuple[Tuple[float, float, str], ...] = (
    (0.0, 5.0, "0-5cm"),
    (5.0, 15.0, "5-15cm"),
    (15.0, 30.0, "15-30cm"),
    (30.0, 60.0, "30-60cm"),
    (60.0, 100.0, "60-100cm"),
    (100.0, 200.0, "100-200cm"),
)

SOILGRIDS_EXPECTED_SCALES: Dict[str, Tuple[float, str]] = {
    "clay": (0.1, "%"),
    "silt": (0.1, "%"),
    "sand": (0.1, "%"),
    "bdod": (0.01, "kg/dm3"),
    "cfvo": (0.1, "vol%"),
    "soc": (0.1, "g/kg"),
    "phh2o": (0.1, "pH"),
}


def _live_sig(source_kind: str, raw_sha: str, rec_sha: str, lon: float, lat: float, detail: str) -> str:
    msg = f"{source_kind}|{raw_sha}|{rec_sha}|{round(float(lon), 4)}|{round(float(lat), 4)}|{detail}".encode("utf-8")
    return hmac.new(_PROCESS_ATTESTATION_KEY, msg, hashlib.sha256).hexdigest()


def issue_live_attestation(
    *,
    source_kind: str,
    raw_sha: str,
    rec_sha: str,
    point_lon_lat: Sequence[float],
    detail: str = "",
) -> str:
    """Register an in-process live provider decode event verified during this Python execution."""
    if not validate_sha256_hex(raw_sha) or not validate_sha256_hex(rec_sha):
        return ""
    if len(point_lon_lat) != 2:
        return ""
    lon, lat = round(float(point_lon_lat[0]), 4), round(float(point_lon_lat[1]), 4)
    sig = _live_sig(source_kind, raw_sha, rec_sha, lon, lat, detail)
    with _ATTESTATION_LOCK:
        if sig not in _LIVE_ATTESTATIONS:
            if len(_LIVE_ORDER) >= _MAX_LIVE_ATTESTATIONS:
                old = _LIVE_ORDER.popleft()
                _LIVE_ATTESTATIONS.pop(old, None)
            _LIVE_ORDER.append(sig)
        _LIVE_ATTESTATIONS[sig] = {
            "source_kind": source_kind,
            "raw_sha": raw_sha,
            "rec_sha": rec_sha,
            "lon": lon,
            "lat": lat,
            "detail": detail,
        }
    return sig


def has_live_attestation(
    *,
    source_kind: str,
    raw_sha: str,
    rec_sha: str,
    lon: float,
    lat: float,
    detail: str = "",
) -> bool:
    """Check whether this exact verified live source payload was decoded in-process."""
    sig = _live_sig(source_kind, raw_sha, rec_sha, lon, lat, detail)
    with _ATTESTATION_LOCK:
        return sig in _LIVE_ATTESTATIONS


def _canonical_json_sha256(obj: Any) -> str:
    encoded = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _safe_dirs(dirs: Iterable[Any]) -> List[Path]:
    """Filter strictly to real, non-symlink existing directories; ignore strings/JSON inputs."""
    out: List[Path] = []
    seen: set[Path] = set()
    for d in dirs:
        if not isinstance(d, Path):
            continue
        try:
            if d.is_symlink() or not d.is_dir():
                continue
            resolved = d.resolve()
        except OSError:
            continue
        if resolved not in seen:
            seen.add(resolved)
            out.append(resolved)
    return out


def _safe_read_regular_bytes(path: Path) -> Optional[bytes]:
    try:
        if path.is_symlink() or not path.is_file():
            return None
        return path.read_bytes()
    except OSError:
        return None


def _is_close_point(pt1: Sequence[Any], pt2: Sequence[Any], tol: float = 1e-4) -> bool:
    try:
        lon1, lat1 = float(pt1[0]), float(pt1[1])
        lon2, lat2 = float(pt2[0]), float(pt2[1])
    except (TypeError, ValueError, IndexError):
        return False
    return abs(lon1 - lon2) <= tol and abs(lat1 - lat2) <= tol


def _nasa_receipt_time_standard(rec: Dict[str, Any], doc: Optional[Dict[str, Any]] = None) -> str:
    url = str(rec.get("url") or "")
    if "time-standard=LST" in url:
        return "LST"
    if isinstance(doc, dict):
        hdr = str((doc.get("header") or {}).get("title") or "")
        if "Local Solar Time" in hdr:
            return "LST"
    return "UTC"


def _locate_nasa_raw_file(folder: Path, rec_path: Path, expected_raw_sha: str) -> Optional[Path]:
    """Locate the raw NASA POWER JSON artifact sibling strictly inside `folder`."""
    candidates: List[Path] = [folder / f"{expected_raw_sha}.raw.json"]
    if rec_path.name == "POWER_RECEIPT.json":
        candidates.append(folder / "POWER_2006_2025.json")
    elif rec_path.name.endswith(".receipt.json"):
        stem = rec_path.name[: -len(".receipt.json")]
        candidates.append(folder / f"{stem}.raw.json")
    for cand in candidates:
        try:
            if cand.is_symlink() or not cand.is_file():
                continue
            if cand.resolve().parent != folder:
                continue
            return cand
        except OSError:
            continue
    return None


def _recompute_nasa_summary(
    doc: Dict[str, Any],
    variable: str,
    start_iso: str,
    end_iso: str,
) -> Tuple[Optional[float], Optional[str], Optional[str]]:
    """Independently compute annual/sub-annual summary from raw NASA POWER JSON bytes."""
    from datetime import date, timedelta

    params = (doc.get("properties") or {}).get("parameter")
    if not isinstance(params, dict):
        return None, None, "NASA raw JSON lacks properties.parameter mapping."
    if variable not in params or not isinstance(params[variable], dict):
        return None, None, f"NASA raw JSON lacks requested variable '{variable}'."
    try:
        d_start = date.fromisoformat(start_iso)
        d_end = date.fromisoformat(end_iso)
    except ValueError:
        return None, None, "Invalid climate valid_period date bounds."
    if d_end < d_start:
        return None, None, "Inverted climate valid_period."

    series = params[variable]
    vals: List[float] = []
    by_year: Dict[int, float] = {}
    cur = d_start
    while cur <= d_end:
        ymd = cur.strftime("%Y%m%d")
        raw_v = series.get(ymd)
        if raw_v is None or isinstance(raw_v, bool):
            return None, None, f"NASA raw JSON missing daily entry {ymd} for {variable}."
        try:
            fv = float(raw_v)
        except (TypeError, ValueError):
            return None, None, f"NASA raw JSON non-numeric entry {ymd} for {variable}."
        if not math.isfinite(fv) or abs(fv - (-999.0)) < 1e-9 or abs(fv - (-99.0)) < 1e-9:
            return None, None, f"NASA raw JSON sentinel value at {ymd} for {variable}."
        if variable == "PRECTOTCORR" and fv < 0.0:
            return None, None, f"NASA raw JSON negative precipitation at {ymd}."
        vals.append(fv)
        by_year[cur.year] = by_year.get(cur.year, 0.0) + fv
        cur += timedelta(days=1)

    if not vals:
        return None, None, "Empty NASA daily observation sequence."
    is_sub = len(vals) < 365
    if variable == "PRECTOTCORR":
        if is_sub:
            return round(math.fsum(vals), 2), "mm", None
        return round(math.fsum(by_year.values()) / max(1, len(by_year)), 2), "mm/year", None
    if variable in ("T2M", "T2M_MIN", "T2M_MAX"):
        return round(math.fsum(vals) / len(vals), 2), "C", None
    return round(math.fsum(vals) / len(vals), 2), None, None


def _verify_nasa_power_proof(
    ev: Dict[str, Any],
    trusted_nasa_dirs: Sequence[Path],
) -> Dict[str, Any]:
    """Verify NASA POWER evidence against allowlisted raw bytes, receipt, metadata, and values."""
    ev_raw_sha = str(ev.get("raw_source_sha256") or "")
    ev_rec_sha = str(ev.get("receipt_sha256") or "")
    ev_level = str(ev.get("evidence_level") or "")
    ev_var = str(ev.get("variable") or "")
    ev_pt = ev.get("point_lon_lat")
    ev_vp = ev.get("valid_period")
    ev_ret = str(ev.get("retrieved_at") or "")

    dirs = _safe_dirs(list(trusted_nasa_dirs) + list(DEFAULT_TRUSTED_NASA_STORES))
    matched_any_receipt = False
    first_mismatch: Optional[Tuple[str, str]] = None

    def _note_mismatch(code: str, detail: str) -> None:
        nonlocal first_mismatch
        if first_mismatch is None:
            first_mismatch = (code, detail)

    def _reject(code: str, detail: str) -> Dict[str, Any]:
        return {
            "status": "REJECTED",
            "verified": False,
            "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
            "reason_code": code,
            "raw_bytes_verified": False,
            "captured_extract_integrity_verified": False,
            "upstream_cryptographic_authenticity_proven": False,
            "detail": detail,
        }

    for folder in dirs:
        try:
            rpaths = sorted(folder.glob("*.receipt.json"))
            pr = folder / "POWER_RECEIPT.json"
            if pr.exists():
                rpaths.append(pr)
        except OSError:
            continue

        for rpath in rpaths:
            rec_bytes = _safe_read_regular_bytes(rpath)
            if rec_bytes is None:
                continue
            try:
                rec = json.loads(rec_bytes.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                continue
            if not isinstance(rec, dict):
                continue

            file_rec_sha = hashlib.sha256(rec_bytes).hexdigest()
            inner_rec_sha = str(rec.get("receipt_sha256") or "")
            rec_raw_sha = str(rec.get("sha256") or "")
            if not validate_sha256_hex(rec_raw_sha):
                continue

            # Identify whether this stored receipt corresponds to the evidence hashes
            rec_hash_matches = (ev_rec_sha == file_rec_sha) or (bool(inner_rec_sha) and ev_rec_sha == inner_rec_sha)
            raw_hash_matches = (ev_raw_sha == rec_raw_sha)
            if not rec_hash_matches and not raw_hash_matches:
                continue

            matched_any_receipt = True

            # Verify v2 receipt internal canonical checksum if v2 schema
            if str(rec.get("schema") or "") == "astragron.nasa-global-receipt.v2":
                expected_inner = _canonical_json_sha256({k: v for k, v in rec.items() if k != "receipt_sha256"})
                if inner_rec_sha != expected_inner:
                    return _reject(
                        "SOURCE_RECEIPT_INTEGRITY_MISMATCH",
                        f"Stored NASA v2 receipt {rpath.name} failed internal canonical checksum verification.",
                    )

            if not (rec_hash_matches and raw_hash_matches):
                _note_mismatch(
                    "SOURCE_RECEIPT_INTEGRITY_MISMATCH",
                    f"Evidence raw_source_sha256/receipt_sha256 pair does not match stored receipt {rpath.name}.",
                )
                continue

            raw_path = _locate_nasa_raw_file(folder, rpath, rec_raw_sha)
            if raw_path is None:
                return _reject(
                    "SOURCE_RECEIPT_INTEGRITY_MISMATCH",
                    f"Stored NASA receipt {rpath.name} lacks backing raw JSON file inside store.",
                )
            raw_bytes = _safe_read_regular_bytes(raw_path)
            if raw_bytes is None:
                return _reject("SOURCE_RECEIPT_INTEGRITY_MISMATCH", f"Unreadable backing raw file {raw_path.name}.")
            actual_raw_sha = hashlib.sha256(raw_bytes).hexdigest()
            if actual_raw_sha != rec_raw_sha:
                return _reject(
                    "SOURCE_RECEIPT_INTEGRITY_MISMATCH",
                    f"Raw byte SHA-256 mismatch for {raw_path.name} (file tampered or mismatched).",
                )
            if actual_raw_sha != ev_raw_sha:
                _note_mismatch(
                    "SOURCE_RECEIPT_INTEGRITY_MISMATCH",
                    f"Evidence raw_source_sha256 differs from {raw_path.name}.",
                )
                continue

            try:
                doc = json.loads(raw_bytes.decode("utf-8-sig"))
            except (UnicodeDecodeError, ValueError):
                return _reject("SOURCE_RECEIPT_INTEGRITY_MISMATCH", f"Corrupt JSON inside {raw_path.name}.")

            # Coordinate alignment check against receipt point and raw GeoJSON coordinates
            rec_pt = rec.get("point_lon_lat")
            if rec_pt is None and rpath.name == "POWER_RECEIPT.json":
                rec_pt = [17.65, 59.82]
            doc_coords = (doc.get("geometry") or {}).get("coordinates")
            if not isinstance(ev_pt, (list, tuple)) or len(ev_pt) != 2:
                _note_mismatch("SOURCE_RECEIPT_CONTENT_MISMATCH", "Evidence lacks valid [lon, lat].")
                continue
            if rec_pt is not None and not _is_close_point(ev_pt, rec_pt, tol=1e-3):
                _note_mismatch(
                    "SOURCE_RECEIPT_CONTENT_MISMATCH",
                    f"Evidence coordinates {list(ev_pt)} do not match receipt point {rec_pt}.",
                )
                continue
            if isinstance(doc_coords, (list, tuple)) and len(doc_coords) >= 2:
                if not _is_close_point(ev_pt, doc_coords[:2], tol=0.65):
                    _note_mismatch(
                        "SOURCE_RECEIPT_CONTENT_MISMATCH",
                        f"Evidence coordinates {list(ev_pt)} do not match raw POWER geometry {doc_coords[:2]}.",
                    )
                    continue

            # Period and retrieved_at alignment check
            if not isinstance(ev_vp, (list, tuple)) or len(ev_vp) != 2:
                _note_mismatch("SOURCE_RECEIPT_CONTENT_MISMATCH", "Evidence lacks valid_period bounds.")
                continue
            s_iso, e_iso = str(ev_vp[0]), str(ev_vp[1])
            rec_per = rec.get("period")
            if isinstance(rec_per, (list, tuple)) and len(rec_per) == 2:
                if not (str(rec_per[0]) <= s_iso <= e_iso <= str(rec_per[1])):
                    _note_mismatch(
                        "SOURCE_RECEIPT_CONTENT_MISMATCH",
                        f"Evidence valid_period {ev_vp} falls outside stored receipt period {rec_per}.",
                    )
                    continue
            rec_ret = str(rec.get("retrieved_at") or "")
            if rec_ret and ev_ret and rec_ret != ev_ret:
                _note_mismatch(
                    "SOURCE_RECEIPT_CONTENT_MISMATCH",
                    f"Evidence retrieved_at ({ev_ret}) differs from stored receipt ({rec_ret}).",
                )
                continue

            # Time standard check against receipt/raw header
            rec_tstd = _nasa_receipt_time_standard(rec, doc)
            qflags = set(str(f) for f in (ev.get("quality_flags") or []))
            if f"{rec_tstd}_TIME_STANDARD" not in qflags and (
                ("UTC_TIME_STANDARD" in qflags and rec_tstd != "UTC")
                or ("LST_TIME_STANDARD" in qflags and rec_tstd != "LST")
            ):
                _note_mismatch(
                    "SOURCE_RECEIPT_CONTENT_MISMATCH",
                    f"Evidence time-standard flags {sorted(qflags)} conflict with receipt time_standard={rec_tstd}.",
                )
                continue

            # Recompute actual observation value from raw bytes and compare
            comp_val, expected_unit, err_msg = _recompute_nasa_summary(doc, ev_var, s_iso, e_iso)
            if err_msg is not None or comp_val is None:
                _note_mismatch("SOURCE_RECEIPT_CONTENT_MISMATCH", err_msg or "Failed raw value verification.")
                continue
            try:
                claimed_val = float(ev.get("converted_si_value"))
            except (TypeError, ValueError):
                _note_mismatch("SOURCE_RECEIPT_CONTENT_MISMATCH", "Non-numeric converted_si_value.")
                continue
            if abs(comp_val - claimed_val) > 0.05:
                _note_mismatch(
                    "SOURCE_RECEIPT_CONTENT_MISMATCH",
                    f"Claimed {ev_var}={claimed_val} disagrees with recomputed raw-byte value {comp_val}.",
                )
                continue
            if expected_unit and str(ev.get("si_unit") or "") != expected_unit:
                _note_mismatch(
                    "SOURCE_RECEIPT_CONTENT_MISMATCH",
                    f"Claimed si_unit={ev.get('si_unit')} disagrees with expected {expected_unit} for {ev_var}.",
                )
                continue

            # Distinguishing live-fetched authentic vs cached authentic raw verification
            if ev_level == "AUTHENTIC_LIVE":
                clon, clat = round(float(rec_pt[0]), 4), round(float(rec_pt[1]), 4)
                detail_range = f"{str(rec_per[0]) if isinstance(rec_per, (list, tuple)) and len(rec_per)==2 else s_iso}..{str(rec_per[1]) if isinstance(rec_per, (list, tuple)) and len(rec_per)==2 else e_iso}:{rec_tstd}"
                if not has_live_attestation(
                    source_kind="NASA_POWER",
                    raw_sha=actual_raw_sha,
                    rec_sha=ev_rec_sha,
                    lon=clon,
                    lat=clat,
                    detail=detail_range,
                ) and not has_live_attestation(
                    source_kind="NASA_POWER",
                    raw_sha=actual_raw_sha,
                    rec_sha=ev_rec_sha,
                    lon=float(ev_pt[0]),
                    lat=float(ev_pt[1]),
                    detail=detail_range,
                ):
                    return {
                        "status": "REJECTED",
                        "verified": False,
                        "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
                        "reason_code": "UNVERIFIED_LIVE_ATTESTATION",
                        "raw_bytes_verified": False,
                        "captured_extract_integrity_verified": True,
                        "upstream_cryptographic_authenticity_proven": False,
                        "detail": (
                            "Claimed AUTHENTIC_LIVE NASA POWER evidence without an in-process verified live fetch "
                            "attestation; cached artifacts cannot self-promote to AUTHENTIC_LIVE."
                        ),
                    }

            return {
                "status": "VERIFIED",
                "verified": True,
                "proof_tier": "AUTHENTIC_VERIFIED_RAW_SOURCE",
                "reason_code": None,
                "raw_bytes_verified": True,
                "captured_extract_integrity_verified": True,
                "upstream_cryptographic_authenticity_proven": False,
                "detail": (
                    f"Verified NASA POWER raw JSON bytes ({actual_raw_sha[:12]}...) and stored receipt {rpath.name}; "
                    "recomputed observation value matches captured raw series (local byte integrity, not upstream PKI)."
                ),
            }

    if matched_any_receipt and first_mismatch is not None:
        return {
            "status": "REJECTED",
            "verified": False,
            "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
            "reason_code": first_mismatch[0],
            "raw_bytes_verified": False,
            "captured_extract_integrity_verified": False,
            "upstream_cryptographic_authenticity_proven": False,
            "detail": first_mismatch[1],
        }

    return {
        "status": "UNVERIFIED",
        "verified": False,
        "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
        "reason_code": "UNVERIFIED_SOURCE_PROOF",
        "raw_bytes_verified": False,
        "captured_extract_integrity_verified": False,
        "upstream_cryptographic_authenticity_proven": False,
        "detail": (
            "No backing NASA POWER raw JSON artifact and receipt matching "
            "raw_source_sha256/receipt_sha256 exist in allowlisted stores or live fetch attestations."
        ),
    }


def _overlapping_soil_layers(ev: Dict[str, Any]) -> Tuple[List[Tuple[str, float]], bool]:
    """Return expected [(depth_label, weight), ...] and whether evidence is a single native horizon object."""
    pp = str(ev.get("parameter_path") or "")
    parts = pp.split(".")
    if len(parts) >= 3 and parts[0] == "soil":
        return [(parts[2], 1.0)], True

    di = ev.get("depth_interval_cm")
    if not isinstance(di, (list, tuple)) or len(di) != 2:
        return [], False
    try:
        d0, d1 = float(di[0]), float(di[1])
    except (TypeError, ValueError):
        return [], False
    total = d1 - d0
    if total <= 0.0:
        return [], False

    overlaps: List[Tuple[str, float]] = []
    for b0, b1, lbl in SOILGRIDS_CANONICAL_NATIVE_LAYERS:
        o0, o1 = max(d0, b0), min(d1, b1)
        if o1 > o0:
            overlaps.append((lbl, (o1 - o0) / total))
    return overlaps, False


def _verify_soilgrids_proof(
    ev: Dict[str, Any],
    trusted_soilgrids_dirs: Sequence[Path],
) -> Dict[str, Any]:
    """Verify SoilGrids evidence against allowlisted normalized extract receipts or live GeoTIFF attestations."""
    ev_raw_sha = str(ev.get("raw_source_sha256") or "")
    ev_rec_sha = str(ev.get("receipt_sha256") or "")
    ev_level = str(ev.get("evidence_level") or "")
    ev_var = str(ev.get("variable") or "")
    ev_pt = ev.get("point_lon_lat")
    ev_ret = str(ev.get("retrieved_at") or "")

    overlaps, is_native_layer_obj = _overlapping_soil_layers(ev)
    if not overlaps or not isinstance(ev_pt, (list, tuple)) or len(ev_pt) != 2:
        return {
            "status": "REJECTED",
            "verified": False,
            "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
            "reason_code": "SOURCE_RECEIPT_CONTENT_MISMATCH",
            "raw_bytes_verified": False,
            "captured_extract_integrity_verified": False,
            "upstream_cryptographic_authenticity_proven": False,
            "detail": "SoilGrids evidence lacks valid point coordinates or resolvable depth interval.",
        }

    dirs = _safe_dirs(list(trusted_soilgrids_dirs) + list(DEFAULT_TRUSTED_SOILGRIDS_STORES))
    needed_labels = {lbl for lbl, _ in overlaps}

    # Index matching point receipts across allowlisted SoilGrids directories
    by_label: Dict[str, List[Tuple[Path, Dict[str, Any], str, Optional[Tuple[str, str]]]]] = {
        lbl: [] for lbl in needed_labels
    }
    point_mismatch_seen: Optional[Tuple[str, str]] = None

    for folder in dirs:
        try:
            rpaths = sorted(folder.glob("*.receipt.json"))
        except OSError:
            continue
        for rpath in rpaths:
            rbytes = _safe_read_regular_bytes(rpath)
            if rbytes is None:
                continue
            try:
                rec = json.loads(rbytes.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                continue
            if not isinstance(rec, dict) or "properties" not in rec or "depth_label" not in rec:
                continue
            lbl = str(rec.get("depth_label") or "")
            if lbl not in needed_labels:
                continue
            file_rec_sha = hashlib.sha256(rbytes).hexdigest()
            rec_pt = rec.get("point_lon_lat")
            if not _is_close_point(ev_pt, rec_pt or [], tol=1e-4):
                # Check if someone copied a real receipt hash onto wrong coordinates
                if ev_rec_sha == file_rec_sha or ev_raw_sha == str(rec.get("payload_sha256") or ""):
                    point_mismatch_seen = (
                        "SOURCE_RECEIPT_CONTENT_MISMATCH",
                        f"SoilGrids receipt {rpath.name} point {rec_pt} conflicts with evidence coordinates {list(ev_pt)}.",
                    )
                continue

            # Validate payload integrity & geotiff hash metadata immediately
            props = rec.get("properties")
            if not isinstance(props, dict):
                by_label[lbl].append((rpath, rec, file_rec_sha, ("SOURCE_RECEIPT_INTEGRITY_MISMATCH", f"Corrupt properties in {rpath.name}.")))
                continue
            actual_payload_sha = _canonical_json_sha256(props)
            if str(rec.get("payload_sha256") or "") != actual_payload_sha:
                by_label[lbl].append(
                    (
                        rpath,
                        rec,
                        file_rec_sha,
                        (
                            "SOURCE_RECEIPT_INTEGRITY_MISMATCH",
                            f"SoilGrids receipt {rpath.name} payload_sha256 failed canonical properties hash check.",
                        ),
                    )
                )
                continue
            gt = rec.get("geotiff_sha256")
            if not isinstance(gt, dict) or not gt or not all(validate_sha256_hex(v) for v in gt.values()):
                by_label[lbl].append(
                    (
                        rpath,
                        rec,
                        file_rec_sha,
                        (
                            "SOURCE_RECEIPT_INTEGRITY_MISMATCH",
                            f"SoilGrids receipt {rpath.name} lacks valid 64-hex geotiff_sha256 records.",
                        ),
                    )
                )
                continue
            by_label[lbl].append((rpath, rec, file_rec_sha, None))

    if point_mismatch_seen is not None and not any(by_label.values()):
        return {
            "status": "REJECTED",
            "verified": False,
            "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
            "reason_code": point_mismatch_seen[0],
            "raw_bytes_verified": False,
            "captured_extract_integrity_verified": False,
            "upstream_cryptographic_authenticity_proven": False,
            "detail": point_mismatch_seen[1],
        }

    # Check if any required horizon is missing or corrupted
    selected: Dict[str, Tuple[Path, Dict[str, Any], str]] = {}
    first_corrupt: Optional[Tuple[str, str]] = None
    for lbl, _ in overlaps:
        cands = by_label.get(lbl, [])
        for c in cands:
            if c[3] is not None:
                return {
                    "status": "REJECTED",
                    "verified": False,
                    "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
                    "reason_code": c[3][0],
                    "raw_bytes_verified": False,
                    "captured_extract_integrity_verified": False,
                    "upstream_cryptographic_authenticity_proven": False,
                    "detail": c[3][1],
                }
        valid_cands = [c for c in cands if c[3] is None]
        if not valid_cands:
            # No receipt found in allowlisted stores for these coordinates/depths
            return {
                "status": "UNVERIFIED",
                "verified": False,
                "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
                "reason_code": "UNVERIFIED_SOURCE_PROOF",
                "raw_bytes_verified": False,
                "captured_extract_integrity_verified": False,
                "upstream_cryptographic_authenticity_proven": False,
                "detail": (
                    f"No backing SoilGrids receipt for coordinates {list(ev_pt)} horizon '{lbl}' "
                    "in allowlisted stores."
                ),
            }
        # Prefer candidate matching direct receipt_sha256 if single layer
        chosen = valid_cands[0]
        if len(overlaps) == 1:
            for cand in valid_cands:
                if cand[2] == ev_rec_sha or str(cand[1].get("payload_sha256")) == ev_raw_sha:
                    chosen = cand
                    break
        selected[lbl] = (chosen[0], chosen[1], chosen[2])

    # Verify composite vs single-layer SHA bindings
    if is_native_layer_obj and len(overlaps) == 1:
        lbl_only = overlaps[0][0]
        _, rec_only, rec_sha_only = selected[lbl_only]
        exp_raw = str(rec_only["payload_sha256"])
        exp_rec = rec_sha_only
    else:
        exp_raw = hashlib.sha256(
            json.dumps({lbl: str(selected[lbl][1]["payload_sha256"]) for lbl in sorted(selected)}, sort_keys=True).encode("utf-8")
        ).hexdigest()
        exp_rec = hashlib.sha256(
            json.dumps({lbl: str(selected[lbl][2]) for lbl in sorted(selected)}, sort_keys=True).encode("utf-8")
        ).hexdigest()

    if ev_raw_sha != exp_raw or ev_rec_sha != exp_rec:
        return {
            "status": "REJECTED",
            "verified": False,
            "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
            "reason_code": "SOURCE_RECEIPT_INTEGRITY_MISMATCH",
            "raw_bytes_verified": False,
            "captured_extract_integrity_verified": False,
            "upstream_cryptographic_authenticity_proven": False,
            "detail": (
                f"SoilGrids evidence raw_source_sha256/receipt_sha256 does not match stored receipt(s) "
                f"for {list(ev_pt)} {sorted(selected.keys())}."
            ),
        }

    # Verify scaled SI value consistency against stored SoilGrids properties
    scale_info = SOILGRIDS_EXPECTED_SCALES.get(ev_var)
    if scale_info is not None:
        expected_scale, expected_unit = scale_info
        weighted_mean = 0.0
        for lbl, w in overlaps:
            prop_block = (selected[lbl][1].get("properties") or {}).get(ev_var)
            if not isinstance(prop_block, dict) or prop_block.get("mean") is None:
                return {
                    "status": "REJECTED",
                    "verified": False,
                    "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
                    "reason_code": "SOURCE_RECEIPT_CONTENT_MISMATCH",
                    "raw_bytes_verified": False,
                    "captured_extract_integrity_verified": False,
                    "upstream_cryptographic_authenticity_proven": False,
                    "detail": f"Stored SoilGrids horizon {lbl} lacks '{ev_var}' data.",
                }
            weighted_mean += w * (float(prop_block["mean"]) * expected_scale)
        try:
            claimed_si = float(ev.get("converted_si_value"))
        except (TypeError, ValueError):
            return {
                "status": "REJECTED",
                "verified": False,
                "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
                "reason_code": "SOURCE_RECEIPT_CONTENT_MISMATCH",
                "raw_bytes_verified": False,
                "captured_extract_integrity_verified": False,
                "upstream_cryptographic_authenticity_proven": False,
                "detail": "SoilGrids evidence lacks numeric converted_si_value.",
            }
        if abs(round(weighted_mean, 2) - claimed_si) > 0.15:
            return {
                "status": "REJECTED",
                "verified": False,
                "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
                "reason_code": "SOURCE_RECEIPT_CONTENT_MISMATCH",
                "raw_bytes_verified": False,
                "captured_extract_integrity_verified": False,
                "upstream_cryptographic_authenticity_proven": False,
                "detail": (
                    f"Claimed {ev_var}={claimed_si} conflicts with stored receipt depth-weighted SI mean "
                    f"{round(weighted_mean, 2)}."
                ),
            }
        if str(ev.get("si_unit") or "") != expected_unit:
            return {
                "status": "REJECTED",
                "verified": False,
                "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
                "reason_code": "SOURCE_RECEIPT_CONTENT_MISMATCH",
                "raw_bytes_verified": False,
                "captured_extract_integrity_verified": False,
                "upstream_cryptographic_authenticity_proven": False,
                "detail": f"Claimed SoilGrids unit {ev.get('si_unit')} disagrees with {expected_unit}.",
            }

    # Verify retrieved_at matches one of the backing layer receipts
    known_rets = {str(selected[lbl][1].get("retrieved_at") or "") for lbl in selected}
    if ev_ret and known_rets and ev_ret not in known_rets:
        return {
            "status": "REJECTED",
            "verified": False,
            "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
            "reason_code": "SOURCE_RECEIPT_CONTENT_MISMATCH",
            "raw_bytes_verified": False,
            "captured_extract_integrity_verified": False,
            "upstream_cryptographic_authenticity_proven": False,
            "detail": f"SoilGrids evidence retrieved_at ({ev_ret}) differs from stored receipt timestamps.",
        }

    # Check whether in-process live GeoTIFF bytes were decoded in this session vs offline normalized extract
    lon_v, lat_v = float(ev_pt[0]), float(ev_pt[1])
    live_layers = [
        lbl
        for lbl in selected
        if has_live_attestation(
            source_kind="SOILGRIDS_WCS",
            raw_sha=str(selected[lbl][1]["payload_sha256"]),
            rec_sha=str(selected[lbl][2]),
            lon=lon_v,
            lat=lat_v,
            detail=lbl,
        )
    ]
    if ev_level == "AUTHENTIC_LIVE":
        if not live_layers:
            return {
                "status": "REJECTED",
                "verified": False,
                "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
                "reason_code": "UNVERIFIED_LIVE_ATTESTATION",
                "raw_bytes_verified": False,
                "captured_extract_integrity_verified": True,
                "upstream_cryptographic_authenticity_proven": False,
                "detail": (
                    "Claimed AUTHENTIC_LIVE SoilGrids evidence lacks in-process live GeoTIFF decode attestation; "
                    "offline normalized extracts cannot self-promote to AUTHENTIC_LIVE."
                ),
            }
        return {
            "status": "VERIFIED",
            "verified": True,
            "proof_tier": "AUTHENTIC_VERIFIED_RAW_SOURCE",
            "reason_code": None,
            "raw_bytes_verified": True,
            "captured_extract_integrity_verified": True,
            "upstream_cryptographic_authenticity_proven": False,
            "detail": (
                f"In-process live SoilGrids GeoTIFF decode + receipt integrity verified across "
                f"{sorted(live_layers)} (raw WCS GeoTIFF SHA-256 captured in session)."
            ),
        }

    return {
        "status": "VERIFIED",
        "verified": True,
        "proof_tier": "LOCALLY_INTEGRITY_VERIFIED_CACHE_EXTRACT",
        "reason_code": None,
        "raw_bytes_verified": False,
        "captured_extract_integrity_verified": True,
        "upstream_cryptographic_authenticity_proven": False,
        "detail": (
            f"Normalized SoilGrids v2.0 JSON extract integrity verified via payload_sha256 and receipt_sha256 "
            f"for {sorted(selected.keys())}; original GeoTIFF binaries are intentionally omitted offline, "
            "so capture extract integrity is established rather than offline raw raster bytes."
        ),
    }


def verify_authentic_evidence_proof(
    ev: Dict[str, Any],
    *,
    trusted_nasa_dirs: Sequence[Path] = (),
    trusted_soilgrids_dirs: Sequence[Path] = (),
) -> Dict[str, Any]:
    """Independently verify source backing for an evidence dict claiming OBSERVED_OR_AUTHENTIC_SOURCE or AUTHENTIC_*.

    Never reads file paths from `ev["receipt_path"]` / `ev["access_path"]`, never trusts
    caller-supplied booleans (`verified`, `is_authentic_source`), and never fetches URLs.
    """
    src_id = str(ev.get("source_id") or "")
    pp = str(ev.get("parameter_path") or "")

    # Reject any caller payload pretending a synthetic fixture is authentic
    fo = str(ev.get("fixture_origin") or "")
    if fo and fo not in ("AUTHENTIC_LIVE_FETCH_RECEIPT", "AUTHENTIC_CACHED_RECEIPT"):
        return {
            "status": "REJECTED",
            "verified": False,
            "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
            "reason_code": "UNTRUSTED_FIXTURE_ORIGIN_FOR_AUTHENTIC_CLAIM",
            "raw_bytes_verified": False,
            "captured_extract_integrity_verified": False,
            "upstream_cryptographic_authenticity_proven": False,
            "detail": f"fixture_origin={fo!r} cannot back an authentic observation claim.",
        }

    # Route by canonical provider/parameter boundary inside allowlisted trusted stores only
    if src_id.startswith("NASA_POWER") or pp.startswith("climate."):
        return _verify_nasa_power_proof(ev, trusted_nasa_dirs)
    if src_id.startswith("ISRIC_SOILGRIDS") or pp.startswith("soil."):
        return _verify_soilgrids_proof(ev, trusted_soilgrids_dirs)

    return {
        "status": "UNVERIFIED",
        "verified": False,
        "proof_tier": "SOURCE_CLAIMED_BUT_UNVERIFIED",
        "reason_code": "UNVERIFIED_SOURCE_PROOF",
        "raw_bytes_verified": False,
        "captured_extract_integrity_verified": False,
        "upstream_cryptographic_authenticity_proven": False,
        "detail": (
            f"Source '{src_id or 'UNKNOWN'}' has no verified backing raw bytes or allowlisted store receipt "
            "for independent authentication."
        ),
    }


__all__ = [
    "DEFAULT_TRUSTED_NASA_STORES",
    "DEFAULT_TRUSTED_SOILGRIDS_STORES",
    "has_live_attestation",
    "issue_live_attestation",
    "verify_authentic_evidence_proof",
]
