"""Pure-Python georeferenced GeoTIFF parser and exact WCS pixel-support validator.

Handles uncompressed, Deflate (RFC 1951), and LZW single/multi-strip and tiled
rasters, TIFF horizontal differencing predictors, affine tiepoint/pixel-scale or
transformation matrices, GeoKey CRS checks, GDAL_NODATA tags, and geodesic
distance checks from requested WGS84 coordinates.
"""
from __future__ import annotations

import math
import struct
from typing import Any, Dict, List, Optional, Sequence, Tuple
import zlib

import pyproj  # type: ignore

WGS84_GEOD = pyproj.Geod(ellps="WGS84")

_TIFF_TYPE_INFO = {
    1: (1, "B"),   # BYTE
    2: (1, "s"),   # ASCII
    3: (2, "H"),   # SHORT
    4: (4, "I"),   # LONG
    5: (8, "II"),  # RATIONAL
    6: (1, "b"),   # SBYTE
    7: (1, "B"),   # UNDEFINED
    8: (2, "h"),   # SSHORT
    9: (4, "i"),   # SLONG
    10: (8, "ii"), # SRATIONAL
    11: (4, "f"),  # FLOAT
    12: (8, "d"),  # DOUBLE
}

_SAMPLE_FORMAT_CODE = {
    (1, 8): "B",
    (1, 16): "H",
    (1, 32): "I",
    (2, 8): "b",
    (2, 16): "h",
    (2, 32): "i",
    (3, 32): "f",
    (3, 64): "d",
}


def _decode_tiff_lzw(data: bytes) -> bytes:
    """Decode MSB-first TIFF LZW stream (compression=5)."""
    CLEAR_CODE = 256
    EOI_CODE = 257

    bit_pos = 0
    total_bits = len(data) * 8

    def read_bits(nbits: int) -> Optional[int]:
        nonlocal bit_pos
        if bit_pos + nbits > total_bits:
            return None
        val = 0
        for _ in range(nbits):
            byte_i = bit_pos >> 3
            shift = 7 - (bit_pos & 7)
            val = (val << 1) | ((data[byte_i] >> shift) & 1)
            bit_pos += 1
        return val

    table: Dict[int, bytes] = {}
    code_size = 9
    next_code = 258
    prev_seq: Optional[bytes] = None
    out = bytearray()

    def reset_table() -> None:
        nonlocal table, code_size, next_code
        table = {i: bytes([i]) for i in range(256)}
        code_size = 9
        next_code = 258

    reset_table()
    while True:
        code = read_bits(code_size)
        if code is None or code == EOI_CODE:
            break
        if code == CLEAR_CODE:
            reset_table()
            prev_seq = None
            continue
        if code in table:
            entry = table[code]
        elif code == next_code and prev_seq is not None:
            entry = prev_seq + prev_seq[:1]
        else:
            raise ValueError(f"Corrupt TIFF LZW code {code} (next_code={next_code}).")
        out.extend(entry)
        if prev_seq is not None and next_code < 4096:
            table[next_code] = prev_seq + entry[:1]
            next_code += 1
            if next_code == 511:
                code_size = 10
            elif next_code == 1023:
                code_size = 11
            elif next_code == 2047:
                code_size = 12
        prev_seq = entry
    return bytes(out)


def _decompress_segment(raw_chunk: bytes, compression: int) -> bytes:
    if compression == 1:
        return raw_chunk
    if compression in (8, 32946):
        return zlib.decompress(raw_chunk)
    if compression == 5:
        return _decode_tiff_lzw(raw_chunk)
    raise ValueError(f"Unsupported TIFF compression scheme: {compression}")


