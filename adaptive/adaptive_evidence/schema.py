"""Typed evidence schema, coordinate/depth/time normalization, and source arbitration.

Implements Section 2 ('Typed evidence objects' and 'Dependency and fallback policy')
and Section 6 (Stage P1) of `00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
import hashlib
import json
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .capabilities import MISSING_REASONS, PARAMETER_PROVENANCE_CLASSES

EVIDENCE_TYPES = (
    "MEASURED",
    "MODELLED",
    "DERIVED",
    "USER_SUPPLIED",
    "SCENARIO",
    "UNAVAILABLE",
)

FIXTURE_ORIGINS = (
    "AUTHENTIC_LIVE_FETCH_RECEIPT",
    "AUTHENTIC_CACHED_RECEIPT",
    "REGIONAL_OFFLINE_REFERENCE_FIXTURE",
    "SYNTHETIC_OFFLINE_CONTROL_FIXTURE",
    "USER_DECLARED_SCENARIO_INPUT",
    "UNAVAILABLE_NO_DATA",
)

EVIDENCE_LEVELS = (
    "AUTHENTIC_LIVE",
    "AUTHENTIC_VERIFIED_CACHE",
    "VERIFIED_OPEN_SOURCE_MAP_ESTIMATE",
    "USER_DECLARED_SCENARIO",
    "SCIENTIFIC_DERIVATION",
    "SYNTHETIC_TEST_FIXTURE",
    "UNAVAILABLE",
)


def infer_evidence_level(
    provenance_class: str,
    fixture_origin: str,
    *,
    is_available: bool = True,
    evidence_level: Optional[str] = None,
) -> str:
    """Resolve canonical evidence level without allowing offline or synthetic fixtures to imitate authentic sources."""
    if evidence_level is not None and evidence_level not in EVIDENCE_LEVELS:
        raise ValueError(f"Invalid evidence_level: {evidence_level}")
    if not is_available or fixture_origin == "UNAVAILABLE_NO_DATA" or provenance_class == "NOT_RETRIEVABLE":
        return "UNAVAILABLE"
    if fixture_origin == "SYNTHETIC_OFFLINE_CONTROL_FIXTURE":
        return "SYNTHETIC_TEST_FIXTURE"
    if fixture_origin == "REGIONAL_OFFLINE_REFERENCE_FIXTURE":
        return "VERIFIED_OPEN_SOURCE_MAP_ESTIMATE"
    if fixture_origin == "USER_DECLARED_SCENARIO_INPUT":
        return "USER_DECLARED_SCENARIO"
    if fixture_origin == "AUTHENTIC_LIVE_FETCH_RECEIPT":
        if evidence_level == "VERIFIED_OPEN_SOURCE_MAP_ESTIMATE":
            return evidence_level
        return "AUTHENTIC_LIVE"
    if fixture_origin == "AUTHENTIC_CACHED_RECEIPT":
        if evidence_level == "VERIFIED_OPEN_SOURCE_MAP_ESTIMATE":
            return evidence_level
        return "AUTHENTIC_VERIFIED_CACHE"
    if evidence_level is not None:
        return evidence_level
    if provenance_class == "DERIVED_WITH_VALIDATED_METHOD":
        return "SCIENTIFIC_DERIVATION"
    if provenance_class == "USER_SCENARIO_ASSUMPTION":
        return "USER_DECLARED_SCENARIO"
    return "UNAVAILABLE"

STANDARD_SOILGRIDS_DEPTHS_CM: Tuple[Tuple[int, int], ...] = (
    (0, 5),
    (5, 15),
    (15, 30),
    (30, 60),
    (60, 100),
    (100, 200),
)

from .land_mask import (
    DEFAULT_NE_DIR,
    _is_finite_number,
    _is_valid_wgs84_crs,
    classify_global_land_status,
    evaluate_field_polygon_land_water,
)


def canonical_digest(obj: Any) -> str:
    raw = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def is_leap_year(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def validate_coordinates_and_crs(
    point_lon_lat: Any,
    crs: Any = "EPSG:4326",
    geometry: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Validate EPSG:4326 coordinates, geometry consistency, and terrestrial land status."""
    if crs != "EPSG:4326":
        return {
            "valid": False,
            "is_land": False,
            "missing_reason": "invalid_coordinates_or_crs",
            "detail": f"Unsupported CRS '{crs}'; only explicit EPSG:4326 is admitted without implicit reprojection.",
        }
    if not isinstance(point_lon_lat, (list, tuple)) or len(point_lon_lat) != 2:
        return {
            "valid": False,
            "is_land": False,
            "missing_reason": "invalid_coordinates_or_crs",
            "detail": "point_lon_lat must be a 2-element [longitude, latitude] list.",
        }
    lon, lat = point_lon_lat[0], point_lon_lat[1]
    if (
        isinstance(lon, bool)
        or isinstance(lat, bool)
        or not isinstance(lon, (int, float))
        or not isinstance(lat, (int, float))
        or not math.isfinite(lon)
        or not math.isfinite(lat)
        or not (-180.0 <= float(lon) <= 180.0)
        or not (-90.0 <= float(lat) <= 90.0)
    ):
        inversion = (
            not isinstance(lon, bool)
            and not isinstance(lat, bool)
            and isinstance(lon, (int, float))
            and isinstance(lat, (int, float))
            and math.isfinite(lon)
            and math.isfinite(lat)
            and abs(float(lon)) <= 90.0
            and 90.0 < abs(float(lat)) <= 180.0
        )
        return {
            "valid": False,
            "is_land": False,
            "land_status": "INVALID",
            "lon_lat_inversion_detected": inversion,
            "missing_reason": "invalid_coordinates_or_crs",
            "detail": (
                f"Coordinates [{lon}, {lat}] have |latitude| > 90 while |longitude| <= 90 (probable [lat, lon] order inversion)."
                if inversion
                else f"Coordinates [{lon}, {lat}] must be finite numbers in [-180, 180] x [-90, 90]."
            ),
        }
    lon_f, lat_f = float(lon), float(lat)
    poly_eval: Optional[Dict[str, Any]] = None
    if geometry is not None:
        if (
            not isinstance(geometry, dict)
            or geometry.get("type") not in ("Point", "Polygon", "MultiPolygon")
            or ("crs" in geometry and not _is_valid_wgs84_crs(geometry.get("crs")))
        ):
            return {
                "valid": False,
                "is_land": False,
                "land_status": "INVALID_GEOMETRY",
                "missing_reason": "invalid_coordinates_or_crs",
                "detail": "Unsupported or malformed GeoJSON geometry or non-EPSG:4326 geometry CRS.",
            }
        if geometry["type"] == "Point":
            coords = geometry.get("coordinates")
            if (
                not isinstance(coords, (list, tuple))
                or len(coords) < 2
                or len(coords) > 3
                or not _is_finite_number(coords[0])
                or not _is_finite_number(coords[1])
                or (len(coords) == 3 and not _is_finite_number(coords[2]))
                or not (-180.0 <= float(coords[0]) <= 180.0)
                or not (-90.0 <= float(coords[1]) <= 90.0)
            ):
                return {
                    "valid": False,
                    "is_land": False,
                    "land_status": "INVALID_GEOMETRY",
                    "missing_reason": "invalid_coordinates_or_crs",
                    "detail": "Malformed GeoJSON Point coordinates (must be finite non-boolean [lon, lat] in [-180, 180] x [-90, 90]).",
                }
            if abs(float(coords[0]) - lon_f) > 1e-9 or abs(float(coords[1]) - lat_f) > 1e-9:
                return {
                    "valid": False,
                    "is_land": False,
                    "land_status": "SPATIAL_MISMATCH",
                    "spatial_mismatch": True,
                    "missing_reason": "spatial_mismatch",
                    "detail": f"GeoJSON Point coordinates [{float(coords[0])}, {float(coords[1])}] do not match point_lon_lat [{lon_f}, {lat_f}].",
                }
        else:
            poly_eval = evaluate_field_polygon_land_water(
                geometry, point_lon_lat=[lon_f, lat_f], crs=crs
            )
            if not poly_eval["valid"]:
                return {
                    "valid": False,
                    "is_land": False,
                    "land_status": poly_eval["land_status"],
                    "spatial_mismatch": bool(poly_eval.get("spatial_mismatch", False)),
                    "lon_lat_inversion_detected": bool(poly_eval.get("lon_lat_inversion_detected", False)),
                    "polygon_evaluation": poly_eval,
                    "missing_reason": poly_eval["missing_reason"],
                    "detail": poly_eval["detail"],
                }

    land_check = classify_global_land_status(lon_f, lat_f)
    if poly_eval is not None and not poly_eval["is_land"]:
        return {
            "valid": True,
            "is_land": False,
            "land_status": str(poly_eval["land_status"]),
            "physical_surface": str(land_check.get("physical_surface", "UNVERIFIED")),
            "is_polar": bool(land_check.get("is_polar", False)),
            "land_region": str(land_check["region"]),
            "distance_to_coast_m": poly_eval.get("distance_to_coast_m"),
            "dataset_metadata": land_check.get("dataset_metadata"),
            "polygon_evaluation": poly_eval,
            "point_lon_lat": [lon_f, lat_f],
            "crs": "EPSG:4326",
            "missing_reason": poly_eval["missing_reason"],
            "detail": str(poly_eval["detail"]),
        }

    return {
        "valid": True,
        "is_land": bool(land_check["is_land"]),
        "land_status": str(land_check["land_status"]),
        "physical_surface": str(land_check.get("physical_surface", "LAND")),
        "is_polar": bool(land_check.get("is_polar", False)),
        "land_region": str(land_check["region"]),
        "distance_to_coast_m": land_check.get("distance_to_coast_m"),
        "dataset_metadata": land_check.get("dataset_metadata"),
        "polygon_evaluation": poly_eval,
        "point_lon_lat": [lon_f, lat_f],
        "crs": "EPSG:4326",
        "missing_reason": land_check["missing_reason"],
        "detail": str(land_check["detail"]),
    }


