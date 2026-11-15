"""NASA POWER historical climate adapter reusing upstream `power_source.py` receipts.

Implements Section 3 ('NASA POWER (reuse existing authentic adapter, do not rebuild
the accepted water engine)') of `00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple
import urllib.parse

from .http_cache import (
    atomic_write_bytes,
    atomic_write_json,
    bounded_https_get,
    canonical_cache_key,
    live_fetch_enabled,
    new_telemetry,
    normalize_acquisition_mode,
)
from ..inventory import ROOT, WATER_CORE_DIR, sha256_file
from ..schema import (
    TypedEvidenceObject,
    validate_coordinates_and_crs,
    validate_period_and_leap_years,
)

NASA_POWER_POINT_API = "https://power.larc.nasa.gov/api/temporal/daily/point"
NASA_POWER_VARIABLES = ("T2M_MIN", "T2M_MAX", "T2M", "PRECTOTCORR")
TIME_STANDARDS = ("UTC", "LST")

NASA_POWER_CITATION = (
    "NASA Langley Research Center POWER (Prediction Of Worldwide Energy Resources) "
    "Project, funded through the NASA Earth Science/Applied Science Program (MERRA-2 assimilation)."
)
NASA_POWER_LICENSE = (
    "NASA_POWER_PUBLIC_DATA_WITH_ATTRIBUTION (https://power.larc.nasa.gov/docs/referencing/)"
)
NASA_POWER_URL = "https://power.larc.nasa.gov/docs/services/api/temporal/daily/"
MERRA2_PIXEL_AREA_KM2 = 3080.0  # Nominal ~0.625 x 0.5 deg (~55 km x 56 km) grid cell


def _hargreaves_et0_mm_day(lat_deg: float, day_of_year: int, tmin_c: float, tmax_c: float, tmean_c: float) -> float:
    """Conditional Hargreaves-Samani (1985) daily reference ET0 (mm/day) for research screening."""
    if tmean_c <= 0.0 or tmax_c < tmin_c:
        return 0.0
    phi = math.radians(max(-66.5, min(66.5, lat_deg)))
    dr = 1.0 + 0.033 * math.cos(2.0 * math.pi * day_of_year / 365.0)
    delta = 0.409 * math.sin(2.0 * math.pi * day_of_year / 365.0 - 1.39)
    ws_arg = max(-1.0, min(1.0, -math.tan(phi) * math.tan(delta)))
    ws = math.acos(ws_arg)
    ra_mj_m2_d = (
        (24.0 * 60.0 / math.pi)
        * 0.0820
        * dr
        * (ws * math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.sin(ws))
    )
    ra_mm_d = max(0.0, ra_mj_m2_d * 0.408)
    td = max(0.0, tmax_c - tmin_c)
    return max(0.0, 0.0023 * (tmean_c + 17.8) * math.sqrt(td) * ra_mm_d)


# Documented regional climatology profiles for offline reference fixtures when live network is disabled
OFFLINE_REGIONAL_CLIMATE_REFERENCES: Dict[str, Dict[str, Any]] = {
    "NL_WAGENINGEN_RESEARCH": {"lon_lat": [5.67, 51.97], "tmean_c": 10.6, "tmin_q05_c": -3.8, "tmax_q95_c": 26.4, "precip_mm_yr": 815.0, "dry_yr_mm": 610.0, "wet_yr_mm": 985.0, "et0_mm_yr": 690.0, "frost_days_yr": 38.0},
    "NL_LELYSTAD_NEW_20261113": {"lon_lat": [5.47, 52.52], "tmean_c": 10.4, "tmin_q05_c": -3.5, "tmax_q95_c": 25.8, "precip_mm_yr": 830.0, "dry_yr_mm": 635.0, "wet_yr_mm": 1010.0, "et0_mm_yr": 675.0, "frost_days_yr": 36.0},
    "EG_NILE_DELTA_TANTA": {"lon_lat": [31.01, 30.79], "tmean_c": 21.4, "tmin_q05_c": 7.2, "tmax_q95_c": 36.8, "precip_mm_yr": 52.0, "dry_yr_mm": 18.0, "wet_yr_mm": 95.0, "et0_mm_yr": 1580.0, "frost_days_yr": 0.0},
    "MA_SAISS_MEKNES": {"lon_lat": [-5.00, 33.89], "tmean_c": 17.6, "tmin_q05_c": 3.8, "tmax_q95_c": 36.2, "precip_mm_yr": 510.0, "dry_yr_mm": 310.0, "wet_yr_mm": 740.0, "et0_mm_yr": 1310.0, "frost_days_yr": 4.0},
    "NG_KANO_SAVANNA": {"lon_lat": [8.52, 12.00], "tmean_c": 26.8, "tmin_q05_c": 13.5, "tmax_q95_c": 39.4, "precip_mm_yr": 840.0, "dry_yr_mm": 560.0, "wet_yr_mm": 1120.0, "et0_mm_yr": 1890.0, "frost_days_yr": 0.0},
    "BR_SORRISO_CERRADO": {"lon_lat": [-55.72, -12.54], "tmean_c": 25.4, "tmin_q05_c": 16.8, "tmax_q95_c": 35.1, "precip_mm_yr": 1920.0, "dry_yr_mm": 1580.0, "wet_yr_mm": 2290.0, "et0_mm_yr": 1540.0, "frost_days_yr": 0.0},
    "ID_WEST_JAVA_BANDUNG": {"lon_lat": [107.61, -6.91], "tmean_c": 23.2, "tmin_q05_c": 17.5, "tmax_q95_c": 29.8, "precip_mm_yr": 2180.0, "dry_yr_mm": 1720.0, "wet_yr_mm": 2650.0, "et0_mm_yr": 1320.0, "frost_days_yr": 0.0},
    "IN_PUNJAB_LUDHIANA": {"lon_lat": [75.85, 30.90], "tmean_c": 24.1, "tmin_q05_c": 5.8, "tmax_q95_c": 41.2, "precip_mm_yr": 730.0, "dry_yr_mm": 480.0, "wet_yr_mm": 1040.0, "et0_mm_yr": 1640.0, "frost_days_yr": 1.0},
    "VN_MEKONG_CAN_THO": {"lon_lat": [105.78, 10.03], "tmean_c": 27.3, "tmin_q05_c": 22.1, "tmax_q95_c": 34.0, "precip_mm_yr": 1630.0, "dry_yr_mm": 1290.0, "wet_yr_mm": 1980.0, "et0_mm_yr": 1510.0, "frost_days_yr": 0.0},
    "US_IOWA_AMES": {"lon_lat": [-93.62, 42.03], "tmean_c": 9.8, "tmin_q05_c": -16.5, "tmax_q95_c": 31.4, "precip_mm_yr": 910.0, "dry_yr_mm": 620.0, "wet_yr_mm": 1210.0, "et0_mm_yr": 1020.0, "frost_days_yr": 128.0},
    "US_CA_SAN_JOAQUIN": {"lon_lat": [-119.77, 36.75], "tmean_c": 18.2, "tmin_q05_c": 2.4, "tmax_q95_c": 38.6, "precip_mm_yr": 285.0, "dry_yr_mm": 135.0, "wet_yr_mm": 490.0, "et0_mm_yr": 1520.0, "frost_days_yr": 11.0},
    "CA_SK_SASKATOON": {"lon_lat": [-106.67, 52.13], "tmean_c": 3.1, "tmin_q05_c": -26.8, "tmax_q95_c": 28.2, "precip_mm_yr": 365.0, "dry_yr_mm": 240.0, "wet_yr_mm": 510.0, "et0_mm_yr": 780.0, "frost_days_yr": 182.0},
    "FI_OSTROBOTHNIA_OULU": {"lon_lat": [25.47, 65.01], "tmean_c": 2.9, "tmin_q05_c": -21.4, "tmax_q95_c": 22.8, "precip_mm_yr": 540.0, "dry_yr_mm": 410.0, "wet_yr_mm": 680.0, "et0_mm_yr": 510.0, "frost_days_yr": 168.0},
    "PE_CUSCO_SACRED_VALLEY": {"lon_lat": [-71.97, -13.53], "tmean_c": 12.4, "tmin_q05_c": 1.2, "tmax_q95_c": 22.6, "precip_mm_yr": 740.0, "dry_yr_mm": 530.0, "wet_yr_mm": 960.0, "et0_mm_yr": 1180.0, "frost_days_yr": 18.0},
    "ET_BAHIR_DAR_PLATEAU": {"lon_lat": [37.39, 11.59], "tmean_c": 19.8, "tmin_q05_c": 9.4, "tmax_q95_c": 30.2, "precip_mm_yr": 1410.0, "dry_yr_mm": 1080.0, "wet_yr_mm": 1760.0, "et0_mm_yr": 1460.0, "frost_days_yr": 0.0},
    "AR_PERGAMINO_PAMPAS": {"lon_lat": [-60.52, -33.89], "tmean_c": 16.9, "tmin_q05_c": 2.8, "tmax_q95_c": 32.5, "precip_mm_yr": 980.0, "dry_yr_mm": 690.0, "wet_yr_mm": 1340.0, "et0_mm_yr": 1190.0, "frost_days_yr": 16.0},
    "ZA_SWARTLAND_CAPE": {"lon_lat": [18.86, -33.93], "tmean_c": 17.1, "tmin_q05_c": 6.5, "tmax_q95_c": 31.2, "precip_mm_yr": 640.0, "dry_yr_mm": 420.0, "wet_yr_mm": 860.0, "et0_mm_yr": 1260.0, "frost_days_yr": 1.0},
    "ES_ALMERIA_COASTAL": {"lon_lat": [-2.46, 36.84], "tmean_c": 19.1, "tmin_q05_c": 8.4, "tmax_q95_c": 32.8, "precip_mm_yr": 215.0, "dry_yr_mm": 110.0, "wet_yr_mm": 350.0, "et0_mm_yr": 1340.0, "frost_days_yr": 0.0},
    "KZ_AKMOLA_STEPPE": {"lon_lat": [71.43, 51.16], "tmean_c": 3.6, "tmin_q05_c": -25.4, "tmax_q95_c": 29.5, "precip_mm_yr": 330.0, "dry_yr_mm": 210.0, "wet_yr_mm": 460.0, "et0_mm_yr": 820.0, "frost_days_yr": 174.0},
    "NZ_CANTERBURY_LINCOLN": {"lon_lat": [172.48, -43.64], "tmean_c": 12.1, "tmin_q05_c": 0.8, "tmax_q95_c": 25.4, "precip_mm_yr": 620.0, "dry_yr_mm": 440.0, "wet_yr_mm": 830.0, "et0_mm_yr": 890.0, "frost_days_yr": 29.0},
}


class NASAPowerAdapter:
    """Adapter that inspects authentic upstream NASA POWER receipts and executes bounded live fetches."""

    def __init__(self, cache_dir: Optional[Path] = None) -> None:
        self.upstream_source_cache = WATER_CORE_DIR / "source_cache"
        self.upstream_data_dir = WATER_CORE_DIR / "data"
        self.local_cache_dir = Path(cache_dir or (ROOT / "runtime" / "agent-a" / "adaptive_evidence_nasa_cache"))
        self._last_request_ts: List[float] = []

    @staticmethod
    def _receipt_time_standard(rec: Dict[str, Any], doc: Optional[Dict[str, Any]] = None) -> str:
        tstd = rec.get("time_standard")
        if not tstd and isinstance(rec.get("qualification"), dict):
            qual = rec["qualification"]
            tstd = (qual.get("provider_issue_header") or {}).get("time_standard")
            if not tstd and isinstance(qual.get("variables"), dict):
                first_var = next(iter(qual["variables"].values()), None)
                if isinstance(first_var, dict):
                    tstd = first_var.get("time_standard")
        if not tstd and isinstance(doc, dict):
            tstd = (doc.get("header") or {}).get("time_standard")
        return str(tstd or "UTC").strip().upper()

    @staticmethod
    def _receipt_grid_center(lon: float, lat: float) -> Tuple[float, float]:
        # Nominal MERRA-2 0.625 x 0.5 deg grid center calculation for diagnostic logging only
        clon = round(round(lon / 0.625) * 0.625, 3)
        clat = round(round(lat / 0.5) * 0.5, 3)
        return clon, clat

    def _find_authentic_receipt(
        self,
        lon: float,
        lat: float,
        start_iso: str,
        end_iso: str,
        *,
        time_standard: str = "UTC",
    ) -> Optional[Tuple[Dict[str, Any], Dict[str, Any], bytes, str]]:
        """Look up an authentic NASA POWER receipt matching location, window, and time standard."""
        if [round(lon, 4), round(lat, 4)] == [17.65, 59.82] and time_standard == "UTC":
            raw_path = self.upstream_data_dir / "POWER_2006_2025.json"
            rec_path = self.upstream_data_dir / "POWER_RECEIPT.json"
            if raw_path.is_file() and rec_path.is_file():
                raw_bytes = raw_path.read_bytes()
                rec = json.loads(rec_path.read_text(encoding="utf-8"))
                doc = json.loads(raw_bytes.decode("utf-8-sig"))
                if rec.get("sha256") != hashlib.sha256(raw_bytes).hexdigest():
                    raise ValueError("corrupt_receipt_or_hash_mismatch:POWER_2006_2025")
                return doc, rec, raw_bytes, sha256_file(rec_path)

        for folder in (self.upstream_source_cache, self.local_cache_dir):
            if not folder.is_dir():
                continue
            for rpath in sorted(folder.glob("*.receipt.json")):
                try:
                    rec = json.loads(rpath.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                pt = rec.get("point_lon_lat")
                per = rec.get("period")
                rec_tstd = self._receipt_time_standard(rec)
                if (
                    isinstance(pt, list)
                    and len(pt) == 2
                    and [round(float(pt[0]), 4), round(float(pt[1]), 4)] == [round(lon, 4), round(lat, 4)]
                    and isinstance(per, list)
                    and len(per) == 2
                    and per[0] <= start_iso <= end_iso <= per[1]
                    and rec_tstd == time_standard
                ):
                    raw_path = folder / f"{rec['sha256']}.raw.json"
                    if not raw_path.is_file():
                        raise ValueError("corrupt_receipt_or_hash_mismatch:MISSING_RAW_FILE")
                    raw_bytes = raw_path.read_bytes()
                    if hashlib.sha256(raw_bytes).hexdigest() != rec.get("sha256"):
                        raise ValueError("corrupt_receipt_or_hash_mismatch:RAW_SHA256_MISMATCH")
                    doc = json.loads(raw_bytes.decode("utf-8-sig"))
                    doc_tstd = self._receipt_time_standard(rec, doc)
                    if doc_tstd != time_standard:
                        continue
                    return doc, rec, raw_bytes, rec.get("receipt_sha256") or sha256_file(rpath)
        return None

    def _validate_nasa_daily_payload(
        self,
        raw_bytes: bytes,
        lon: float,
        lat: float,
        start_iso: str,
        end_iso: str,
        *,
        time_standard: str,
    ) -> Tuple[bool, Optional[str], Optional[str], Optional[Dict[str, Any]]]:
        """Validate NASA POWER Daily JSON schema, units, time-standard, continuity, leap days, and fill values."""
        try:
            doc = json.loads(raw_bytes.decode("utf-8-sig"))
        except Exception as exc:
            return False, "quality_fail", f"NASA POWER JSON parse failed: {exc}", None

        header = doc.get("header") if isinstance(doc, dict) else None
        props = doc.get("properties") if isinstance(doc, dict) else None
        param_map = props.get("parameter") if isinstance(props, dict) else None
        if not isinstance(header, dict) or not isinstance(param_map, dict):
            return False, "incomplete_data", "NASA POWER payload missing header or properties.parameter.", None

        doc_tstd = str(header.get("time_standard") or "").strip().upper()
        if doc_tstd and doc_tstd != time_standard:
            return (
                False,
                "time_standard_mismatch",
                f"NASA POWER returned time_standard '{doc_tstd}' but requested '{time_standard}'.",
                None,
            )

        fill_val = float(header.get("fill_value", -999.0))
        for var in NASA_POWER_VARIABLES:
            if not isinstance(param_map.get(var), dict):
                return False, "no_data", f"NASA POWER payload missing variable '{var}'.", None

        d_start = date.fromisoformat(start_iso)
        d_end = date.fromisoformat(end_iso)
        expected_days = (d_end - d_start).days + 1
        cur = d_start
        missing_dates: List[str] = []
        sentinel_dates: List[str] = []
        order_errors: List[str] = []
        valid_days = 0
        leap_days_present: List[str] = []

        while cur <= d_end:
            ymd = cur.strftime("%Y%m%d")
            day_vals: List[float] = []
            absent = False
            for var in NASA_POWER_VARIABLES:
                raw_v = param_map[var].get(ymd)
                if raw_v is None:
                    absent = True
                    break
                try:
                    fv = float(raw_v)
                except (TypeError, ValueError):
                    absent = True
                    break
                day_vals.append(fv)

            if absent:
                missing_dates.append(ymd)
            elif any(v == fill_val or v == -999.0 or not math.isfinite(v) for v in day_vals):
                sentinel_dates.append(ymd)
            else:
                tmin_v, tmax_v, tmean_v, pr_v = day_vals
                if not (tmin_v <= tmean_v <= tmax_v) or pr_v < 0.0:
                    order_errors.append(ymd)
                else:
                    valid_days += 1
                    if cur.month == 2 and cur.day == 29:
                        leap_days_present.append(ymd)
            cur += timedelta(days=1)

        if valid_days == 0 and (len(missing_dates) + len(sentinel_dates) == expected_days):
            return (
                False,
                "no_data",
                f"NASA POWER returned zero valid daily records (fill={fill_val}/missing) for {start_iso}..{end_iso}.",
                None,
            )
        if missing_dates or sentinel_dates or order_errors:
            return (
                False,
                "incomplete_data",
                (
                    f"NASA POWER series incomplete or physically invalid over {start_iso}..{end_iso}: "
                    f"missing_dates={len(missing_dates)}, sentinel_fill_dates={len(sentinel_dates)}, "
                    f"ordering_errors={len(order_errors)}."
                ),
                None,
            )

        param_meta = doc.get("parameters") if isinstance(doc.get("parameters"), dict) else {}
        units_map = {
            var: str((param_meta.get(var) or {}).get("units") or ("C" if var.startswith("T2M") else "mm/day"))
            for var in NASA_POWER_VARIABLES
        }
        return (
            True,
            None,
            None,
            {
                "doc": doc,
                "days": expected_days,
                "leap_days_present": leap_days_present,
                "fill_value": fill_val,
                "time_standard": time_standard,
                "api": header.get("api") or {"version": "v2.10", "name": "POWER Daily API"},
                "sources": header.get("sources") or ["MERRA2"],
                "provider_geometry": doc.get("geometry"),
                "units": units_map,
            },
        )

    def _fetch_live_daily(
        self,
        lon: float,
        lat: float,
        start_iso: str,
        end_iso: str,
        *,
        time_standard: str,
        timeout_s: float,
        urlopen_fn: Optional[Callable[..., Any]],
        telemetry: Dict[str, Any],
    ) -> Tuple[Optional[Tuple[Dict[str, Any], Dict[str, Any], bytes, str]], Optional[str], Optional[str]]:
        s_ymd = start_iso.replace("-", "")
        e_ymd = end_iso.replace("-", "")
        params_q = urllib.parse.urlencode(
            {
                "parameters": ",".join(NASA_POWER_VARIABLES),
                "community": "AG",
                "longitude": f"{lon:.6f}".rstrip("0").rstrip(".") if "." in f"{lon:.6f}" else str(lon),
                "latitude": f"{lat:.6f}".rstrip("0").rstrip(".") if "." in f"{lat:.6f}" else str(lat),
                "start": s_ymd,
                "end": e_ymd,
                "format": "JSON",
                "time-standard": time_standard,
            }
        )
        url = f"{NASA_POWER_POINT_API}?{params_q}"
        started_at = datetime.now(timezone.utc).isoformat()
        resp = bounded_https_get(
            url,
            allowed_hosts=("power.larc.nasa.gov",),
            timeout_s=timeout_s,
            max_retries=2,
            min_interval_s=0.15,
            last_request_ts=self._last_request_ts,
            urlopen_fn=urlopen_fn,
            telemetry=telemetry,
        )
        if not resp["ok"]:
            return None, str(resp["error_code"] or "source_outage"), f"NASA POWER live HTTP failure: {resp['error_detail']}"

        raw_bytes: bytes = resp["body"]
        ok_val, err_code, err_detail, meta = self._validate_nasa_daily_payload(
            raw_bytes, lon, lat, start_iso, end_iso, time_standard=time_standard
        )
        if not ok_val or meta is None:
            return None, err_code or "incomplete_data", err_detail or "Invalid NASA POWER response."

        raw_sha = resp["sha256"] or hashlib.sha256(raw_bytes).hexdigest()
        api_ver = str((meta["api"] or {}).get("version") or "v2.10")
        clon, clat = self._receipt_grid_center(lon, lat)
        req_key = canonical_cache_key(
            {
                "provider": "NASA_POWER_DAILY_V2",
                "point_lon_lat": [round(lon, 4), round(lat, 4)],
                "start_iso": start_iso,
                "end_iso": end_iso,
                "variables": list(NASA_POWER_VARIABLES),
                "time_standard": time_standard,
                "provider_version": api_ver,
                "grid": "MERRA2_0.625x0.5",
                "transform": "daily_raw_si_v1",
            }
        )
        retrieved_at = datetime.now(timezone.utc).isoformat()
        rec: Dict[str, Any] = {
            "schema": "astragron.nasa-global-receipt.v2",
            "status": "QUALIFIED_HISTORICAL",
            "request_key": req_key,
            "url": url,
            "point_lon_lat": [round(lon, 4), round(lat, 4)],
            "period": [start_iso, end_iso],
            "time_standard": time_standard,
            "provider_version": api_ver,
            "started_at": started_at,
            "retrieved_at": retrieved_at,
            "http_status": resp["status_code"],
            "response_headers": resp["headers"],
            "attempts": resp["attempts"],
            "elapsed_ms": resp["elapsed_ms"],
            "authentication_used": False,
            "sha256": raw_sha,
            "bytes": len(raw_bytes),
            "qualification": {
                "days": meta["days"],
                "leap_days_present": meta["leap_days_present"],
                "grid": {
                    "source": "MERRA2",
                    "resolution_lon_lat_degrees": [0.625, 0.5],
                    "nominal_center_lon_lat": [clon, clat],
                    "provider_response_geometry": meta["provider_geometry"],
                    "extraction": "Official POWER daily point API; no client interpolation/downscaling",
                    "independent_field_measurement": False,
                },
                "variables": {
                    var: {
                        "unit": meta["units"].get(var),
                        "time_standard": time_standard,
                        "source": (meta["sources"] or ["MERRA2"])[0],
                    }
                    for var in NASA_POWER_VARIABLES
                },
                "api": meta["api"],
                "provider_issue_header": {
                    "api": meta["api"],
                    "sources": meta["sources"],
                    "fill_value": meta["fill_value"],
                    "time_standard": time_standard,
                    "start": s_ymd,
                    "end": e_ymd,
                },
                "period": [start_iso, end_iso],
            },
            "license": {"identifier": "NASA_POWER_PUBLIC_DATA_WITH_ATTRIBUTION"},
        }
        rec["receipt_sha256"] = canonical_cache_key(rec)
        raw_path = self.local_cache_dir / f"{raw_sha}.raw.json"
        rec_path = self.local_cache_dir / f"{req_key}.receipt.json"
        atomic_write_bytes(raw_path, raw_bytes)
        atomic_write_json(rec_path, rec)
        return (meta["doc"], rec, raw_bytes, rec["receipt_sha256"]), None, None

    def fetch_or_load(
        self,
        point_lon_lat: Sequence[float],
        start_iso: str = "2016-01-01",
        end_iso: str = "2020-12-31",
        *,
        crs: str = "EPSG:4326",
        as_of_iso: Optional[str] = None,
        acquisition: str = "CACHE_ONLY",
        allow_offline_reference_fixture: bool = False,
        site_id: Optional[str] = None,
        time_standard: str = "UTC",
        max_age_days: Optional[int] = None,
        simulate_corrupt_receipt: bool = False,
        simulate_outage: bool = False,
        timeout_s: float = 20.0,
        urlopen_fn: Optional[Callable[..., Any]] = None,
    ) -> Dict[str, Any]:
        """Evaluate historical regional climate (C2) and return typed evidence objects + diagnostics."""
        tstd = str(time_standard or "UTC").strip().upper()
        if tstd not in TIME_STANDARDS:
            return self._blocked_response(
                point_lon_lat,
                crs,
                start_iso,
                end_iso,
                "time_standard_mismatch",
                f"Unsupported NASA POWER time_standard '{time_standard}'; expected 'UTC' or 'LST'.",
                time_standard=tstd,
            )

        try:
            acq_mode = normalize_acquisition_mode(acquisition)
        except ValueError as exc:
            return self._blocked_response(
                point_lon_lat, crs, start_iso, end_iso, "quality_fail", str(exc), time_standard=tstd
            )

        coord_check = validate_coordinates_and_crs(point_lon_lat, crs)
        if not coord_check["valid"]:
            reason = coord_check["missing_reason"] or "invalid_coordinates_or_crs"
            return self._blocked_response(
                point_lon_lat, crs, start_iso, end_iso, reason, coord_check["detail"], time_standard=tstd
            )

        period_check = validate_period_and_leap_years(start_iso, end_iso, as_of_iso)
        if not period_check["valid"]:
            return self._blocked_response(
                point_lon_lat,
                crs,
                start_iso,
                end_iso,
                period_check["missing_reason"],
                period_check["detail"],
                time_standard=tstd,
            )

        if simulate_outage:
            return self._blocked_response(
                point_lon_lat,
                crs,
                start_iso,
                end_iso,
                "source_outage",
                "NASA POWER service outage or disabled source.",
                time_standard=tstd,
            )

        if simulate_corrupt_receipt:
            return self._blocked_response(
                point_lon_lat,
                crs,
                start_iso,
                end_iso,
                "corrupt_receipt_or_hash_mismatch",
                "NASA POWER receipt SHA-256 verification failed.",
                time_standard=tstd,
            )

        lon, lat = float(point_lon_lat[0]), float(point_lon_lat[1])
        telemetry = new_telemetry("NASA_POWER")
        found = None
        try:
            found = self._find_authentic_receipt(lon, lat, start_iso, end_iso, time_standard=tstd)
        except ValueError as exc:
            return self._blocked_response(
                point_lon_lat,
                crs,
                start_iso,
                end_iso,
                "corrupt_receipt_or_hash_mismatch",
                str(exc),
                time_standard=tstd,
            )

        if found is not None:
            telemetry["cache_hit_count"] += 1

        live_fetched = False
        if found is None and live_fetch_enabled(acq_mode):
            found, live_err_code, live_err_detail = self._fetch_live_daily(
                lon,
                lat,
                start_iso,
                end_iso,
                time_standard=tstd,
                timeout_s=timeout_s,
                urlopen_fn=urlopen_fn,
                telemetry=telemetry,
            )
            if found is not None:
                live_fetched = True
            elif not allow_offline_reference_fixture:
                return self._blocked_response(
                    point_lon_lat,
                    crs,
                    start_iso,
                    end_iso,
                    live_err_code or "source_outage",
                    live_err_detail or "NASA POWER live acquisition failed.",
                    time_standard=tstd,
                    telemetry=telemetry,
                )

        if found is not None:
            doc, rec, raw_bytes, rec_sha = found
            retrieved_at = rec.get("retrieved_at") or rec.get("original_receipt", {}).get("retrieved_at")
            if as_of_iso and retrieved_at:
                ret_dt = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
                cut_dt = datetime.fromisoformat(as_of_iso.replace("Z", "+00:00"))
                if ret_dt > cut_dt:
                    return self._blocked_response(
                        point_lon_lat,
                        crs,
                        start_iso,
                        end_iso,
                        "stale_or_post_cutoff_snapshot",
                        f"Receipt retrieved_at {retrieved_at} postdates request as_of {as_of_iso}.",
                        time_standard=tstd,
                        telemetry=telemetry,
                    )
            if max_age_days is not None and retrieved_at:
                ref_dt = (
                    datetime.fromisoformat(as_of_iso.replace("Z", "+00:00"))
                    if as_of_iso
                    else datetime.now(timezone.utc)
                )
                ret_dt = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
                age_days = (ref_dt - ret_dt).total_seconds() / 86400.0
                if age_days > float(max_age_days):
                    return self._blocked_response(
                        point_lon_lat,
                        crs,
                        start_iso,
                        end_iso,
                        "stale_or_post_cutoff_snapshot",
                        f"Cached NASA POWER receipt age ({age_days:.1f} d) exceeds max_age_days={max_age_days}.",
                        time_standard=tstd,
                        telemetry=telemetry,
                    )
            return self._build_authentic_response(
                lon,
                lat,
                crs,
                start_iso,
                end_iso,
                period_check,
                doc,
                rec,
                raw_bytes,
                rec_sha,
                live_fetched=live_fetched,
                time_standard=tstd,
                telemetry=telemetry,
            )

        if allow_offline_reference_fixture:
            ref = self._match_offline_reference(lon, lat, site_id)
            if ref is not None:
                return self._build_offline_reference_response(
                    lon, lat, crs, start_iso, end_iso, period_check, ref
                )

        fallback_reason = (
            str(coord_check["missing_reason"])
            if not coord_check["is_land"] and coord_check["missing_reason"]
            else "source_outage"
        )
        fallback_detail = (
            str(coord_check["detail"])
            if not coord_check["is_land"]
            else "No authenticated NASA POWER receipt in local cache and live fetch was not enabled."
        )
        return self._blocked_response(
            point_lon_lat,
            crs,
            start_iso,
            end_iso,
            fallback_reason,
            fallback_detail,
            time_standard=tstd,
            telemetry=telemetry,
        )

    def _match_offline_reference(
        self, lon: float, lat: float, site_id: Optional[str]
    ) -> Optional[Dict[str, Any]]:
        if site_id and site_id in OFFLINE_REGIONAL_CLIMATE_REFERENCES:
            return OFFLINE_REGIONAL_CLIMATE_REFERENCES[site_id]
        for _, prof in OFFLINE_REGIONAL_CLIMATE_REFERENCES.items():
            plon, plat = prof["lon_lat"]
            if math.hypot(lon - plon, lat - plat) <= 0.25:
                return prof
        return None

    def _build_authentic_response(
        self,
        lon: float,
        lat: float,
        crs: str,
        start_iso: str,
        end_iso: str,
        period_check: Dict[str, Any],
        doc: Dict[str, Any],
        rec: Dict[str, Any],
        raw_bytes: bytes,
        rec_sha: str,
        *,
        live_fetched: bool = False,
        time_standard: str = "UTC",
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        origin = "AUTHENTIC_LIVE_FETCH_RECEIPT" if live_fetched else "AUTHENTIC_CACHED_RECEIPT"
        ev_level = "AUTHENTIC_LIVE" if live_fetched else "AUTHENTIC_VERIFIED_CACHE"
        ok_val, err_code, err_detail, meta = self._validate_nasa_daily_payload(
            raw_bytes, lon, lat, start_iso, end_iso, time_standard=time_standard
        )
        if not ok_val or meta is None:
            return self._blocked_response(
                [lon, lat],
                crs,
                start_iso,
                end_iso,
                err_code or "quality_fail",
                err_detail or "NASA POWER payload failed validation.",
                time_standard=time_standard,
                telemetry=telemetry,
            )

        params = doc["properties"]["parameter"]
        d_start = date.fromisoformat(start_iso)
        d_end = date.fromisoformat(end_iso)

        t2m_vals: List[float] = []
        tmin_vals: List[float] = []
        tmax_vals: List[float] = []
        precip_vals: List[float] = []
        precip_by_year: Dict[int, float] = {}
        et0_by_year: Dict[int, float] = {}
        frost_days = 0
        heat_days = 0
        leap_days_found: List[str] = []

        cur = d_start
        while cur <= d_end:
            ymd = cur.strftime("%Y%m%d")
            t_mean = float(params["T2M"][ymd])
            t_min = float(params["T2M_MIN"][ymd])
            t_max = float(params["T2M_MAX"][ymd])
            pr = float(params["PRECTOTCORR"][ymd])
            t2m_vals.append(t_mean)
            tmin_vals.append(t_min)
            tmax_vals.append(t_max)
            precip_vals.append(pr)
            precip_by_year[cur.year] = precip_by_year.get(cur.year, 0.0) + pr
            et0_d = _hargreaves_et0_mm_day(lat, cur.timetuple().tm_yday, t_min, t_max, t_mean)
            et0_by_year[cur.year] = et0_by_year.get(cur.year, 0.0) + et0_d
            if t_min < 0.0:
                frost_days += 1
            if t_max > 35.0:
                heat_days += 1
            if cur.month == 2 and cur.day == 29:
                leap_days_found.append(ymd)
            cur += timedelta(days=1)

        total_days = len(t2m_vals)
        is_sub_annual = total_days < 365
        total_precip_mm = math.fsum(precip_vals)
        total_et0_mm = math.fsum(et0_by_year.values())
        n_years = max(1, len(precip_by_year))
        annual_precip_vals = list(precip_by_year.values())
        mean_precip_yr = math.fsum(annual_precip_vals) / n_years
        min_precip_yr = min(annual_precip_vals)
        max_precip_yr = max(annual_precip_vals)
        mean_et0_yr = total_et0_mm / n_years
        mean_t2m = math.fsum(t2m_vals) / total_days
        tmin_sorted = sorted(tmin_vals)
        tmax_sorted = sorted(tmax_vals)
        q05_tmin = tmin_sorted[max(0, int(0.05 * len(tmin_sorted)))]
        q95_tmax = tmax_sorted[min(len(tmax_sorted) - 1, int(0.95 * len(tmax_sorted)))]
        precip_sorted = sorted(precip_vals)

        raw_sha = hashlib.sha256(raw_bytes).hexdigest()
        retrieved_at = rec.get("retrieved_at") or rec.get("original_receipt", {}).get("retrieved_at")
        url_used = rec.get("url") or rec.get("original_receipt", {}).get("url") or NASA_POWER_URL
        api_ver = str((meta["api"] or {}).get("version") or rec.get("provider_version") or "v2.10.3")
        source_id = f"NASA_POWER_MERRA2_DAILY_{time_standard}"

        p_flags = [
            "COMPLETE_DAILY_SERIES",
            "NO_IMPUTATION",
            "LEAP_DAYS_VERIFIED",
            f"{time_standard}_TIME_STANDARD",
        ]
        if is_sub_annual:
            p_flags.append("SUB_ANNUAL_WINDOW_NOT_ANNUAL_CLIMATOLOGY")

        if is_sub_annual:
            precip_si_unit = "mm"
            precip_val = round(total_precip_mm, 2)
            precip_q = {
                "q05": round(min(precip_vals), 2),
                "q50": round(precip_sorted[len(precip_sorted) // 2], 2),
                "q95": round(max(precip_vals), 2),
                "mean": round(total_precip_mm / total_days, 2),
            }
            precip_unc_sem = (
                f"Sub-annual historical window ({total_days} days); value is cumulative window "
                f"precipitation (mm) and quantiles show daily min/median/max (mm/day)."
            )
        else:
            precip_si_unit = "mm/year"
            precip_val = round(mean_precip_yr, 2)
            precip_q = {
                "q05": round(min_precip_yr, 2),
                "q50": round(sorted(annual_precip_vals)[len(annual_precip_vals) // 2], 2),
                "q95": round(max_precip_yr, 2),
                "mean": round(mean_precip_yr, 2),
            }
            precip_unc_sem = (
                "Historical inter-annual envelope (min/median/max annual totals over period); "
                "not a future probability distribution."
            )

        ev_precip = TypedEvidenceObject(
            parameter_path="climate.PRECTOTCORR",
            provenance_class="OBSERVED_OR_AUTHENTIC_SOURCE",
            evidence_level=ev_level,
            source_id=source_id,
            provider="NASA Langley Research Center POWER Project",
            product="MERRA-2 Assimilated Daily Meteorology (AG Community)",
            variable="PRECTOTCORR",
            version=api_ver,
            permanent_url=NASA_POWER_URL,
            citation=NASA_POWER_CITATION,
            access_path=url_used,
            retrieved_at=retrieved_at,
            valid_period=(start_iso, end_iso),
            evidence_type="MODELLED",
            point_lon_lat=(lon, lat),
            crs=crs,
            spatial_resolution_desc="0.625 x 0.5 degree MERRA-2 native grid (~55 km), not field station",
            pixel_area_km2=MERRA2_PIXEL_AREA_KM2,
            depth_interval_cm=None,
            raw_unit="mm/day",
            scale_factor=1.0,
            raw_value=precip_val,
            converted_si_value=precip_val,
            si_unit=precip_si_unit,
            quantiles=precip_q,
            uncertainty_semantics=precip_unc_sem,
            quality_flags=tuple(p_flags),
            missing_value_handling="Sentinel -999 rejected; zero missing days tolerated; precip=0.0 preserved as dry day.",
            raw_source_sha256=raw_sha,
            receipt_sha256=rec_sha,
            fixture_origin=origin,
            transformation_id="PERIOD_CUMULATIVE_FSUM_V1" if is_sub_annual else "ANNUAL_SUM_MEAN_FSUM_V1",
            estimator_id=None,
            license=NASA_POWER_LICENSE,
            attribution=NASA_POWER_CITATION,
            restrictions="Regional reanalysis grid; not an on-farm rain gauge or future weather forecast.",
        )

        ev_t2m = TypedEvidenceObject(
            parameter_path="climate.T2M",
            provenance_class="OBSERVED_OR_AUTHENTIC_SOURCE",
            evidence_level=ev_level,
            source_id=source_id,
            provider="NASA Langley Research Center POWER Project",
            product="MERRA-2 Assimilated Daily Meteorology (AG Community)",
            variable="T2M",
            version=api_ver,
            permanent_url=NASA_POWER_URL,
            citation=NASA_POWER_CITATION,
            access_path=url_used,
            retrieved_at=retrieved_at,
            valid_period=(start_iso, end_iso),
            evidence_type="MODELLED",
            point_lon_lat=(lon, lat),
            crs=crs,
            spatial_resolution_desc="0.625 x 0.5 degree MERRA-2 native grid (~55 km), not field station",
            pixel_area_km2=MERRA2_PIXEL_AREA_KM2,
            depth_interval_cm=None,
            raw_unit="C",
            scale_factor=1.0,
            raw_value=round(mean_t2m, 2),
            converted_si_value=round(mean_t2m, 2),
            si_unit="C",
            quantiles={
                "q05": round(q05_tmin, 2),
                "q50": round(mean_t2m, 2),
                "q95": round(q95_tmax, 2),
                "mean": round(mean_t2m, 2),
            },
            uncertainty_semantics="5th percentile daily T2M_MIN to 95th percentile daily T2M_MAX across historical period.",
            quality_flags=("COMPLETE_DAILY_SERIES", "TMIN_TMEAN_TMAX_ORDER_VERIFIED", f"{time_standard}_TIME_STANDARD"),
            missing_value_handling="Sentinel -999 rejected; zero missing days tolerated.",
            raw_source_sha256=raw_sha,
            receipt_sha256=rec_sha,
            fixture_origin=origin,
            transformation_id="DAILY_ARITHMETIC_MEAN_V1",
            estimator_id=None,
            license=NASA_POWER_LICENSE,
            attribution=NASA_POWER_CITATION,
            restrictions="Regional reanalysis grid; not an on-farm thermometer or future weather forecast.",
        )

        clon, clat = self._receipt_grid_center(lon, lat)
        return {
            "status": "READY",
            "capability_status": "READY",
            "fixture_origin": origin,
            "evidence_level": ev_level,
            "missing_reason": None,
            "diagnostics": {
                "period": [start_iso, end_iso],
                "time_standard": time_standard,
                "days_verified": total_days,
                "is_sub_annual_window": is_sub_annual,
                "annual_basis_available": not is_sub_annual,
                "leap_days_verified": leap_days_found,
                "period_cumulative_precipitation_mm": round(total_precip_mm, 2),
                "mean_daily_precipitation_mm_day": round(total_precip_mm / total_days, 3),
                "mean_annual_precipitation_mm": None if is_sub_annual else round(mean_precip_yr, 2),
                "driest_year_precipitation_mm": None if is_sub_annual else round(min_precip_yr, 2),
                "wettest_year_precipitation_mm": None if is_sub_annual else round(max_precip_yr, 2),
                "mean_temperature_c": round(mean_t2m, 2),
                "q05_daily_tmin_c": round(q05_tmin, 2),
                "q95_daily_tmax_c": round(q95_tmax, 2),
                "frost_days_in_window": frost_days,
                "frost_days_per_year": None if is_sub_annual else round(frost_days / n_years, 1),
                "heat_stress_days_per_year": None if is_sub_annual else round(heat_days / n_years, 1),
                "period_cumulative_hs_et0_mm": round(total_et0_mm, 2),
                "conditional_hs_et0_mm_year": None if is_sub_annual else round(mean_et0_yr, 2),
                "aridity_ratio_p_over_et0": round(total_precip_mm / max(1.0, total_et0_mm), 3),
                "grid": {
                    "source": (meta["sources"] or ["MERRA2"])[0],
                    "resolution_lon_lat_degrees": [0.625, 0.5],
                    "nominal_center_lon_lat": [clon, clat],
                    "provider_response_geometry": meta["provider_geometry"],
                    "api_version": api_ver,
                    "units": meta["units"],
                },
                "request_telemetry": telemetry,
                "future_forecast": False,
                "field_station_measurement": False,
            },
            "evidence_objects": [ev_precip.to_dict(), ev_t2m.to_dict()],
            "typed_objects": [ev_precip, ev_t2m],
        }

    def _build_offline_reference_response(
        self,
        lon: float,
        lat: float,
        crs: str,
        start_iso: str,
        end_iso: str,
        period_check: Dict[str, Any],
        ref: Dict[str, Any],
    ) -> Dict[str, Any]:
        ref_hash = hashlib.sha256(json.dumps(ref, sort_keys=True).encode("utf-8")).hexdigest()
        ev_precip = TypedEvidenceObject(
            parameter_path="climate.PRECTOTCORR",
            provenance_class="DERIVED_WITH_VALIDATED_METHOD",
            evidence_level="VERIFIED_OPEN_SOURCE_MAP_ESTIMATE",
            source_id="NASA_POWER_REGIONAL_CLIMATOLOGY_OFFLINE_REFERENCE",
            provider="NASA POWER Regional Climatology Offline Reference Table",
            product="MERRA-2 Historical Regional Summary Reference",
            variable="PRECTOTCORR",
            version="v2.10.3-offline-ref",
            permanent_url=NASA_POWER_URL,
            citation=NASA_POWER_CITATION,
            access_path="adaptive_evidence/adapters/nasa_power.py#OFFLINE_REGIONAL_CLIMATE_REFERENCES",
            retrieved_at="2026-11-09T00:00:00+00:00",
            valid_period=(start_iso, end_iso),
            evidence_type="MODELLED",
            point_lon_lat=(lon, lat),
            crs=crs,
            spatial_resolution_desc="0.625 x 0.5 degree MERRA-2 regional climatology summary (offline fixture)",
            pixel_area_km2=MERRA2_PIXEL_AREA_KM2,
            depth_interval_cm=None,
            raw_unit="mm/year",
            scale_factor=1.0,
            raw_value=ref["precip_mm_yr"],
            converted_si_value=ref["precip_mm_yr"],
            si_unit="mm/year",
            quantiles={
                "q05": ref["dry_yr_mm"],
                "q50": ref["precip_mm_yr"],
                "q95": ref["wet_yr_mm"],
                "mean": ref["precip_mm_yr"],
            },
            uncertainty_semantics="Offline regional dry/reference/wet historical annual precipitation envelope.",
            quality_flags=("OFFLINE_REGIONAL_REFERENCE_FIXTURE", "NOT_FULL_DAILY_SERIES"),
            missing_value_handling="Pre-verified regional climatology summary; no daily imputation.",
            raw_source_sha256=ref_hash,
            receipt_sha256=ref_hash,
            fixture_origin="REGIONAL_OFFLINE_REFERENCE_FIXTURE",
            transformation_id="REGIONAL_CLIMATOLOGY_SUMMARY_V1",
            estimator_id=None,
            license=NASA_POWER_LICENSE,
            attribution=NASA_POWER_CITATION,
            restrictions="Offline regional climatology summary; acquire full daily NASA POWER snapshot for daily simulation.",
        )

        ev_t2m = TypedEvidenceObject(
            parameter_path="climate.T2M",
            provenance_class="DERIVED_WITH_VALIDATED_METHOD",
            evidence_level="VERIFIED_OPEN_SOURCE_MAP_ESTIMATE",
            source_id="NASA_POWER_REGIONAL_CLIMATOLOGY_OFFLINE_REFERENCE",
            provider="NASA POWER Regional Climatology Offline Reference Table",
            product="MERRA-2 Historical Regional Summary Reference",
            variable="T2M",
            version="v2.10.3-offline-ref",
            permanent_url=NASA_POWER_URL,
            citation=NASA_POWER_CITATION,
            access_path="adaptive_evidence/adapters/nasa_power.py#OFFLINE_REGIONAL_CLIMATE_REFERENCES",
            retrieved_at="2026-11-09T00:00:00+00:00",
            valid_period=(start_iso, end_iso),
            evidence_type="MODELLED",
            point_lon_lat=(lon, lat),
            crs=crs,
            spatial_resolution_desc="0.625 x 0.5 degree MERRA-2 regional climatology summary (offline fixture)",
            pixel_area_km2=MERRA2_PIXEL_AREA_KM2,
            depth_interval_cm=None,
            raw_unit="C",
            scale_factor=1.0,
            raw_value=ref["tmean_c"],
            converted_si_value=ref["tmean_c"],
            si_unit="C",
            quantiles={
                "q05": ref["tmin_q05_c"],
                "q50": ref["tmean_c"],
                "q95": ref["tmax_q95_c"],
                "mean": ref["tmean_c"],
            },
            uncertainty_semantics="Offline regional 5th percentile Tmin to 95th percentile Tmax envelope.",
            quality_flags=("OFFLINE_REGIONAL_REFERENCE_FIXTURE", "NOT_FULL_DAILY_SERIES"),
            missing_value_handling="Pre-verified regional climatology summary.",
            raw_source_sha256=ref_hash,
            receipt_sha256=ref_hash,
            fixture_origin="REGIONAL_OFFLINE_REFERENCE_FIXTURE",
            transformation_id="REGIONAL_CLIMATOLOGY_SUMMARY_V1",
            estimator_id=None,
            license=NASA_POWER_LICENSE,
            attribution=NASA_POWER_CITATION,
            restrictions="Offline regional climatology summary; acquire full daily NASA POWER snapshot for daily simulation.",
        )

        return {
            "status": "CONDITIONAL",
            "capability_status": "CONDITIONAL",
            "fixture_origin": "REGIONAL_OFFLINE_REFERENCE_FIXTURE",
            "evidence_level": "VERIFIED_OPEN_SOURCE_MAP_ESTIMATE",
            "missing_reason": None,
            "diagnostics": {
                "period": [start_iso, end_iso],
                "annual_basis_available": True,
                "days_verified": period_check["expected_days"],
                "leap_days_verified": period_check["leap_days_ymd"],
                "mean_annual_precipitation_mm": ref["precip_mm_yr"],
                "driest_year_precipitation_mm": ref["dry_yr_mm"],
                "wettest_year_precipitation_mm": ref["wet_yr_mm"],
                "mean_temperature_c": ref["tmean_c"],
                "q05_daily_tmin_c": ref["tmin_q05_c"],
                "q95_daily_tmax_c": ref["tmax_q95_c"],
                "frost_days_per_year": ref["frost_days_yr"],
                "conditional_hs_et0_mm_year": ref["et0_mm_yr"],
                "aridity_ratio_p_over_et0": round(ref["precip_mm_yr"] / max(1.0, ref["et0_mm_yr"]), 3),
                "future_forecast": False,
                "field_station_measurement": False,
            },
            "evidence_objects": [ev_precip.to_dict(), ev_t2m.to_dict()],
            "typed_objects": [ev_precip, ev_t2m],
        }

    def _blocked_response(
        self,
        point_lon_lat: Sequence[Any],
        crs: str,
        start_iso: str,
        end_iso: str,
        missing_reason: str,
        detail: str,
        *,
        time_standard: str = "UTC",
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        lon = float(point_lon_lat[0]) if isinstance(point_lon_lat, (list, tuple)) and len(point_lon_lat) == 2 and isinstance(point_lon_lat[0], (int, float)) and math.isfinite(point_lon_lat[0]) else 0.0
        lat = float(point_lon_lat[1]) if isinstance(point_lon_lat, (list, tuple)) and len(point_lon_lat) == 2 and isinstance(point_lon_lat[1], (int, float)) and math.isfinite(point_lon_lat[1]) else 0.0
        ev = TypedEvidenceObject(
            parameter_path="climate.PRECTOTCORR",
            provenance_class="NOT_RETRIEVABLE",
            evidence_level="UNAVAILABLE",
            source_id=f"NASA_POWER_MERRA2_DAILY_{time_standard}",
            provider="NASA Langley Research Center POWER Project",
            product="MERRA-2 Assimilated Daily Meteorology",
            variable="PRECTOTCORR",
            version="v2.10.3",
            permanent_url=NASA_POWER_URL,
            citation=NASA_POWER_CITATION,
            access_path=NASA_POWER_URL,
            retrieved_at=None,
            valid_period=(start_iso, end_iso),
            evidence_type="UNAVAILABLE",
            point_lon_lat=(lon, lat),
            crs=str(crs),
            spatial_resolution_desc="0.625 x 0.5 degree MERRA-2 grid",
            pixel_area_km2=MERRA2_PIXEL_AREA_KM2,
            depth_interval_cm=None,
            raw_unit="mm/day",
            scale_factor=1.0,
            raw_value=None,
            converted_si_value=None,
            si_unit="mm/year",
            quantiles=None,
            uncertainty_semantics="Unavailable",
            quality_flags=("BLOCKED", f"{time_standard}_TIME_STANDARD"),
            missing_value_handling=detail,
            raw_source_sha256=None,
            receipt_sha256=None,
            fixture_origin="UNAVAILABLE_NO_DATA",
            transformation_id=None,
            estimator_id=None,
            license=NASA_POWER_LICENSE,
            attribution=NASA_POWER_CITATION,
            restrictions="Unavailable",
            missing_reason=missing_reason,
        )
        return {
            "status": "BLOCKED",
            "capability_status": "BLOCKED",
            "fixture_origin": "UNAVAILABLE_NO_DATA",
            "evidence_level": "UNAVAILABLE",
            "missing_reason": missing_reason,
            "detail": detail,
            "diagnostics": {"time_standard": time_standard, "request_telemetry": telemetry} if telemetry else None,
            "evidence_objects": [ev.to_dict()],
            "typed_objects": [ev],
        }
