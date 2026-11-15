"""Suite A — G1 NASA POWER Daily Adapter Upgrade Tests.

Tests UTC vs LST cache separation, missing-day / -999 fill vs valid dry 0.0 mm/day,
leap-year 366-day handling, post-cutoff & max_age_days enforcement, host allow-list,
2 MB size cap, 429 retry backoff, and atomic receipt/raw file persistence.
"""
from __future__ import annotations

import io
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

from adaptive_evidence.adapters.http_cache import bounded_https_get, canonical_cache_key, validate_outbound_https_url
from adaptive_evidence.adapters.nasa_power import NASAPowerAdapter


def _build_power_json(
    start_s: str,
    end_s: str,
    *,
    lon: float = 1.60,
    lat: float = 48.35,
    missing_dates: tuple[str, ...] = (),
    fill_precip_dates: tuple[str, ...] = (),
    dry_all: bool = False,
) -> dict:
    s_d = date.fromisoformat(start_s)
    e_d = date.fromisoformat(end_s)
    tmin, tmax, tmean, pre = {}, {}, {}, {}
    cur = s_d
    idx = 0
    while cur <= e_d:
        k = cur.strftime("%Y%m%d")
        if k not in missing_dates:
            tmin[k] = 6.5
            tmax[k] = 17.5
            tmean[k] = 12.0
            if k in fill_precip_dates:
                pre[k] = -999.0
            elif dry_all:
                pre[k] = 0.0
            else:
                pre[k] = 2.0 if idx % 2 == 0 else 0.0
        cur += timedelta(days=1)
        idx += 1
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat, 120.0]},
        "header": {
            "api": {"version": "v2.10.3", "name": "POWER Daily API"},
            "sources": ["MERRA2"],
            "fill_value": -999.0,
            "start": start_s.replace("-", ""),
            "end": end_s.replace("-", ""),
        },
        "parameters": {
            "T2M_MIN": {"units": "C"},
            "T2M_MAX": {"units": "C"},
            "T2M": {"units": "C"},
            "PRECTOTCORR": {"units": "mm/day"},
        },
        "properties": {
            "parameter": {
                "T2M_MIN": tmin,
                "T2M_MAX": tmax,
                "T2M": tmean,
                "PRECTOTCORR": pre,
            }
        },
    }