def validate_depth_intervals(intervals_cm: Sequence[Sequence[float]]) -> Dict[str, Any]:
    """Validate depth intervals (in cm) for monotonicity, non-negativity, and non-overlap."""
    if not isinstance(intervals_cm, (list, tuple)) or len(intervals_cm) == 0:
        return {
            "valid": False,
            "missing_reason": "depth_inconsistency",
            "detail": "At least one soil depth interval [top_cm, bottom_cm] is required.",
        }
    normalized: List[List[float]] = []
    prev_bottom: Optional[float] = None
    for idx, pair in enumerate(intervals_cm):
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            return {
                "valid": False,
                "missing_reason": "depth_inconsistency",
                "detail": f"Depth interval at index {idx} must have 2 elements [top_cm, bottom_cm].",
            }
        top, bottom = pair[0], pair[1]
        if (
            isinstance(top, bool)
            or isinstance(bottom, bool)
            or not isinstance(top, (int, float))
            or not isinstance(bottom, (int, float))
            or not math.isfinite(top)
            or not math.isfinite(bottom)
            or top < 0.0
            or bottom <= top
            or bottom > 500.0
        ):
            return {
                "valid": False,
                "missing_reason": "depth_inconsistency",
                "detail": f"Invalid depth interval [{top}, {bottom}] cm: requires 0 <= top < bottom <= 500.",
            }
        if prev_bottom is not None:
            if float(top) < prev_bottom:
                return {
                    "valid": False,
                    "missing_reason": "depth_inconsistency",
                    "detail": f"Overlapping or inverted depth intervals: {top} cm < previous bottom {prev_bottom} cm.",
                }
            if abs(float(top) - prev_bottom) > 1e-6:
                return {
                    "valid": False,
                    "missing_reason": "depth_inconsistency",
                    "detail": (
                        f"Non-contiguous depth intervals with omitted gap: {top} cm != previous bottom {prev_bottom} cm; "
                        "intermediate soil horizons cannot be fabricated."
                    ),
                }
        prev_bottom = float(bottom)
        normalized.append([float(top), float(bottom)])

    return {
        "valid": True,
        "intervals_cm": normalized,
        "total_depth_m": (normalized[-1][1] - normalized[0][0]) / 100.0,
        "missing_reason": None,
    }


