"""Authentic Natural Earth 10m global land, island, and inland-water geospatial classifier.

Implements Gate G1 of the ASTRAGRON Final Remediation & Open-Source Release specification:
- Uses official Natural Earth 1:10,000,000 (`ne_10m_land` v5.1.1, `ne_10m_minor_islands` v4.1.0,
  `ne_10m_lakes` v5.0.0) public-domain vectors with SHA-256 integrity verification.
- Uses Shapely / GEOS (`STRtree`, prepared geometries, interior hole handling, validity checks)
  and `pyproj.Geod(ellps="WGS84")` for metric distance-to-coast and geodesic polygon areas.
- Classifies points and complete field polygons into `LAND`, `OCEAN`, `INLAND_WATER`,
  `COASTAL_UNCERTAIN`, or `LAND_STATUS_UNVERIFIED` without hand-drawn polygons or city exceptions.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import shapefile  # pyshp (MIT)
import shapely
from pyproj import Geod
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import nearest_points, unary_union
from shapely.strtree import STRtree
from shapely.validation import explain_validity

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_NE_DIR = ROOT / "examples" / "adaptive_evidence" / "natural_earth_10m"
RECEIPT_FILENAME = "NATURAL_EARTH_10M_RECEIPT.json"

# Standard 1:10,000,000 cartographic generalization uncertainty thresholds:
# - 500 m on the land side (0.05 mm at 1:10M)
# - 2,500 m on the water/lake side (0.25 mm at 1:10M) to avoid confidently false OCEAN/INLAND_WATER labels on generalized shorelines/peninsulas
COASTAL_UNCERTAINTY_THRESHOLD_M: float = 500.0
WATER_SIDE_SHORELINE_UNCERTAINTY_THRESHOLD_M: float = 2500.0
WGS84_GEOD = Geod(ellps="WGS84")


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(65536):
            h.update(chunk)
    return h.hexdigest()


class NaturalEarth10mIndex:
    """Reusable STRtree spatial index over verified Natural Earth 10m land, minor islands, and lakes."""

    def __init__(self, data_dir: Path = DEFAULT_NE_DIR, *, verify_hashes: bool = True) -> None:
        self.data_dir = Path(data_dir)
        self.verify_hashes = verify_hashes
        self.dataset_available = False
        self.dataset_error: Optional[str] = None
        self.dataset_metadata: Dict[str, Any] = {}
        self.load_time_ms: float = 0.0

        self.land_polygons: List[Polygon] = []
        self.land_boundaries: List[Any] = []
        self.inland_water_polygons: List[Polygon] = []
        self.inland_water_names: List[str] = []
        self.inland_water_boundaries: List[Any] = []

        self.land_tree: Optional[STRtree] = None
        self.land_boundary_tree: Optional[STRtree] = None
        self.inland_water_tree: Optional[STRtree] = None
        self.inland_water_boundary_tree: Optional[STRtree] = None

        self._load()

    def _load(self) -> None:
        t0 = time.perf_counter()
        receipt_path = self.data_dir / RECEIPT_FILENAME
        if not receipt_path.exists():
            self.dataset_error = f"Missing Natural Earth receipt: {receipt_path}"
            return

        try:
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            layers_meta = receipt.get("layers", {})
            for req_layer in ("ne_10m_land", "ne_10m_minor_islands", "ne_10m_lakes"):
                if req_layer not in layers_meta:
                    self.dataset_error = f"Missing required layer '{req_layer}' in {RECEIPT_FILENAME}"
                    return
                ext_files = layers_meta[req_layer].get("extracted_files", {})
                for fname, finfo in ext_files.items():
                    fpath = self.data_dir / fname
                    if not fpath.exists():
                        self.dataset_error = f"Missing Natural Earth file: {fpath}"
                        return
                    if self.verify_hashes:
                        actual_sha = _sha256_file(fpath)
                        if actual_sha != finfo.get("sha256"):
                            self.dataset_error = (
                                f"SHA-256 mismatch for {fname}: expected {finfo.get('sha256')}, got {actual_sha}"
                            )
                            return

            # 1. Load ne_10m_land + ne_10m_minor_islands
            for layer_name in ("ne_10m_land", "ne_10m_minor_islands"):
                shp_path = self.data_dir / f"{layer_name}.shp"
                sf = shapefile.Reader(str(shp_path))
                for sr in sf.iterShapeRecords():
                    rec = sr.record.as_dict()
                    # Exclude Natural Earth's documented fictional geocoding placeholder ('Null island' at [0,0])
                    if str(rec.get("featurecla", "")).strip().lower() == "null island":
                        continue
                    g = shape(sr.shape.__geo_interface__)
                    if not g.is_valid:
                        g = shapely.make_valid(g)
                    for part in (g.geoms if hasattr(g, "geoms") else [g]):
                        if isinstance(part, Polygon) and not part.is_empty:
                            shapely.prepare(part)
                            self.land_polygons.append(part)
                            minx, miny, maxx, _ = part.bounds
                            if minx <= -179.999 or maxx >= 179.999 or miny <= -89.999:
                                # Exclude artificial planar shapefile seam cuts along +/-180 deg or -90 deg
                                coords = list(part.exterior.coords)
                                for a, b in zip(coords[:-1], coords[1:]):
                                    if not (
                                        (abs(a[0]) > 179.999 and abs(b[0]) > 179.999)
                                        or (a[1] < -89.999 and b[1] < -89.999)
                                    ):
                                        self.land_boundaries.append(LineString([a, b]))
                                for ir in part.interiors:
                                    self.land_boundaries.append(LineString(ir.coords))
                            else:
                                self.land_boundaries.append(part.boundary)
                            # Interior rings in ne_10m_land (e.g., Caspian Sea) represent endorheic inland seas
                            if layer_name == "ne_10m_land":
                                for interior_ring in part.interiors:
                                    hole_poly = Polygon(interior_ring)
                                    if hole_poly.is_valid and hole_poly.area > 0.05:
                                        shapely.prepare(hole_poly)
                                        self.inland_water_polygons.append(hole_poly)
                                        self.inland_water_names.append("Endorheic Inland Sea (Caspian/Inland Basin)")
                                        self.inland_water_boundaries.append(hole_poly.boundary)
                sf.close()

            # 2. Load ne_10m_lakes
            lakes_shp = self.data_dir / "ne_10m_lakes.shp"
            sf_lakes = shapefile.Reader(str(lakes_shp))
            for sr in sf_lakes.iterShapeRecords():
                rec = sr.record.as_dict()
                lake_name = str(rec.get("name") or rec.get("name_en") or rec.get("featurecla") or "Inland Lake").strip()
                g = shape(sr.shape.__geo_interface__)
                if not g.is_valid:
                    g = shapely.make_valid(g)
                for part in (g.geoms if hasattr(g, "geoms") else [g]):
                    if isinstance(part, Polygon) and not part.is_empty:
                        shapely.prepare(part)
                        self.inland_water_polygons.append(part)
                        self.inland_water_names.append(lake_name)
                        self.inland_water_boundaries.append(part.boundary)
            sf_lakes.close()

            self.land_tree = STRtree(self.land_polygons)
            self.land_boundary_tree = STRtree(self.land_boundaries)
            self.inland_water_tree = STRtree(self.inland_water_polygons)
            self.inland_water_boundary_tree = STRtree(self.inland_water_boundaries)

            self.dataset_metadata = {
                "dataset_name": "Natural Earth 10m Physical Vectors (Land, Minor Islands, Lakes)",
                "scale": "1:10,000,000",
                "license": "Public Domain (Natural Earth Terms of Use)",
                "layers": {
                    k: {
                        "version": v.get("version"),
                        "raw_zip_sha256": v.get("raw_zip_sha256"),
                        "download_url": v.get("download_url"),
                    }
                    for k, v in layers_meta.items()
                },
                "coastal_uncertainty_threshold_m": COASTAL_UNCERTAINTY_THRESHOLD_M,
                "water_side_shoreline_uncertainty_threshold_m": WATER_SIDE_SHORELINE_UNCERTAINTY_THRESHOLD_M,
                "cartographic_scale_limitation_note": (
                    "Natural Earth 1:10,000,000 is a global macro-scale screening basemap "
                    "(500 m land-side / 2,500 m water-side shoreline uncertainty buffer); "
                    "it is NOT a field-scale cadastre or a certificate of 500 m boundary accuracy."
                ),
                "land_polygon_count": len(self.land_polygons),
                "inland_water_polygon_count": len(self.inland_water_polygons),
            }
            self.dataset_available = True
            self.load_time_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        except Exception as exc:
            self.dataset_error = f"Failed to load Natural Earth 10m shapefiles: {exc}"
            self.dataset_available = False

    def geodesic_distance_to_boundary_m(self, lon: float, lat: float, bnd_tree: STRtree, boundaries: List[Any]) -> float:
        pt = Point(lon, lat)
        idx = bnd_tree.nearest(pt)
        if idx is None:
            return float("inf")
        # Check top candidate and local neighborhood to guarantee true geodesic minimum
        cand_indices = list(bnd_tree.query(pt.buffer(0.5)))
        if int(idx) not in cand_indices:
            cand_indices.append(int(idx))
        best_m = float("inf")
        for c_idx in cand_indices:
            _, near_pt = nearest_points(pt, boundaries[int(c_idx)])
            _, _, dist_m = WGS84_GEOD.inv(lon, lat, float(near_pt.x), float(near_pt.y))
            if abs(dist_m) < best_m:
                best_m = abs(dist_m)
        return best_m


_GLOBAL_NE_INDEX: Optional[NaturalEarth10mIndex] = None


def get_natural_earth_index(
    data_dir: Path = DEFAULT_NE_DIR,
    *,
    force_reload: bool = False,
) -> NaturalEarth10mIndex:
    global _GLOBAL_NE_INDEX
    if _GLOBAL_NE_INDEX is None or force_reload or _GLOBAL_NE_INDEX.data_dir != Path(data_dir):
        _GLOBAL_NE_INDEX = NaturalEarth10mIndex(data_dir=data_dir)
    return _GLOBAL_NE_INDEX


def _is_finite_number(val: Any) -> bool:
    """Return True iff val is an int/float (never bool) and finite."""
    return (
        not isinstance(val, bool)
        and isinstance(val, (int, float))
        and math.isfinite(float(val))
    )


def _is_valid_wgs84_crs(crs_val: Any) -> bool:
    """Validate that a CRS string or GeoJSON CRS object explicitly denotes WGS84 / EPSG:4326."""
    if crs_val is None:
        return True
    if isinstance(crs_val, str):
        return crs_val.strip() in (
            "EPSG:4326",
            "urn:ogc:def:crs:EPSG::4326",
            "urn:ogc:def:crs:OGC:1.3:CRS84",
            "WGS84",
        )
    if isinstance(crs_val, dict):
        props = crs_val.get("properties")
        if isinstance(props, dict):
            return _is_valid_wgs84_crs(props.get("name"))
    return False


def classify_global_land_status(
    lon: float,
    lat: float,
    *,
    data_dir: Path = DEFAULT_NE_DIR,
    coastal_threshold_m: float = COASTAL_UNCERTAINTY_THRESHOLD_M,
) -> Dict[str, Any]:
    """Classify a WGS84 [lon, lat] point using authentic Natural Earth 10m layers and geodesic coast distance."""
    if (
        not _is_finite_number(lon)
        or not _is_finite_number(lat)
        or not (-180.0 <= float(lon) <= 180.0)
        or not (-90.0 <= float(lat) <= 90.0)
    ):
        return {
            "valid": False,
            "land_status": "INVALID_GEOMETRY",
            "physical_surface": "INVALID",
            "is_land": False,
            "is_polar": False,
            "region": "INVALID_COORDINATES",
            "distance_to_coast_m": None,
            "missing_reason": "invalid_coordinates_or_crs",
            "dataset_metadata": None,
            "detail": f"Coordinates [{lon}, {lat}] must be finite non-boolean numbers in [-180, 180] x [-90, 90].",
        }
    lon = float(lon)
    lat = float(lat)
    idx = get_natural_earth_index(data_dir=data_dir)
    if not idx.dataset_available or idx.land_tree is None or idx.inland_water_tree is None:
        return {
            "land_status": "LAND_STATUS_UNVERIFIED",
            "physical_surface": "UNVERIFIED",
            "is_land": False,
            "is_polar": False,
            "region": "DATASET_UNAVAILABLE_OR_TAMPERED",
            "distance_to_coast_m": None,
            "missing_reason": "land_status_unverified",
            "dataset_metadata": idx.dataset_metadata,
            "detail": (
                f"Natural Earth 10m dataset unavailable or failed integrity verification ({idx.dataset_error}); "
                "failing closed as LAND_STATUS_UNVERIFIED without promoting to LAND or OCEAN."
            ),
        }

    # Normalize antimeridian (-180.0 / +180.0)
    lon_norm = 179.999999 if lon == 180.0 else (-179.999999 if lon == -180.0 else lon)
    pt = Point(lon_norm, lat)

    in_land = any(idx.land_polygons[i].covers(pt) for i in idx.land_tree.query(pt))
    lake_hits = [i for i in idx.inland_water_tree.query(pt) if idx.inland_water_polygons[i].covers(pt)]
    in_lake = len(lake_hits) > 0
    lake_name = idx.inland_water_names[lake_hits[0]] if in_lake else None

    dist_coast_m = idx.geodesic_distance_to_boundary_m(
        lon_norm, lat, idx.land_boundary_tree, idx.land_boundaries
    )
    dist_lake_m = (
        idx.geodesic_distance_to_boundary_m(
            lon_norm, lat, idx.inland_water_boundary_tree, idx.inland_water_boundaries
        )
        if idx.inland_water_boundary_tree is not None
        else float("inf")
    )
    min_shore_m = round(min(dist_coast_m, dist_lake_m), 1)
    is_polar = bool(lat <= -60.0 or lat >= 83.5)
    water_side_threshold_m = max(coastal_threshold_m, WATER_SIDE_SHORELINE_UNCERTAINTY_THRESHOLD_M)

    # 1. Check inland water (lakes and endorheic seas like Caspian Sea, Lake Victoria, Lake Michigan)
    # Note: islands inside lakes are holes in ne_10m_lakes, so in_lake is False on lake islands!
    if in_lake:
        # Check if within water-side shoreline uncertainty buffer
        if min_shore_m < water_side_threshold_m:
            return {
                "land_status": "COASTAL_UNCERTAIN",
                "physical_surface": "INLAND_WATER_SHORELINE_BUFFER",
                "is_land": False,
                "is_polar": is_polar,
                "region": lake_name or "INLAND_WATER",
                "distance_to_coast_m": min_shore_m,
                "missing_reason": "land_status_unverified",
                "dataset_metadata": idx.dataset_metadata,
                "detail": (
                    f"Location [{lon}, {lat}] lies inside inland water ({lake_name}) within "
                    f"{min_shore_m} m (< {water_side_threshold_m} m 1:10M water-side shoreline uncertainty threshold); "
                    "classified as COASTAL_UNCERTAIN."
                ),
            }
        return {
            "land_status": "INLAND_WATER",
            "physical_surface": "INLAND_WATER",
            "is_land": False,
            "is_polar": is_polar,
            "region": lake_name or "INLAND_WATER",
            "distance_to_coast_m": min_shore_m,
            "missing_reason": "ocean_or_non_land_cell",
            "dataset_metadata": idx.dataset_metadata,
            "detail": f"Location [{lon}, {lat}] falls in inland water body ({lake_name}) per Natural Earth 10m.",
        }

    # 2. Point is inside terrestrial land or minor island polygon
    if in_land:
        if is_polar:
            # Polar land (e.g., Antarctica) is physically LAND (not water!), but unsupported for open-field agriculture
            return {
                "land_status": "LAND",
                "physical_surface": "LAND",
                "is_land": False,
                "is_polar": True,
                "region": "POLAR_LAND_ANTARCTICA_OR_HIGH_ARCTIC",
                "distance_to_coast_m": min_shore_m,
                "missing_reason": "unsupported_region",
                "dataset_metadata": idx.dataset_metadata,
                "detail": (
                    f"Location [{lon}, {lat}] is polar terrestrial land (physical_surface=LAND, not water), "
                    "but outside supported agricultural latitudes."
                ),
            }
        if min_shore_m < coastal_threshold_m:
            return {
                "land_status": "COASTAL_UNCERTAIN",
                "physical_surface": "LAND_NEAR_COAST",
                "is_land": False,
                "is_polar": False,
                "region": "COASTAL_BUFFER_10M",
                "distance_to_coast_m": min_shore_m,
                "missing_reason": "land_status_unverified",
                "dataset_metadata": idx.dataset_metadata,
                "detail": (
                    f"Location [{lon}, {lat}] is on land within {min_shore_m} m (< {coastal_threshold_m} m "
                    "1:10M cartographic uncertainty threshold) of coastline/shoreline; fails closed as COASTAL_UNCERTAIN."
                ),
            }
        return {
            "land_status": "LAND",
            "physical_surface": "LAND",
            "is_land": True,
            "is_polar": False,
            "region": "NATURAL_EARTH_10M_LAND",
            "distance_to_coast_m": min_shore_m,
            "missing_reason": None,
            "dataset_metadata": idx.dataset_metadata,
            "detail": f"Verified terrestrial land per Natural Earth 10m ({min_shore_m} m from nearest shoreline).",
        }

    # 3. Point is outside terrestrial land polygons (ocean or near-shore coastal water)
    if not is_polar and min_shore_m < water_side_threshold_m:
        return {
            "land_status": "COASTAL_UNCERTAIN",
            "physical_surface": "WATER_NEAR_COAST",
            "is_land": False,
            "is_polar": False,
            "region": "COASTAL_BUFFER_10M",
            "distance_to_coast_m": min_shore_m,
            "missing_reason": "land_status_unverified",
            "dataset_metadata": idx.dataset_metadata,
            "detail": (
                f"Location [{lon}, {lat}] is within {min_shore_m} m (< {water_side_threshold_m} m "
                "1:10M water-side shoreline uncertainty threshold) of coastline; fails closed as COASTAL_UNCERTAIN."
            ),
        }

    return {
        "land_status": "OCEAN",
        "physical_surface": "OCEAN",
        "is_land": False,
        "is_polar": is_polar,
        "region": "POLAR_OCEAN" if is_polar else "OPEN_OCEAN_OR_SEA",
        "distance_to_coast_m": min_shore_m,
        "missing_reason": "unsupported_region" if is_polar else "ocean_or_non_land_cell",
        "dataset_metadata": idx.dataset_metadata,
        "detail": f"Location [{lon}, {lat}] is open ocean/sea per Natural Earth 10m ({min_shore_m} m from coast).",
    }


def _split_antimeridian_ring(coords: Sequence[Sequence[float]]) -> List[Polygon]:
    """Handle polygons whose vertices cross the +/-180 antimeridian by unwrapping longitudes."""
    lons = [float(c[0]) for c in coords]
    if max(lons) - min(lons) <= 180.0:
        return [Polygon([(float(c[0]), float(c[1])) for c in coords])]
    # Unwrap negative longitudes by +360 to range [0, 360], then clip against [0, 180] and [180, 360]
    unwrapped = [(float(c[0]) + 360.0 if float(c[0]) < 0.0 else float(c[0]), float(c[1])) for c in coords]
    poly_360 = Polygon(unwrapped)
    if not poly_360.is_valid:
        return [Polygon([(float(c[0]), float(c[1])) for c in coords])]
    east_part = poly_360.intersection(box(0.0, -90.0, 180.0, 90.0))
    west_part_shifted = poly_360.intersection(box(180.0, -90.0, 360.0, 90.0))
    west_part = shapely.affinity.translate(west_part_shifted, xoff=-360.0)
    parts: List[Polygon] = []
    for geom in (east_part, west_part):
        for p in (geom.geoms if hasattr(geom, "geoms") else [geom]):
            if isinstance(p, Polygon) and not p.is_empty:
                parts.append(p)
    return parts


def evaluate_field_polygon_land_water(
    geometry: Dict[str, Any],
    *,
    point_lon_lat: Optional[Sequence[Any]] = None,
    crs: Any = "EPSG:4326",
    data_dir: Path = DEFAULT_NE_DIR,
    coastal_threshold_m: float = COASTAL_UNCERTAINTY_THRESHOLD_M,
) -> Dict[str, Any]:
    """Evaluate a complete GeoJSON Polygon/MultiPolygon against Natural Earth 10m land and lakes."""
    if not isinstance(geometry, dict):
        return {
            "valid": False,
            "is_land": False,
            "land_status": "INVALID_GEOMETRY",
            "missing_reason": "invalid_coordinates_or_crs",
            "detail": "Geometry must be a GeoJSON object (dict).",
        }
    if not _is_valid_wgs84_crs(crs) or ("crs" in geometry and not _is_valid_wgs84_crs(geometry.get("crs"))):
        return {
            "valid": False,
            "is_land": False,
            "land_status": "INVALID_GEOMETRY",
            "missing_reason": "invalid_coordinates_or_crs",
            "detail": "Geometry CRS must be EPSG:4326 / WGS84 without implicit reprojection.",
        }

    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if gtype not in ("Polygon", "MultiPolygon") or not isinstance(coords, (list, tuple)) or len(coords) == 0:
        return {
            "valid": False,
            "is_land": False,
            "land_status": "INVALID_GEOMETRY",
            "missing_reason": "invalid_coordinates_or_crs",
            "detail": "Malformed Polygon/MultiPolygon coordinates.",
        }

    # Normalize to list of polygon coordinate arrays, each a list of linear rings
    poly_coord_sets: List[Sequence[Any]] = []
    if gtype == "Polygon":
        poly_coord_sets = [coords]
    else:
        for poly_item in coords:
            if not isinstance(poly_item, (list, tuple)) or len(poly_item) == 0:
                return {
                    "valid": False,
                    "is_land": False,
                    "land_status": "INVALID_GEOMETRY",
                    "missing_reason": "invalid_coordinates_or_crs",
                    "detail": "Malformed MultiPolygon element (expected non-empty list of linear rings).",
                }
            poly_coord_sets.append(poly_item)

    # Strictly validate every linear ring and vertex (no booleans, strings, NaN/Inf, wrong nesting, or unclosed rings)
    for poly_rings in poly_coord_sets:
        if not isinstance(poly_rings, (list, tuple)) or len(poly_rings) == 0:
            return {
                "valid": False,
                "is_land": False,
                "land_status": "INVALID_GEOMETRY",
                "missing_reason": "invalid_coordinates_or_crs",
                "detail": "Polygon requires at least one exterior linear ring.",
            }
        for ring in poly_rings:
            if not isinstance(ring, (list, tuple)) or len(ring) < 4:
                return {
                    "valid": False,
                    "is_land": False,
                    "land_status": "INVALID_GEOMETRY",
                    "missing_reason": "invalid_coordinates_or_crs",
                    "detail": "Polygon linear ring requires at least 4 coordinate pairs.",
                }
            for pt_item in ring:
                if (
                    not isinstance(pt_item, (list, tuple))
                    or len(pt_item) < 2
                    or len(pt_item) > 3
                    or not _is_finite_number(pt_item[0])
                    or not _is_finite_number(pt_item[1])
                    or (len(pt_item) == 3 and not _is_finite_number(pt_item[2]))
                ):
                    return {
                        "valid": False,
                        "is_land": False,
                        "land_status": "INVALID_GEOMETRY",
                        "missing_reason": "invalid_coordinates_or_crs",
                        "detail": "Polygon contains non-numeric, boolean, NaN, Infinite, or malformed coordinate tuple.",
                    }
                lon_v, lat_v = float(pt_item[0]), float(pt_item[1])
                if abs(lon_v) <= 90.0 and 90.0 < abs(lat_v) <= 180.0:
                    return {
                        "valid": False,
                        "is_land": False,
                        "land_status": "INVALID_GEOMETRY",
                        "lon_lat_inversion_detected": True,
                        "missing_reason": "invalid_coordinates_or_crs",
                        "detail": f"Polygon coordinate [{lon_v}, {lat_v}] has |lat| > 90; probable [lat, lon] inversion.",
                    }
                if not (-180.0 <= lon_v <= 180.0) or not (-90.0 <= lat_v <= 90.0):
                    return {
                        "valid": False,
                        "is_land": False,
                        "land_status": "INVALID_GEOMETRY",
                        "missing_reason": "invalid_coordinates_or_crs",
                        "detail": f"Polygon coordinate [{lon_v}, {lat_v}] outside [-180, 180] x [-90, 90].",
                    }
            # Enforce explicit GeoJSON linear ring closure (first vertex == last vertex)
            first_lon, first_lat = float(ring[0][0]), float(ring[0][1])
            last_lon, last_lat = float(ring[-1][0]), float(ring[-1][1])
            if first_lon != last_lon or first_lat != last_lat:
                return {
                    "valid": False,
                    "is_land": False,
                    "land_status": "INVALID_GEOMETRY",
                    "unclosed_ring": True,
                    "missing_reason": "invalid_coordinates_or_crs",
                    "detail": (
                        f"Polygon linear ring is not closed (first vertex [{first_lon}, {first_lat}] "
                        f"!= last vertex [{last_lon}, {last_lat}])."
                    ),
                }

    # Construct shapely geometry with antimeridian handling for both Polygon and MultiPolygon
    crosses_antimeridian = False
    try:
        built_parts: List[Polygon] = []
        for poly_rings in poly_coord_sets:
            ext_ring = poly_rings[0]
            ext_lons = [float(c[0]) for c in ext_ring]
            if max(ext_lons) - min(ext_lons) > 180.0:
                crosses_antimeridian = True
                built_parts.extend(_split_antimeridian_ring(ext_ring))
            else:
                single_geom = shape({"type": "Polygon", "coordinates": poly_rings})
                if isinstance(single_geom, Polygon):
                    built_parts.append(single_geom)
                else:
                    for g_sub in getattr(single_geom, "geoms", []):
                        if isinstance(g_sub, Polygon):
                            built_parts.append(g_sub)
        if len(built_parts) == 0:
            poly_geom: Any = Polygon()
        elif len(built_parts) == 1 and gtype == "Polygon" and not crosses_antimeridian:
            poly_geom = built_parts[0]
        else:
            poly_geom = MultiPolygon(built_parts) if len(built_parts) > 1 else built_parts[0]
    except Exception as exc:
        return {
            "valid": False,
            "is_land": False,
            "land_status": "INVALID_GEOMETRY",
            "missing_reason": "invalid_coordinates_or_crs",
            "detail": f"Unable to construct valid Polygon/MultiPolygon geometry: {exc}",
        }

    if not poly_geom.is_valid or poly_geom.is_empty or poly_geom.area <= 0.0:
        reason_str = explain_validity(poly_geom)
        return {
            "valid": False,
            "is_land": False,
            "land_status": "INVALID_GEOMETRY",
            "missing_reason": "invalid_coordinates_or_crs",
            "validity_explanation": reason_str,
            "detail": f"Geometrically invalid or self-intersecting polygon: {reason_str}",
        }

    # Check point_lon_lat spatial consistency with Polygon/MultiPolygon (covers or boundary within 1e-9 deg)
    if point_lon_lat is not None:
        if (
            not isinstance(point_lon_lat, (list, tuple))
            or len(point_lon_lat) != 2
            or not _is_finite_number(point_lon_lat[0])
            or not _is_finite_number(point_lon_lat[1])
            or not (-180.0 <= float(point_lon_lat[0]) <= 180.0)
            or not (-90.0 <= float(point_lon_lat[1]) <= 90.0)
        ):
            return {
                "valid": False,
                "is_land": False,
                "land_status": "INVALID_GEOMETRY",
                "missing_reason": "invalid_coordinates_or_crs",
                "detail": "point_lon_lat must be a valid 2-element [lon, lat] coordinate pair in EPSG:4326.",
            }
        pt_lon, pt_lat = float(point_lon_lat[0]), float(point_lon_lat[1])
        pt_candidates = [Point(pt_lon, pt_lat)]
        if abs(pt_lon) == 180.0:
            pt_candidates.append(Point(-pt_lon, pt_lat))
        poly_buffered = poly_geom.buffer(1e-9)
        point_covered = any(poly_geom.covers(p_c) or poly_buffered.covers(p_c) for p_c in pt_candidates)
        if not point_covered:
            rep_pt_err = poly_geom.representative_point()
            return {
                "valid": False,
                "is_land": False,
                "land_status": "SPATIAL_MISMATCH",
                "spatial_mismatch": True,
                "missing_reason": "spatial_mismatch",
                "point_lon_lat": [pt_lon, pt_lat],
                "polygon_representative_point": [round(float(rep_pt_err.x), 6), round(float(rep_pt_err.y), 6)],
                "detail": (
                    f"Spatial mismatch: submitted point_lon_lat [{pt_lon}, {pt_lat}] is not covered by "
                    f"the submitted {gtype} geometry (representative point "
                    f"[{round(float(rep_pt_err.x), 4)}, {round(float(rep_pt_err.y), 4)}]). "
                    "Hidden relocation to polygon centroid/representative point is prohibited."
                ),
            }

    idx = get_natural_earth_index(data_dir=data_dir)
    if not idx.dataset_available or idx.land_tree is None or idx.inland_water_tree is None:
        return {
            "valid": True,
            "is_land": False,
            "land_status": "LAND_STATUS_UNVERIFIED",
            "missing_reason": "land_status_unverified",
            "detail": f"Natural Earth 10m dataset unavailable ({idx.dataset_error}); failing closed.",
        }

    area_m2, _ = WGS84_GEOD.geometry_area_perimeter(poly_geom)
    geodesic_area_ha = round(abs(area_m2) / 10000.0, 3)

    # Intersect with Natural Earth 10m land and inland water
    cand_land = [idx.land_polygons[i] for i in idx.land_tree.query(poly_geom)]
    land_union = unary_union(cand_land) if cand_land else Polygon()
    land_inter = poly_geom.intersection(land_union) if not land_union.is_empty else Polygon()

    cand_lakes = [idx.inland_water_polygons[i] for i in idx.inland_water_tree.query(poly_geom)]
    lake_union = unary_union(cand_lakes) if cand_lakes else Polygon()
    lake_inter = poly_geom.intersection(lake_union) if not lake_union.is_empty else Polygon()

    total_deg_area = poly_geom.area
    lake_frac = min(1.0, max(0.0, lake_inter.area / total_deg_area))
    net_land_inter = land_inter.difference(lake_union) if not lake_union.is_empty else land_inter
    land_frac = min(1.0, max(0.0, net_land_inter.area / total_deg_area))
    ocean_frac = max(0.0, 1.0 - land_frac - lake_frac)

    rep_pt = poly_geom.representative_point()
    min_coast_m = idx.geodesic_distance_to_boundary_m(
        float(rep_pt.x), float(rep_pt.y), idx.land_boundary_tree, idx.land_boundaries
    )
    # Also check whether polygon intersects any physical coastline or lake shoreline
    if idx.land_boundary_tree is not None and len(idx.land_boundary_tree.query(poly_geom, predicate="intersects")) > 0:
        min_coast_m = 0.0
    if idx.inland_water_boundary_tree is not None and len(idx.inland_water_boundary_tree.query(poly_geom, predicate="intersects")) > 0:
        min_coast_m = 0.0

    if lake_frac >= 0.99:
        status = "INLAND_WATER"
        is_land = False
        m_reason: Optional[str] = "ocean_or_non_land_cell"
        detail = f"Field polygon lies entirely in inland water (inland_water_fraction={lake_frac:.3f})."
    elif ocean_frac >= 0.99:
        status = "OCEAN"
        is_land = False
        m_reason = "ocean_or_non_land_cell"
        detail = f"Field polygon lies entirely in ocean/sea (ocean_fraction={ocean_frac:.3f})."
    elif land_frac < 0.99 or lake_frac > 0.01 or min_coast_m < coastal_threshold_m:
        status = "COASTAL_UNCERTAIN"
        is_land = False
        m_reason = "land_status_unverified"
        detail = (
            f"Field polygon overlaps shoreline or mixed land/water (land_fraction={land_frac:.3f}, "
            f"inland_water_fraction={lake_frac:.3f}, ocean_fraction={ocean_frac:.3f}, "
            f"min_coast_distance_m={round(min_coast_m, 1)} m); fails closed as COASTAL_UNCERTAIN."
        )
    else:
        status = "LAND"
        is_land = True
        m_reason = None
        detail = f"Complete field polygon verified on terrestrial land ({geodesic_area_ha} ha)."

    return {
        "valid": True,
        "is_land": is_land,
        "land_status": status,
        "crosses_antimeridian": crosses_antimeridian,
        "geodesic_area_ha": geodesic_area_ha,
        "land_fraction": round(land_frac, 4),
        "inland_water_fraction": round(lake_frac, 4),
        "ocean_fraction": round(ocean_frac, 4),
        "mixed_land_water_overlap": bool(0.01 < land_frac < 0.99 or (lake_frac > 0.01 and land_frac > 0.01)),
        "distance_to_coast_m": round(min_coast_m, 1),
        "missing_reason": m_reason,
        "dataset_metadata": idx.dataset_metadata,
        "detail": detail,
    }
