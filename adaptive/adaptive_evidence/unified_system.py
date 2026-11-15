"""Unified ASTRAGRON Runnable System (`astragron.unified-system.v1`).

Wires together:
1. Strict Geometry + Land/Water/Coast/Polar + Point-vs-Polygon Spatial Consistency Validator
2. Live & Cached Official NASA POWER Daily Adapter with SHA-256 Receipts
3. Live & Cached ISRIC SoilGrids v2.0 250 m WCS Adapter with Uncertainty Quantiles
4. Adaptive Evidence Engine (`C1`–`C10`) & Decision Sensitivity Analyzer (`P4`)
5. Upstream 5-Year Conditional Research Planner (`water_core.application.Service` & `ClientDecisionService`)
6. Farmer-Friendly & Researcher-Auditable Printable English HTML/CSV/JSON Report Renderer

Zero protected files in `coordination/BASELINE_LOCK.json` (301 files) or
`coordination/GROWTH_INPUT_LOCK.json` (59 files) are modified.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import html
import io
import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .adapters import FAOGAEZAdapter, NASAPowerAdapter, SoilGridsWCSAdapter
from .capabilities import CAPABILITY_REGISTRY
from .engine import AdaptiveEvidenceEngine
from .integration import (
    PROVENANCE_AND_LICENSE_LEDGER,
    ROLLBACK_AND_ISOLATION_PLAN,
    AdaptiveClientDecisionBridge,
)
from .inventory import (
    ROOT,
    WATER_CORE_DIR,
    sha256_file,
    verify_upstream_integrity,
)
from .land_mask import WGS84_GEOD, _is_finite_number, _is_valid_wgs84_crs, evaluate_field_polygon_land_water
from .license_gate import evaluate_open_source_license_gate
from .schema import canonical_digest, validate_coordinates_and_crs
from .sensitivity import DecisionSensitivityAnalyzer

BASELINE_LOCK_PATH = ROOT / "coordination" / "BASELINE_LOCK.json"
GROWTH_LOCK_PATH = ROOT / "coordination" / "GROWTH_INPUT_LOCK.json"
GLOBAL_NASA_CACHE_DIR = ROOT / "adaptive_evidence" / "data" / "nasa_power_global_cache"
GLOBAL_SOILGRIDS_CACHE_DIR = ROOT / "adaptive_evidence" / "data" / "soilgrids_global_cache"

if str(WATER_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(WATER_CORE_DIR))

from application import Service as WaterCoreResearchService  # type: ignore
from brain.service import ClientDecisionService  # type: ignore


# 12 Geographically Diverse Worldwide Land Locations for Gate III
GATE3_WORLDWIDE_12_SITES: List[Dict[str, Any]] = [
    {
        "site_id": "SE_UPPSALA",
        "country": "Sweden",
        "continent": "Europe",
        "name": "Uppsala Research Farm, Sweden",
        "point_lon_lat": [17.65, 59.82],
        "nasa_cache_origin": "UPSTREAM_PINNED_CACHE",
        "candidate_crops": ["barley", "oats", "faba_bean", "rapeseed"],
        "water_supply_scenario": {"regime": "irrigated", "seasonal_supply_m3_ha": 450.0},
        "five_year_example_file": "sweden_planning.json",
    },
    {
        "site_id": "KE_NYERI",
        "country": "Kenya",
        "continent": "Africa",
        "name": "Nyeri / Central Highlands, Kenya",
        "point_lon_lat": [36.95, -0.42],
        "nasa_cache_origin": "UPSTREAM_PINNED_CACHE",
        "candidate_crops": ["wheat", "barley", "chickpea"],
        "water_supply_scenario": {"regime": "rainfed"},
        "five_year_example_file": "kenya_research.json",
    },
    {
        "site_id": "AU_WAGGA",
        "country": "Australia",
        "continent": "Oceania",
        "name": "Wagga Wagga, New South Wales, Australia",
        "point_lon_lat": [147.35, -35.05],
        "nasa_cache_origin": "UPSTREAM_PINNED_CACHE",
        "candidate_crops": ["wheat", "barley", "chickpea"],
        "water_supply_scenario": {"regime": "rainfed"},
        "five_year_example_file": "australia_research.json",
    },
    {
        "site_id": "DE_HEILBRONN",
        "country": "Germany",
        "continent": "Europe",
        "name": "Heilbronn, Baden-Wuerttemberg, Germany",
        "point_lon_lat": [9.22, 49.14],
        "nasa_cache_origin": "UPSTREAM_PINNED_CACHE",
        "candidate_crops": ["wheat", "barley", "rapeseed"],
        "water_supply_scenario": {"regime": "rainfed"},
        "five_year_example_file": None,
    },
    {
        "site_id": "BR_BRASILIA_CERRADO",
        "country": "Brazil",
        "continent": "South America",
        "name": "Brasilia Cerrado Agricultural Plateau, Brazil",
        "point_lon_lat": [-47.90, -15.80],
        "nasa_cache_origin": "LIVE_FETCHED_AND_CACHED",
        "candidate_crops": ["soybean", "maize", "sorghum"],
        "water_supply_scenario": {"regime": "rainfed"},
        "five_year_example_file": None,
    },
    {
        "site_id": "AR_PERGAMINO_PAMPAS",
        "country": "Argentina",
        "continent": "South America",
        "name": "Pergamino, Buenos Aires Pampas, Argentina",
        "point_lon_lat": [-60.52, -33.89],
        "nasa_cache_origin": "LIVE_FETCHED_AND_CACHED",
        "candidate_crops": ["wheat", "soybean", "maize", "sunflower"],
        "water_supply_scenario": {"regime": "rainfed"},
        "five_year_example_file": None,
    },
    {
        "site_id": "IN_PUNJAB_LUDHIANA",
        "country": "India",
        "continent": "Asia",
        "name": "Ludhiana Indo-Gangetic Plain, Punjab, India",
        "point_lon_lat": [75.85, 30.90],
        "nasa_cache_origin": "LIVE_FETCHED_AND_CACHED",
        "candidate_crops": ["wheat", "rice", "chickpea"],
        "water_supply_scenario": {"regime": "irrigated", "seasonal_supply_m3_ha": 1800.0},
        "five_year_example_file": None,
    },
    {
        "site_id": "JP_TSUKUBA_KANTO",
        "country": "Japan",
        "continent": "Asia",
        "name": "Tsukuba, Ibaraki (Kanto Plain), Japan",
        "point_lon_lat": [140.12, 36.08],
        "nasa_cache_origin": "LIVE_FETCHED_AND_CACHED",
        "candidate_crops": ["rice", "soybean", "wheat"],
        "water_supply_scenario": {"regime": "rainfed"},
        "five_year_example_file": None,
    },
    {
        "site_id": "ID_WEST_JAVA_BANDUNG",
        "country": "Indonesia",
        "continent": "Asia",
        "name": "Bandung Highland Basin, West Java, Indonesia",
        "point_lon_lat": [107.61, -6.91],
        "nasa_cache_origin": "LIVE_FETCHED_AND_CACHED",
        "candidate_crops": ["rice", "maize", "soybean"],
        "water_supply_scenario": {"regime": "rainfed"},
        "five_year_example_file": None,
    },
    {
        "site_id": "EG_NILE_DELTA_TANTA",
        "country": "Egypt",
        "continent": "Africa",
        "name": "Tanta, Central Nile Delta, Egypt",
        "point_lon_lat": [31.01, 30.79],
        "nasa_cache_origin": "LIVE_FETCHED_AND_CACHED",
        "candidate_crops": ["wheat", "maize", "faba_bean"],
        "water_supply_scenario": {"regime": "irrigated", "seasonal_supply_m3_ha": 2400.0},
        "five_year_example_file": None,
    },
    {
        "site_id": "US_IOWA_AMES",
        "country": "USA",
        "continent": "North America",
        "name": "Ames, Story County, Iowa, USA",
        "point_lon_lat": [-93.62, 42.03],
        "nasa_cache_origin": "LIVE_FETCHED_AND_CACHED",
        "candidate_crops": ["maize", "soybean", "oats"],
        "water_supply_scenario": {"regime": "rainfed"},
        "five_year_example_file": None,
    },
    {
        "site_id": "ZA_SWARTLAND_CAPE",
        "country": "South Africa",
        "continent": "Africa",
        "name": "Swartland / Malmesbury, Western Cape, South Africa",
        "point_lon_lat": [18.86, -33.93],
        "nasa_cache_origin": "LIVE_FETCHED_AND_CACHED",
        "candidate_crops": ["wheat", "barley", "chickpea", "rapeseed"],
        "water_supply_scenario": {"regime": "rainfed"},
        "five_year_example_file": None,
    },
]


class UnifiedAstragronSystem:
    """Unified runnable coordinator combining strict geometry gates, C1-C10 adaptive evidence, and 5-year research planning."""

    def __init__(
        self,
        nasa_cache_dir: Path = GLOBAL_NASA_CACHE_DIR,
        soilgrids_cache_dir: Path = GLOBAL_SOILGRIDS_CACHE_DIR,
    ) -> None:
        self.nasa = NASAPowerAdapter(cache_dir=nasa_cache_dir)
        self.soilgrids = SoilGridsWCSAdapter(cache_dir=soilgrids_cache_dir)
        self.gaez = FAOGAEZAdapter()
        self.engine = AdaptiveEvidenceEngine(
            nasa_adapter=self.nasa,
            soilgrids_adapter=self.soilgrids,
            gaez_adapter=self.gaez,
        )
        self.sensitivity = DecisionSensitivityAnalyzer(self.engine)
        self.bridge = AdaptiveClientDecisionBridge(
            adaptive_engine=self.engine,
            sensitivity_analyzer=self.sensitivity,
        )
        self.water_core_service = WaterCoreResearchService()
        self.client_decision_service = ClientDecisionService()
        self._session_results: Dict[str, Dict[str, Any]] = {}

    def _validate_cross_request_location_coherence(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Validate coordinates, CRS, GeoJSON, site_ids, and spatial coherence across all nested request levels."""
        site_specs: List[Tuple[str, Any]] = []
        if "location" in payload:
            site_specs.append(("payload.location", payload.get("location")))
        eng_req = payload.get("engine_request")
        if isinstance(eng_req, dict) and "location" in eng_req:
            site_specs.append(("engine_request.location", eng_req.get("location")))
        res_req = payload.get("research_decision_request")
        if isinstance(res_req, dict) and "location" in res_req:
            site_specs.append(("research_decision_request.location", res_req.get("location")))

        validated_sites: List[Dict[str, Any]] = []
        explicit_site_ids: List[Tuple[str, str]] = []
        site_geometries: List[Tuple[str, Dict[str, Any], str]] = []

        for label, loc_obj in site_specs:
            if not isinstance(loc_obj, dict):
                return {
                    "valid": False,
                    "missing_reason": "invalid_coordinates_or_crs",
                    "detail": f"{label} must be a GeoJSON-compatible location object.",
                    "c1_point": None,
                    "crs": "EPSG:4326",
                }
            crs = loc_obj.get("crs", "EPSG:4326")
            if crs != "EPSG:4326":
                return {
                    "valid": False,
                    "missing_reason": "invalid_coordinates_or_crs",
                    "detail": f"{label} declares unsupported CRS '{crs}'; only explicit EPSG:4326 is accepted.",
                    "c1_point": loc_obj.get("point_lon_lat"),
                    "crs": str(crs),
                }
            sid = str(loc_obj.get("site_id") or "").strip()
            if sid:
                explicit_site_ids.append((label, sid))

            pt = loc_obj.get("point_lon_lat")
            geom = loc_obj.get("geometry")

            if pt is not None:
                v = validate_coordinates_and_crs(pt, crs, geom)
                if not v["valid"]:
                    return {
                        "valid": False,
                        "missing_reason": v.get("missing_reason") or "invalid_coordinates_or_crs",
                        "detail": f"{label}: {v.get('detail')}",
                        "c1_point": pt,
                        "crs": crs,
                    }
                validated_sites.append(
                    {
                        "label": label,
                        "site_id": sid,
                        "point": [float(pt[0]), float(pt[1])],
                        "crs": crs,
                        "geometry": geom,
                    }
                )
            elif geom is not None:
                if not isinstance(geom, dict) or geom.get("type") not in ("Point", "Polygon", "MultiPolygon"):
                    return {
                        "valid": False,
                        "missing_reason": "invalid_coordinates_or_crs",
                        "detail": f"{label}.geometry must be a valid GeoJSON Point, Polygon, or MultiPolygon.",
                        "c1_point": None,
                        "crs": crs,
                    }
                if geom["type"] == "Point":
                    gcoords = geom.get("coordinates")
                    v = validate_coordinates_and_crs(
                        list(gcoords[:2]) if isinstance(gcoords, (list, tuple)) and len(gcoords) >= 2 else None,
                        crs,
                        geom,
                    )
                    if not v["valid"]:
                        return {
                            "valid": False,
                            "missing_reason": v.get("missing_reason") or "invalid_coordinates_or_crs",
                            "detail": f"{label}.geometry: {v.get('detail')}",
                            "c1_point": gcoords,
                            "crs": crs,
                        }
                    validated_sites.append(
                        {
                            "label": label,
                            "site_id": sid,
                            "point": [float(gcoords[0]), float(gcoords[1])],
                            "crs": crs,
                            "geometry": geom,
                        }
                    )
                else:
                    pe = evaluate_field_polygon_land_water(geom, crs=crs)
                    if not pe["valid"]:
                        return {
                            "valid": False,
                            "missing_reason": pe.get("missing_reason") or "invalid_coordinates_or_crs",
                            "detail": f"{label}.geometry: {pe.get('detail')}",
                            "c1_point": None,
                            "crs": crs,
                        }
            else:
                return {
                    "valid": False,
                    "missing_reason": "invalid_coordinates_or_crs",
                    "detail": f"{label} must provide EPSG:4326 point_lon_lat or GeoJSON geometry.",
                    "c1_point": None,
                    "crs": crs,
                }

            if isinstance(geom, dict) and geom.get("type") in ("Polygon", "MultiPolygon"):
                site_geometries.append((label, geom, crs))

        distinct_ids = sorted({sid for _, sid in explicit_site_ids})
        if len(distinct_ids) > 1:
            return {
                "valid": False,
                "missing_reason": "spatial_mismatch",
                "detail": f"Conflicting nested site_id values across request objects: {explicit_site_ids}.",
                "c1_point": validated_sites[0]["point"] if validated_sites else None,
                "crs": "EPSG:4326",
            }

        for idx_a in range(len(validated_sites)):
            for idx_b in range(idx_a + 1, len(validated_sites)):
                sa = validated_sites[idx_a]
                sb = validated_sites[idx_b]
                lon_a, lat_a = sa["point"]
                lon_b, lat_b = sb["point"]
                _, _, dist_m = WGS84_GEOD.inv(lon_a, lat_a, lon_b, lat_b)
                if not math.isfinite(dist_m) or dist_m > 100.0:
                    return {
                        "valid": False,
                        "missing_reason": "spatial_mismatch",
                        "detail": (
                            f"Nested location {sb['label']} {[lon_b, lat_b]} differs by "
                            f"{dist_m / 1000.0:.3f} km ({dist_m:.1f} m) from {sa['label']} {[lon_a, lat_a]}."
                        ),
                        "c1_point": [lon_a, lat_a],
                        "crs": "EPSG:4326",
                    }

        for g_label, geom, g_crs in site_geometries:
            for s in validated_sites:
                chk = validate_coordinates_and_crs(s["point"], g_crs, geom)
                if not chk["valid"]:
                    return {
                        "valid": False,
                        "missing_reason": chk.get("missing_reason") or "spatial_mismatch",
                        "detail": f"Cross-request point {s['label']} {s['point']} vs {g_label}: {chk.get('detail')}",
                        "c1_point": s["point"],
                        "crs": g_crs,
                    }

        # Validate field-level geometries/points across outer, engine_request, and research_decision_request
        ref_point = validated_sites[0]["point"] if validated_sites else None
        primary_sid = explicit_site_ids[0][1] if explicit_site_ids else None
        containers = [("payload", payload)]
        if isinstance(eng_req, dict):
            containers.append(("engine_request", eng_req))
        if isinstance(res_req, dict):
            containers.append(("research_decision_request", res_req))

        for cname, container in containers:
            fields = container.get("fields")
            if not isinstance(fields, list):
                continue
            for f_idx, fobj in enumerate(fields):
                if not isinstance(fobj, dict):
                    continue
                flabel = f"{cname}.fields[{f_idx}]"
                f_loc = fobj.get("location")
                if f_loc is not None and not isinstance(f_loc, dict):
                    return {
                        "valid": False,
                        "missing_reason": "invalid_coordinates_or_crs",
                        "detail": f"{flabel}.location must be a dict.",
                        "c1_point": ref_point,
                        "crs": "EPSG:4326",
                    }
                f_crs = fobj.get("crs") or (f_loc.get("crs") if isinstance(f_loc, dict) else None) or "EPSG:4326"
                if f_crs != "EPSG:4326":
                    return {
                        "valid": False,
                        "missing_reason": "invalid_coordinates_or_crs",
                        "detail": f"{flabel} declares unsupported CRS '{f_crs}'.",
                        "c1_point": ref_point,
                        "crs": str(f_crs),
                    }
                f_sid = str((f_loc.get("site_id") if isinstance(f_loc, dict) else None) or "").strip()
                if f_sid and primary_sid and f_sid != primary_sid:
                    return {
                        "valid": False,
                        "missing_reason": "spatial_mismatch",
                        "detail": f"{flabel} site_id '{f_sid}' conflicts with primary site_id '{primary_sid}'.",
                        "c1_point": ref_point,
                        "crs": "EPSG:4326",
                    }
                f_pt = fobj.get("point_lon_lat")
                if f_pt is None and isinstance(f_loc, dict):
                    f_pt = f_loc.get("point_lon_lat")
                f_geom = fobj.get("geometry")
                if f_geom is None and isinstance(f_loc, dict):
                    f_geom = f_loc.get("geometry")

                if f_pt is not None:
                    fv = validate_coordinates_and_crs(f_pt, f_crs, f_geom)
                    if not fv["valid"]:
                        return {
                            "valid": False,
                            "missing_reason": fv.get("missing_reason") or "invalid_coordinates_or_crs",
                            "detail": f"{flabel}: {fv.get('detail')}",
                            "c1_point": ref_point or f_pt,
                            "crs": f_crs,
                        }
                    f_pt_num = [float(f_pt[0]), float(f_pt[1])]
                    if ref_point is not None:
                        _, _, fdist = WGS84_GEOD.inv(ref_point[0], ref_point[1], f_pt_num[0], f_pt_num[1])
                        if not math.isfinite(fdist) or fdist > 25_000.0:
                            return {
                                "valid": False,
                                "missing_reason": "spatial_mismatch",
                                "detail": f"{flabel} coordinate {f_pt_num} is {fdist/1000.0:.2f} km from primary farm {ref_point} (> 25 km farm bound).",
                                "c1_point": ref_point,
                                "crs": "EPSG:4326",
                            }
                    for g_label, s_geom, s_crs in site_geometries:
                        chk = validate_coordinates_and_crs(f_pt_num, s_crs, s_geom)
                        if not chk["valid"]:
                            return {
                                "valid": False,
                                "missing_reason": chk.get("missing_reason") or "spatial_mismatch",
                                "detail": f"{flabel} point {f_pt_num} falls outside {g_label}: {chk.get('detail')}",
                                "c1_point": ref_point,
                                "crs": s_crs,
                            }
                elif f_geom is not None:
                    if not isinstance(f_geom, dict) or f_geom.get("type") not in ("Point", "Polygon", "MultiPolygon"):
                        return {
                            "valid": False,
                            "missing_reason": "invalid_coordinates_or_crs",
                            "detail": f"{flabel}.geometry must be Point, Polygon, or MultiPolygon.",
                            "c1_point": ref_point,
                            "crs": f_crs,
                        }
                    if f_geom["type"] == "Point":
                        gc = f_geom.get("coordinates")
                        fv = validate_coordinates_and_crs(
                            list(gc[:2]) if isinstance(gc, (list, tuple)) and len(gc) >= 2 else None,
                            f_crs,
                            f_geom,
                        )
                        if not fv["valid"]:
                            return {
                                "valid": False,
                                "missing_reason": fv.get("missing_reason") or "invalid_coordinates_or_crs",
                                "detail": f"{flabel}.geometry: {fv.get('detail')}",
                                "c1_point": ref_point,
                                "crs": f_crs,
                            }
                        if ref_point is not None:
                            _, _, fdist = WGS84_GEOD.inv(ref_point[0], ref_point[1], float(gc[0]), float(gc[1]))
                            if not math.isfinite(fdist) or fdist > 25_000.0:
                                return {
                                    "valid": False,
                                    "missing_reason": "spatial_mismatch",
                                    "detail": f"{flabel}.geometry Point is {fdist/1000.0:.2f} km from primary farm {ref_point}.",
                                    "c1_point": ref_point,
                                    "crs": f_crs,
                                }
                    else:
                        fpe = evaluate_field_polygon_land_water(f_geom, crs=f_crs)
                        if not fpe["valid"]:
                            return {
                                "valid": False,
                                "missing_reason": fpe.get("missing_reason") or "invalid_coordinates_or_crs",
                                "detail": f"{flabel}.geometry: {fpe.get('detail')}",
                                "c1_point": ref_point,
                                "crs": f_crs,
                            }
                        if ref_point is not None:
                            ring = (
                                f_geom["coordinates"][0][0]
                                if f_geom["type"] == "Polygon"
                                else f_geom["coordinates"][0][0][0]
                            )
                            _, _, fdist = WGS84_GEOD.inv(ref_point[0], ref_point[1], float(ring[0]), float(ring[1]))
                            if not math.isfinite(fdist) or fdist > 25_000.0:
                                return {
                                    "valid": False,
                                    "missing_reason": "spatial_mismatch",
                                    "detail": f"{flabel}.geometry vertices are {fdist/1000.0:.2f} km from primary farm {ref_point}.",
                                    "c1_point": ref_point,
                                    "crs": f_crs,
                                }

        return {"valid": True, "missing_reason": None, "detail": "Cross-request locations coherent."}

    def evaluate_unified(self, payload: Any) -> Dict[str, Any]:
        """Evaluate any adaptive-evidence, research-decision, or client-decision request through the unified pipeline."""
        if not isinstance(payload, dict):
            ae_resp = self.engine.evaluate({})
            return self._package_unified_envelope({}, ae_resp, None, None, None)

        schema = str(payload.get("schema") or "")
        is_client_decision = schema == "astragron.client-decision.request.v1" or "engine_request" in payload
        is_research_decision = (
            not is_client_decision
            and (
                schema == "astragron.research-decision.request.v1"
                or ("fields" in payload and "scenarios" in payload and "horizon_years" in payload)
            )
        )

        # Gate 0 (BEFORE any NASA/SoilGrids fetch or 5-year planner run):
        # Cross-validate all nested location objects, site_ids, CRS, and field geometries.
        coherence = self._validate_cross_request_location_coherence(payload)
        if not coherence["valid"]:
            req_id = str(
                payload.get("request_id")
                or payload.get("farm_id")
                or "unified-spatial-rejected"
            )
            reason = str(coherence["missing_reason"] or "spatial_mismatch")
            detail = str(coherence["detail"] or "Spatial coherence validation failed.")
            c1_payload = {
                "capability_id": "C1",
                "name": CAPABILITY_REGISTRY["C1"].name,
                "status": "BLOCKED",
                "missing_reason": reason,
                "detail": detail,
                "point_lon_lat": coherence.get("c1_point"),
                "crs": coherence.get("crs", "EPSG:4326"),
                "land_status": "SPATIAL_MISMATCH" if reason == "spatial_mismatch" else "INVALID_GEOMETRY",
                "physical_surface": "INVALID",
                "distance_to_coast_m": None,
                "dataset_metadata": None,
                "polygon_evaluation": None,
                "hemisphere": None,
            }
            ae_resp = self.engine._build_c1_blocked_response(
                req_id, c1_payload, reason, detail, request=payload
            )
            return self._package_unified_envelope(payload, ae_resp, None, None, None)

        # Determine whether payload is a client-decision, 5-year research-decision, or adaptive-evidence request
        if is_client_decision:
            ae_req = self.bridge.translate_client_request_to_adaptive(
                payload,
                allow_offline_reference_fixture=False,
                allow_conditional_crop_planning=True,
            )
            if isinstance(payload.get("options"), dict):
                ae_req["options"].update(
                    {k: v for k, v in payload["options"].items() if k != "acquisition" or "source" not in (payload.get("engine_request") or {})}
                )
            research_req = None
        elif is_research_decision:
            ae_req = self.bridge.translate_client_request_to_adaptive(
                {"request_id": (payload.get("location") or {}).get("site_id", "research-5y"), "engine_request": payload},
                allow_offline_reference_fixture=False,
                allow_conditional_crop_planning=True,
            )
            if isinstance(payload.get("options"), dict):
                ae_req["options"].update(payload["options"])
            research_req = deepcopy(payload)
        else:
            ae_req = deepcopy(payload)
            research_req = payload.get("research_decision_request")

        # Step 1: Evaluate C1-C10 adaptive evidence (includes strict geometry & land/water gates)
        ae_resp = self.engine.evaluate(ae_req)
        c1_ok = ae_resp["capability_statuses"]["C1"] == "READY"
        sens_resp = self.sensitivity.analyze(ae_req) if c1_ok else None
        canon_sens_resp = None
        if (
            c1_ok
            and is_client_decision
            and isinstance(payload.get("options"), dict)
            and bool(payload["options"].get("run_canonical_sensitivity", False))
        ):
            from .sensitivity import CanonicalDecisionSensitivityRunner

            canon_sens_resp = CanonicalDecisionSensitivityRunner(self.client_decision_service).run(
                payload
            )

        # Step 2: Authoritative 5-Year Decision Routing ONLY when C1 is READY and requested
        upstream_client_resp: Optional[Dict[str, Any]] = None
        five_year_res: Optional[Dict[str, Any]] = None

        if c1_ok and is_client_decision:
            # BLOCKER 1: Route astragron.client-decision.request.v1 directly through ClientDecisionService ONCE.
            # Preserve exact canonical decision, alternatives, qualification, nutrient_response, and report_dto.
            try:
                upstream_client_resp = self.client_decision_service.run(deepcopy(payload))
                eng_res = upstream_client_resp.get("engine_result")
                if isinstance(eng_res, dict):
                    five_year_res = deepcopy(eng_res)
                    five_year_res["canonical_client_status"] = upstream_client_resp.get("status")
                    five_year_res["canonical_decision"] = deepcopy(upstream_client_resp.get("decision"))
                    five_year_res["report_dto"] = deepcopy(upstream_client_resp.get("report_dto"))
                    if upstream_client_resp.get("status") == "CONDITIONAL_RESEARCH_COMPLETE":
                        five_year_res["status"] = "RESEARCH_COMPARISON_COMPLETE"
                else:
                    five_year_res = {
                        "status": upstream_client_resp.get("status", "EVIDENCE_BLOCKED"),
                        "missing_requirements": upstream_client_resp.get("missing_requirements", []),
                        "canonical_client_status": upstream_client_resp.get("status"),
                        "canonical_decision": deepcopy(upstream_client_resp.get("decision")),
                        "report_dto": deepcopy(upstream_client_resp.get("report_dto")),
                    }
            except Exception as exc:
                upstream_client_resp = {
                    "schema": "astragron.client-decision.response.v1",
                    "farm_id": payload.get("farm_id"),
                    "status": "EVIDENCE_BLOCKED",
                    "missing_requirements": [str(exc)],
                    "decision": None,
                    "alternatives": [],
                    "qualification": None,
                    "nutrient_response": None,
                    "report_dto": None,
                }
                five_year_res = {
                    "status": "EVIDENCE_BLOCKED",
                    "reason": str(exc),
                    "field_recommendation": None,
                }
        elif c1_ok and isinstance(research_req, dict):
            try:
                five_year_res = self.water_core_service.run(deepcopy(research_req))
            except Exception as exc:
                five_year_res = {
                    "status": "EVIDENCE_BLOCKED",
                    "reason": str(exc),
                    "field_recommendation": None,
                }

        # Step 3: Reconcile unified status outcome without false upgrades
        if upstream_client_resp is not None:
            if upstream_client_resp.get("status") == "CONDITIONAL_RESEARCH_COMPLETE":
                ae_resp["status_outcome"] = "CONDITIONAL_RESEARCH_COMPARISON"
        elif (
            five_year_res is not None
            and five_year_res.get("status") == "RESEARCH_COMPARISON_COMPLETE"
        ):
            ae_resp["status_outcome"] = "CONDITIONAL_RESEARCH_COMPARISON"

        return self._package_unified_envelope(
            payload, ae_resp, sens_resp, five_year_res, upstream_client_resp, canon_sens_resp
        )

    def _package_unified_envelope(
        self,
        raw_request: Dict[str, Any],
        ae_resp: Dict[str, Any],
        sens_resp: Optional[Dict[str, Any]],
        five_year_res: Optional[Dict[str, Any]],
        upstream_client_resp: Optional[Dict[str, Any]] = None,
        canon_sens_resp: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        try:
            result_id = canonical_digest({"req": raw_request, "ae": ae_resp["request_id"]})
        except Exception:
            import hashlib
            result_id = hashlib.sha256(repr(ae_resp["request_id"]).encode("utf-8")).hexdigest()

        five_year_summary = None
        if isinstance(five_year_res, dict):
            rd = five_year_res.get("canonical_decision") or five_year_res.get("research_decision") or {}
            cand_reg = five_year_res.get("candidate_registry") or {}
            cases = five_year_res.get("cases") or []
            missing_reqs = (
                upstream_client_resp.get("missing_requirements", [])
                if isinstance(upstream_client_resp, dict)
                else five_year_res.get("missing_requirements", [])
            )
            five_year_summary = {
                "status": five_year_res.get("canonical_client_status") or five_year_res.get("status"),
                "engine_status": five_year_res.get("status"),
                "decision_status": rd.get("status"),
                "selected_policy_ids": rd.get("selected_ids", []),
                "decision": deepcopy(rd) if rd else None,
                "report_dto": deepcopy(five_year_res.get("report_dto")),
                "candidate_count": len(cand_reg),
                "scenario_case_count": len(cases),
                "missing_requirements": missing_reqs,
                "quality_assessment": ae_resp.get("quality_assessment"),
                "single_next_missing_input": ae_resp.get("single_next_missing_input"),
                "field_recommendation": None,
                "field_validated": False,
                "candidates": [
                    {
                        "policy_id": pid,
                        "origin": cinfo.get("origin"),
                        "five_year_choices": cinfo.get("choices"),
                    }
                    for pid, cinfo in list(cand_reg.items())[:8]
                ],
                "scenario_outcomes": [
                    {
                        "policy_id": c.get("policy_id"),
                        "scenario_id": c.get("scenario_id"),
                        "status": c.get("status"),
                        "service_pass": c.get("service_pass"),
                        "ET_shortfall_m3_equivalent": c.get("ET_shortfall_m3_equivalent"),
                        "source_withdrawal_m3": c.get("source_withdrawal_m3"),
                        "max_field_harvest_deficit_mm": c.get("max_field_harvest_deficit_mm"),
                    }
                    for c in cases[:16]
                ],
            }

        envelope = {
            "schema": "astragron.unified-decision.response.v1",
            "result_id": result_id,
            "request_id": ae_resp["request_id"],
            "status_outcome": ae_resp["status_outcome"],
            "overall_summary_status": ae_resp["overall_summary_status"],
            "capability_statuses": ae_resp["capability_statuses"],
            "evidence_levels_observed": ae_resp.get("evidence_levels_observed", []),
            "quality_assessment": ae_resp.get("quality_assessment"),
            "single_next_missing_input": ae_resp.get("single_next_missing_input"),
            "adaptive_evidence": ae_resp,
            "decision_sensitivity": sens_resp,
            "canonical_decision_sensitivity": canon_sens_resp,
            "five_year_research_plan": five_year_summary,
            "upstream_client_decision_response": deepcopy(upstream_client_resp) if upstream_client_resp is not None else None,
            "artifacts": {
                "html_report": f"/api/v1/adaptive-evidence/results/{result_id}.html",
                "json_export": f"/api/v1/adaptive-evidence/results/{result_id}.json",
                "csv_export": f"/api/v1/adaptive-evidence/results/{result_id}.csv",
            },
            "export_capabilities": {
                "html_report": True,
                "json_export": True,
                "csv_export": True,
                "customer_pdf_export": False,
                "customer_pdf_unavailable_reason": "Codex B per-farm customer PDF renderer was not supplied in this workspace; browser print-to-PDF of the English HTML report is available, and Codex A canonical report_dto is preserved verbatim in JSON/HTML.",
            },
            "scientific_guardrails": ae_resp["scientific_guardrails"],
        }
        self._session_results[result_id] = envelope
        return envelope

    def export_result(self, result_id: str, fmt: str) -> Optional[bytes]:
        env = self._session_results.get(result_id)
        if env is None:
            return None
        if fmt == "json":
            return (json.dumps(env, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
        if fmt == "html":
            return render_english_html_report(env).encode("utf-8")
        if fmt == "csv":
            return render_english_csv_summary(env).encode("utf-8")
        return None


def render_english_csv_summary(envelope: Dict[str, Any]) -> str:
    """Render a deterministic CSV summary of capability statuses and 5-year/screening outcomes."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(
        [
            "result_id",
            "request_id",
            "status_outcome",
            "capability_id",
            "capability_name",
            "status",
            "missing_reason",
            "detail",
        ]
    )
    ae = envelope["adaptive_evidence"]
    for cid, cap in ae["capabilities"].items():
        writer.writerow(
            [
                envelope["result_id"],
                envelope["request_id"],
                envelope["status_outcome"],
                cid,
                cap.get("name", ""),
                cap.get("status", ""),
                cap.get("missing_reason") or "",
                cap.get("detail") or "",
            ]
        )
    return buf.getvalue()


def render_english_html_report(envelope: Dict[str, Any]) -> str:
    """Render a standalone, printable English HTML report satisfying Gate V requirements."""
    ae = envelope["adaptive_evidence"]
    caps = ae["capabilities"]
    c1 = caps["C1"]
    outcome = envelope["status_outcome"]
    five_yr = envelope.get("five_year_research_plan")

    banner_colors = {
        "CONDITIONAL_RESEARCH_COMPARISON": ("#14532d", "#dcfce7", "CONDITIONAL 5-YEAR RESEARCH COMPARISON READY (NOT FIELD-VALIDATED)"),
        "REGIONAL_SCREENING_ONLY": ("#1e3a8a", "#dbeafe", "REGIONAL CROP & WATER SCREENING READY (NOT A 5-YEAR ROTATION PLAN)"),
        "CLIMATE_READY_SOIL_PARTIAL": ("#713f12", "#fef9c3", "HISTORICAL CLIMATE READY — SOIL / CROP MODEL PARTIAL OR BLOCKED"),
        "SOIL_READY_CLIMATE_PARTIAL": ("#713f12", "#fef9c3", "REGIONAL SOIL READY — HISTORICAL CLIMATE BLOCKED / SCREENING UNAVAILABLE"),
        "WATER_OR_UNVERIFIED_LOCATION": ("#7c2d12", "#ffedd5", "NON-TERRESTRIAL WATER / COASTAL UNCERTAIN / POLAR LOCATION — AGRONOMY BLOCKED"),
        "INVALID_LOCATION_OR_GEOMETRY": ("#7f1d1d", "#fee2e2", "INVALID COORDINATES, CRS, OR SPATIAL POINT/POLYGON MISMATCH — REJECTED"),
        "EVIDENCE_BLOCKED": ("#581c87", "#f3e8ff", "EVIDENCE BLOCKED — REQUIRED AUTHENTIC INPUTS OR SOURCES UNAVAILABLE"),
    }
    fg, bg, banner_text = banner_colors.get(
        outcome, ("#1f2937", "#f3f4f6", f"STATUS: {outcome}")
    )

    # 1. What Can Be Answered Now
    usable_rows: List[str] = []
    for cid, cap in caps.items():
        if cap["status"] in ("READY", "CONDITIONAL"):
            usable_rows.append(
                f"<tr><td><strong>{html.escape(cid)}</strong></td>"
                f"<td>{html.escape(str(cap.get('name', '')))}</td>"
                f"<td><span class='badge badge-{html.escape(cap['status'].lower())}'>{html.escape(cap['status'])}</span></td>"
                f"<td>{html.escape(str(cap.get('detail', '')))}</td></tr>"
            )
    if not usable_rows:
        usable_rows.append(
            "<tr><td colspan='4'>No agricultural or climate capabilities are usable for this request.</td></tr>"
        )

    # 2. What Remains Blocked and Why
    blocked_rows: List[str] = []
    for b in ae.get("blocked_claims", []):
        blocked_rows.append(
            f"<tr><td><strong>{html.escape(str(b.get('capability_id', '')))}</strong></td>"
            f"<td>{html.escape(str(b.get('capability_name', '')))}</td>"
            f"<td><code>{html.escape(str(b.get('missing_reason', '')))}</code></td>"
            f"<td>{html.escape(str(b.get('explanation', '')))}</td></tr>"
        )
    if not blocked_rows:
        blocked_rows.append("<tr><td colspan='4'>None.</td></tr>")

    # 3. Minimal Next Measurements Needed
    next_rows: List[str] = []
    for m in ae.get("minimal_next_measurements", []):
        upgrades = ", ".join(m.get("upgrades_capabilities", []))
        next_rows.append(
            f"<tr><td>{int(m.get('priority_rank', 0))}</td>"
            f"<td><code>{html.escape(str(m.get('parameter', '')))}</code></td>"
            f"<td>{html.escape(str(m.get('measurement_action', '')))}</td>"
            f"<td>{html.escape(upgrades)}</td></tr>"
        )
    if not next_rows:
        next_rows.append("<tr><td colspan='4'>No additional measurements required for current tier.</td></tr>")

    # 4. Source & Receipt Provenance Table
    prov_rows: List[str] = []
    for ev in ae.get("provenance_and_uncertainty_ledger", {}).get("evidence_objects", []):
        prov_rows.append(
            f"<tr><td><code>{html.escape(str(ev.get('parameter_path', '')))}</code></td>"
            f"<td>{html.escape(str(ev.get('provider', '')))}</td>"
            f"<td><code>{html.escape(str(ev.get('fixture_origin', '')))}</code></td>"
            f"<td>{html.escape(str(ev.get('converted_si_value', '')))} {html.escape(str(ev.get('si_unit', '')))}</td>"
            f"<td><code>{html.escape(str(ev.get('raw_source_sha256') or ev.get('receipt_sha256') or 'N/A')[:16])}</code></td>"
            f"<td>{html.escape(str(ev.get('license', '')))}</td></tr>"
        )
    if not prov_rows:
        prov_rows.append("<tr><td colspan='6'>No external source receipts loaded (request blocked at C1 or cache miss).</td></tr>")

    # 5. Conditional 5-Year Rotation Comparison OR Regional Screening Section
    upstream_cd = envelope.get("upstream_client_decision_response")
    planning_html = ""
    if five_yr and five_yr.get("status") in ("RESEARCH_COMPARISON_COMPLETE", "CONDITIONAL_RESEARCH_COMPLETE"):
        cand_rows = []
        for c in five_yr.get("candidates", []):
            choices_str = json.dumps(c.get("five_year_choices", {}), ensure_ascii=False)
            cand_rows.append(
                f"<tr><td><code>{html.escape(str(c.get('policy_id', '')))}</code></td>"
                f"<td>{html.escape(str(c.get('origin', '')))}</td>"
                f"<td><code>{html.escape(choices_str)}</code></td></tr>"
            )
        scen_rows = []
        for s in five_yr.get("scenario_outcomes", []):
            scen_rows.append(
                f"<tr><td><code>{html.escape(str(s.get('policy_id', '')))}</code></td>"
                f"<td>{html.escape(str(s.get('scenario_id', '')))}</td>"
                f"<td>{html.escape(str(s.get('status', '')))}</td>"
                f"<td>{html.escape(str(s.get('service_pass', '')))}</td>"
                f"<td>{html.escape(str(s.get('ET_shortfall_m3_equivalent', '')))}</td>"
                f"<td>{html.escape(str(s.get('source_withdrawal_m3', '')))}</td></tr>"
            )
        dto_html = ""
        if isinstance(upstream_cd, dict):
            dto = upstream_cd.get("report_dto") or {}
            qual = upstream_cd.get("qualification") or {}
            dto_summary = json.dumps(dto.get("summary") or {}, ensure_ascii=False, indent=2)
            qual_summary = json.dumps(qual, ensure_ascii=False)
            dto_html = (
                f"<div class='notice'><strong>Authoritative Codex A ClientDecisionService Output:</strong> "
                f"Schema <code>{html.escape(str(upstream_cd.get('schema')))}</code>, "
                f"Status <code>{html.escape(str(upstream_cd.get('status')))}</code>, "
                f"Qualification: <code>{html.escape(qual_summary[:300])}</code></div>"
                f"<h3>Canonical Codex A <code>report_dto.summary</code></h3>"
                f"<pre class='dto-pre'>{html.escape(dto_summary)}</pre>"
            )
        planning_html = f"""
        <section>
          <h2>5. Conditional 5-Year Multi-Field Rotation Comparison (Research Only)</h2>
          <p class="notice"><strong>Qualification Notice:</strong> Executed by upstream Codex A engine over 5 historical years. Selected Policy IDs: <code>{html.escape(", ".join(five_yr.get("selected_policy_ids", [])))}</code>. Not a field-validated farm prescription; marketable yield and profit remain <code>null</code>.</p>
          {dto_html}
          <h3>Candidate 5-Year Policies</h3>
          <table>
            <thead><tr><th>Policy ID</th><th>Origin</th><th>5-Year Field Crop Sequence</th></tr></thead>
            <tbody>{"".join(cand_rows)}</tbody>
          </table>
          <h3>Historical Weather Scenario Outcomes</h3>
          <table>
            <thead><tr><th>Policy ID</th><th>Scenario</th><th>Status</th><th>Service Pass</th><th>ET Shortfall (m3)</th><th>Withdrawal (m3)</th></tr></thead>
            <tbody>{"".join(scen_rows)}</tbody>
          </table>
        </section>
        """
    elif caps["C7"]["status"] == "CONDITIONAL" and caps["C7"].get("diagnostics"):
        c7_diag = caps["C7"]["diagnostics"]
        rank_rows = []
        for r in c7_diag.get("candidate_ranking", []):
            rank_rows.append(
                f"<tr><td><strong>{html.escape(str(r.get('crop', '')))}</strong></td>"
                f"<td>{html.escape(str(r.get('botanical_family', '')))}</td>"
                f"<td>{html.escape(str(r.get('composite_water_adequacy_score', '')))}</td>"
                f"<td>{html.escape(str(r.get('net_deficit_ref_mm', '')))} mm</td>"
                f"<td>{html.escape(str(r.get('net_deficit_worst_mm', '')))} mm</td></tr>"
            )
        planning_html = f"""
        <section>
          <h2>5. Regional Seasonal Crop Water Suitability Screening (<code>C7_SCREENING</code>)</h2>
          <p class="notice"><strong>Important Distinction:</strong> This is a regional seasonal water-balance screening aid (<code>C7_SCREENING</code>), <strong>NOT a 5-year rotation plan or WOFOST/CP-SAT optimization</strong>. True 5-year multi-field rotation planning requires verified local soil hydraulic parameters, crop phenology calibration, and multi-field rotation constraints.</p>
          <table>
            <thead><tr><th>Candidate Crop</th><th>Botanical Family</th><th>Composite Water Adequacy Score</th><th>Reference Seasonal Deficit</th><th>Worst-Case Seasonal Deficit</th></tr></thead>
            <tbody>{"".join(rank_rows)}</tbody>
          </table>
        </section>
        """
    else:
        planning_html = """
        <section>
          <h2>5. 5-Year Rotation Comparison &amp; Crop Water Screening</h2>
          <p>Both 5-year multi-field rotation comparison and regional crop water screening are <strong>BLOCKED</strong> for this request. See Section 2 (What Remains Blocked and Why) and Section 3 (Minimal Next Measurements Needed).</p>
        </section>
        """

    pt_str = json.dumps(c1.get("point_lon_lat"))
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>ASTRAGRON Unified Research &amp; Adaptive Evidence Report — {html.escape(envelope['request_id'])}</title>
  <style>
    body {{ font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111827; margin: 24px auto; max-width: 1120px; padding: 0 16px; line-height: 1.45; }}
    header {{ border-bottom: 2px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 18px; }}
    .banner {{ background: {bg}; color: {fg}; border: 2px solid {fg}; border-radius: 6px; padding: 14px 18px; font-weight: 700; font-size: 1.05rem; margin-bottom: 20px; }}
    .meta-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin-bottom: 20px; }}
    h1 {{ font-size: 1.5rem; margin: 0 0 6px 0; }}
    h2 {{ font-size: 1.18rem; margin-top: 24px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }}
    table {{ width: 100%; border-collapse: collapse; margin: 10px 0 18px 0; font-size: 0.92rem; }}
    th, td {{ border: 1px solid #d1d5db; padding: 8px 10px; text-align: left; vertical-align: top; }}
    th {{ background: #f3f4f6; font-weight: 600; }}
    .badge {{ display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 700; }}
    .badge-ready {{ background: #dcfce7; color: #166534; }}
    .badge-conditional {{ background: #dbeafe; color: #1e40af; }}
    .badge-blocked {{ background: #fee2e2; color: #991b1b; }}
    .notice {{ background: #fffbeb; border-left: 4px solid #d97706; padding: 10px 12px; font-size: 0.92rem; }}
    .dto-pre {{ background: #f9fafb; border: 1px solid #d1d5db; padding: 10px; overflow-x: auto; }}
    @media print {{ body {{ margin: 0; max-width: 100%; }} .no-print {{ display: none; }} }}
  </style>
</head>
<body>
  <header>
    <h1>ASTRAGRON Global Adaptive Evidence &amp; Research Decision Report</h1>
    <div>Request ID: <code>{html.escape(envelope['request_id'])}</code> | Result SHA-256: <code>{html.escape(envelope['result_id'][:24])}</code></div>
  </header>

  <div class="banner" id="status-banner">
    Outcome: {html.escape(outcome)} — {html.escape(banner_text)}
  </div>

  <div class="meta-grid">
    <div><strong>Coordinates (EPSG:4326):</strong> <code>{html.escape(pt_str)}</code></div>
    <div><strong>Land Status:</strong> <code>{html.escape(str(c1.get('land_status')))}</code></div>
    <div><strong>Physical Surface:</strong> <code>{html.escape(str(c1.get('physical_surface')))}</code></div>
    <div><strong>Field Validated:</strong> <code>false</code> (Marketable Yield &amp; Profit: <code>null</code>)</div>
    <div><strong>Quality Gate Verdict:</strong> <code>{html.escape(str((envelope.get('quality_assessment') or {}).get('overall_verdict') or 'UNAVAILABLE'))}</code></div>
    <div><strong>Single Next Missing Input:</strong> <code>{html.escape(str(((envelope.get('single_next_missing_input') or {}).get('input_key')) or 'NONE'))}</code></div>
  </div>

  <section>
    <h2>1. What Can Be Answered Now (Usable &amp; Conditional Capabilities)</h2>
    <table>
      <thead><tr><th>ID</th><th>Capability</th><th>Status</th><th>Scientific Summary &amp; Scope</th></tr></thead>
      <tbody>{"".join(usable_rows)}</tbody>
    </table>
  </section>

  <section>
    <h2>2. What Remains Blocked and Why</h2>
    <table>
      <thead><tr><th>ID</th><th>Capability</th><th>Missing / Block Reason</th><th>Explanation</th></tr></thead>
      <tbody>{"".join(blocked_rows)}</tbody>
    </table>
  </section>

  <section>
    <h2>3. Minimal Next Measurements Needed</h2>
    <table>
      <thead><tr><th>Rank</th><th>Parameter</th><th>Required Measurement / Verification Action</th><th>Upgrades</th></tr></thead>
      <tbody>{"".join(next_rows)}</tbody>
    </table>
  </section>

  <section>
    <h2>4. Source &amp; Receipt Provenance Table</h2>
    <table>
      <thead><tr><th>Parameter</th><th>Provider</th><th>Origin Class</th><th>Value (SI)</th><th>SHA-256 Receipt</th><th>License</th></tr></thead>
      <tbody>{"".join(prov_rows)}</tbody>
    </table>
  </section>

  {planning_html}

  <section class="no-print">
    <h2>6. Export Formats &amp; Disclosure</h2>
    <p>Available machine-readable and printable exports: HTML (this view; use Browser Print &rarr; Save as PDF if needed), full JSON envelope (including Codex A <code>report_dto</code> when executed), and CSV capability summary. Standalone Codex B per-farm customer PDF export is <strong>UNAVAILABLE</strong> (Codex B customer PDF renderer was not supplied in this workspace).</p>
  </section>
</body>
</html>
"""


def evaluate_gate3_worldwide_12site_matrix() -> Dict[str, Any]:
    """Evaluate all 12 geographically diverse worldwide land locations for Gate III."""
    system = UnifiedAstragronSystem()
    rows: List[Dict[str, Any]] = []

    counts = {
        "total_locations_evaluated": len(GATE3_WORLDWIDE_12_SITES),
        "live_nasa_fetch_and_cached_count": 0,
        "upstream_cached_nasa_receipt_count": 0,
        "soilgrids_live_or_cached_count": 0,
        "screening_only_output_count": 0,
        "true_conditional_5y_planning_count": 0,
        "climate_ready_soil_or_crop_blocked_count": 0,
        "blocked_or_unsupported_count": 0,
        "missing_or_failed_count": 0,
    }

    for site in GATE3_WORLDWIDE_12_SITES:
        if site["five_year_example_file"]:
            ex_path = WATER_CORE_DIR / "examples" / site["five_year_example_file"]
            req_payload = json.loads(ex_path.read_text(encoding="utf-8"))
        else:
            req_payload = {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": f"gate3-{site['site_id'].lower()}",
                "location": {
                    "site_id": site["site_id"],
                    "name": site["name"],
                    "point_lon_lat": site["point_lon_lat"],
                    "crs": "EPSG:4326",
                },
                "period": {"start": "2016-01-01", "end": "2020-12-31"},
                "soil_depth_intervals_cm": [[0, 5]],
                "candidate_crops": site["candidate_crops"],
                "water_supply_scenario": site["water_supply_scenario"],
                "options": {
                    "acquisition": "CACHE_ONLY",
                    "allow_offline_reference_fixture": False,
                    "allow_conditional_crop_planning": True,
                },
            }

        env = system.evaluate_unified(req_payload)
        ae = env["adaptive_evidence"]
        caps = ae["capabilities"]
        c1 = caps["C1"]
        c2 = caps["C2"]
        c3 = caps["C3"]
        c7 = caps["C7"]
        five_yr = env.get("five_year_research_plan")

        nasa_status = (
            "LIVE_FETCHED_AND_CACHED"
            if site["nasa_cache_origin"] == "LIVE_FETCHED_AND_CACHED" and c2["status"] == "READY"
            else "CACHED_RECEIPT"
            if c2["status"] == "READY"
            else "BLOCKED"
        )
        if nasa_status == "LIVE_FETCHED_AND_CACHED":
            counts["live_nasa_fetch_and_cached_count"] += 1
        elif nasa_status == "CACHED_RECEIPT":
            counts["upstream_cached_nasa_receipt_count"] += 1

        soil_status = (
            "SOILGRIDS_LIVE_OR_CACHED"
            if c3["status"] in ("READY", "CONDITIONAL")
            else "BLOCKED"
        )
        if soil_status == "SOILGRIDS_LIVE_OR_CACHED":
            counts["soilgrids_live_or_cached_count"] += 1

        if five_yr and five_yr.get("status") == "RESEARCH_COMPARISON_COMPLETE":
            crop_planning_status = "TRUE_5Y_RESEARCH_PLAN"
            counts["true_conditional_5y_planning_count"] += 1
        elif c7["status"] == "CONDITIONAL":
            crop_planning_status = "CONDITIONAL_SCREENING"
            counts["screening_only_output_count"] += 1
        else:
            crop_planning_status = "BLOCKED"
            counts["climate_ready_soil_or_crop_blocked_count"] += 1

        c2_ev = [
            e
            for e in ae["provenance_and_uncertainty_ledger"]["evidence_objects"]
            if str(e.get("parameter_path", "")).startswith("climate.")
        ]
        nasa_sha = c2_ev[0]["raw_source_sha256"] if c2_ev else None

        rows.append(
            {
                "site_id": site["site_id"],
                "country": site["country"],
                "continent": site["continent"],
                "name": site["name"],
                "point_lon_lat": site["point_lon_lat"],
                "land_status": c1["land_status"],
                "distance_to_coast_m": c1["distance_to_coast_m"],
                "nasa_climate_status": nasa_status,
                "nasa_raw_payload_sha256": nasa_sha,
                "mean_annual_precipitation_mm": (c2.get("diagnostics") or {}).get("mean_annual_precipitation_mm"),
                "mean_temperature_c": (c2.get("diagnostics") or {}).get("mean_temperature_c"),
                "soil_status": soil_status,
                "crop_or_planning_status": crop_planning_status,
                "status_outcome": env["status_outcome"],
                "capability_statuses": env["capability_statuses"],
                "blocked_capabilities": [
                    {"capability_id": b["capability_id"], "missing_reason": b["missing_reason"]}
                    for b in ae["blocked_claims"]
                ],
                "minimal_next_measurements": ae["minimal_next_measurements"][:3],
            }
        )

    return {
        "schema": "astragron.gate3.worldwide-12site-matrix.v1",
        "summary_counts": counts,
        "locations": rows,
    }


def evaluate_gate4_five_year_and_partial_cases() -> Dict[str, Any]:
    """Execute the 3 complete 5-year research examples (Sweden, Kenya, Australia) + partial/blocked cases for Gate IV."""
    system = UnifiedAstragronSystem()
    cases_out: Dict[str, Any] = {}

    for label, fname in (
        ("sweden_5y_research", "sweden_planning.json"),
        ("kenya_5y_research", "kenya_research.json"),
        ("australia_5y_research", "australia_research.json"),
    ):
        payload = json.loads((WATER_CORE_DIR / "examples" / fname).read_text(encoding="utf-8"))
        env = system.evaluate_unified(payload)
        cases_out[label] = {
            "request_file": f"SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109/release/water_core/examples/{fname}",
            "status_outcome": env["status_outcome"],
            "five_year_research_plan": env["five_year_research_plan"],
            "capability_statuses": env["capability_statuses"],
            "scientific_guardrails": env["scientific_guardrails"],
        }

    # Partial case 1: Japan Tsukuba (Climate READY from live-cached NASA POWER, SoilGrids & Crop Model BLOCKED)
    jp_req = {
        "schema": "astragron.adaptive-evidence.request.v1",
        "request_id": "gate4-japan-climate-ready-soil-blocked",
        "location": {
            "site_id": "JP_TSUKUBA_KANTO",
            "name": "Tsukuba, Ibaraki, Japan",
            "point_lon_lat": [140.12, 36.08],
            "crs": "EPSG:4326",
        },
        "period": {"start": "2016-01-01", "end": "2020-12-31"},
        "soil_depth_intervals_cm": [[0, 5]],
        "candidate_crops": ["rice", "soybean"],
        "water_supply_scenario": {"regime": "rainfed"},
        "options": {"acquisition": "CACHE_ONLY", "allow_offline_reference_fixture": False},
    }
    jp_env = system.evaluate_unified(jp_req)
    cases_out["japan_climate_ready_soil_blocked"] = {
        "status_outcome": jp_env["status_outcome"],
        "capability_statuses": jp_env["capability_statuses"],
        "usable_outputs": jp_env["adaptive_evidence"]["usable_outputs"],
        "blocked_claims": jp_env["adaptive_evidence"]["blocked_claims"],
        "minimal_next_measurements": jp_env["adaptive_evidence"]["minimal_next_measurements"],
    }

    # Partial case 2: Germany Heilbronn with uncalibrated crop (Climate READY, Soil CONDITIONAL, Crop Model BLOCKED)
    de_req = {
        "schema": "astragron.adaptive-evidence.request.v1",
        "request_id": "gate4-germany-uncalibrated-crop-blocked",
        "location": {
            "site_id": "DE_HEILBRONN",
            "name": "Heilbronn, Germany",
            "point_lon_lat": [9.22, 49.14],
            "crs": "EPSG:4326",
        },
        "period": {"start": "2016-01-01", "end": "2020-12-31"},
        "soil_depth_intervals_cm": [[0, 5]],
        "candidate_crops": ["avocado_uncalibrated_cultivar"],
        "water_supply_scenario": {"regime": "rainfed"},
        "options": {"acquisition": "CACHE_ONLY", "allow_offline_reference_fixture": False},
    }
    de_env = system.evaluate_unified(de_req)
    cases_out["germany_climate_soil_ready_crop_blocked"] = {
        "status_outcome": de_env["status_outcome"],
        "capability_statuses": de_env["capability_statuses"],
        "usable_outputs": de_env["adaptive_evidence"]["usable_outputs"],
        "conditional_outputs": de_env["adaptive_evidence"]["conditional_outputs"],
        "blocked_claims": de_env["adaptive_evidence"]["blocked_claims"],
        "minimal_next_measurements": de_env["adaptive_evidence"]["minimal_next_measurements"],
    }

    return {
        "schema": "astragron.gate4.five-year-and-partial-cases.v1",
        "cases": cases_out,
    }


def build_final_baseline_and_ownership() -> Dict[str, Any]:
    """Build `FINAL_BASELINE_AND_OWNERSHIP.json` satisfying Gate I."""
    integrity = verify_upstream_integrity()
    lic_gate = evaluate_open_source_license_gate()
    return {
        "schema": "astragron.final-baseline-and-ownership.v1",
        "generated_at_utc": "2026-11-14T15:00:00Z",
        "workspace_root": str(ROOT),
        "git_branch": "feature/global-adaptive-evidence",
        "protected_locks_verified": {
            "passed": integrity["passed"],
            "baseline_lock_path": "coordination/BASELINE_LOCK.json",
            "baseline_lock_sha256": sha256_file(BASELINE_LOCK_PATH),
            "baseline_locked_file_count": integrity["protected_baseline_files_verified"],
            "baseline_mismatches": integrity["protected_baseline_mismatches"],
            "growth_lock_path": "coordination/GROWTH_INPUT_LOCK.json",
            "growth_lock_sha256": sha256_file(GROWTH_LOCK_PATH),
            "growth_locked_file_count": integrity["growth_input_files_verified"],
            "growth_mismatches": integrity["growth_input_mismatches"],
            "receipt_verification_mode": integrity["receipt_verification_mode"],
        },
        "subsystem_ownership": {
            "water_5y_cp_sat_and_english_ui_base": {
                "directory": "SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109/release/water_core",
                "mutation_policy": "READ_ONLY_LOCKED_UPSTREAM",
                "entry_module": "application.Service / integration_server.Handler",
            },
            "soil_memory_and_client_decision_v1": {
                "directory": "brain/ and SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109/release/soil_service.py",
                "mutation_policy": "READ_ONLY_LOCKED_UPSTREAM",
                "entry_module": "brain.service.ClientDecisionService",
            },
            "global_adaptive_evidence_and_unified_coordinator": {
                "directory": "adaptive_evidence/",
                "mutation_policy": "ACTIVE_SIDECAR_AND_UNIFIED_COORDINATOR",
                "entry_module": "adaptive_evidence.unified_system.UnifiedAstragronSystem / adaptive_evidence.unified_server",
            },
        },
        "open_source_license_status": {
            "gate_g3_status": lic_gate["status"],
            "root_project_license_status": lic_gate["owner_license_selection_status"],
            "owner_license_authorized": "BLOCKED",
        },
        "rollback_and_isolation_plan": ROLLBACK_AND_ISOLATION_PLAN,
    }