def validate_period_and_leap_years(start_iso: str, end_iso: str, as_of_iso: Optional[str] = None) -> Dict[str, Any]:
    """Validate ISO date bounds, chronological order, and enumerate leap days in the interval."""
    try:
        d_start = date.fromisoformat(start_iso)
        d_end = date.fromisoformat(end_iso)
    except (ValueError, TypeError) as exc:
        return {
            "valid": False,
            "missing_reason": "temporal_mismatch",
            "detail": f"Invalid ISO date period [{start_iso}, {end_iso}]: {exc}",
        }
    if d_start.isoformat() != start_iso or d_end.isoformat() != end_iso or d_start > d_end:
        return {
            "valid": False,
            "missing_reason": "temporal_mismatch",
            "detail": f"Start date {start_iso} must precede or equal end date {end_iso}.",
        }
    if as_of_iso is not None:
        try:
            cutoff_dt = datetime.fromisoformat(as_of_iso.replace("Z", "+00:00"))
            if d_end >= cutoff_dt.date():
                return {
                    "valid": False,
                    "missing_reason": "stale_or_post_cutoff_snapshot",
                    "detail": f"Period end {end_iso} is not strictly historical relative to cutoff {as_of_iso}.",
                }
        except ValueError as exc:
            return {
                "valid": False,
                "missing_reason": "temporal_mismatch",
                "detail": f"Invalid as_of timestamp '{as_of_iso}': {exc}",
            }

    leap_days: List[str] = []
    for yr in range(d_start.year, d_end.year + 1):
        if is_leap_year(yr):
            ld = date(yr, 2, 29)
            if d_start <= ld <= d_end:
                leap_days.append(ld.strftime("%Y%m%d"))

    return {
        "valid": True,
        "start": start_iso,
        "end": end_iso,
        "expected_days": (d_end - d_start).days + 1,
        "leap_days_ymd": leap_days,
        "missing_reason": None,
    }


