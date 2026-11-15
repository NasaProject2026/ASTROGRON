"""NASA Space Apps 2026 Open-Source & Third-Party Rights Compliance Gate (Gate G3).

Implements Gate G3 of `ASTRAGRON_GEMINI_ADAPTIVE_EVIDENCE_FINAL_REMEDIATION_OPEN_SOURCE_EN_2026-11-14.md`:
- Software Bill of Materials (SBOM) with exact pinned versions, PyPI URLs, SPDX IDs,
  and transitive native C/C++ library obligations (GEOS LGPL-2.1-or-later, PROJ MIT).
- External Data Rights Register with per-layer provenance, SHA-256 hashes, raw vs. derived
  distinction, and explicit separation between OSI software licenses and Creative Commons
  open-data licenses (CC BY 4.0 is NOT an OSI software license and is never relabeled Apache-2.0).
- Fail-closed compliance scanner that detects missing attribution, incompatible/non-commercial
  licenses, mislabeled CC-BY data, bundled secrets/credentials, or proprietary assets.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

ROOT = Path(__file__).resolve().parent.parent
NE_RECEIPT_PATH = ROOT / "examples" / "adaptive_evidence" / "natural_earth_10m" / "NATURAL_EARTH_10M_RECEIPT.json"

SOFTWARE_BILL_OF_MATERIALS: List[Dict[str, Any]] = [
    {
        "package": "shapely",
        "pinned_version": "2.2.0",
        "spdx_license": "BSD-3-Clause",
        "is_osi_approved_software_license": True,
        "origin_url": "https://pypi.org/project/shapely/2.2.0/",
        "repository_url": "https://github.com/shapely/shapely",
        "transitive_native_components": [
            {
                "library": "GEOS (Geometry Engine, Open Source)",
                "spdx_license": "LGPL-2.1-or-later",
                "is_osi_approved_software_license": True,
                "origin_url": "https://libgeos.org/",
                "distribution_obligation": (
                    "Bundled dynamically in binary wheel; when redistributing binary wheels, "
                    "retain LGPL-2.1 notice and link to GEOS source."
                ),
            }
        ],
        "distribution_obligation": "Retain BSD-3-Clause copyright notice and disclaimer in THIRD_PARTY_NOTICES.md.",
    },
    {
        "package": "pyproj",
        "pinned_version": "3.8.0",
        "spdx_license": "MIT",
        "is_osi_approved_software_license": True,
        "origin_url": "https://pypi.org/project/pyproj/3.8.0/",
        "repository_url": "https://github.com/pyproj4/pyproj",
        "transitive_native_components": [
            {
                "library": "PROJ Cartographic Projections and Coordinate Transformations Library",
                "spdx_license": "MIT",
                "is_osi_approved_software_license": True,
                "origin_url": "https://proj.org/",
                "distribution_obligation": "Retain MIT copyright notice and PROJ data public-domain/CC-BY notices.",
            }
        ],
        "distribution_obligation": "Retain MIT copyright notice in THIRD_PARTY_NOTICES.md.",
    },
    {
        "package": "pyshp",
        "pinned_version": "3.1.8",
        "spdx_license": "MIT",
        "is_osi_approved_software_license": True,
        "origin_url": "https://pypi.org/project/pyshp/3.1.8/",
        "repository_url": "https://github.com/GeospatialPython/pyshp",
        "transitive_native_components": [],
        "distribution_obligation": "Retain MIT copyright notice in THIRD_PARTY_NOTICES.md.",
    },
    {
        "package": "numpy",
        "pinned_version": "2.5.4",
        "spdx_license": "BSD-3-Clause",
        "is_osi_approved_software_license": True,
        "origin_url": "https://pypi.org/project/numpy/2.5.4/",
        "repository_url": "https://github.com/numpy/numpy",
        "transitive_native_components": [],
        "distribution_obligation": "Retain BSD-3-Clause copyright notice in THIRD_PARTY_NOTICES.md.",
    },
    {
        "package": "jsonschema",
        "pinned_version": "4.26.0",
        "spdx_license": "MIT",
        "is_osi_approved_software_license": True,
        "origin_url": "https://pypi.org/project/jsonschema/4.26.0/",
        "repository_url": "https://github.com/python-jsonschema/jsonschema",
        "transitive_native_components": [],
        "distribution_obligation": "Retain MIT copyright notice in THIRD_PARTY_NOTICES.md.",
    },
    {
        "package": "attrs",
        "pinned_version": "26.1.0",
        "spdx_license": "MIT",
        "is_osi_approved_software_license": True,
        "origin_url": "https://pypi.org/project/attrs/26.1.0/",
        "repository_url": "https://github.com/python-attrs/attrs",
        "transitive_native_components": [],
        "distribution_obligation": "Retain MIT copyright notice in THIRD_PARTY_NOTICES.md.",
    },
    {
        "package": "jsonschema-specifications",
        "pinned_version": "2025.9.1",
        "spdx_license": "MIT",
        "is_osi_approved_software_license": True,
        "origin_url": "https://pypi.org/project/jsonschema-specifications/2025.9.1/",
        "repository_url": "https://github.com/python-jsonschema/jsonschema-specifications",
        "transitive_native_components": [],
        "distribution_obligation": "Retain MIT copyright notice in THIRD_PARTY_NOTICES.md.",
    },
    {
        "package": "referencing",
        "pinned_version": "0.37.0",
        "spdx_license": "MIT",
        "is_osi_approved_software_license": True,
        "origin_url": "https://pypi.org/project/referencing/0.37.0/",
        "repository_url": "https://github.com/python-jsonschema/referencing",
        "transitive_native_components": [],
        "distribution_obligation": "Retain MIT copyright notice in THIRD_PARTY_NOTICES.md.",
    },
    {
        "package": "rpds-py",
        "pinned_version": "2026.9.1",
        "spdx_license": "MIT",
        "is_osi_approved_software_license": True,
        "origin_url": "https://pypi.org/project/rpds-py/2026.9.1/",
        "repository_url": "https://github.com/crate-py/rpds",
        "transitive_native_components": [],
        "distribution_obligation": "Retain MIT copyright notice in THIRD_PARTY_NOTICES.md.",
    },
    {
        "package": "certifi",
        "pinned_version": "2026.10.23",
        "spdx_license": "MPL-2.0",
        "is_osi_approved_software_license": True,
        "origin_url": "https://pypi.org/project/certifi/2026.10.23/",
        "repository_url": "https://github.com/certifi/python-certifi",
        "transitive_native_components": [],
        "distribution_obligation": "Unmodified CA bundle; retain MPL-2.0 notice in THIRD_PARTY_NOTICES.md.",
    },
]


def build_external_data_rights_register() -> List[Dict[str, Any]]:
    ne_receipt = json.loads(NE_RECEIPT_PATH.read_text(encoding="utf-8")) if NE_RECEIPT_PATH.exists() else {"layers": {}}
    ne_layers = ne_receipt.get("layers", {})

    rows: List[Dict[str, Any]] = []
    for layer_id, expected_ver in (
        ("ne_10m_land", "5.1.1"),
        ("ne_10m_minor_islands", "4.1.0"),
        ("ne_10m_lakes", "5.0.0"),
    ):
        meta = ne_layers.get(layer_id, {})
        rows.append(
            {
                "dataset_id": f"NATURAL_EARTH_{layer_id.upper()}",
                "provider": "Natural Earth (NACIS & North American Cartographic Information Society)",
                "precise_layer": layer_id,
                "version": meta.get("version", expected_ver),
                "source_url": meta.get(
                    "download_url", f"https://naciscdn.org/naturalearth/10m/physical/{layer_id}.zip"
                ),
                "terms_url": "https://www.naturalearthdata.com/about/terms-of-use/",
                "copyright_and_rights": "Public Domain (No rights reserved; free to use, modify, and redistribute)",
                "declared_license": "CC0-1.0 / Public Domain",
                "license_category": "PUBLIC_DOMAIN_DATA",
                "is_osi_software_license": False,
                "reuse_and_redistribution_permitted": True,
                "modification_permitted": True,
                "mandatory_attribution": "Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.",
                "raw_or_derived": "RAW_OFFICIAL_VECTOR_SHAPEFILES_AND_SIMPLIFIED_WEB_JSON",
                "raw_zip_sha256": meta.get("raw_zip_sha256"),
                "extracted_files": meta.get("extracted_files", {}),
                "web_ui_derived_vector_json": "adaptive_evidence/web_unified/world_map_10m.json (simplified from bundled ne_10m_land v5.1.1)",
                "access_mode": "BUNDLED_OFFLINE",
                "nasa_space_apps_2026_compatibility": (
                    "Public domain third-party geographic vector data; documented source and terms per NASA 2026 rules."
                ),
            }
        )

    rows.extend(
        [
            {
                "dataset_id": "NASA_POWER_MERRA2_DAILY_UTC",
                "provider": "NASA Langley Research Center (LaRC) POWER Project",
                "precise_layer": "Daily Agroclimatology (PRECTOTCORR, T2M, T2M_MIN, T2M_MAX, ALLSKY_SFC_SW_DWN)",
                "version": "POWER Release 9 / MERRA-2",
                "source_url": "https://power.larc.nasa.gov/",
                "terms_url": "https://power.larc.nasa.gov/docs/services/api/",
                "copyright_and_rights": "U.S. Government Public Domain work (17 U.S.C. 105) / NASA Open Data Policy",
                "declared_license": "Public Domain (NASA Open Data)",
                "license_category": "PUBLIC_DOMAIN_DATA",
                "is_osi_software_license": False,
                "reuse_and_redistribution_permitted": True,
                "modification_permitted": True,
                "mandatory_attribution": (
                    "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project "
                    "funded through the NASA Earth Science/Applied Science Program."
                ),
                "raw_or_derived": "RAW_CACHED_RECEIPTS_AND_DERIVED_CLIMATE_SUMMARIES",
                "raw_zip_sha256": "see_ORIGINAL_SOURCE_RECEIPTS.json",
                "access_mode": "CACHED_RECEIPT_AND_LIVE_OPTIONAL",
                "nasa_space_apps_2026_compatibility": "Official NASA open dataset; fully compliant with NASA Space Apps 2026.",
            },
            {
                "dataset_id": "ISRIC_SOILGRIDS_V2_250M_WCS",
                "provider": "ISRIC - World Soil Information",
                "precise_layer": "SoilGrids250m v2.0 (clay, silt, sand, bdod, cfvo, soc, phh2o, nitrogen; Q0.05/Q0.50/mean/Q0.95)",
                "version": "v2.0",
                "source_url": "https://maps.isric.org/",
                "terms_url": "https://www.isric.org/explore/soilgrids/faq-soilgrids#What_is_the_license_of_SoilGrids",
                "copyright_and_rights": "Copyright ISRIC - World Soil Information, licensed under CC BY 4.0",
                "declared_license": "CC-BY-4.0",
                "license_category": "CREATIVE_COMMONS_ATTRIBUTION_DATA_NOT_OSI_SOFTWARE_LICENSE",
                "is_osi_software_license": False,
                "reuse_and_redistribution_permitted": True,
                "modification_permitted": True,
                "mandatory_attribution": (
                    "Poggio, L., de Sousa, L. M., Batjes, N. H., Heuvelink, G. B. M., Kempen, B., Ribeiro, E., "
                    "and Rossiter, D. (2021). SoilGrids 2.0: producing soil information for the globe with "
                    "quantified spatial uncertainty. SOIL, 7, 217-240. https://doi.org/10.5194/soil-7-217-240-2021"
                ),
                "raw_or_derived": "CACHED_WCS_RECEIPTS_AND_DERIVED_PTF_HYDRAULICS",
                "raw_zip_sha256": "see_ORIGINAL_SOURCE_RECEIPTS.json",
                "access_mode": "CACHED_RECEIPT_AND_WCS_OPTIONAL",
                "nasa_space_apps_2026_compatibility": (
                    "CC BY 4.0 is an open data license (not an OSI software license); documented as third-party "
                    "open data with full attribution and never relabeled as Apache-2.0 software."
                ),
            },
            {
                "dataset_id": "FAO_IIASA_GAEZ_V4_AND_V5_PER_LAYER_GATE",
                "provider": "Food and Agriculture Organization of the United Nations (FAO) & IIASA",
                "precise_layer": "GAEZ v4 / v5 Agro-Ecological Suitability Layers (Evaluated Per Layer)",
                "version": "v4.0 / v5.0 (DISABLED_BY_DEFAULT)",
                "source_url": "https://gaez.fao.org/",
                "terms_url": "https://www.fao.org/contact-us/terms/db-terms-of-use/en/",
                "copyright_and_rights": "FAO & IIASA; evaluated per layer before enabling.",
                "declared_license": "SOURCE_UNAVAILABLE_OR_LICENSE_UNVERIFIED_BY_DEFAULT",
                "license_category": "UNVERIFIED_DISABLED_BY_DEFAULT",
                "is_osi_software_license": False,
                "reuse_and_redistribution_permitted": False,
                "modification_permitted": False,
                "mandatory_attribution": (
                    "Fischer et al. (2021), FAO & IIASA Global Agro-Ecological Zones (GAEZ). "
                    "Disabled by default unless a per-layer CC-BY receipt without NC restriction is supplied."
                ),
                "raw_or_derived": "NONE_BUNDLED_DISABLED_BY_DEFAULT",
                "raw_zip_sha256": None,
                "access_mode": "DISABLED_BY_DEFAULT",
                "nasa_space_apps_2026_compatibility": (
                    "No FAO GAEZ v4 or v5 data are bundled; adapter fails closed with license_unverified "
                    "unless a verified per-layer CC-BY receipt is explicitly supplied."
                ),
            },
        ]
    )
    return rows


SECRET_PATTERNS = (
    re.compile(r"AIza[0-9A-Za-z\-_]{35}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"ghp_[0-9A-Za-z]{36}"),
    re.compile(r"sk-[0-9A-Za-z]{32,}"),
)
PROPRIETARY_ASSET_EXTENSIONS = (".ttf", ".otf", ".woff", ".woff2", ".eot", ".dll", ".exe", ".so", ".dylib")
UNEXPECTED_RAW_OR_ARCHIVE_EXTENSIONS = (".tif", ".tiff", ".geotiff", ".png", ".jpg", ".jpeg", ".bmp", ".whl", ".tar", ".gz", ".zip", ".raw")
SENSITIVE_FILENAMES = (".env", "id_rsa", "id_ed25519", "secrets.json", "credentials.json")
REQUIRED_COMPLIANCE_DOCS = (
    "LICENSE_RECOMMENDATION.md",
    "THIRD_PARTY_NOTICES.md",
    "DATA_SOURCES_AND_LICENSES.md",
    "OPEN_SOURCE_COMPLIANCE_CHECKLIST.md",
    "SCIENTIFIC_LIMITATIONS.md",
)


def evaluate_open_source_license_gate(
    *,
    sbom: Optional[Sequence[Dict[str, Any]]] = None,
    data_register: Optional[Sequence[Dict[str, Any]]] = None,
    scan_dirs: Optional[Sequence[Path]] = None,
) -> Dict[str, Any]:
    """Run automated fail-closed open-source and third-party rights compliance gate."""
    sbom_list = list(sbom) if sbom is not None else list(SOFTWARE_BILL_OF_MATERIALS)
    data_list = list(data_register) if data_register is not None else build_external_data_rights_register()
    dirs_to_scan = (
        list(scan_dirs)
        if scan_dirs is not None
        else [
            ROOT / "adaptive_evidence",
            ROOT / "tests" / "adaptive_evidence",
            ROOT / "examples" / "adaptive_evidence",
            ROOT / "docs" / "adaptive_evidence",
        ]
    )

    blockers: List[Dict[str, str]] = []

    # 1. Validate SBOM entries
    for pkg in sbom_list:
        name = str(pkg.get("package", "")).strip()
        ver = str(pkg.get("pinned_version", "")).strip()
        lic = str(pkg.get("spdx_license", "")).strip()
        obligation = str(pkg.get("distribution_obligation", "")).strip()
        if not name or not ver or not lic or not obligation:
            blockers.append(
                {
                    "code": "SBOM_INCOMPLETE_METADATA",
                    "item": name or "unknown_package",
                    "detail": "Missing package name, pinned_version, spdx_license, or distribution_obligation.",
                }
            )
        if any(bad in lic.upper() for bad in ("UNKNOWN", "PROPRIETARY", "UNLICENSED", "GPL-3.0-ONLY")):
            blockers.append(
                {
                    "code": "SBOM_INCOMPATIBLE_OR_UNKNOWN_LICENSE",
                    "item": name,
                    "detail": f"Disallowed or unverified software license: {lic}",
                }
            )

    # 2. Validate External Data Rights Register
    for row in data_list:
        ds_id = str(row.get("dataset_id", "")).strip()
        lic = str(row.get("declared_license", "")).strip()
        attr = str(row.get("mandatory_attribution", "")).strip()
        mode = str(row.get("access_mode", "")).strip()
        is_osi = bool(row.get("is_osi_software_license", False))

        if not ds_id or not lic or not attr:
            blockers.append(
                {
                    "code": "DATA_MISSING_LICENSE_OR_ATTRIBUTION",
                    "item": ds_id or "unknown_dataset",
                    "detail": "Dataset entry lacks declared_license or mandatory_attribution.",
                }
            )
        # Never claim CC BY is an OSI software license or relabel CC BY dataset as Apache-2.0
        if "CC-BY" in lic.upper() and (is_osi or "APACHE" in lic.upper()):
            blockers.append(
                {
                    "code": "MISLEADING_CC_BY_AS_OSI_OR_APACHE",
                    "item": ds_id,
                    "detail": "CC BY data license must not be claimed as an OSI software license or relabeled Apache-2.0.",
                }
            )
        # Any active dataset (anything except DISABLED_BY_DEFAULT) must have verified redistribution rights and non-NC/non-proprietary license
        if mode != "DISABLED_BY_DEFAULT":
            if not row.get("reuse_and_redistribution_permitted", False) or "NC" in lic.upper() or "PROPRIETARY" in lic.upper():
                blockers.append(
                    {
                        "code": "DISALLOWED_BUNDLED_DATA_LICENSE" if mode == "BUNDLED_OFFLINE" else "DISALLOWED_DATA_LICENSE",
                        "item": ds_id,
                        "detail": f"Dataset ({mode}) {ds_id} has restricted/non-commercial or unverified license: {lic}",
                    }
                )
        # Bundled datasets must additionally pin a raw archive SHA-256 receipt
        if mode == "BUNDLED_OFFLINE":
            if not row.get("raw_zip_sha256"):
                blockers.append(
                    {
                        "code": "BUNDLED_DATA_MISSING_SHA256",
                        "item": ds_id,
                        "detail": f"Bundled dataset {ds_id} is missing pinned raw_zip_sha256.",
                    }
                )

    # 3. Scan sidecar directories for secrets, private keys, raw GeoTIFFs/archives, or proprietary binary/font assets
    scanned_files = 0
    if scan_dirs is None:
        if (ROOT / "LICENSE").exists():
            blockers.append(
                {
                    "code": "ROOT_LICENSE_UNEXPECTEDLY_CREATED",
                    "item": "LICENSE",
                    "detail": "Root LICENSE must not be created or modified by the adaptive_evidence sidecar.",
                }
            )
        docs_dir = ROOT / "docs" / "adaptive_evidence"
        for req_doc in REQUIRED_COMPLIANCE_DOCS:
            if not (docs_dir / req_doc).exists():
                blockers.append(
                    {
                        "code": "MISSING_COMPLIANCE_DOCUMENT",
                        "item": f"docs/adaptive_evidence/{req_doc}",
                        "detail": "Mandatory open-source/rights compliance documentation file is missing.",
                    }
                )

    for d in dirs_to_scan:
        if not d.exists():
            continue
        for p in sorted(d.rglob("*")):
            if not p.is_file() or "__pycache__" in p.parts:
                continue
            scanned_files += 1
            rel_item = str(p.relative_to(ROOT) if p.is_relative_to(ROOT) else p).replace("\\", "/")
            if p.name.lower() in SENSITIVE_FILENAMES:
                blockers.append(
                    {
                        "code": "SENSITIVE_CREDENTIAL_FILE_DETECTED",
                        "item": rel_item,
                        "detail": f"Sensitive filename {p.name} must not be packaged in sidecar workspace.",
                    }
                )
            if p.suffix.lower() in PROPRIETARY_ASSET_EXTENSIONS:
                blockers.append(
                    {
                        "code": "DISALLOWED_BINARY_OR_FONT_ASSET",
                        "item": rel_item,
                        "detail": f"Bundled binary or font asset ({p.suffix}) is prohibited without explicit font/binary license clearance.",
                    }
                )
            if p.suffix.lower() in UNEXPECTED_RAW_OR_ARCHIVE_EXTENSIONS:
                blockers.append(
                    {
                        "code": "UNEXPECTED_RAW_RASTER_OR_ARCHIVE_ASSET",
                        "item": rel_item,
                        "detail": f"Unexpected raw raster or binary archive ({p.suffix}) detected in tracked sidecar folders; only compact verified JSON/SHP receipts are permitted.",
                    }
                )
            if p.suffix.lower() in (".py", ".md", ".json", ".txt", ".yaml", ".yml", ".html", ".css", ".js"):
                try:
                    txt = p.read_text(encoding="utf-8", errors="ignore")
                    for pat in SECRET_PATTERNS:
                        if pat.search(txt):
                            blockers.append(
                                {
                                    "code": "BUNDLED_SECRET_OR_CREDENTIAL_DETECTED",
                                    "item": rel_item,
                                    "detail": f"Pattern {pat.pattern} matched in file.",
                                }
                            )
                except Exception:
                    pass

    review_ready = len(blockers) == 0
    return {
        "schema": "astragron.adaptive-evidence.license-and-provenance-register.v1",
        "gate": "G3_OPEN_SOURCE_COMPLIANCE",
        "status": "PASS" if review_ready else "BLOCKED",
        "OPEN_SOURCE_RELEASE_REVIEW_READY": review_ready,
        "owner_license_selection_status": "OWNER_APPROVED_APACHE_2_0_FOR_ORIGINAL_OWNED_CODE_ONLY_NO_ROOT_LICENSE_MUTATION",
        "original_owned_code_license": "Apache-2.0",
        "root_license_modified": False,
        "third_party_data_relicensed": False,
        "scanned_sidecar_file_count": scanned_files,
        "blocker_count": len(blockers),
        "blockers": blockers,
        "software_bill_of_materials": sbom_list,
        "external_data_rights_register": data_list,
        "legal_disclaimer": (
            "Technical provenance and license audit report generated for independent human review; "
            "records owner Apache-2.0 selection for original owned sidecar code only without touching root LICENSE or relicensing upstream/third-party assets."
        ),
    }


def write_lf_json_if_changed(path: Path, payload: Any) -> bool:
    """Persist JSON deterministically with LF newlines, keeping unchanged bytes intact."""
    serialized = (json.dumps(payload, indent=2) + "\n").encode("utf-8")
    if path.exists():
        try:
            existing_bytes = path.read_bytes()
            if b"\r\n" not in existing_bytes and json.loads(existing_bytes.decode("utf-8")) == payload:
                return False
        except (OSError, UnicodeDecodeError, ValueError):
            pass
    path.write_bytes(serialized)
    return True


def write_security_and_rights_reports() -> Dict[str, Any]:
    """Generate and persist LICENSE_AND_PROVENANCE_REGISTER.json and SECURITY_AND_RIGHTS_CHECK.json."""
    reg = evaluate_open_source_license_gate()
    docs_dir = ROOT / "docs" / "adaptive_evidence"
    docs_dir.mkdir(parents=True, exist_ok=True)
    write_lf_json_if_changed(docs_dir / "LICENSE_AND_PROVENANCE_REGISTER.json", reg)
    sec_report = {
        "schema": "astragron.security-and-rights-check.v1",
        "status": reg["status"],
        "open_source_release_review_ready": reg["OPEN_SOURCE_RELEASE_REVIEW_READY"],
        "owner_license_selection_status": reg["owner_license_selection_status"],
        "original_owned_code_license": reg["original_owned_code_license"],
        "root_license_exists": (ROOT / "LICENSE").exists(),
        "root_license_modified": reg["root_license_modified"],
        "third_party_data_relicensed": reg["third_party_data_relicensed"],
        "scanned_sidecar_file_count": reg["scanned_sidecar_file_count"],
        "blocker_count": reg["blocker_count"],
        "blockers": reg["blockers"],
        "checks_enforced": [
            "SBOM SPDX completeness & disallowed license block",
            "CC-BY-4.0 vs OSI software license separation (never Apache-2.0)",
            "FAO GAEZ disabled by default / per-layer CC-BY non-NC gate",
            "Secret/token regex scan (API keys, private keys, tokens)",
            "Raw GeoTIFF / unexpected binary / font / archive leak scan",
            "Root LICENSE non-creation/non-mutation verification",
            "Mandatory compliance docs presence verification",
        ],
    }
    write_lf_json_if_changed(docs_dir / "SECURITY_AND_RIGHTS_CHECK.json", sec_report)
    return sec_report


if __name__ == "__main__":
    out = write_security_and_rights_reports()
    print(json.dumps({"status": out["status"], "blockers": out["blocker_count"], "scanned": out["scanned_sidecar_file_count"]}))
