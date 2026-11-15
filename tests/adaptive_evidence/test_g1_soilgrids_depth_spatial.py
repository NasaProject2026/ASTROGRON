"""Suite B — G1 ISRIC SoilGrids Depth Aggregation, GeoTIFF Decoder, and Spatial Integrity Tests.

Tests Deflate (zlib), LZW, horizontal predictor=2, multi-strip rasters, cfvo=0 vs nodata=-32768,
geodesic distance / POINT_PIXEL_MISSING / GEO_DISTANCE_EXCEEDED, all 6 depths without 0-5cm
substitution, >200cm abstention, intensive thickness weighting, and phh2o scalar abstention.
"""
from __future__ import annotations

import io
import json
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

from adaptive_evidence.adapters.depth_aggregation import (
    ALL_SOILGRIDS_DEPTH_LABELS,
    aggregate_soilgrids_property_layers,
    resolve_overlapping_soilgrids_depths,
)
from adaptive_evidence.adapters.geotiff import locate_geotiff_pixel_at_point, parse_geotiff
from adaptive_evidence.adapters.soilgrids import SoilGridsWCSAdapter


def _lzw_compress_tiff(raw: bytes) -> bytes:
    """Minimal MSB-first TIFF LZW encoder compatible with compression=5 decoders."""
    CLEAR, EOI = 256, 257
    bits_out: list[int] = []

    def emit(code: int, width: int) -> None:
        for shift in range(width - 1, -1, -1):
            bits_out.append((code >> shift) & 1)

    table: dict[bytes, int] = {bytes([i]): i for i in range(256)}
    next_code = 258
    code_size = 9
    emit(CLEAR, code_size)
    w = b""
    for b in raw:
        wk = w + bytes([b])
        if wk in table:
            w = wk
        else:
            emit(table[w], code_size)
            if next_code < 4096:
                table[wk] = next_code
                next_code += 1
                if next_code == 512:
                    code_size = 10
                elif next_code == 1024:
                    code_size = 11
                elif next_code == 2048:
                    code_size = 12
            else:
                emit(CLEAR, code_size)
                table = {bytes([i]): i for i in range(256)}
                next_code = 258
                code_size = 9
            w = bytes([b])
    if w:
        emit(table[w], code_size)
    emit(EOI, code_size)
    while len(bits_out) % 8:
        bits_out.append(0)
    out = bytearray()
    for i in range(0, len(bits_out), 8):
        byte = 0
        for b in bits_out[i : i + 8]:
            byte = (byte << 1) | b
        out.append(byte)
    return bytes(out)