@dataclass(frozen=True)
class TypedEvidenceObject:
    """Strictly typed evidence record preserving full provenance, spatial/depth support, units, and uncertainty."""

    parameter_path: str
    provenance_class: str
    source_id: str
    provider: str
    product: str
    variable: str
    version: str
    permanent_url: str
    citation: str
    access_path: str
    retrieved_at: Optional[str]
    valid_period: Optional[Tuple[str, str]]
    evidence_type: str
    point_lon_lat: Tuple[float, float]
    crs: str
    spatial_resolution_desc: str
    pixel_area_km2: Optional[float]
    depth_interval_cm: Optional[Tuple[float, float]]
    raw_unit: Optional[str]
    scale_factor: Optional[float]
    raw_value: Optional[float]
    converted_si_value: Optional[float]
    si_unit: Optional[str]
    quantiles: Optional[Dict[str, Optional[float]]]
    uncertainty_semantics: str
    quality_flags: Tuple[str, ...]
    missing_value_handling: str
    raw_source_sha256: Optional[str]
    receipt_sha256: Optional[str]
    fixture_origin: str
    transformation_id: Optional[str]
    estimator_id: Optional[str]
    license: str
    attribution: str
    restrictions: str
    missing_reason: Optional[str] = None
    geometry: Optional[Dict[str, Any]] = None
    evidence_level: Optional[str] = None

    def __post_init__(self) -> None:
        if self.provenance_class not in PARAMETER_PROVENANCE_CLASSES:
            raise ValueError(f"Invalid provenance_class: {self.provenance_class}")
        if self.evidence_type not in EVIDENCE_TYPES:
            raise ValueError(f"Invalid evidence_type: {self.evidence_type}")
        if self.fixture_origin not in FIXTURE_ORIGINS:
            raise ValueError(f"Invalid fixture_origin: {self.fixture_origin}")
        if self.missing_reason is not None and self.missing_reason not in MISSING_REASONS:
            raise ValueError(f"Invalid missing_reason: {self.missing_reason}")
        if self.converted_si_value is not None and (
            isinstance(self.converted_si_value, bool) or not math.isfinite(self.converted_si_value)
        ):
            raise ValueError(f"Non-finite converted_si_value for {self.parameter_path}")
        resolved_level = infer_evidence_level(
            self.provenance_class,
            self.fixture_origin,
            is_available=self.is_available,
            evidence_level=self.evidence_level,
        )
        object.__setattr__(self, "evidence_level", resolved_level)

    @property
    def is_available(self) -> bool:
        return self.missing_reason is None and self.converted_si_value is not None

    @property
    def is_authentic_source(self) -> bool:
        return (
            self.is_available
            and self.provenance_class == "OBSERVED_OR_AUTHENTIC_SOURCE"
            and self.evidence_level in ("AUTHENTIC_LIVE", "AUTHENTIC_VERIFIED_CACHE")
            and self.fixture_origin in ("AUTHENTIC_LIVE_FETCH_RECEIPT", "AUTHENTIC_CACHED_RECEIPT")
        )

    def to_dict(self) -> Dict[str, Any]:
        core = {
            "parameter_path": self.parameter_path,
            "provenance_class": self.provenance_class,
            "evidence_level": self.evidence_level,
            "source_id": self.source_id,
            "provider": self.provider,
            "product": self.product,
            "variable": self.variable,
            "version": self.version,
            "permanent_url": self.permanent_url,
            "citation": self.citation,
            "access_path": self.access_path,
            "retrieved_at": self.retrieved_at,
            "valid_period": list(self.valid_period) if self.valid_period else None,
            "evidence_type": self.evidence_type,
            "point_lon_lat": list(self.point_lon_lat),
            "geometry": self.geometry,
            "crs": self.crs,
            "spatial_resolution_desc": self.spatial_resolution_desc,
            "pixel_area_km2": self.pixel_area_km2,
            "depth_interval_cm": list(self.depth_interval_cm) if self.depth_interval_cm else None,
            "raw_unit": self.raw_unit,
            "scale_factor": self.scale_factor,
            "raw_value": self.raw_value,
            "converted_si_value": self.converted_si_value,
            "si_unit": self.si_unit,
            "quantiles": self.quantiles,
            "uncertainty_semantics": self.uncertainty_semantics,
            "quality_flags": list(self.quality_flags),
            "missing_value_handling": self.missing_value_handling,
            "raw_source_sha256": self.raw_source_sha256,
            "receipt_sha256": self.receipt_sha256,
            "fixture_origin": self.fixture_origin,
            "transformation_id": self.transformation_id,
            "estimator_id": self.estimator_id,
            "license": self.license,
            "attribution": self.attribution,
            "restrictions": self.restrictions,
            "missing_reason": self.missing_reason,
            "is_available": self.is_available,
            "is_authentic_source": self.is_authentic_source,
        }
        core["evidence_id"] = canonical_digest(core)
        return core