def _unpack_samples(raw_bytes: bytes, endian: str, sample_format: int, bps: int, count: int) -> List[Any]:
    fmt = _SAMPLE_FORMAT_CODE.get((sample_format, bps))
    if fmt is None:
        raise ValueError(f"Unsupported TIFF SampleFormat={sample_format}, BitsPerSample={bps}.")
    needed = count * (bps // 8)
    if len(raw_bytes) < needed:
        raise ValueError(f"Truncated raster segment: expected {needed} bytes, got {len(raw_bytes)}.")
    return list(struct.unpack(f"{endian}{count}{fmt}", raw_bytes[:needed]))


def _apply_horizontal_predictor(values: List[Any], width: int, rows: int, bps: int) -> List[Any]:
    if bps not in (8, 16, 32):
        raise ValueError(f"TIFF Predictor=2 unsupported for BitsPerSample={bps}.")
    mod = 1 << bps
    half = 1 << (bps - 1)
    out = list(values)
    for r in range(rows):
        base = r * width
        acc = out[base]
        for c in range(1, width):
            acc = (acc + out[base + c]) % mod
            if acc >= half:
                out[base + c] = acc - mod
            else:
                out[base + c] = acc
    return out


def parse_geotiff(tiff_bytes: bytes) -> Dict[str, Any]:
    """Parse a GeoTIFF byte payload into raster array + georeferencing metadata."""
    if not isinstance(tiff_bytes, (bytes, bytearray)) or len(tiff_bytes) < 16:
        raise ValueError("GeoTIFF buffer too short.")
    magic = bytes(tiff_bytes[:4])
    if magic == b"II*\x00":
        endian = "<"
    elif magic == b"MM\x00*":
        endian = ">"
    else:
        raise ValueError(f"Invalid GeoTIFF header signature: {magic!r}")

    ifd_offset = struct.unpack(endian + "I", tiff_bytes[4:8])[0]
    if ifd_offset <= 0 or ifd_offset + 2 > len(tiff_bytes):
        raise ValueError("Invalid TIFF IFD0 offset.")

    num_entries = struct.unpack(endian + "H", tiff_bytes[ifd_offset : ifd_offset + 2])[0]
    tags: Dict[int, Any] = {}
    for idx in range(num_entries):
        entry_off = ifd_offset + 2 + idx * 12
        if entry_off + 12 > len(tiff_bytes):
            raise ValueError("Truncated TIFF IFD0 entry.")
        tag, field_type, count, value_or_offset = struct.unpack(
            endian + "HHII", tiff_bytes[entry_off : entry_off + 12]
        )
        tinfo = _TIFF_TYPE_INFO.get(field_type)
        if tinfo is None:
            continue
        item_sz, item_fmt = tinfo
        byte_len = item_sz * count
        if byte_len <= 4:
            raw_field = bytes(tiff_bytes[entry_off + 8 : entry_off + 8 + byte_len])
        else:
            if value_or_offset + byte_len > len(tiff_bytes):
                raise ValueError(f"TIFF tag {tag} payload offset out of range.")
            raw_field = bytes(tiff_bytes[value_or_offset : value_or_offset + byte_len])

        if field_type == 2:
            tags[tag] = raw_field.rstrip(b"\x00").decode("ascii", errors="replace")
        elif field_type in (5, 10):
            pairs = struct.unpack(f"{endian}{count * 2}{item_fmt[0]}", raw_field)
            vals = [
                (pairs[2 * k] / pairs[2 * k + 1]) if pairs[2 * k + 1] != 0 else math.nan
                for k in range(count)
            ]
            tags[tag] = vals[0] if count == 1 else vals
        else:
            vals = list(struct.unpack(f"{endian}{count}{item_fmt}", raw_field))
            tags[tag] = vals[0] if count == 1 else vals

    def _as_list(val: Any) -> List[Any]:
        if val is None:
            return []
        return list(val) if isinstance(val, (list, tuple)) else [val]

    width = int(tags.get(256) or 0)
    height = int(tags.get(257) or 0)
    if width <= 0 or height <= 0:
        raise ValueError("GeoTIFF missing valid ImageWidth (256) / ImageLength (257).")
    samples_per_pixel = int(tags.get(277, 1))
    if samples_per_pixel != 1:
        raise ValueError(f"Expected single-band GeoTIFF, got SamplesPerPixel={samples_per_pixel}.")
    bps = int(tags.get(258, 16))
    sample_format = int(tags.get(339, 2))  # SoilGrids WCS uses signed 16-bit int (2)
    compression = int(tags.get(259, 1))
    predictor = int(tags.get(317, 1))

    values: List[Any] = [0] * (width * height)
    if 324 in tags and 325 in tags:
        # Tiled raster
        tw = int(tags[322])
        th = int(tags[323])
        t_offs = [int(x) for x in _as_list(tags[324])]
        t_cnts = [int(x) for x in _as_list(tags[325])]
        tiles_across = math.ceil(width / tw)
        for ti, (off, cnt) in enumerate(zip(t_offs, t_cnts)):
            chunk = _decompress_segment(bytes(tiff_bytes[off : off + cnt]), compression)
            tile_vals = _unpack_samples(chunk, endian, sample_format, bps, tw * th)
            if predictor == 2:
                tile_vals = _apply_horizontal_predictor(tile_vals, tw, th, bps)
            ty = (ti // tiles_across) * th
            tx = (ti % tiles_across) * tw
            for lr in range(th):
                gy = ty + lr
                if gy >= height:
                    continue
                for lc in range(tw):
                    gx = tx + lc
                    if gx >= width:
                        continue
                    values[gy * width + gx] = tile_vals[lr * tw + lc]
    elif 273 in tags and 279 in tags:
        s_offs = [int(x) for x in _as_list(tags[273])]
        s_cnts = [int(x) for x in _as_list(tags[279])]
        rows_per_strip = int(tags.get(278, height))
        row_cursor = 0
        for off, cnt in zip(s_offs, s_cnts):
            rows_here = min(rows_per_strip, height - row_cursor)
            if rows_here <= 0:
                break
            chunk = _decompress_segment(bytes(tiff_bytes[off : off + cnt]), compression)
            strip_vals = _unpack_samples(chunk, endian, sample_format, bps, width * rows_here)
            if predictor == 2:
                strip_vals = _apply_horizontal_predictor(strip_vals, width, rows_here, bps)
            start_idx = row_cursor * width
            values[start_idx : start_idx + len(strip_vals)] = strip_vals
            row_cursor += rows_here
        if row_cursor < height:
            raise ValueError(f"Truncated GeoTIFF strips: decoded {row_cursor} < {height} rows.")
    else:
        raise ValueError("GeoTIFF missing StripOffsets/StripByteCounts and TileOffsets/TileByteCounts.")

    nodata_raw = tags.get(42113)
    nodata_val: Optional[float] = None
    if isinstance(nodata_raw, str) and nodata_raw.strip():
        try:
            nodata_val = float(nodata_raw.strip())
        except ValueError:
            nodata_val = None

    pixel_scale = _as_list(tags.get(33550))
    tiepoint = _as_list(tags.get(33922))
    model_transform = _as_list(tags.get(34264))
    geo_keys = [int(x) for x in _as_list(tags.get(34735))]
    geo_ascii = str(tags.get(34737) or "")

    # Decode GeoKeyDirectory (version, rev, minor, num_keys, then 4-tuples)
    epsg_code: Optional[int] = None
    model_type: Optional[int] = None
    if len(geo_keys) >= 4:
        num_keys = geo_keys[3]
        for k_idx in range(num_keys):
            base = 4 + k_idx * 4
            if base + 3 >= len(geo_keys):
                break
            key_id, tiff_tag_loc, _cnt, val_off = geo_keys[base : base + 4]
            if tiff_tag_loc == 0:
                if key_id == 1024:  # GTModelTypeGeoKey (1=Projected, 2=Geographic)
                    model_type = val_off
                elif key_id in (2048, 3072):  # GeographicTypeGeoKey / ProjectedCSTypeGeoKey
                    epsg_code = val_off

    if epsg_code == 4326 or ("WGS 84" in geo_ascii and model_type in (None, 2)):
        raster_crs = "EPSG:4326"
    elif epsg_code and epsg_code not in (32767, 0):
        raster_crs = f"EPSG:{epsg_code}"
    elif "Goode_Homolosine" in geo_ascii or epsg_code == 152160:
        raster_crs = "+proj=igh +datum=WGS84 +units=m +no_defs"
    elif epsg_code is None and len(pixel_scale) >= 2 and len(tiepoint) >= 6:
        # Infer geographic lon/lat degrees only if tiepoint lies within WGS84 bounds and scales < 1 deg
        if abs(tiepoint[3]) <= 180.0 and abs(tiepoint[4]) <= 90.0 and abs(pixel_scale[0]) < 1.0:
            raster_crs = "EPSG:4326"
        else:
            raster_crs = "UNKNOWN"
    else:
        raster_crs = "UNKNOWN"

    geotransform: Optional[Dict[str, float]] = None
    if len(pixel_scale) >= 2 and len(tiepoint) >= 6 and float(pixel_scale[0]) > 0 and float(pixel_scale[1]) > 0:
        sx = float(pixel_scale[0])
        sy = float(pixel_scale[1])
        i0, j0, _, x0, y0, _ = [float(v) for v in tiepoint[:6]]
        geotransform = {
            "x_origin": x0 - i0 * sx,
            "y_origin": y0 + j0 * sy,
            "pixel_width": sx,
            "pixel_height": sy,
        }
    elif len(model_transform) == 16 and abs(float(model_transform[0])) > 0 and abs(float(model_transform[5])) > 0:
        geotransform = {
            "x_origin": float(model_transform[3]),
            "y_origin": float(model_transform[7]),
            "pixel_width": float(model_transform[0]),
            "pixel_height": abs(float(model_transform[5])),
        }

    return {
        "width": width,
        "height": height,
        "values": values,
        "nodata": nodata_val,
        "crs": raster_crs,
        "geotransform": geotransform,
        "compression": compression,
        "predictor": predictor,
        "bits_per_sample": bps,
        "sample_format": sample_format,
        "epsg_code": epsg_code,
        "geo_ascii": geo_ascii,
    }


def _pixel_center_xy(gt: Dict[str, float], col: int, row: int) -> Tuple[float, float]:
    cx = gt["x_origin"] + (col + 0.5) * gt["pixel_width"]
    cy = gt["y_origin"] - (row + 0.5) * gt["pixel_height"]
    return cx, cy


def _target_xy_in_raster_crs(lon: float, lat: float, raster_crs: str) -> Tuple[float, float]:
    if raster_crs == "EPSG:4326":
        return lon, lat
    if raster_crs == "UNKNOWN":
        raise ValueError("GeoTIFF lacks identifiable CRS metadata.")
    tr = pyproj.Transformer.from_crs("EPSG:4326", raster_crs, always_xy=True)
    return tr.transform(lon, lat)


def _xy_to_lonlat(x: float, y: float, raster_crs: str) -> Tuple[float, float]:
    if raster_crs == "EPSG:4326":
        return x, y
    tr = pyproj.Transformer.from_crs(raster_crs, "EPSG:4326", always_xy=True)
    return tr.transform(x, y)


def _is_nodata_value(val: Any, nodata: Optional[float]) -> bool:
    if val is None:
        return True
    if isinstance(val, float) and not math.isfinite(val):
        return True
    if nodata is not None and float(val) == float(nodata):
        return True
    if float(val) <= -32768.0:
        return True
    return False


def locate_geotiff_pixel_at_point(
    parsed: Dict[str, Any],
    lon: float,
    lat: float,
    *,
    max_distance_m: float = 500.0,
    is_masked_zero_fn: Optional[Any] = None,
) -> Dict[str, Any]:
    """Locate the exact georeferenced pixel covering (lon, lat) and compute geodesic offset.

    Never picks arbitrary first > 0 pixels across the raster. If exact pixel is missing or
    nodata, inspects if any valid pixel sits within `max_distance_m`; otherwise fails closed
    with POINT_PIXEL_MISSING / GEO_DISTANCE_EXCEEDED.
    """
    gt = parsed.get("geotransform")
    raster_crs = parsed.get("crs") or "UNKNOWN"
    if gt is None or raster_crs == "UNKNOWN":
        return {
            "ok": False,
            "code": "SPATIAL_UNCERTAIN",
            "missing_reason": "spatial_uncertain",
            "detail": "GeoTIFF missing affine geotransform or verifiable CRS metadata.",
        }

    try:
        tx, ty = _target_xy_in_raster_crs(lon, lat, raster_crs)
    except Exception as exc:
        return {
            "ok": False,
            "code": "SPATIAL_UNCERTAIN",
            "missing_reason": "invalid_coordinates_or_crs",
            "detail": f"Cannot project requested WGS84 point into raster CRS '{raster_crs}': {exc}",
        }

    width = int(parsed["width"])
    height = int(parsed["height"])
    col_f = (tx - gt["x_origin"]) / gt["pixel_width"]
    row_f = (gt["y_origin"] - ty) / gt["pixel_height"]
    col = int(math.floor(col_f))
    row = int(math.floor(row_f))

    # Clamp exact right/bottom edge hits where query falls within half a pixel of border
    if col == width and col_f <= width + 1e-6:
        col = width - 1
    if row == height and row_f <= height + 1e-6:
        row = height - 1

    if not (0 <= col < width and 0 <= row < height):
        return {
            "ok": False,
            "code": "POINT_PIXEL_MISSING",
            "missing_reason": "point_pixel_missing",
            "detail": f"Requested coordinate ({lon}, {lat}) falls outside raster bounds (col={col_f:.2f}, row={row_f:.2f}, size={width}x{height}).",
        }

    nodata = parsed.get("nodata")
    vals = parsed["values"]

    def _dist_m(r_idx: int, c_idx: int) -> Tuple[float, float, float]:
        px, py = _pixel_center_xy(gt, c_idx, r_idx)
        plon, plat = _xy_to_lonlat(px, py, raster_crs)
        _, _, d_m = WGS84_GEOD.inv(lon, lat, plon, plat)
        return float(d_m), float(plon), float(plat)

    def _valid_at(r_idx: int, c_idx: int) -> bool:
        v = vals[r_idx * width + c_idx]
        if _is_nodata_value(v, nodata):
            return False
        if is_masked_zero_fn is not None and is_masked_zero_fn(r_idx, c_idx, v):
            return False
        return True

    exact_idx = row * width + col
    exact_dist_m, exact_lon, exact_lat = _dist_m(row, col)
    if _valid_at(row, col):
        flags: List[str] = []
        if exact_dist_m > max_distance_m:
            return {
                "ok": False,
                "code": "GEO_DISTANCE_EXCEEDED",
                "missing_reason": "geo_distance_exceeded",
                "detail": f"Pixel center distance {exact_dist_m:.1f} m exceeds max_distance_m={max_distance_m:.1f} m.",
                "distance_m": round(exact_dist_m, 2),
                "row": row,
                "col": col,
            }
        if exact_dist_m > 250.0:
            flags.append("SPATIAL_UNCERTAIN")
        return {
            "ok": True,
            "row": row,
            "col": col,
            "index": exact_idx,
            "value": vals[exact_idx],
            "pixel_center_lon_lat": [round(exact_lon, 6), round(exact_lat, 6)],
            "distance_m": round(exact_dist_m, 2),
            "pixel_scale_deg": [gt["pixel_width"], gt["pixel_height"]] if raster_crs == "EPSG:4326" else None,
            "crs": raster_crs,
            "quality_flags": flags,
            "exact_cell_match": True,
        }

    # Exact cell is nodata/masked; inspect whether a valid pixel sits anywhere in the raster
    # strictly within max_distance_m (otherwise fail closed without distant pixel borrowing).
    best_dist = float("inf")
    best_candidate: Optional[Tuple[int, int, float, float, float]] = None
    for rr in range(height):
        for cc in range(width):
            if not _valid_at(rr, cc):
                continue
            d_m, plon, plat = _dist_m(rr, cc)
            if d_m < best_dist:
                best_dist = d_m
                best_candidate = (rr, cc, d_m, plon, plat)

    if best_candidate is None:
        return {
            "ok": False,
            "code": "POINT_PIXEL_MISSING",
            "missing_reason": "point_pixel_missing",
            "detail": f"Requested pixel ({row}, {col}) and surrounding raster contain only nodata/masked pixels.",
            "row": row,
            "col": col,
            "pixel_center_lon_lat": [round(exact_lon, 6), round(exact_lat, 6)],
            "distance_m": round(exact_dist_m, 2),
        }

    return {
        "ok": False,
        "code": "GEO_DISTANCE_EXCEEDED" if best_candidate[2] > max_distance_m else "POINT_PIXEL_MISSING",
        "missing_reason": "geo_distance_exceeded" if best_candidate[2] > max_distance_m else "point_pixel_missing",
        "detail": (
            f"Exact pixel ({row}, {col}) at {exact_dist_m:.1f} m is nodata/masked; "
            f"nearest non-masked pixel ({best_candidate[0]}, {best_candidate[1]}) is {best_candidate[2]:.1f} m away "
            f"(not silently substituted)."
        ),
        "exact_row": row,
        "exact_col": col,
        "nearest_valid_distance_m": round(best_candidate[2], 2),
    }


__all__ = [
    "locate_geotiff_pixel_at_point",
    "parse_geotiff",
]
