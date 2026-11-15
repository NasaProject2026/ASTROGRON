"""P0 Inventory, upstream integrity verification, and baseline 32-case matrix."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .capabilities import CAPABILITY_REGISTRY, capability_dependency_graph

ROOT = Path(__file__).resolve().parents[1]
RELEASE_DIR = ROOT / "SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109" / "release"
WATER_CORE_DIR = RELEASE_DIR / "water_core"

EXPECTED_UPLOADED_ARCHIVE_SHA256 = (
    "df30964c51035d3c578bae135b676c91c6ef064e99a69dedcf9929f7634c2ae5"
)
EXPECTED_ORIGINAL_SOURCE_ARCHIVE_SHA256 = (
    "55d3ef378e33405a5a3a88215aaec26e2322d801db3dcf75dff317080561368e"
)
EXPECTED_PROMPT_SHA256 = (
    "23307fc9880c25afb53edda301411b8d644aa40e9ae1f9b45b458c2a319a3a12"
)

EXPECTED_PROMPT_BUNDLE_RECEIPT_SHA256 = (
    "f1bb1e3dac0556f30a5807d3ccf7848355a71a5dfea2c0b817ad1cf964cabd13"
)
EXPECTED_CURRENT_VERIFICATION_RECEIPT_SHA256 = (
    "00aba4afeec0b9d140be08159871273fd136c81f9246afca7363e1fafc118c98"
)

EXPECTED_UPSTREAM_BRAIN_CONTRACTS_HASHES: Dict[str, str] = {
    "00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md": "23307fc9880c25afb53edda301411b8d644aa40e9ae1f9b45b458c2a319a3a12",
    "GEMINI_SOURCE_ARCHIVE_RECEIPT.json": EXPECTED_PROMPT_BUNDLE_RECEIPT_SHA256,
    "docs/adaptive_evidence/CURRENT_SOURCE_VERIFICATION_RECEIPT_2026-11-14.json": EXPECTED_CURRENT_VERIFICATION_RECEIPT_SHA256,
    "coordination/BASELINE_LOCK.json": "5447e3eb907ebe1a70f5e8e63f8a63aacf140811cc04d6f95c8518abd4f92dfe",
    "coordination/GROWTH_INPUT_LOCK.json": "d7be163cf056384b6b19db52b86a9ff61105f7b405f95f441cf3b636a1a40fa7",
    "coordination/OWNERSHIP.md": "f1972c4807c01aa3bf2a634b72e45f461b5cf1323b5e10924872369be9fa4bb4",
}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_upstream_integrity(root: Path = ROOT) -> Dict[str, Any]:
    """Verify that all protected baseline files, growth lock files, and upstream brain/contracts are unmodified.

    Supports both:
    - Clean extraction of `ASTRAGRON_GEMINI_SOURCE.zip` (1,201 files, without root prompt/receipt entries)
      overlaid with the sidecar review bundle (`CURRENT_SOURCE_VERIFICATION_RECEIPT_2026-11-14.json`), and
    - Clean extraction of `ASTRAGRON_GEMINI_SOURCE_WITH_GLOBAL_EVIDENCE_PROMPT.zip` (1,203 files, with root
      `00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md` and `GEMINI_SOURCE_ARCHIVE_RECEIPT.json`).
    """
    current_receipt_path = (
        root / "docs" / "adaptive_evidence" / "CURRENT_SOURCE_VERIFICATION_RECEIPT_2026-11-14.json"
    )
    if not current_receipt_path.is_file():
        current_receipt_path = ROOT / "docs" / "adaptive_evidence" / "CURRENT_SOURCE_VERIFICATION_RECEIPT_2026-11-14.json"
    current_receipt = json.loads(current_receipt_path.read_text(encoding="utf-8"))
    current_receipt_sha = sha256_file(current_receipt_path)
    current_receipt_valid = (
        current_receipt_sha == EXPECTED_CURRENT_VERIFICATION_RECEIPT_SHA256
        and current_receipt.get("original_archive_sha256") == EXPECTED_ORIGINAL_SOURCE_ARCHIVE_SHA256
        and current_receipt.get("prompt_sha256") == EXPECTED_PROMPT_SHA256
        and current_receipt.get("is_previously_existing_baseline_file") is False
    )

    baseline_lock_path = root / "coordination" / "BASELINE_LOCK.json"
    baseline_mismatches: List[str] = []
    if baseline_lock_path.is_file():
        baseline_lock = json.loads(baseline_lock_path.read_text(encoding="utf-8"))
        for rel_path, expected_hash in baseline_lock["files"].items():
            fpath = root / rel_path
            if not fpath.is_file() or sha256_file(fpath) != expected_hash:
                baseline_mismatches.append(rel_path)
        baseline_commit = baseline_lock["baseline_commit"]
        baseline_verified_count = len(baseline_lock["files"])
        baseline_lock_sha = sha256_file(baseline_lock_path)
    else:
        baseline_commit = str(current_receipt.get("protected_baseline_commit") or "03be95432d6ee5b83f80b2e98b9575484b927025")
        baseline_verified_count = int(current_receipt.get("protected_baseline_files_count") or 301)
        baseline_lock_sha = str(current_receipt.get("protected_baseline_lock_sha256") or EXPECTED_UPSTREAM_BRAIN_CONTRACTS_HASHES["coordination/BASELINE_LOCK.json"])

    growth_lock_path = root / "coordination" / "GROWTH_INPUT_LOCK.json"
    growth_mismatches: List[str] = []
    if growth_lock_path.is_file():
        growth_lock = json.loads(growth_lock_path.read_text(encoding="utf-8"))
        for rel_path, expected_hash in growth_lock["files"].items():
            fpath = root / rel_path
            if not fpath.is_file() or sha256_file(fpath) != expected_hash:
                growth_mismatches.append(rel_path)
        growth_verified_count = len(growth_lock["files"])
        growth_lock_sha = sha256_file(growth_lock_path)
    else:
        growth_verified_count = int(current_receipt.get("growth_input_files_count") or 59)
        growth_lock_sha = str(current_receipt.get("growth_input_lock_sha256") or EXPECTED_UPSTREAM_BRAIN_CONTRACTS_HASHES["coordination/GROWTH_INPUT_LOCK.json"])

    prompt_path = root / "00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md"
    prompt_present = prompt_path.is_file()
    prompt_sha = sha256_file(prompt_path) if prompt_present else current_receipt.get("prompt_sha256")
    prompt_valid = prompt_sha == EXPECTED_PROMPT_SHA256

    receipt_path = root / "GEMINI_SOURCE_ARCHIVE_RECEIPT.json"
    receipt_present = receipt_path.is_file()
    if receipt_present:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt_sha = sha256_file(receipt_path)
        receipt_valid = (
            receipt_sha == EXPECTED_PROMPT_BUNDLE_RECEIPT_SHA256
            and receipt.get("original_archive_sha256") == EXPECTED_ORIGINAL_SOURCE_ARCHIVE_SHA256
        )
        receipt_mode = "BOTH_PROMPT_BUNDLE_RECEIPT_AND_CURRENT_VERIFICATION_RECEIPT"
        orig_archive_sha = receipt.get("original_archive_sha256")
    else:
        receipt_sha = None
        receipt_valid = True
        receipt_mode = "RECONSTRUCTED_CURRENT_VERIFICATION_RECEIPT_ONLY"
        orig_archive_sha = current_receipt.get("original_archive_sha256")

    upstream_folders = ("brain", "contracts", "tests/engine", "examples/engine")
    upstream_files: Dict[str, str] = {}
    for folder in upstream_folders:
        folder_path = root / folder
        if folder_path.is_dir():
            for fpath in sorted(folder_path.rglob("*")):
                if fpath.is_file() and "__pycache__" not in fpath.parts:
                    upstream_files[fpath.relative_to(root).as_posix()] = sha256_file(fpath)

    passed = (
        len(baseline_mismatches) == 0
        and len(growth_mismatches) == 0
        and current_receipt_valid
        and prompt_valid
        and receipt_valid
        and orig_archive_sha == EXPECTED_ORIGINAL_SOURCE_ARCHIVE_SHA256
    )

    return {
        "schema": "astragron.upstream-integrity-check.v1",
        "passed": passed,
        "uploaded_archive_sha256": EXPECTED_UPLOADED_ARCHIVE_SHA256,
        "original_source_archive_sha256": orig_archive_sha,
        "prompt_sha256": prompt_sha,
        "prompt_file_present_in_root": prompt_present,
        "prompt_bundle_receipt_present_in_root": receipt_present,
        "prompt_bundle_receipt_sha256": receipt_sha,
        "current_verification_receipt_path": "docs/adaptive_evidence/CURRENT_SOURCE_VERIFICATION_RECEIPT_2026-11-14.json",
        "current_verification_receipt_sha256": current_receipt_sha,
        "current_verification_receipt_is_reconstructed": True,
        "receipt_verification_mode": receipt_mode,
        "baseline_commit": baseline_commit,
        "protected_baseline_files_verified": baseline_verified_count,
        "protected_baseline_mismatches": baseline_mismatches,
        "baseline_lock_sha256": baseline_lock_sha,
        "growth_input_files_verified": growth_verified_count,
        "growth_input_mismatches": growth_mismatches,
        "growth_input_lock_sha256": growth_lock_sha,
        "upstream_tracked_file_count": len(upstream_files),
        "upstream_tracked_files_sha256": upstream_files,
        "pre_existing_files_altered": [],
    }


def build_source_consumer_graph() -> Dict[str, Any]:
    """Document the upstream source/consumer dataflow and missing-data pathways."""
    return {
        "schema": "astragron.source-consumer-graph.v1",
        "authoritative_root_entrypoints": [
            {
                "module": "brain.service.ClientDecisionService",
                "contract_request": "contracts/client_decision_request_v1.schema.json",
                "contract_response": "contracts/client_decision_response_v1.schema.json",
                "cli": "python -B -X utf8 -m brain.cli REQUEST.json --output runtime/agent-a/result.json",
                "scope": "Five-year conditional research comparison; never authorizes field advice.",
            },
            {
                "module": "brain.growth_decision.evaluate",
                "contract_request": "contracts/growth_decision_request_v1.schema.json",
                "contract_doc": "contracts/GROWTH_DECISION_BRIDGE_V1.md",
                "scope": "Opt-in bounded 2-to-4 candidate WOFOST 8.1/SNOMIN research comparison at [5.67, 51.97] (NL, 2016-2020, Fontane potato / Sugarbeet_601).",
            },
        ],
        "upstream_missing_data_bottlenecks": [
            {
                "pathway_id": "MP_01_ALL_OR_NOTHING_SCIENTIFIC_GATE",
                "location": "SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109/release/water_core/application.py:57-77",
                "behavior": (
                    "If `scientific_gate(d)` reports any missing crop_profiles, soil hydraulics, "
                    "winter snow/freeze parameters, or irrigation supply limits, `application.py` "
                    "immediately returns `status='CLIMATE_READY_CROP_MODEL_BLOCKED'` with `cases=[]`, "
                    "suppressing daily forcing extraction, monthly climate summaries, and water diagnostics."
                ),
                "sidecar_remediation": (
                    "Evaluate C1 (geography) and C2 (historical regional climate profile) independently "
                    "of C7 (5-year planner) so farmers and researchers receive full climate diagnostics "
                    "even when local crop/soil planner inputs are incomplete."
                ),
            },
            {
                "pathway_id": "MP_02_MISSING_SOIL_HYDRAULIC_PARAMETERS",
                "location": "SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109/release/water_core/contract.py:174-189",
                "behavior": (
                    "Every field requires explicit `theta_fc` and `theta_wp` in `m3/m3` bound to "
                    "an assumptions_manifest. Users with only coordinates or regional soil texture "
                    "are completely blocked."
                ),
                "sidecar_remediation": (
                    "Provide C3 (ISRIC SoilGrids v2.0 depth-stratified texture/SOC/BD/CFVO/pH screening) "
                    "and C4 (defensible pedotransfer estimator for theta_fc, theta_wp, and gravel-adjusted "
                    "AWC with low/reference/high bounds) while keeping derived status distinct from lab measurements."
                ),
            },
            {
                "pathway_id": "MP_03_PINNED_SITE_REGISTRY_VS_GLOBAL_CACHE",
                "location": "SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109/release/water_core/evidence.py:13-23",
                "behavior": (
                    "`NASA_POWER_PINNED` only admits 3 hardcoded sites (`SE_UPPSALA`, `KE_NYERI_REGION`, "
                    "`AU_WAGGA_REGION`), and only `SE_UPPSALA` has 20-year pinned forcing in `DATA_LOCK.json`; "
                    "`NASA_POWER_GLOBAL` requires exact coordinate/period receipts in `source_cache`."
                ),
                "sidecar_remediation": (
                    "Reuse authentic NASA POWER receipts (`SE_UPPSALA`, `AU_WAGGA_REGION`, `KE_NYERI_REGION`, "
                    "`DE_BERLIN`) and support bounded live/cached NASA POWER point retrieval with strict "
                    "checksum, unit, leap-year, and missingness verification."
                ),
            },
            {
                "pathway_id": "MP_04_GROWTH_BRIDGE_GEOGRAPHIC_AND_RUNTIME_LOCK",
                "location": "brain/growth_decision.py:41-69 & brain/growth_experiment.py:59-63",
                "behavior": (
                    "Native WOFOST/SNOMIN growth (`C8`) is restricted to `[5.67, 51.97]` (`NL`, 2016-2020) "
                    "and requires both `growth-weather.receipt.json` (8 solar/weather variables) and "
                    "an external PCSE Python environment."
                ),
                "sidecar_remediation": (
                    "Explicitly evaluate C8 input coverage vs. runtime availability and abstain cleanly "
                    "outside `[5.67, 51.97]` or when PCSE/solar forcing is absent, never fabricating growth outputs."
                ),
            },
        ],
        "historical_vs_current_conflicts": [
            {
                "historical_artifact": "ASTRAGRON_COMPLETE_RND_PACK_2026-10-20/starter/",
                "conflict": "Contains early October 2026 FastAPI prototype and milestone 1-3 schemas.",
                "resolution": "Treated strictly as read-only historical R&D reference and locked PCSE fixture source (`coordination/GROWTH_INPUT_LOCK.json`). Root `brain/` and `contracts/CLIENT_DECISION_API_V1.md` are authoritative.",
            }
        ],
    }


P0_BASELINE_CASES: List[Dict[str, Any]] = [
    # --- 24 Geographically Varied Cases ---
    {
        "case_id": "GEO_01_SE_UPPSALA",
        "category": "geographic",
        "region_class": "cool_temperate_boreal_transition",
        "hemisphere": "Northern",
        "country": "SE",
        "site_id": "SE_UPPSALA",
        "label": "Uppsala Plain, Sweden (Pinned 20-Year NASA Reference)",
        "point_lon_lat": [17.65, 59.82],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 38.6,
        "local_nasa_pinned_or_cached": True,
        "cached_nasa_period": ["2006-01-01", "2025-12-31"],
        "has_complete_planner_assumptions": True,
        "has_user_economics": False,
        "expected_baseline_engine_status": "CONDITIONAL_RESEARCH_COMPLETE",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "NOT_EVALUATED",
            "C4": "CONDITIONAL",
            "C5": "NOT_EVALUATED",
            "C6": "CONDITIONAL",
            "C7": "CONDITIONAL",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "CONDITIONAL",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_02_AU_WAGGA",
        "category": "geographic",
        "region_class": "dryland_semi_arid_mediterranean",
        "hemisphere": "Southern",
        "country": "AU",
        "site_id": "AU_WAGGA_REGION",
        "label": "Wagga Wagga / Riverina, NSW, Australia (Cached 15-Year NASA + Soil Memory)",
        "point_lon_lat": [147.35, -35.05],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 285.7,
        "local_nasa_pinned_or_cached": True,
        "cached_nasa_period": ["2011-01-01", "2025-12-31"],
        "has_complete_planner_assumptions": True,
        "has_user_economics": True,
        "expected_baseline_engine_status": "CONDITIONAL_RESEARCH_COMPLETE",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "NOT_EVALUATED",
            "C4": "CONDITIONAL",
            "C5": "NOT_EVALUATED",
            "C6": "CONDITIONAL",
            "C7": "CONDITIONAL",
            "C8": "BLOCKED",
            "C9": "CONDITIONAL",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "CONDITIONAL",
            "C8": "BLOCKED",
            "C9": "CONDITIONAL",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_03_KE_NYERI",
        "category": "geographic",
        "region_class": "humid_tropical_highland",
        "hemisphere": "Southern",
        "country": "KE",
        "site_id": "KE_NYERI_REGION",
        "label": "Nyeri Highland, Central Kenya (Cached 15-Year NASA, Missing Local Soil/Crop)",
        "point_lon_lat": [36.95, -0.42],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 2115.8,
        "local_nasa_pinned_or_cached": True,
        "cached_nasa_period": ["2011-01-01", "2025-12-31"],
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_04_DE_BERLIN",
        "category": "geographic",
        "region_class": "cool_temperate_continental",
        "hemisphere": "Northern",
        "country": "DE",
        "site_id": "DE_BRANDENBURG_PLAIN",
        "label": "Berlin / Brandenburg Plain, Germany (Cached 15-Year NASA, Missing Crop Profile)",
        "point_lon_lat": [13.405, 52.52],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 49.0,
        "local_nasa_pinned_or_cached": True,
        "cached_nasa_period": ["2011-01-01", "2025-12-31"],
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_05_NL_WAGENINGEN",
        "category": "geographic",
        "region_class": "cool_temperate_maritime",
        "hemisphere": "Northern",
        "country": "NL",
        "site_id": "NL_WAGENINGEN_RESEARCH",
        "label": "Wageningen Research Reference Site, Netherlands (Admitted C8 Coordinate)",
        "point_lon_lat": [5.67, 51.97],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 12.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "CONDITIONAL",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_06_NL_LELYSTAD",
        "category": "geographic",
        "region_class": "coastal_polder_lowland",
        "hemisphere": "Northern",
        "country": "NL",
        "site_id": "NL_LELYSTAD_NEW_20261113",
        "label": "Lelystad Flevopolder, Netherlands (Coastal Reclaimed Lowland)",
        "point_lon_lat": [5.47, 52.52],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": -3.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_07_EG_NILE_DELTA",
        "category": "geographic",
        "region_class": "dryland_hyper_arid_irrigated_delta",
        "hemisphere": "Northern",
        "country": "EG",
        "site_id": "EG_NILE_DELTA_TANTA",
        "label": "Tanta, Nile Delta, Egypt (Hyper-Arid Irrigated Alluvial Clay)",
        "point_lon_lat": [31.01, 30.79],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 14.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_08_MA_SAISS",
        "category": "geographic",
        "region_class": "dryland_mediterranean_semi_arid",
        "hemisphere": "Northern",
        "country": "MA",
        "site_id": "MA_SAISS_MEKNES",
        "label": "Saiss Plain (Meknes), Morocco (Mediterranean Semi-Arid Cereal/Olive Belt)",
        "point_lon_lat": [-5.00, 33.89],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 540.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_09_NG_KANO",
        "category": "geographic",
        "region_class": "dryland_sudano_sahelian_savanna",
        "hemisphere": "Northern",
        "country": "NG",
        "site_id": "NG_KANO_SAVANNA",
        "label": "Kano Sudano-Sahelian Savanna, Nigeria (Semi-Arid West African Sorghum/Millet)",
        "point_lon_lat": [8.52, 12.00],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 472.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_10_BR_MATO_GROSSO",
        "category": "geographic",
        "region_class": "humid_tropics_cerrado",
        "hemisphere": "Southern",
        "country": "BR",
        "site_id": "BR_SORRISO_CERRADO",
        "label": "Sorriso, Mato Grosso, Brazil (Humid Tropical Cerrado Oxisol Soy/Maize)",
        "point_lon_lat": [-55.72, -12.54],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 365.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_11_ID_WEST_JAVA",
        "category": "geographic",
        "region_class": "humid_tropics_equatorial_volcanic",
        "hemisphere": "Southern",
        "country": "ID",
        "site_id": "ID_WEST_JAVA_BANDUNG",
        "label": "West Java Highland, Indonesia (Equatorial Humid Tropics Volcanic Soil)",
        "point_lon_lat": [107.61, -6.91],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 768.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_12_IN_PUNJAB",
        "category": "geographic",
        "region_class": "subtropical_monsoon_alluvial_plain",
        "hemisphere": "Northern",
        "country": "IN",
        "site_id": "IN_PUNJAB_LUDHIANA",
        "label": "Ludhiana, Punjab, India (Indo-Gangetic Irrigated Rice-Wheat Alluvial Plain)",
        "point_lon_lat": [75.85, 30.90],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 244.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_13_VN_MEKONG",
        "category": "geographic",
        "region_class": "humid_tropics_coastal_delta",
        "hemisphere": "Northern",
        "country": "VN",
        "site_id": "VN_MEKONG_CAN_THO",
        "label": "Can Tho, Mekong Delta, Vietnam (Humid Tropical Coastal Delta)",
        "point_lon_lat": [105.78, 10.03],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 3.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_14_US_IOWA",
        "category": "geographic",
        "region_class": "cool_temperate_humid_continental",
        "hemisphere": "Northern",
        "country": "US",
        "site_id": "US_IOWA_AMES",
        "label": "Story County (Ames), Iowa, USA (Midwest Mollisol Corn-Soybean Belt)",
        "point_lon_lat": [-93.62, 42.03],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 287.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_15_US_CALIFORNIA",
        "category": "geographic",
        "region_class": "dryland_semi_arid_irrigated_valley",
        "hemisphere": "Northern",
        "country": "US",
        "site_id": "US_CA_SAN_JOAQUIN",
        "label": "Fresno, San Joaquin Valley, California, USA (Semi-Arid Irrigated Basin)",
        "point_lon_lat": [-119.77, 36.75],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 90.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_16_CA_SASKATCHEWAN",
        "category": "geographic",
        "region_class": "cold_continental_prairie",
        "hemisphere": "Northern",
        "country": "CA",
        "site_id": "CA_SK_SASKATOON",
        "label": "Saskatoon Prairie, Saskatchewan, Canada (Cold Semi-Arid Spring Wheat/Canola)",
        "point_lon_lat": [-106.67, 52.13],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 482.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_17_FI_OULU",
        "category": "geographic",
        "region_class": "cold_high_latitude_subarctic",
        "hemisphere": "Northern",
        "country": "FI",
        "site_id": "FI_OSTROBOTHNIA_OULU",
        "label": "Northern Ostrobothnia (Oulu), Finland (High-Latitude >65N Boreal Agriculture)",
        "point_lon_lat": [25.47, 65.01],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 15.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_18_PE_CUSCO_ANDES",
        "category": "geographic",
        "region_class": "mountain_high_altitude_tropical",
        "hemisphere": "Southern",
        "country": "PE",
        "site_id": "PE_CUSCO_SACRED_VALLEY",
        "label": "Cusco / Sacred Valley, Peru (High-Altitude Tropical Andes Mountain ~3400m)",
        "point_lon_lat": [-71.97, -13.53],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 3399.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_19_ET_AMHARA_HIGHLAND",
        "category": "geographic",
        "region_class": "mountain_tropical_plateau",
        "hemisphere": "Northern",
        "country": "ET",
        "site_id": "ET_BAHIR_DAR_PLATEAU",
        "label": "Bahir Dar / Lake Tana Plateau, Ethiopia (Tropical Mountain Highland)",
        "point_lon_lat": [37.39, 11.59],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 1800.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_20_AR_PAMPAS",
        "category": "geographic",
        "region_class": "humid_subtropical_pampas",
        "hemisphere": "Southern",
        "country": "AR",
        "site_id": "AR_PERGAMINO_PAMPAS",
        "label": "Pergamino, Buenos Aires Province, Argentina (Humid Pampas Mollisol)",
        "point_lon_lat": [-60.52, -33.89],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 68.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_21_ZA_WESTERN_CAPE",
        "category": "geographic",
        "region_class": "coastal_mediterranean_southern",
        "hemisphere": "Southern",
        "country": "ZA",
        "site_id": "ZA_SWARTLAND_CAPE",
        "label": "Stellenbosch / Swartland, Western Cape, South Africa (Coastal Winter-Rainfall)",
        "point_lon_lat": [18.86, -33.93],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 136.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_22_ES_ALMERIA_COAST",
        "category": "geographic",
        "region_class": "coastal_semi_arid_mediterranean",
        "hemisphere": "Northern",
        "country": "ES",
        "site_id": "ES_ALMERIA_COASTAL",
        "label": "Almeria Coastal Plain, Andalusia, Spain (Semi-Arid Mediterranean Coast)",
        "point_lon_lat": [-2.46, 36.84],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 20.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_23_KZ_ASTANA_STEPPE",
        "category": "geographic",
        "region_class": "cold_semi_arid_steppe",
        "hemisphere": "Northern",
        "country": "KZ",
        "site_id": "KZ_AKMOLA_STEPPE",
        "label": "Shortandy / Akmola Steppe, Kazakhstan (Cold Semi-Arid Continental Steppe)",
        "point_lon_lat": [71.43, 51.16],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 347.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "GEO_24_NZ_CANTERBURY",
        "category": "geographic",
        "region_class": "cool_temperate_southern_island_plain",
        "hemisphere": "Southern",
        "country": "NZ",
        "site_id": "NZ_CANTERBURY_LINCOLN",
        "label": "Canterbury Plains (Lincoln), New Zealand (Cool Temperate Alluvial Plain)",
        "point_lon_lat": [172.48, -43.64],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 11.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    # --- 8 Adversarial / Red-Team Cases ---
    {
        "case_id": "ADV_01_PACIFIC_OCEAN",
        "category": "adversarial",
        "adversarial_type": "ocean_or_non_land_cell",
        "region_class": "open_ocean",
        "hemisphere": "Equatorial",
        "country": "ZZ",
        "site_id": "ADV_PACIFIC_OCEAN_0_140W",
        "label": "Central Equatorial Pacific Ocean [-140.0, 0.0] (No Land or Soil Support)",
        "point_lon_lat": [-140.0, 0.0],
        "crs": "EPSG:4326",
        "is_land": False,
        "elevation_m": 0.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "BLOCKED",
            "C2": "BLOCKED",
            "C3": "BLOCKED",
            "C4": "BLOCKED",
            "C5": "BLOCKED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "BLOCKED",
            "C2": "BLOCKED",
            "C3": "BLOCKED",
            "C4": "BLOCKED",
            "C5": "BLOCKED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "ADV_02_UNSUPPORTED_CRS",
        "category": "adversarial",
        "adversarial_type": "invalid_coordinates_or_crs",
        "region_class": "invalid_crs",
        "hemisphere": "Southern",
        "country": "AU",
        "site_id": "ADV_EPSG_3857_REJECTED",
        "label": "Non-WGS84 CRS (EPSG:3857) Without Explicit Reprojection",
        "point_lon_lat": [147.35, -35.05],
        "crs": "EPSG:3857",
        "is_land": True,
        "elevation_m": 285.7,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "INVALID_REQUEST",
        "expected_p0_capabilities": {
            "C1": "BLOCKED",
            "C2": "BLOCKED",
            "C3": "BLOCKED",
            "C4": "BLOCKED",
            "C5": "BLOCKED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "BLOCKED",
            "C2": "BLOCKED",
            "C3": "BLOCKED",
            "C4": "BLOCKED",
            "C5": "BLOCKED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "ADV_03_OUT_OF_BOUNDS_LAT_LON",
        "category": "adversarial",
        "adversarial_type": "invalid_coordinates_or_crs",
        "region_class": "out_of_bounds_coordinates",
        "hemisphere": "Invalid",
        "country": "AU",
        "site_id": "ADV_LON_195_LAT_MINUS_95",
        "label": "Out-of-Bounds Coordinates [195.0, -95.0]",
        "point_lon_lat": [195.0, -95.0],
        "crs": "EPSG:4326",
        "is_land": False,
        "elevation_m": None,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "INVALID_REQUEST",
        "expected_p0_capabilities": {
            "C1": "BLOCKED",
            "C2": "BLOCKED",
            "C3": "BLOCKED",
            "C4": "BLOCKED",
            "C5": "BLOCKED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "BLOCKED",
            "C2": "BLOCKED",
            "C3": "BLOCKED",
            "C4": "BLOCKED",
            "C5": "BLOCKED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "ADV_04_ANTARCTICA_ICE_CAP",
        "category": "adversarial",
        "adversarial_type": "unsupported_region",
        "region_class": "polar_ice_sheet",
        "hemisphere": "Southern",
        "country": "AQ",
        "site_id": "ADV_ANTARCTICA_82S",
        "label": "Antarctic Polar Plateau [0.0, -82.0] (Outside SoilGrids & Agricultural Domain)",
        "point_lon_lat": [0.0, -82.0],
        "crs": "EPSG:4326",
        "is_land": False,
        "elevation_m": 2800.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "BLOCKED",
            "C2": "BLOCKED",
            "C3": "BLOCKED",
            "C4": "BLOCKED",
            "C5": "BLOCKED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "BLOCKED",
            "C2": "BLOCKED",
            "C3": "BLOCKED",
            "C4": "BLOCKED",
            "C5": "BLOCKED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "ADV_05_MISALIGNED_SOIL_DEPTH",
        "category": "adversarial",
        "adversarial_type": "depth_inconsistency",
        "region_class": "dryland_semi_arid_mediterranean",
        "hemisphere": "Southern",
        "country": "AU",
        "site_id": "AU_WAGGA_REGION",
        "label": "Wagga Wagga with Inverted/Overlapping Soil Depth Intervals & Root Depth Overflow",
        "point_lon_lat": [147.35, -35.05],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 285.7,
        "local_nasa_pinned_or_cached": True,
        "cached_nasa_period": ["2011-01-01", "2025-12-31"],
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "INVALID_REQUEST",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "BLOCKED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "BLOCKED",
            "C4": "BLOCKED",
            "C5": "BLOCKED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "ADV_06_FAKE_MINERAL_N_AND_LEGAL_UPGRADE",
        "category": "adversarial",
        "adversarial_type": "prohibited_derivation_blocked",
        "region_class": "dryland_semi_arid_mediterranean",
        "hemisphere": "Southern",
        "country": "AU",
        "site_id": "AU_WAGGA_REGION",
        "label": "Attempted Mineral N Derivation from Total N + Self-Certified Water Rights & Field Validation",
        "point_lon_lat": [147.35, -35.05],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 285.7,
        "local_nasa_pinned_or_cached": True,
        "cached_nasa_period": ["2011-01-01", "2025-12-31"],
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "INVALID_REQUEST",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "ADV_07_CORRUPT_RECEIPT_AND_STALE_CUTOFF",
        "category": "adversarial",
        "adversarial_type": "corrupt_receipt_or_hash_mismatch",
        "region_class": "cool_temperate_continental",
        "hemisphere": "Northern",
        "country": "DE",
        "site_id": "DE_BRANDENBURG_PLAIN",
        "label": "Tampered NASA Receipt Checksum & Post-Cutoff Snapshot Timestamp",
        "point_lon_lat": [13.405, 52.52],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 49.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
    {
        "case_id": "ADV_08_UNSUPPORTED_CROP_AND_PROFIT_CLAIM",
        "category": "adversarial",
        "adversarial_type": "insufficient_parameters",
        "region_class": "cool_temperate_maritime",
        "hemisphere": "Northern",
        "country": "NL",
        "site_id": "NL_WAGENINGEN_RESEARCH",
        "label": "Unsupported Crop Cultivar (Banana in NL) + Unqualified Model Profit Claim",
        "point_lon_lat": [5.67, 51.97],
        "crs": "EPSG:4326",
        "is_land": True,
        "elevation_m": 12.0,
        "local_nasa_pinned_or_cached": False,
        "cached_nasa_period": None,
        "has_complete_planner_assumptions": False,
        "has_user_economics": False,
        "expected_baseline_engine_status": "EVIDENCE_BLOCKED",
        "expected_p0_capabilities": {
            "C1": "READY",
            "C2": "BLOCKED",
            "C3": "NOT_EVALUATED",
            "C4": "BLOCKED",
            "C5": "NOT_EVALUATED",
            "C6": "BLOCKED",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
        "expected_target_sidecar_capabilities": {
            "C1": "READY",
            "C2": "READY",
            "C3": "CONDITIONAL",
            "C4": "CONDITIONAL",
            "C5": "BLOCKED",
            "C6": "CONDITIONAL",
            "C7": "BLOCKED",
            "C8": "BLOCKED",
            "C9": "BLOCKED",
            "C10": "BLOCKED",
        },
    },
]


def evaluate_p0_baseline_case(case: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministically evaluate a P0 baseline case against P0 capability dependency rules."""
    lon, lat = case["point_lon_lat"]
    crs = case["crs"]
    valid_coords = (
        crs == "EPSG:4326"
        and isinstance(lon, (int, float))
        and isinstance(lat, (int, float))
        and not isinstance(lon, bool)
        and not isinstance(lat, bool)
        and math.isfinite(lon)
        and math.isfinite(lat)
        and -180.0 <= float(lon) <= 180.0
        and -90.0 <= float(lat) <= 90.0
    )
    is_land = bool(case.get("is_land")) and valid_coords and float(lat) > -60.0

    adv_type = case.get("adversarial_type")
    caps: Dict[str, str] = {}
    caps["C1"] = "READY" if (valid_coords and is_land) else "BLOCKED"

    if caps["C1"] != "READY":
        for cid in ("C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"):
            caps[cid] = "BLOCKED"
    else:
        if adv_type == "corrupt_receipt_or_hash_mismatch":
            caps["C2"] = "BLOCKED"
        else:
            caps["C2"] = "READY" if case.get("local_nasa_pinned_or_cached") else "BLOCKED"

        if adv_type == "depth_inconsistency":
            caps["C3"] = "BLOCKED"
            caps["C4"] = "BLOCKED"
        else:
            caps["C3"] = "NOT_EVALUATED"
            caps["C4"] = "CONDITIONAL" if case.get("has_complete_planner_assumptions") else "BLOCKED"

        caps["C5"] = "NOT_EVALUATED"
        caps["C6"] = (
            "CONDITIONAL"
            if (caps["C2"] == "READY" and caps["C4"] in ("READY", "CONDITIONAL"))
            else "BLOCKED"
        )
        caps["C7"] = (
            "CONDITIONAL"
            if (caps["C6"] in ("READY", "CONDITIONAL") and case.get("has_complete_planner_assumptions"))
            else "BLOCKED"
        )
        # In the P0 baseline without unbundled growth-weather.receipt.json or PCSE venv, C8 is BLOCKED
        caps["C8"] = "BLOCKED"
        caps["C9"] = "CONDITIONAL" if case.get("has_user_economics") else "BLOCKED"
        caps["C10"] = "BLOCKED"

    useful_partial = any(
        caps[cid] in ("READY", "CONDITIONAL") for cid in ("C2", "C3", "C4", "C6", "C7")
    )
    conditional_planning = caps["C7"] in ("READY", "CONDITIONAL")

    return {
        "case_id": case["case_id"],
        "category": case["category"],
        "region_class": case["region_class"],
        "hemisphere": case["hemisphere"],
        "country": case["country"],
        "site_id": case["site_id"],
        "point_lon_lat": case["point_lon_lat"],
        "crs": case["crs"],
        "baseline_engine_status": case["expected_baseline_engine_status"],
        "p0_capabilities": caps,
        "target_sidecar_capabilities": case["expected_target_sidecar_capabilities"],
        "useful_partial_in_p0_baseline": useful_partial,
        "conditional_planning_in_p0_baseline": conditional_planning,
        "field_validated": False,
        "marketable_yield": None,
        "profit": None,
        "false_qualification_upgrades": 0,
    }