PROVENANCE_PRIORITY = {
    "OBSERVED_OR_AUTHENTIC_SOURCE": 1,
    "DERIVED_WITH_VALIDATED_METHOD": 2,
    "USER_SCENARIO_ASSUMPTION": 3,
    "NOT_RETRIEVABLE": 99,
    "OFFICIAL_VERIFICATION_REQUIRED": 100,
}

FIXTURE_PRIORITY = {
    "AUTHENTIC_LIVE_FETCH_RECEIPT": 1,
    "AUTHENTIC_CACHED_RECEIPT": 2,
    "REGIONAL_OFFLINE_REFERENCE_FIXTURE": 3,
    "USER_DECLARED_SCENARIO_INPUT": 4,
    "SYNTHETIC_OFFLINE_CONTROL_FIXTURE": 5,
    "UNAVAILABLE_NO_DATA": 99,
}

EVIDENCE_LEVEL_PRIORITY = {
    "AUTHENTIC_LIVE": 1,
    "AUTHENTIC_VERIFIED_CACHE": 2,
    "VERIFIED_OPEN_SOURCE_MAP_ESTIMATE": 3,
    "USER_DECLARED_SCENARIO": 4,
    "SCIENTIFIC_DERIVATION": 5,
    "SYNTHETIC_TEST_FIXTURE": 6,
    "UNAVAILABLE": 99,
}