def _apply_horiz_diff_encode(raw: bytes, width: int, rows: int, bps: int) -> bytes:
    """Encode horizontal differencing predictor=2 (byte/int16 sample width)."""
    stride = width * (bps // 8)
    step = bps // 8
    out = bytearray(raw)
    for r in range(rows):
        row_off = r * stride
        for i in range(stride - 1, step - 1, -1):
            if step == 1:
                out[row_off + i] = (out[row_off + i] - out[row_off + i - 1]) & 0xFF
            elif step == 2 and i % 2 == 1:
                # 16-bit integer horizontal differencing operates on 16-bit samples
                idx = row_off + i - 1
                cur = struct.unpack_from("<H", raw, idx)[0]
                prv = struct.unpack_from("<H", raw, idx - 2)[0]
                struct.pack_into("<H", out, idx, (cur - prv) & 0xFFFF)
    return bytes(out)


def _build_geotiff(
    width: int,
    height: int,
    values: list[int | float],
    *,
    compression: int = 1,
    predictor: int = 1,
    rows_per_strip: int | None = None,
    sample_format: int = 2,
    bps: int = 16,
    lon0: float = 1.59,
    lat0: float = 48.36,
    scale: float = 0.002,
    nodata_str: str = "-32768",
) -> bytes:
    rps = rows_per_strip or height
    fmt = "<h" if (sample_format == 2 and bps == 16) else "<f" if (sample_format == 3 and bps == 32) else "<B"
    strips: list[bytes] = []
    for r0 in range(0, height, rps):
        r1 = min(height, r0 + rps)
        chunk_vals = values[r0 * width : r1 * width]
        raw_strip = b"".join(struct.pack(fmt, v) for v in chunk_vals)
        if predictor == 2:
            raw_strip = _apply_horiz_diff_encode(raw_strip, width, r1 - r0, bps)
        if compression == 8:
            strips.append(zlib.compress(raw_strip))
        elif compression == 5:
            strips.append(_lzw_compress_tiff(raw_strip))
        else:
            strips.append(raw_strip)

    ps_bytes = struct.pack("<3d", scale, scale, 0.0)
    tp_bytes = struct.pack("<6d", 0.0, 0.0, 0.0, lon0, lat0, 0.0)
    gkeys = struct.pack("<12H", 1, 1, 0, 2, 1024, 0, 1, 2, 2048, 0, 1, 4326)
    nodata_b = nodata_str.encode("ascii") + b"\x00"

    entries_spec: list[tuple[int, int, int, int, bytes | None]] = [
        (256, 4, 1, width, None),
        (257, 4, 1, height, None),
        (258, 3, 1, bps, None),
        (259, 3, 1, compression, None),
        (273, 4, len(strips), 0, b"__STRIP_OFFS__"),
        (277, 3, 1, 1, None),
        (278, 4, 1, rps, None),
        (279, 4, len(strips), 0, b"__STRIP_CNTS__"),
        (317, 3, 1, predictor, None),
        (339, 3, 1, sample_format, None),
        (33550, 12, 3, 0, ps_bytes),
        (33922, 12, 6, 0, tp_bytes),
        (34735, 3, len(gkeys) // 2, 0, gkeys),
        (42113, 2, len(nodata_b), 0, nodata_b),
    ]
    ifd_start = 8
    ifd_len = 2 + 12 * len(entries_spec) + 4
    buf = bytearray(b"II\x2a\x00\x08\x00\x00\x00" + b"\x00" * ifd_len)
    cursor = ifd_start + ifd_len
    strip_offs = []
    strip_cnts = []
    for sb in strips:
        strip_offs.append(cursor)
        strip_cnts.append(len(sb))
        buf.extend(sb)
        cursor += len(sb)

    struct.pack_into("<H", buf, ifd_start, len(entries_spec))
    for idx, (tag, ftype, cnt, imm, ext) in enumerate(entries_spec):
        pos = ifd_start + 2 + idx * 12
        if ext == b"__STRIP_OFFS__":
            if len(strip_offs) == 1:
                val = strip_offs[0]
            else:
                val = cursor
                pack_b = struct.pack(f"<{len(strip_offs)}I", *strip_offs)
                buf.extend(pack_b)
                cursor += len(pack_b)
        elif ext == b"__STRIP_CNTS__":
            if len(strip_cnts) == 1:
                val = strip_cnts[0]
            else:
                val = cursor
                pack_b = struct.pack(f"<{len(strip_cnts)}I", *strip_cnts)
                buf.extend(pack_b)
                cursor += len(pack_b)
        elif ext is not None:
            val = cursor
            buf.extend(ext)
            cursor += len(ext)
        else:
            val = imm
        struct.pack_into("<HHII", buf, pos, tag, ftype, cnt, val)
    struct.pack_into("<I", buf, ifd_start + 2 + len(entries_spec) * 12, 0)
    return bytes(buf)


class TestG1SoilGridsDepthAndSpatial(unittest.TestCase):
    def test_geotiff_compression_multistrip_predictor_float32_and_cfvo_zero(self) -> None:
        vals = [120, 140, -32768, 0, 210, 250]
        # 1. Deflate multi-strip int16
        t_def = _build_geotiff(3, 2, vals, compression=8, rows_per_strip=1)
        p_def = parse_geotiff(t_def)
        self.assertEqual(p_def["values"], vals)
        self.assertEqual(p_def["nodata"], -32768.0)

        # 2. LZW multi-strip int16 with Predictor=2 horizontal differencing
        t_lzw = _build_geotiff(3, 2, vals, compression=5, predictor=2, rows_per_strip=1)
        p_lzw = parse_geotiff(t_lzw)
        self.assertEqual(p_lzw["values"], vals)

        # 3. Float32 Deflate raster
        fvals = [1.5, 2.25, -9999.0, 0.0]
        t_f32 = _build_geotiff(2, 2, fvals, compression=8, sample_format=3, bps=32, nodata_str="-9999")
        p_f32 = parse_geotiff(t_f32)
        self.assertEqual([round(x, 3) for x in p_f32["values"]], [1.5, 2.25, -9999.0, 0.0])

        # 4. Valid cfvo=0 pixel vs -32768 nodata center pixel
        t_cfvo = _build_geotiff(
            2, 2, [0, -32768, 10, 12], lon0=1.60, lat0=48.352, scale=0.002, nodata_str="-32768"
        )
        p_cfvo = parse_geotiff(t_cfvo)
        loc_zero = locate_geotiff_pixel_at_point(p_cfvo, 1.601, 48.351, max_distance_m=500.0)
        self.assertTrue(loc_zero["ok"])
        self.assertEqual(loc_zero["value"], 0)
        loc_nd = locate_geotiff_pixel_at_point(p_cfvo, 1.603, 48.351, max_distance_m=500.0)
        self.assertFalse(loc_nd["ok"])
        self.assertEqual(loc_nd["code"], "POINT_PIXEL_MISSING")

    def test_geo_distance_exceeded_fails_closed(self) -> None:
        # 1 coarse 0.02 deg pixel centered at (10.00, 50.00), query at (10.009, 50.000) inside pixel yet > 500 m from center
        t = _build_geotiff(1, 1, [220], lon0=9.99, lat0=50.01, scale=0.02)
        p = parse_geotiff(t)
        res = locate_geotiff_pixel_at_point(p, 10.009, 50.000, max_distance_m=500.0)
        self.assertFalse(res["ok"])
        self.assertEqual(res["code"], "GEO_DISTANCE_EXCEEDED")

    def test_all_6_native_depths_custom_aggregation_phh2o_abstention_and_over200cm_block(self) -> None:
        self.assertEqual(len(ALL_SOILGRIDS_DEPTH_LABELS), 6)
        ov = resolve_overlapping_soilgrids_depths(10.0, 45.0)
        self.assertTrue(ov["valid"])
        labels = [o["depth_label"] for o in ov["overlaps"]]
        self.assertEqual(labels, ["5-15cm", "15-30cm", "30-60cm"])
        weights = {o["depth_label"]: o["overlap_cm"] for o in ov["overlaps"]}
        self.assertEqual(weights, {"5-15cm": 5.0, "15-30cm": 15.0, "30-60cm": 15.0})

        layer_vals = {
            "5-15cm": {"q05": 10.0, "q50": 20.0, "mean": 20.0, "q95": 30.0},
            "15-30cm": {"q05": 12.0, "q50": 24.0, "mean": 24.0, "q95": 36.0},
            "30-60cm": {"q05": 14.0, "q50": 28.0, "mean": 28.0, "q95": 42.0},
        }
        soc_agg = aggregate_soilgrids_property_layers("soc", ov["overlaps"], layer_vals, unit="g/kg")
        # Exact thickness-weighted mean: (5*20 + 15*24 + 15*28) / 35 = 880 / 35 = 25.1429
        self.assertAlmostEqual(soc_agg["mean"], 25.1428, places=3)
        self.assertFalse(soc_agg["abstained_scalar"])

        ph_agg = aggregate_soilgrids_property_layers(
            "phh2o",
            ov["overlaps"],
            {
                "5-15cm": {"q05": 6.0, "q50": 6.2, "mean": 6.2, "q95": 6.5},
                "15-30cm": {"q05": 6.4, "q50": 6.6, "mean": 6.6, "q95": 6.9},
                "30-60cm": {"q05": 7.0, "q50": 7.3, "mean": 7.3, "q95": 7.6},
            },
            unit="pH",
        )
        self.assertTrue(ph_agg["abstained_scalar"])
        self.assertIsNone(ph_agg["mean"])

        # >200 cm must fail closed inside adapter
        with tempfile.TemporaryDirectory() as td:
            adapter = SoilGridsWCSAdapter(cache_dir=Path(td))
            res_deep = adapter.fetch_or_load([1.60, 48.35], [[150, 250]], acquisition="CACHE_ONLY")
            self.assertEqual(res_deep["status"], "BLOCKED")
            self.assertEqual(res_deep["missing_reason"], "depth_interval_unavailable")

            # Non-contiguous intervals (e.g. omitting 5-15cm between [0,5] and [15,30]) must fail closed
            from adaptive_evidence.schema import validate_depth_intervals
            gap_chk = validate_depth_intervals([[0, 5], [15, 30]])
            self.assertFalse(gap_chk["valid"])
            self.assertEqual(gap_chk["missing_reason"], "depth_inconsistency")
            res_gap = adapter.fetch_or_load([1.60, 48.35], [[0, 5], [15, 30]], acquisition="CACHE_ONLY")
            self.assertEqual(res_gap["status"], "BLOCKED")
            self.assertEqual(res_gap["missing_reason"], "depth_inconsistency")


if __name__ == "__main__":
    unittest.main()