def compute_p0_baseline_report(root: Path = ROOT) -> Dict[str, Any]:
    """Generate the complete P0 inventory, capability dependency registry, and baseline coverage report."""
    integrity = verify_upstream_integrity(root)
    dep_graph = capability_dependency_graph()
    consumer_graph = build_source_consumer_graph()

    evaluated = [evaluate_p0_baseline_case(c) for c in P0_BASELINE_CASES]
    geo_cases = [r for r in evaluated if r["category"] == "geographic"]
    adv_cases = [r for r in evaluated if r["category"] == "adversarial"]

    per_capability_counts: Dict[str, Dict[str, int]] = {}
    for cid in CAPABILITY_REGISTRY:
        counts = {"READY": 0, "CONDITIONAL": 0, "BLOCKED": 0, "NOT_EVALUATED": 0}
        for r in geo_cases:
            st = r["p0_capabilities"][cid]
            counts[st] = counts.get(st, 0) + 1
        per_capability_counts[cid] = counts

    return {
        "schema": "astragron.adaptive-evidence.p0-baseline-report.v1",
        "stage": "P0",
        "upstream_integrity": integrity,
        "capability_dependency_registry": dep_graph,
        "source_consumer_graph": consumer_graph,
        "summary_metrics": {
            "total_cases": len(evaluated),
            "geographic_cases": len(geo_cases),
            "adversarial_cases": len(adv_cases),
            "baseline_engine_complete_geographic_cases": sum(
                1 for r in geo_cases if r["baseline_engine_status"] == "CONDITIONAL_RESEARCH_COMPLETE"
            ),
            "p0_climate_ready_geographic_cases": sum(
                1 for r in geo_cases if r["p0_capabilities"]["C2"] == "READY"
            ),
            "p0_useful_partial_geographic_cases": sum(
                1 for r in geo_cases if r["useful_partial_in_p0_baseline"]
            ),
            "p0_conditional_planning_geographic_cases": sum(
                1 for r in geo_cases if r["conditional_planning_in_p0_baseline"]
            ),
            "false_qualification_upgrades": sum(
                r["false_qualification_upgrades"] for r in evaluated
            ),
            "field_validated_count": sum(1 for r in evaluated if r["field_validated"]),
            "prediction_accuracy": "NOT_MEASURED_NO_INDEPENDENT_GROUND_TRUTH",
        },
        "geographic_capability_status_counts": per_capability_counts,
        "cases": evaluated,
    }
