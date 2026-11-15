"""Bridge adapter between V7 Next.js farmer workflows and Python UnifiedAstragronSystem.

Provides:
- Request translation from Next.js `AnalysisJobTriggerRequest` (with optional fields,
  geometries, candidate crops, and supply scenarios) to canonical `UnifiedAstragronSystem`
  evaluation requests without altering M1-M14 protected research fixtures.
- Truthful `status_outcome` -> `{status, failClosedStatus, dataAvailabilityClass}` mapping
  preventing false upgrades (`field_validated` stays `False`, non-Uppsala sites are never
  labeled `OK_RECORDED_RESEARCH`).
- Conversion from `UnifiedAstragronSystem` C1-C10 + NASA POWER + SoilGrids diagnostics into
  a strict schema-compliant V7 `ReportEnvelope` with chart series, plain-language sections,
  allowed citation IDs, and SHA-256 provenance receipts.
- Atomic JSON disk persistence (`PythonRuntimeStore`) so jobs, unified result envelopes, and
  farmer reports survive server restarts.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import threading
from typing import Any, Dict, List, Optional, Tuple

from .capabilities import CAPABILITY_REGISTRY
from .engine import SUPPORTED_REGIONAL_CROPS
from .inventory import ROOT, WATER_CORE_DIR

DEFAULT_PYTHON_STORE_PATH = ROOT / "data" / "runtime" / "astragron-python-store.json"

CROP_ALIAS_MAP: Dict[str, str] = {
    "winter wheat": "wheat",
    "spring wheat": "wheat",
    "wheat": "wheat",
    "spring barley": "barley",
    "winter barley": "barley",
    "barley": "barley",
    "oats": "oats",
    "oat": "oats",
    "faba bean": "faba_bean",
    "faba beans": "faba_bean",
    "faba_bean": "faba_bean",
    "broad bean": "faba_bean",
    "rapeseed": "rapeseed",
    "canola": "rapeseed",
    "oilseed rape": "rapeseed",
    "potato": "potato",
    "potatoes": "potato",
    "maize": "maize",
    "corn": "maize",
    "soybean": "soybean",
    "soybeans": "soybean",
    "sorghum": "sorghum",
    "chickpea": "chickpea",
    "chickpeas": "chickpea",
    "sunflower": "sunflower",
    "rice": "rice",
}

BENCHMARK_SITE_COORDS: Dict[str, Tuple[str, Tuple[float, float]]] = {
    "uppsala-demo": ("SE_UPPSALA", (17.6389, 59.8586)),
    "uppsala-m14": ("SE_UPPSALA", (17.6389, 59.8586)),
    "nyeri-kenya": ("KE_NYERI", (36.9476, -0.4201)),
    "wagga-australia": ("AU_WAGGA", (147.3598, -35.1082)),
    "polar-svalbard": ("SJ_SVALBARD", (15.6397, 78.2232)),
    "ocean-atlantic": ("OCEAN_NORTH_ATLANTIC", (-30.0, 45.0)),
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _normalize_crop_name(raw: Any) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    cleaned = raw.strip().lower()
    if not cleaned:
        return None
    if cleaned in CROP_ALIAS_MAP:
        return CROP_ALIAS_MAP[cleaned]
    underscored = cleaned.replace("-", "_").replace(" ", "_")
    if underscored in SUPPORTED_REGIONAL_CROPS:
        return underscored
    return underscored


def _extract_candidate_crops(body: Dict[str, Any]) -> List[str]:
    fields = body.get("fields")
    seen: List[str] = []
    if isinstance(fields, list):
        for fld in fields:
            if not isinstance(fld, dict):
                continue
            raw_list = fld.get("candidateCrops") or fld.get("cropCandidates") or []
            if isinstance(raw_list, list):
                for item in raw_list:
                    norm = _normalize_crop_name(item)
                    if norm and norm not in seen:
                        seen.append(norm)
    top_crops = body.get("candidateCrops")
    if isinstance(top_crops, list):
        for item in top_crops:
            norm = _normalize_crop_name(item)
            if norm and norm not in seen:
                seen.append(norm)
    return seen if seen else ["wheat", "barley", "chickpea"]


def _extract_total_area_ha(body: Dict[str, Any]) -> Optional[float]:
    explicit = body.get("totalAreaHa")
    if isinstance(explicit, (int, float)) and not isinstance(explicit, bool) and math.isfinite(explicit) and explicit >= 0:
        return round(float(explicit), 2)
    fields = body.get("fields")
    if not isinstance(fields, list) or not fields:
        return None
    total = 0.0
    found = False
    for fld in fields:
        if not isinstance(fld, dict):
            continue
        area = fld.get("declaredAreaHa")
        if area is None:
            area = fld.get("areaHa")
        if isinstance(area, (int, float)) and not isinstance(area, bool) and math.isfinite(area) and area >= 0:
            total += float(area)
            found = True
    return round(total, 2) if found else None


def _is_unmodified_uppsala_benchmark(body: Dict[str, Any]) -> bool:
    farm_id = str(body.get("farmId") or "").strip()
    if farm_id not in ("uppsala-demo", "uppsala-m14"):
        return False
    if bool(body.get("inputsModified")) or bool(body.get("isUserCreatedDraft")):
        return False
    coords = body.get("coordinates")
    if not isinstance(coords, list) or len(coords) != 2:
        return False
    try:
        lon, lat = float(coords[0]), float(coords[1])
    except (TypeError, ValueError):
        return False
    if abs(lon - 17.6389) > 1e-6 or abs(lat - 59.8586) > 1e-6:
        return False
    field_count = body.get("fieldCount")
    if field_count is not None and field_count != 3:
        return False
    return True


def _resolve_acquisition_mode(body: Dict[str, Any]) -> str:
    if os.environ.get("ASTRAGRON_OFFLINE_ONLY") == "1":
        return "CACHE_ONLY"
    requested = str(body.get("acquisitionMode") or "").strip().upper()
    if requested in ("CACHE_ONLY", "FETCH_ALLOWED"):
        return requested
    # Default to FETCH_ALLOWED when live scientific backend executes so new sites
    # attempt verified NASA POWER / SoilGrids retrieval cleanly.
    return "FETCH_ALLOWED"


def translate_nextjs_analysis_request(body: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
    """Translate Next.js `AnalysisJobTriggerRequest` into an `UnifiedAstragronSystem` payload.

    Returns `(unified_payload, is_unmodified_uppsala)`.
    """
    if not isinstance(body, dict):
        raise ValueError("Analysis request body must be a JSON object.")

    farm_id = str(body.get("farmId") or "").strip()
    input_revision = str(body.get("inputRevision") or "").strip()
    coords = body.get("coordinates")
    if not farm_id or not input_revision or not isinstance(coords, list) or len(coords) != 2:
        raise ValueError("Missing required farmId, inputRevision, or [longitude, latitude] coordinates.")

    is_unmodified_uppsala = _is_unmodified_uppsala_benchmark(body)
    if is_unmodified_uppsala:
        sweden_path = WATER_CORE_DIR / "examples" / "sweden_planning.json"
        if sweden_path.is_file():
            sweden_payload = json.loads(sweden_path.read_text(encoding="utf-8"))
            sweden_payload["request_id"] = f"ui-{farm_id}-{input_revision[:12]}"
            opts = dict(sweden_payload.get("options") or {})
            opts.setdefault("acquisition", "CACHE_ONLY")
            opts["allow_conditional_crop_planning"] = True
            sweden_payload["options"] = opts
            return sweden_payload, True

    bench_entry = BENCHMARK_SITE_COORDS.get(farm_id) if not body.get("inputsModified") else None
    site_id = bench_entry[0] if bench_entry else f"UI_{farm_id.upper()}"
    location_name = str(body.get("locationLabel") or body.get("farmName") or farm_id).strip() or farm_id

    fields = body.get("fields")
    first_geometry: Optional[Dict[str, Any]] = None
    translated_fields: List[Dict[str, Any]] = []
    water_regime = "rainfed"

    if isinstance(fields, list):
        for idx, fld in enumerate(fields):
            if not isinstance(fld, dict):
                continue
            geom = fld.get("geometry")
            if (
                isinstance(geom, dict)
                and geom.get("type") in ("Polygon", "MultiPolygon", "Point")
                and isinstance(geom.get("coordinates"), list)
            ):
                if first_geometry is None and geom.get("type") in ("Polygon", "MultiPolygon"):
                    first_geometry = geom
                translated_fields.append(
                    {
                        "field_id": str(fld.get("id") or f"F{idx + 1}"),
                        "geometry": geom,
                    }
                )
            if bool(fld.get("irrigationAccess")):
                water_regime = "supplemental"

    # Allow top-level optional geometry fallback if fields omitted it
    if first_geometry is None:
        top_geom = body.get("geometry")
        if (
            isinstance(top_geom, dict)
            and top_geom.get("type") in ("Polygon", "MultiPolygon")
            and isinstance(top_geom.get("coordinates"), list)
        ):
            first_geometry = top_geom

    location_obj: Dict[str, Any] = {
        "site_id": site_id,
        "name": location_name,
        "point_lon_lat": [coords[0], coords[1]],
        "crs": "EPSG:4326",
    }
    if first_geometry is not None:
        location_obj["geometry"] = first_geometry

    req_payload: Dict[str, Any] = {
        "schema": "astragron.adaptive-evidence.request.v1",
        "request_id": f"ui-{farm_id}-{input_revision[:12]}",
        "location": location_obj,
        "period": {"start": "2016-01-01", "end": "2020-12-31"},
        "soil_depth_intervals_cm": body.get("soilDepthIntervalsCm") or [[0, 5]],
        "candidate_crops": _extract_candidate_crops(body),
        "water_supply_scenario": {"regime": water_regime},
        "options": {
            "acquisition": _resolve_acquisition_mode(body),
            "allow_offline_reference_fixture": False,
            "allow_conditional_crop_planning": False,
        },
    }
    if translated_fields:
        req_payload["fields"] = translated_fields

    return req_payload, False


def map_outcome_to_job_state(
    status_outcome: str,
    *,
    is_unmodified_uppsala: bool,
) -> Dict[str, str]:
    """Map Python `status_outcome` truthfully into Next.js job & report statuses.

    Never upgrades partial or regional screening into field-validated advice, and
    never labels non-Uppsala results as `OK_RECORDED_RESEARCH`.
    """
    if status_outcome == "CONDITIONAL_RESEARCH_COMPARISON":
        if is_unmodified_uppsala:
            return {
                "job_status": "ABSTAINED",
                "fail_closed_status": "OK_RECORDED_RESEARCH",
                "data_availability_class": "VERIFIED_RECORDED_CORPUS",
                "current_stage": "Multi-year research comparison ready (zero universal pass)",
                "headline_status": "Recorded Uppsala 5-year research archive — conditional comparison only (recommendation blocked)",
                "recommendation_notice": "No tested 5-year rotation qualified under every dry/normal/wet weather scenario. Research comparison metrics are preserved without issuing a farm prescription (field_validated = false).",
            }
        return {
            "job_status": "ABSTAINED",
            "fail_closed_status": "MODEL_UNQUALIFIED",
            "data_availability_class": "COVERAGE_ONLY",
            "current_stage": "Conditional multi-year research comparison (not field-validated)",
            "headline_status": "Conditional multi-year screening finished — not field-validated for agronomic prescription",
            "recommendation_notice": "Conditional scenario outputs cannot substitute for local agronomic calibration or verified soil/fertility testing (field_validated = false).",
        }

    if status_outcome == "REGIONAL_SCREENING_ONLY":
        return {
            "job_status": "COMPLETED_LIMITED",
            "fail_closed_status": "OK_COVERAGE_ONLY",
            "data_availability_class": "COVERAGE_ONLY",
            "current_stage": "Regional climate, SoilGrids, & crop-water screening ready",
            "headline_status": "Regional NASA POWER & SoilGrids water screening ready — 5-year farm optimization uncalibrated",
            "recommendation_notice": "Regional satellite climate (NASA POWER) and 250 m SoilGrids uncertainty ranges are grounded for screening. Multi-year field optimization, yield prediction, and fertilizer dosing remain blocked (field_validated = false).",
        }

    if status_outcome == "CLIMATE_READY_SOIL_PARTIAL":
        return {
            "job_status": "COMPLETED_LIMITED",
            "fail_closed_status": "OK_COVERAGE_ONLY",
            "data_availability_class": "COVERAGE_ONLY",
            "current_stage": "Historical NASA POWER climate ready; soil or crop layers partial/blocked",
            "headline_status": "Historical NASA POWER climate ready — soil or crop layers unavailable for screening",
            "recommendation_notice": "Verified multi-year NASA POWER climate observations are included, while SoilGrids/soil hydraulics or crop calibration failed closed without gap-filling (field_validated = false).",
        }

    if status_outcome == "SOIL_READY_CLIMATE_PARTIAL":
        return {
            "job_status": "COMPLETED_LIMITED",
            "fail_closed_status": "OK_COVERAGE_ONLY",
            "data_availability_class": "COVERAGE_ONLY",
            "current_stage": "Regional SoilGrids characterization ready; historical climate blocked",
            "headline_status": "Regional SoilGrids 250 m soil properties ready — historical climate unavailable",
            "recommendation_notice": "ISRIC SoilGrids regional quantiles are reported with depth uncertainty, while NASA POWER climate retrieval was blocked or unavailable (field_validated = false).",
        }

    if status_outcome == "WATER_OR_UNVERIFIED_LOCATION":
        return {
            "job_status": "UNAVAILABLE",
            "fail_closed_status": "MODEL_UNQUALIFIED",
            "data_availability_class": "OUT_OF_COVERAGE",
            "current_stage": "Blocked at terrestrial land-surface gate (water/polar/coast)",
            "headline_status": "Non-terrestrial water, polar cryosphere, or coastal boundary — agricultural analysis blocked",
            "recommendation_notice": "Natural Earth land-mask validation classified this location outside verifiable terrestrial cropland. No climate or agronomic screening is permitted.",
        }

    if status_outcome == "EVIDENCE_BLOCKED":
        return {
            "job_status": "UNAVAILABLE",
            "fail_closed_status": "NO_EVIDENCE_FOR_SITE",
            "data_availability_class": "OUT_OF_COVERAGE",
            "current_stage": "Evidence sources unavailable in current cache/network mode",
            "headline_status": "Required NASA POWER & SoilGrids evidence unavailable — failed closed cleanly",
            "recommendation_notice": "Authentic Earth-observation evidence could not be retrieved or verified for this location in the active acquisition mode. Zero synthetic fallback numbers were substituted.",
        }

    return {
        "job_status": "FAILED",
        "fail_closed_status": "SOURCE_NOT_PROVIDED",
        "data_availability_class": "OUT_OF_COVERAGE",
        "current_stage": "Invalid coordinates, CRS, or spatial point/polygon mismatch",
        "headline_status": "Location, CRS, or field polygon rejected by spatial integrity gate",
        "recommendation_notice": "Coordinates, coordinate reference system, or field parcel geometry failed strict WGS84 validation. Check field boundaries and retry.",
    }


def _map_capability_to_coverage_status(cap_status: str, missing_reason: Optional[str]) -> str:
    if cap_status == "READY":
        return "AVAILABLE"
    if cap_status == "CONDITIONAL":
        return "CONDITIONAL"
    if missing_reason in ("non_land_location", "out_of_coverage", "polar_or_unverified_coast", "spatial_mismatch", "invalid_coordinates_or_crs"):
        return "OUT_OF_COVERAGE"
    if missing_reason in ("source_outage", "offline_cache_miss"):
        return "TEMPORARILY_UNAVAILABLE"
    return "INSUFFICIENT_EVIDENCE"


def _build_source_coverages_summary(ae_resp: Dict[str, Any]) -> List[Dict[str, str]]:
    caps = ae_resp.get("capabilities") or {}
    c1 = caps.get("C1") or {}
    c2 = caps.get("C2") or {}
    c3 = caps.get("C3") or {}
    c4 = caps.get("C4") or {}
    c5 = caps.get("C5") or {}
    c6 = caps.get("C6") or {}
    c8 = caps.get("C8") or {}

    return [
        {
            "sourceId": "NATURAL_EARTH_10M_LAND",
            "title": "Natural Earth 1:10M Land & Geometry Gate (C1)",
            "status": _map_capability_to_coverage_status(str(c1.get("status", "BLOCKED")), c1.get("missing_reason")),
            "coverageKind": str(c1.get("land_status") or "LAND_MASK"),
            "resolution": "1:10M global vector (WGS84)",
        },
        {
            "sourceId": "NASA_POWER_DAILY_AGRO",
            "title": "NASA POWER Historical Daily Climate (C2)",
            "status": _map_capability_to_coverage_status(str(c2.get("status", "BLOCKED")), c2.get("missing_reason")),
            "coverageKind": str(c2.get("evidence_level") or c2.get("fixture_origin") or "CLIMATOLOGY"),
            "resolution": "0.5 deg grid (~50 km), daily",
        },
        {
            "sourceId": "ISRIC_SOILGRIDS_250M",
            "title": "ISRIC SoilGrids v2.0 Regional Soil & Hydraulics (C3/C4)",
            "status": _map_capability_to_coverage_status(str(c3.get("status", "BLOCKED")), c3.get("missing_reason")),
            "coverageKind": str(c4.get("evidence_level") or c3.get("evidence_level") or "REGIONAL_ESTIMATE"),
            "resolution": "250 m pixel quantiles (Q05/Q50/Q95)",
        },
        {
            "sourceId": "FAO_GAEZ_SUITABILITY",
            "title": "FAO GAEZ Crop Suitability Gate (C5)",
            "status": _map_capability_to_coverage_status(str(c5.get("status", "BLOCKED")), c5.get("missing_reason")),
            "coverageKind": "LICENSE_AND_LAYER_GATED",
            "resolution": "30 arc-sec (~1 km) when licensed",
        },
        {
            "sourceId": "FAO56_CROP_WATER_BALANCE",
            "title": "Seasonal Crop-Water Balance Screening (C6/C7)",
            "status": _map_capability_to_coverage_status(str(c6.get("status", "BLOCKED")), c6.get("missing_reason")),
            "coverageKind": "SCREENING_ONLY_NOT_PRESCRIPTION",
            "resolution": "Farm parcel + regional grid",
        },
        {
            "sourceId": "PROCESS_GROWTH_CALIBRATION",
            "title": "On-Farm Soil Lab, Yield & Regulatory Gate (C8-C10)",
            "status": _map_capability_to_coverage_status(str(c8.get("status", "BLOCKED")), c8.get("missing_reason")),
            "coverageKind": "FIELD_VALIDATION_REQUIRED",
            "resolution": "Site-specific measurements required",
        },
    ]


def _build_charts(ae_resp: Dict[str, Any], unified_env: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    caps = ae_resp.get("capabilities") or {}
    c2 = caps.get("C2") or {}
    c6 = caps.get("C6") or {}

    water_chart: List[Dict[str, Any]] = []
    c6_diag = c6.get("diagnostics") or {}
    crop_screenings = c6_diag.get("crop_screenings") if isinstance(c6_diag, dict) else None
    if isinstance(crop_screenings, dict) and crop_screenings:
        for crop_name, stats in list(crop_screenings.items())[:5]:
            if not isinstance(stats, dict):
                continue
            ref_def = stats.get("net_deficit_ref_mm")
            worst_def = stats.get("net_deficit_worst_mm")
            if isinstance(ref_def, (int, float)) and math.isfinite(ref_def):
                water_chart.append(
                    {
                        "label": f"{crop_name} (Ref)",
                        "value": round(float(ref_def), 1),
                        "unit": "mm",
                        "statusTag": "SCREENING_REF",
                    }
                )
            if isinstance(worst_def, (int, float)) and math.isfinite(worst_def) and len(water_chart) < 6:
                water_chart.append(
                    {
                        "label": f"{crop_name} (Dry)",
                        "value": round(float(worst_def), 1),
                        "unit": "mm",
                        "statusTag": "SCREENING_WORST",
                    }
                )
    if not water_chart and c2.get("status") in ("READY", "CONDITIONAL"):
        c2_diag = c2.get("diagnostics") or {}
        mean_p = c2_diag.get("mean_annual_precipitation_mm")
        dry_p = c2_diag.get("driest_year_precipitation_mm")
        et0 = c2_diag.get("conditional_hs_et0_mm_year")
        if isinstance(mean_p, (int, float)) and math.isfinite(mean_p):
            water_chart.append({"label": "Mean Precip", "value": round(float(mean_p), 1), "unit": "mm/yr", "statusTag": "NASA_POWER"})
        if isinstance(dry_p, (int, float)) and math.isfinite(dry_p):
            water_chart.append({"label": "Driest Precip", "value": round(float(dry_p), 1), "unit": "mm/yr", "statusTag": "NASA_POWER"})
        if isinstance(et0, (int, float)) and math.isfinite(et0):
            water_chart.append({"label": "Hargreaves ET0", "value": round(float(et0), 1), "unit": "mm/yr", "statusTag": "DERIVED_HS_ET0"})

    # Source / Capability Readiness Bar Chart: green (0), amber (1), red (2) aligned with FarmerReportCharts colors
    statuses = list((ae_resp.get("capability_statuses") or {}).values())
    ready_count = sum(1 for s in statuses if s == "READY")
    cond_count = sum(1 for s in statuses if s == "CONDITIONAL")
    blocked_count = sum(1 for s in statuses if s == "BLOCKED")

    source_chart = [
        {"label": "Ready Capabilities (C1-C10)", "value": ready_count, "unit": "checks", "statusTag": "READY"},
        {"label": "Conditional / Regional", "value": cond_count, "unit": "checks", "statusTag": "CONDITIONAL"},
        {"label": "Blocked / Uncalibrated", "value": blocked_count, "unit": "checks", "statusTag": "BLOCKED"},
    ]

    return water_chart, source_chart


def build_farmer_report_envelope(
    req_body: Dict[str, Any],
    unified_env: Dict[str, Any],
    *,
    job_id: str,
    is_unmodified_uppsala: bool,
) -> Tuple[Dict[str, Any], List[str], Dict[str, Any]]:
    """Build schema-valid V7 `ReportEnvelope`, `allowedCitationIds`, and grounded `evidenceFacts`."""
    ae = unified_env["adaptive_evidence"]
    caps = ae.get("capabilities") or {}
    c1 = caps.get("C1") or {}
    c2 = caps.get("C2") or {}
    c3 = caps.get("C3") or {}
    c4 = caps.get("C4") or {}
    c7 = caps.get("C7") or {}

    outcome = str(unified_env.get("status_outcome") or "EVIDENCE_BLOCKED")
    mapped = map_outcome_to_job_state(outcome, is_unmodified_uppsala=is_unmodified_uppsala)

    farm_id = str(req_body.get("farmId") or "custom-farm").strip()
    farm_name = str(req_body.get("farmName") or farm_id).strip() or farm_id
    location_label = str(req_body.get("locationLabel") or farm_name).strip() or farm_name
    coords = req_body.get("coordinates") or [0.0, 0.0]
    input_rev = str(req_body.get("inputRevision") or "rev-unknown").strip()
    dataset_mode = str(req_body.get("datasetMode") or "REAL_SCIENTIFIC_BACKEND")
    if dataset_mode not in ("SYNTHETIC_UI_DEMO", "RECORDED_M14_RESEARCH", "REAL_SCIENTIFIC_BACKEND"):
        dataset_mode = "REAL_SCIENTIFIC_BACKEND"
    field_count = int(req_body.get("fieldCount") or 0)
    total_area_ha = _extract_total_area_ha(req_body)
    result_id = str(unified_env.get("result_id") or hashlib.sha256(job_id.encode("utf-8")).hexdigest())
    created_at = _utc_now_iso()

    report_id_seed = f"{farm_id}:{input_rev}:{result_id[:16]}:{dataset_mode}"
    report_digest = hashlib.sha256(report_id_seed.encode("utf-8")).hexdigest()[:12]
    safe_slug = "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in farm_id)[:24] or "farm"
    report_id = f"rep-{safe_slug}-{report_digest}"

    summary_findings: List[str] = [
        f"Unified scientific outcome: {outcome} (Result SHA-256 {result_id[:16]}).",
    ]
    five_yr = unified_env.get("five_year_research_plan")
    if isinstance(five_yr, dict) and five_yr.get("status") in ("RESEARCH_COMPARISON_COMPLETE", "CONDITIONAL_RESEARCH_COMPLETE"):
        cand_n = len(five_yr.get("candidates") or [])
        scen_n = len(five_yr.get("scenario_outcomes") or [])
        summary_findings.append(
            f"Evaluated {cand_n} multi-year rotation candidates across {scen_n} recorded hydrological scenarios (0 universally field-qualified)."
        )
    elif c7.get("status") == "CONDITIONAL" and isinstance(c7.get("diagnostics"), dict):
        ranking = c7["diagnostics"].get("candidate_ranking") or []
        if ranking:
            top = ranking[0]
            summary_findings.append(
                f"Regional seasonal water screening ranked {top.get('crop')} highest on water adequacy score ({top.get('composite_water_adequacy_score')}, reference deficit {top.get('net_deficit_ref_mm')} mm)."
            )

    if c2.get("status") in ("READY", "CONDITIONAL") and isinstance(c2.get("diagnostics"), dict):
        d2 = c2["diagnostics"]
        summary_findings.append(
            f"NASA POWER climate ({d2.get('year_count', '?')} yr): mean annual precip {d2.get('mean_annual_precipitation_mm')} mm, Hargreaves ET0 {d2.get('conditional_hs_et0_mm_year')} mm/yr."
        )

    what_we_know: List[str] = [
        f"Location anchored at WGS84 [{float(coords[0]):.4f}, {float(coords[1]):.4f}] (Land status: {c1.get('land_status', 'UNKNOWN')})."
    ]
    for cid in ("C1", "C2", "C3", "C4", "C5", "C6", "C7"):
        cap_item = caps.get(cid)
        if isinstance(cap_item, dict) and cap_item.get("status") in ("READY", "CONDITIONAL"):
            detail_txt = str(cap_item.get("detail") or cap_item.get("name") or "").strip()
            if detail_txt:
                tag = "Conditional" if cap_item.get("status") == "CONDITIONAL" else "Ready"
                what_we_know.append(f"[{cid} {tag}] {detail_txt}")
    if len(what_we_know) == 1:
        what_we_know.append(str(c1.get("detail") or "Location gate evaluated without fabrications."))

    what_we_dont_know: List[str] = [
        "Field validation status is false: marketable yield and farm profit remain null without on-farm trials.",
    ]
    for blk in ae.get("blocked_claims") or []:
        cid = blk.get("capability_id")
        reason = blk.get("missing_reason")
        expl = blk.get("explanation")
        what_we_dont_know.append(f"[{cid} · {reason}] {expl}")

    what_happens_next: List[str] = []
    for nxt in ae.get("minimal_next_measurements") or []:
        what_happens_next.append(
            f"Priority {nxt.get('priority_rank', 1)} ({nxt.get('parameter')}): {nxt.get('measurement_action')}"
        )
    if not what_happens_next:
        what_happens_next.append("Download the verified PDF report or update parcel boundaries / crop inputs on the farm map.")

    water_chart, source_chart = _build_charts(ae, unified_env)
    coverages = _build_source_coverages_summary(ae)

    cap_summary = ", ".join(f"{cid}={st}" for cid, st in (ae.get("capability_statuses") or {}).items())
    qa = unified_env.get("quality_assessment") or {}
    scientific_notes: List[str] = [
        f"Capability Matrix: {cap_summary}",
        f"Evidence Quality Gate: {qa.get('overall_verdict', 'UNAVAILABLE')} | Evidence levels: {', '.join(qa.get('evidence_levels_observed') or []) or 'NONE'}",
        f"Fail-closed job status: {mapped['fail_closed_status']} | Unified status_outcome: {outcome}",
    ]

    allowed_citation_ids: List[str] = [
        f"RESULT_{result_id[:16].upper()}",
        "NATURAL_EARTH_10M_LAND",
    ]
    for ev in (ae.get("provenance_and_uncertainty_ledger") or {}).get("evidence_objects") or []:
        prov = str(ev.get("provider") or "").strip()
        sha = str(ev.get("raw_source_sha256") or ev.get("receipt_sha256") or "")[:12]
        param = str(ev.get("parameter_path") or "").strip()
        if prov:
            scientific_notes.append(
                f"Source Receipt [{prov}] {param}: {ev.get('converted_si_value')} {ev.get('si_unit')} "
                f"(origin={ev.get('fixture_origin')}, sha256={sha or 'N/A'}, license={ev.get('license')})"
            )
        if sha:
            allowed_citation_ids.append(f"RECEIPT_{sha.upper()}")

    if c4.get("status") in ("READY", "CONDITIONAL") and isinstance(c4.get("diagnostics"), dict):
        scens = c4["diagnostics"].get("scenarios") or {}
        ref_awc = (scens.get("REFERENCE") or {}).get("awc_mm_m")
        if ref_awc is not None:
            summary_findings.append(
                f"Regional SoilGrids 250 m texture estimate yields reference available water capacity ~{ref_awc} mm/m (pedotransfer uncertainty bounds preserved)."
            )

    field_geometries: List[Dict[str, Any]] = []
    if isinstance(req_body.get("fields"), list):
        for idx, fld in enumerate(req_body["fields"]):
            if not isinstance(fld, dict):
                continue
            field_geometries.append(
                {
                    "id": str(fld.get("id") or f"field-{idx + 1}"),
                    "label": str(fld.get("label") or f"Field {idx + 1}"),
                    "geometry": fld.get("geometry") if isinstance(fld.get("geometry"), dict) else None,
                    "geometrySource": fld.get("geometrySource"),
                    "areaHa": fld.get("declaredAreaHa") if isinstance(fld.get("declaredAreaHa"), (int, float)) else None,
                    "perimeterMeters": fld.get("perimeterMeters") if isinstance(fld.get("perimeterMeters"), (int, float)) else None,
                }
            )

    raw_envelope: Dict[str, Any] = {
        "reportId": report_id,
        "farmId": farm_id,
        "farmName": farm_name,
        "locationLabel": location_label,
        "coordinates": [float(coords[0]), float(coords[1])],
        "totalAreaHa": total_area_ha,
        "fieldCount": field_count,
        "inputRevision": input_rev,
        "corpusVersion": f"unified-ae-{result_id[:12]}",
        "datasetMode": dataset_mode,
        "analysisJobId": job_id,
        "createdAt": created_at,
        "dataAvailabilityClass": mapped["data_availability_class"],
        "headlineStatus": mapped["headline_status"],
        "recommendationNotice": mapped["recommendation_notice"],
        "summaryFindings": summary_findings,
        "whatWeKnow": what_we_know,
        "whatWeDontKnow": what_we_dont_know,
        "whatHappensNext": what_happens_next,
        "sourceCoveragesSummary": coverages,
        "waterBalanceChart": water_chart,
        "sourceReadinessChart": source_chart,
        "scientificNotes": scientific_notes,
        "fieldGeometries": field_geometries,
        "provenanceFooter": (
            f"ASTRAGRON Unified Scientific Engine | Outcome={outcome} | FailClosed={mapped['fail_closed_status']} | "
            f"Site={farm_id} | InputRev={input_rev} | ResultSHA={result_id[:16]}"
        ),
    }

    content_hash = hashlib.sha256(
        json.dumps(raw_envelope, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    raw_envelope["contentHash"] = content_hash

    evidence_facts = {
        "resultId": result_id,
        "statusOutcome": outcome,
        "failClosedStatus": mapped["fail_closed_status"],
        "capabilityStatuses": ae.get("capability_statuses"),
        "fieldValidated": False,
        "marketableYield": None,
        "profit": None,
        "summaryFindings": summary_findings,
        "whatWeDontKnow": what_we_dont_know,
    }
    return raw_envelope, list(dict.fromkeys(allowed_citation_ids)), evidence_facts


class PythonRuntimeStore:
    """Thread-safe, disk-persisted runtime store for jobs, reports, farms, and unified envelopes."""

    def __init__(self, store_path: Optional[Path] = None) -> None:
        env_path = os.environ.get("ASTRAGRON_PYTHON_STORE_PATH", "").strip()
        self.store_path = Path(store_path or (Path(env_path) if env_path else DEFAULT_PYTHON_STORE_PATH))
        self._lock = threading.Lock()
        self._state: Dict[str, Any] = {
            "schema": "astragron.python-runtime-store.v1",
            "jobs": {},
            "reports": {},
            "farms": {},
            "envelopes": {},
        }
        self._load()

    def _load(self) -> None:
        with self._lock:
            if not self.store_path.is_file():
                return
            try:
                loaded = json.loads(self.store_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    for key in ("jobs", "reports", "farms", "envelopes"):
                        if isinstance(loaded.get(key), dict):
                            self._state[key] = loaded[key]
            except Exception:
                pass

    def _flush(self) -> None:
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.store_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(self._state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(tmp_path, self.store_path)

    def find_reusable_job(
        self, farm_id: str, input_revision: str, dataset_mode: str, acquisition_mode: str
    ) -> Optional[Dict[str, Any]]:
        with self._lock:
            for job in reversed(list(self._state["jobs"].values())):
                if (
                    job.get("farmId") == farm_id
                    and job.get("inputRevision") == input_revision
                    and job.get("datasetMode") == dataset_mode
                    and job.get("acquisitionMode") == acquisition_mode
                    and job.get("status") in ("COMPLETED_VERIFIED", "COMPLETED_LIMITED", "ABSTAINED")
                ):
                    return deepcopy(job)
            return None

    def save_analysis_outcome(
        self,
        job_payload: Dict[str, Any],
        report_envelope: Dict[str, Any],
        unified_envelope: Dict[str, Any],
    ) -> None:
        with self._lock:
            self._state["jobs"][job_payload["jobId"]] = deepcopy(job_payload)
            self._state["reports"][report_envelope["reportId"]] = deepcopy(report_envelope)
            res_id = str(unified_envelope.get("result_id") or "")
            if res_id:
                self._state["envelopes"][res_id] = deepcopy(unified_envelope)
            # Keep bounded store size
            for bucket, limit in (("jobs", 200), ("reports", 200), ("envelopes", 100)):
                keys = list(self._state[bucket].keys())
                if len(keys) > limit:
                    for old_k in keys[: len(keys) - limit]:
                        del self._state[bucket][old_k]
            self._flush()

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            job = self._state["jobs"].get(job_id)
            return deepcopy(job) if isinstance(job, dict) else None

    def cancel_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            job = self._state["jobs"].get(job_id)
            if not isinstance(job, dict):
                return None
            if job.get("status") in ("QUEUED", "RUNNING", "COMPLETED_LIMITED"):
                job["status"] = "CANCELLED"
                job["updatedAt"] = _utc_now_iso()
                job["completedAt"] = job["updatedAt"]
                job["currentStage"] = "Cancelled by user"
                job["message"] = "Analysis run was cancelled."
                self._flush()
            return deepcopy(job)

    def get_report(self, report_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            rep = self._state["reports"].get(report_id)
            return deepcopy(rep) if isinstance(rep, dict) else None

    def list_reports(self, farm_id: Optional[str] = None) -> List[Dict[str, Any]]:
        with self._lock:
            reps = list(self._state["reports"].values())
            if farm_id:
                reps = [r for r in reps if r.get("farmId") == farm_id]
            return deepcopy(list(reversed(reps)))

    def save_farm(self, farm_draft: Dict[str, Any]) -> Dict[str, Any]:
        farm_id = str(farm_draft.get("id") or "").strip()
        if not farm_id:
            raise ValueError("Farm draft requires a non-empty id.")
        with self._lock:
            self._state["farms"][farm_id] = deepcopy(farm_draft)
            self._flush()
            return deepcopy(farm_draft)

    def list_farms(self) -> Dict[str, Any]:
        with self._lock:
            return deepcopy(self._state["farms"])

    def hydrate_unified_system(self, unified_system: Any) -> None:
        """Restore persisted unified result envelopes into `unified_system._session_results`."""
        with self._lock:
            for res_id, env in self._state["envelopes"].items():
                if isinstance(res_id, str) and isinstance(env, dict):
                    unified_system._session_results[res_id] = deepcopy(env)