def arbitrate_parameter_sources(
    parameter_path: str,
    candidates: Sequence[TypedEvidenceObject],
    *,
    expected_si_unit: Optional[str] = None,
    as_of_iso: Optional[str] = None,
    allow_synthetic_controls: bool = False,
) -> Dict[str, Any]:
    """Select the highest-qualified valid source for a parameter and log all rejected substitutes."""
    valid_candidates: List[Tuple[Tuple[int, int, float], TypedEvidenceObject]] = []
    rejected: List[Dict[str, Any]] = []

    cutoff_dt: Optional[datetime] = None
    if as_of_iso:
        cutoff_dt = datetime.fromisoformat(as_of_iso.replace("Z", "+00:00"))

    for cand in candidates:
        if cand.parameter_path != parameter_path:
            rejected.append(
                {
                    "source_id": cand.source_id,
                    "provider": cand.provider,
                    "reason": "parameter_mismatch",
                    "detail": f"Candidate path {cand.parameter_path} != {parameter_path}",
                }
            )
            continue
        if not cand.is_available:
            rejected.append(
                {
                    "source_id": cand.source_id,
                    "provider": cand.provider,
                    "reason": cand.missing_reason or "source_outage",
                    "detail": "Source reported unavailable or missing value.",
                }
            )
            continue
        if not allow_synthetic_controls and cand.fixture_origin == "SYNTHETIC_OFFLINE_CONTROL_FIXTURE":
            rejected.append(
                {
                    "source_id": cand.source_id,
                    "provider": cand.provider,
                    "reason": "quality_fail",
                    "detail": "Synthetic offline control fixture is excluded when authentic/reference evidence is required.",
                }
            )
            continue
        if expected_si_unit and cand.si_unit != expected_si_unit:
            rejected.append(
                {
                    "source_id": cand.source_id,
                    "provider": cand.provider,
                    "reason": "quality_fail",
                    "detail": f"Unit mismatch: expected '{expected_si_unit}', got '{cand.si_unit}'.",
                }
            )
            continue
        if cutoff_dt and cand.retrieved_at:
            cand_dt = datetime.fromisoformat(cand.retrieved_at.replace("Z", "+00:00"))
            if cand_dt > cutoff_dt:
                rejected.append(
                    {
                        "source_id": cand.source_id,
                        "provider": cand.provider,
                        "reason": "stale_or_post_cutoff_snapshot",
                        "detail": f"Retrieval timestamp {cand.retrieved_at} postdates cutoff {as_of_iso}.",
                    }
                )
                continue

        rank_key = (
            PROVENANCE_PRIORITY.get(cand.provenance_class, 99),
            EVIDENCE_LEVEL_PRIORITY.get(cand.evidence_level or "UNAVAILABLE", 99),
            FIXTURE_PRIORITY.get(cand.fixture_origin, 99),
            float(cand.pixel_area_km2 if cand.pixel_area_km2 is not None else 1e9),
        )
        valid_candidates.append((rank_key, cand))

    valid_candidates.sort(key=lambda item: item[0])
    if not valid_candidates:
        primary_reason = rejected[0]["reason"] if rejected else "not_identifiable"
        return {
            "parameter_path": parameter_path,
            "status": "UNAVAILABLE",
            "selected": None,
            "missing_reason": primary_reason,
            "rejected_substitutes": rejected,
        }

    selected = valid_candidates[0][1]
    for _, lower in valid_candidates[1:]:
        rejected.append(
            {
                "source_id": lower.source_id,
                "provider": lower.provider,
                "reason": "superseded_by_higher_priority_source",
                "detail": f"Superseded by {selected.source_id} ({selected.provenance_class}, {selected.fixture_origin}).",
            }
        )

    return {
        "parameter_path": parameter_path,
        "status": "SELECTED",
        "selected": selected.to_dict(),
        "missing_reason": None,
        "rejected_substitutes": rejected,
    }