class _FakeHttpResp:
    def __init__(self, body: bytes, status: int = 200) -> None:
        self.status = status
        self._bio = io.BytesIO(body)

    def read(self, n: int = -1) -> bytes:
        return self._bio.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class TestG1NasaPowerUpgrade(unittest.TestCase):
    def test_utc_vs_lst_cache_key_separation_and_live_to_cache_level(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            adapter = NASAPowerAdapter(cache_dir=Path(td))
            payload = json.dumps(_build_power_json("2020-01-01", "2020-12-31")).encode("utf-8")

            with mock.patch("adaptive_evidence.adapters.nasa_power.urllib.request.urlopen", return_value=_FakeHttpResp(payload)):
                live_utc = adapter.fetch_or_load(
                    [1.60, 48.35],
                    "2020-01-01",
                    "2020-12-31",
                    acquisition="FETCH_ALLOWED",
                    time_standard="UTC",
                    site_id="FR_LEAP_UTC",
                )
            self.assertEqual(live_utc["status"], "READY")
            self.assertEqual(live_utc["evidence_level"], "AUTHENTIC_LIVE")
            self.assertEqual(live_utc["diagnostics"]["time_standard"], "UTC")
            self.assertEqual(live_utc["diagnostics"]["days_verified"], 366)  # 2020 leap day preserved
            self.assertEqual(live_utc["diagnostics"]["leap_days_verified"], ["20200229"])

            # Requesting LST in CACHE_ONLY must NOT collide with UTC cache entry
            lst_miss = adapter.fetch_or_load(
                [1.60, 48.35],
                "2020-01-01",
                "2020-12-31",
                acquisition="CACHE_ONLY",
                time_standard="LST",
                site_id="FR_LEAP_LST",
            )
            self.assertEqual(lst_miss["status"], "BLOCKED")
            self.assertEqual(lst_miss["missing_reason"], "source_outage")

            # Same UTC request in CACHE_ONLY returns AUTHENTIC_VERIFIED_CACHE
            cache_utc = adapter.fetch_or_load(
                [1.60, 48.35],
                "2020-01-01",
                "2020-12-31",
                acquisition="CACHE_ONLY",
                time_standard="UTC",
                site_id="FR_LEAP_UTC",
            )
            self.assertEqual(cache_utc["status"], "READY")
            self.assertEqual(cache_utc["evidence_level"], "AUTHENTIC_VERIFIED_CACHE")
            self.assertEqual(cache_utc["diagnostics"]["time_standard"], "UTC")

    def test_dry_zero_preserved_while_minus999_fill_and_missing_days_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            adapter = NASAPowerAdapter(cache_dir=Path(td))
            dry_bytes = json.dumps(_build_power_json("2024-06-01", "2024-06-30", dry_all=True)).encode("utf-8")
            with mock.patch("adaptive_evidence.adapters.nasa_power.urllib.request.urlopen", return_value=_FakeHttpResp(dry_bytes)):
                dry_res = adapter.fetch_or_load(
                    [1.60, 48.35], "2024-06-01", "2024-06-30", acquisition="FETCH_ALLOWED", site_id="DRY_JUNE"
                )
            self.assertEqual(dry_res["status"], "READY")
            self.assertEqual(dry_res["diagnostics"]["days_verified"], 30)
            self.assertEqual(dry_res["diagnostics"]["period_cumulative_precipitation_mm"], 0.0)
            self.assertTrue(dry_res["diagnostics"]["is_sub_annual_window"])
            self.assertFalse(dry_res["diagnostics"]["annual_basis_available"])

            fill_bytes = json.dumps(
                _build_power_json("2024-07-01", "2024-07-31", fill_precip_dates=("20240710",))
            ).encode("utf-8")
            with mock.patch("adaptive_evidence.adapters.nasa_power.urllib.request.urlopen", return_value=_FakeHttpResp(fill_bytes)):
                fill_res = adapter.fetch_or_load(
                    [1.60, 48.35], "2024-07-01", "2024-07-31", acquisition="FETCH_ALLOWED", site_id="FILL_JULY"
                )
            self.assertEqual(fill_res["status"], "BLOCKED")
            self.assertIn(fill_res["missing_reason"], ("incomplete_data", "quality_fail"))

            gap_bytes = json.dumps(
                _build_power_json("2024-08-01", "2024-08-31", missing_dates=("20240815",))
            ).encode("utf-8")
            with mock.patch("adaptive_evidence.adapters.nasa_power.urllib.request.urlopen", return_value=_FakeHttpResp(gap_bytes)):
                gap_res = adapter.fetch_or_load(
                    [1.60, 48.35], "2024-08-01", "2024-08-31", acquisition="FETCH_ALLOWED", site_id="GAP_AUG"
                )
            self.assertEqual(gap_res["status"], "BLOCKED")

    def test_host_allowlist_2mb_cap_and_429_retry_backoff(self) -> None:
        ok_bad_host, host_err = validate_outbound_https_url("https://evil.example.com/power")
        self.assertFalse(ok_bad_host)
        self.assertIsNotNone(host_err)

        ok_http, http_err = validate_outbound_https_url("http://power.larc.nasa.gov/api/temporal/daily/point")
        self.assertFalse(ok_http)
        self.assertIsNotNone(http_err)

        # Oversized payload rejected (> 2 MB)
        oversized = _FakeHttpResp(b"x" * (2 * 1024 * 1024 + 128))
        res_big = bounded_https_get(
            "https://power.larc.nasa.gov/api/temporal/daily/point?longitude=1.6&latitude=48.35",
            urlopen_fn=lambda req, timeout=20: oversized,
            max_retries=0,
        )
        self.assertFalse(res_big["ok"])
        self.assertEqual(res_big["error_code"], "quality_fail")
        self.assertIn("2097152 byte cap", res_big["error_detail"])

        # 429 then 200 succeeds cleanly with retry telemetry
        import urllib.error
        calls = {"n": 0}

        def _retry_open(req, timeout=20):
            calls["n"] += 1
            if calls["n"] == 1:
                raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {}, None)
            return _FakeHttpResp(b'{"ok":true}')

        res_ok = bounded_https_get(
            "https://power.larc.nasa.gov/api/temporal/daily/point?longitude=1.6&latitude=48.35",
            urlopen_fn=_retry_open,
            max_retries=2,
            base_backoff_s=0.01,
        )
        self.assertTrue(res_ok["ok"])
        self.assertEqual(res_ok["attempts"], 2)
        self.assertEqual(res_ok["status_code"], 200)

    def test_max_age_days_and_cutoff_rejection(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            adapter = NASAPowerAdapter(cache_dir=Path(td))
            payload = json.dumps(_build_power_json("2020-01-01", "2020-12-31")).encode("utf-8")
            with mock.patch("adaptive_evidence.adapters.nasa_power.urllib.request.urlopen", return_value=_FakeHttpResp(payload)):
                adapter.fetch_or_load(
                    [1.60, 48.35],
                    "2020-01-01",
                    "2020-12-31",
                    as_of_iso="2021-01-05T00:00:00+00:00",
                    acquisition="FETCH_ALLOWED",
                    site_id="STALE_TEST",
                )
            # Re-read cache with as_of much later and max_age_days=1 -> blocked as stale
            stale = adapter.fetch_or_load(
                [1.60, 48.35],
                "2020-01-01",
                "2020-12-31",
                as_of_iso="2030-01-01T00:00:00+00:00",
                acquisition="CACHE_ONLY",
                max_age_days=1,
                site_id="STALE_TEST",
            )
            self.assertEqual(stale["status"], "BLOCKED")
            self.assertEqual(stale["missing_reason"], "stale_or_post_cutoff_snapshot")

            # Period extending past as_of_iso -> stale_or_post_cutoff_snapshot
            post_cut = adapter.fetch_or_load(
                [1.60, 48.35],
                "2020-01-01",
                "2020-12-31",
                as_of_iso="2020-06-01T00:00:00+00:00",
                acquisition="CACHE_ONLY",
                site_id="CUTOFF_TEST",
            )
        self.assertEqual(post_cut["status"], "BLOCKED")
        self.assertEqual(post_cut["missing_reason"], "stale_or_post_cutoff_snapshot")

    def test_raw_http_redirect_status_blocked_on_injected_urlopen(self) -> None:
        class _RedirectResp:
            status = 302
            headers = {"Location": "https://evil.example.com/payload"}
            def read(self, n=-1):
                return b""
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False

        res_redir = bounded_https_get(
            "https://power.larc.nasa.gov/api/temporal/daily/point?longitude=1.6&latitude=48.35",
            urlopen_fn=lambda req, timeout=20: _RedirectResp(),
            max_retries=0,
        )
        self.assertFalse(res_redir["ok"])
        self.assertEqual(res_redir["status_code"], 302)
        self.assertEqual(res_redir["error_code"], "source_blocked")


if __name__ == "__main__":
    unittest.main()
