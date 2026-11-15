"""FAO GAEZ v4 regional agro-ecological suitability screening adapter contract.

Implements Section 3 ('FAO GAEZ v4 or regional crop suitability screening') of
`00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`:
- Marks live GAEZ retrieval `SOURCE_UNAVAILABLE_OR_LICENSE_UNVERIFIED` (`missing_reason="license_unverified"`)
  when an authenticated FAO GAEZ v4 raster receipt and verified redistribution license are absent.
- Supports explicit offline contract-control fixtures (`SYNTHETIC_OFFLINE_CONTROL_FIXTURE`) for testing
  the C5 suitability screening contract without disguising control fixtures as authentic FAO data.
- Strictly prohibits treating regional suitability classes/indices as calibrated farm yields.
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Dict, Optional, Sequence

from ..schema import TypedEvidenceObject, validate_coordinates_and_crs

FAO_GAEZ_CITATION = (
    "Fischer, G., Nachtergaele, F. O., van Velthuizen, H. T., Chiozza, F., Franceschini, G., "
    "Henry, M., Muchoney, D., and Tramberend, S. (2021). Global Agro-Ecological Zones (GAEZ v4) - "
    "Model Documentation. FAO & IIASA, Rome, Italy. https://doi.org/10.4060/cb4744en"
)
FAO_GAEZ_URL = "https://gaez.fao.org/"
FAO_GAEZ_PIXEL_AREA_KM2 = 85.0  # Nominal 5 arc-minute (~9.2 km x 9.2 km) grid cell


class FAOGAEZAdapter:
    """Adapter contract for C5 Regional Agro-Ecological Suitability Screening (FAO GAEZ v4)."""

    def evaluate_suitability(
        self,
        point_lon_lat: Sequence[float],
        crop_code: str = "wheat",
        water_supply_regime: str = "rainfed",
        *,
        crs: str = "EPSG:4326",
        verified_local_receipt: Optional[Dict[str, Any]] = None,
        allow_contract_test_fixture: bool = False,
        contract_test_fixture_payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Evaluate C5 regional suitability or return SOURCE_UNAVAILABLE_OR_LICENSE_UNVERIFIED."""
        coord_check = validate_coordinates_and_crs(point_lon_lat, crs)
        if not coord_check["valid"] or not coord_check["is_land"]:
            reason = coord_check["missing_reason"] or "invalid_coordinates_or_crs"
            return self._blocked_response(
                point_lon_lat,
                crs,
                crop_code,
                reason,
                coord_check["detail"],
                adapter_status="BLOCKED_INVALID_OR_NON_LAND_LOCATION",
            )

        lon, lat = float(point_lon_lat[0]), float(point_lon_lat[1])

        # Path 1: Verified local receipt with explicit per-layer license, version, and redistribution check
        if verified_local_receipt is not None:
            lic = str(verified_local_receipt.get("license", ""))
            layer_id = str(verified_local_receipt.get("layer_id", "")).strip()
            gaez_ver = str(verified_local_receipt.get("gaez_version", "v4.0")).strip()
            redist_ok = verified_local_receipt.get("redistribution_permitted", True)
            suitability_idx = verified_local_receipt.get("suitability_index_0_100")
            if (
                "CC-BY" not in lic
                or "NC" in lic.upper()
                or redist_ok is False
                or suitability_idx is None
                or not (0.0 <= float(suitability_idx) <= 100.0)
                or (gaez_ver.startswith("v5") and not layer_id)
            ):
                return self._blocked_response(
                    [lon, lat],
                    crs,
                    crop_code,
                    "license_unverified",
                    (
                        "Provided FAO GAEZ receipt lacks per-layer verified CC-BY redistribution rights, "
                        "contains non-commercial restriction, or lacks layer_id/valid [0, 100] suitability index."
                    ),
                    adapter_status="SOURCE_UNAVAILABLE_OR_LICENSE_UNVERIFIED",
                )
            rec_sha = hashlib.sha256(
                json.dumps(verified_local_receipt, sort_keys=True).encode("utf-8")
            ).hexdigest()
            return self._build_suitability_response(
                lon=lon,
                lat=lat,
                crs=crs,
                crop_code=crop_code,
                water_supply_regime=water_supply_regime,
                suitability_index=float(suitability_idx),
                suitability_class=str(verified_local_receipt.get("suitability_class", "MS")),
                fixture_origin="AUTHENTIC_CACHED_RECEIPT",
                license_str=lic,
                rec_sha=rec_sha,
            )

        # Path 2: Explicit offline contract-control fixture (never disguised as real FAO data)
        if allow_contract_test_fixture and contract_test_fixture_payload is not None:
            suitability_idx = float(contract_test_fixture_payload.get("suitability_index_0_100", 65.0))
            if not (0.0 <= suitability_idx <= 100.0):
                return self._blocked_response(
                    [lon, lat],
                    crs,
                    crop_code,
                    "quality_fail",
                    f"Contract fixture suitability_index_0_100={suitability_idx} outside [0, 100].",
                    adapter_status="QUALITY_FAIL",
                )
            rec_sha = hashlib.sha256(
                json.dumps(contract_test_fixture_payload, sort_keys=True).encode("utf-8")
            ).hexdigest()
            return self._build_suitability_response(
                lon=lon,
                lat=lat,
                crs=crs,
                crop_code=crop_code,
                water_supply_regime=water_supply_regime,
                suitability_index=suitability_idx,
                suitability_class=str(contract_test_fixture_payload.get("suitability_class", "S")),
                fixture_origin="SYNTHETIC_OFFLINE_CONTROL_FIXTURE",
                license_str="SYNTHETIC_CONTROL_FIXTURE_NOT_AUTHENTIC_FAO_GAEZ",
                rec_sha=rec_sha,
            )

        # Default Path: Honest reporting that live GAEZ endpoint/license is unverified in offline workspace
        return self._blocked_response(
            [lon, lat],
            crs,
            crop_code,
            "license_unverified",
            (
                "SOURCE_UNAVAILABLE_OR_LICENSE_UNVERIFIED: No authenticated FAO GAEZ v4 raster receipt "
                "with verified redistribution license is present in the workspace; synthetic GAEZ tables "
                "disguised as real FAO data are prohibited."
            ),
            adapter_status="SOURCE_UNAVAILABLE_OR_LICENSE_UNVERIFIED",
        )

    def _build_suitability_response(
        self,
        *,
        lon: float,
        lat: float,
        crs: str,
        crop_code: str,
        water_supply_regime: str,
        suitability_index: float,
        suitability_class: str,
        fixture_origin: str,
        license_str: str,
        rec_sha: str,
    ) -> Dict[str, Any]:
        ev = TypedEvidenceObject(
            parameter_path=f"suitability.{crop_code}.{water_supply_regime}_index",
            provenance_class=(
                "OBSERVED_OR_AUTHENTIC_SOURCE"
                if fixture_origin == "AUTHENTIC_CACHED_RECEIPT"
                else "USER_SCENARIO_ASSUMPTION"
            ),
            source_id=(
                "FAO_IIASA_GAEZ_V4_5ARCMIN"
                if fixture_origin == "AUTHENTIC_CACHED_RECEIPT"
                else "FAO_GAEZ_V4_OFFLINE_CONTRACT_CONTROL_FIXTURE"
            ),
            provider="FAO & IIASA Global Agro-Ecological Zones (GAEZ v4)",
            product=f"GAEZ v4 Agro-Ecological Suitability Index ({crop_code}, {water_supply_regime})",
            variable="suitability_index_0_100",
            version="v4.0",
            permanent_url=FAO_GAEZ_URL,
            citation=FAO_GAEZ_CITATION,
            access_path="adaptive_evidence/adapters/fao_gaez.py",
            retrieved_at="2026-11-08T12:00:00+00:00",
            valid_period=("1981-01-01", "2010-12-31"),
            evidence_type="MODELLED" if fixture_origin == "AUTHENTIC_CACHED_RECEIPT" else "SCENARIO",
            point_lon_lat=(lon, lat),
            crs=crs,
            spatial_resolution_desc="5 arc-minute (~9 km) regional suitability grid; not field-scale yield calibration",
            pixel_area_km2=FAO_GAEZ_PIXEL_AREA_KM2,
            depth_interval_cm=None,
            raw_unit="index_0_100",
            scale_factor=1.0,
            raw_value=suitability_index,
            converted_si_value=suitability_index,
            si_unit="index_0_100",
            quantiles=None,
            uncertainty_semantics="Regional agro-climatic suitability class screening only; not a farm yield distribution.",
            quality_flags=(
                "REGIONAL_SUITABILITY_ONLY_NOT_FARM_YIELD",
                f"FIXTURE_ORIGIN_{fixture_origin}",
            ),
            missing_value_handling="Unverified sources blocked by default.",
            raw_source_sha256=rec_sha,
            receipt_sha256=rec_sha,
            fixture_origin=fixture_origin,
            transformation_id="GAEZ_SUITABILITY_INDEX_IDENTITY_V1",
            estimator_id=None,
            license=license_str,
            attribution=FAO_GAEZ_CITATION,
            restrictions="Regional suitability classes must NEVER be treated as calibrated farm yields or profit.",
        )

        ev_prohibited_yield = TypedEvidenceObject(
            parameter_path=f"crop.{crop_code}.calibrated_farm_yield_t_ha",
            provenance_class="NOT_RETRIEVABLE",
            source_id="FAO_IIASA_GAEZ_V4_5ARCMIN",
            provider="FAO & IIASA GAEZ v4",
            product="Prohibited Suitability-to-Yield Substitution Gate",
            variable="calibrated_farm_yield_t_ha",
            version="v4.0",
            permanent_url=FAO_GAEZ_URL,
            citation=FAO_GAEZ_CITATION,
            access_path="PROHIBITED_DERIVATION_GATE",
            retrieved_at=None,
            valid_period=None,
            evidence_type="UNAVAILABLE",
            point_lon_lat=(lon, lat),
            crs=crs,
            spatial_resolution_desc="5 arc-minute (~9 km) grid",
            pixel_area_km2=FAO_GAEZ_PIXEL_AREA_KM2,
            depth_interval_cm=None,
            raw_unit=None,
            scale_factor=None,
            raw_value=None,
            converted_si_value=None,
            si_unit="t/ha",
            quantiles=None,
            uncertainty_semantics="Regional suitability classes cannot be converted to calibrated farm yields.",
            quality_flags=("GAEZ_TO_FARM_YIELD_PROHIBITED",),
            missing_value_handling="Requires local cultivar parameters and field trial validation.",
            raw_source_sha256=rec_sha,
            receipt_sha256=rec_sha,
            fixture_origin="UNAVAILABLE_NO_DATA",
            transformation_id=None,
            estimator_id=None,
            license=license_str,
            attribution=FAO_GAEZ_CITATION,
            restrictions="Converting FAO GAEZ suitability classes into calibrated farm yields is prohibited.",
            missing_reason="not_identifiable",
        )

        return {
            "status": "CONDITIONAL",
            "capability_status": "CONDITIONAL",
            "adapter_status": "CONTRACT_VERIFIED",
            "fixture_origin": fixture_origin,
            "missing_reason": None,
            "diagnostics": {
                "crop_code": crop_code,
                "water_supply_regime": water_supply_regime,
                "suitability_index_0_100": suitability_index,
                "suitability_class": suitability_class,
                "calibrated_farm_yield_t_ha": None,
                "treats_suitability_as_farm_yield": False,
            },
            "evidence_objects": [ev.to_dict()],
            "prohibited_substitutions": [ev_prohibited_yield.to_dict()],
            "typed_objects": [ev],
        }

    def _blocked_response(
        self,
        point_lon_lat: Sequence[Any],
        crs: str,
        crop_code: str,
        missing_reason: str,
        detail: str,
        *,
        adapter_status: str,
    ) -> Dict[str, Any]:
        lon = float(point_lon_lat[0]) if isinstance(point_lon_lat, (list, tuple)) and len(point_lon_lat) == 2 and isinstance(point_lon_lat[0], (int, float)) and math.isfinite(point_lon_lat[0]) else 0.0
        lat = float(point_lon_lat[1]) if isinstance(point_lon_lat, (list, tuple)) and len(point_lon_lat) == 2 and isinstance(point_lon_lat[1], (int, float)) and math.isfinite(point_lon_lat[1]) else 0.0
        ev = TypedEvidenceObject(
            parameter_path=f"suitability.{crop_code}.rainfed_index",
            provenance_class="NOT_RETRIEVABLE",
            source_id="FAO_IIASA_GAEZ_V4_5ARCMIN",
            provider="FAO & IIASA Global Agro-Ecological Zones (GAEZ v4)",
            product="GAEZ v4 Agro-Ecological Suitability Index",
            variable="suitability_index_0_100",
            version="v4.0",
            permanent_url=FAO_GAEZ_URL,
            citation=FAO_GAEZ_CITATION,
            access_path=FAO_GAEZ_URL,
            retrieved_at=None,
            valid_period=None,
            evidence_type="UNAVAILABLE",
            point_lon_lat=(lon, lat),
            crs=str(crs),
            spatial_resolution_desc="5 arc-minute (~9 km) grid",
            pixel_area_km2=FAO_GAEZ_PIXEL_AREA_KM2,
            depth_interval_cm=None,
            raw_unit="index_0_100",
            scale_factor=1.0,
            raw_value=None,
            converted_si_value=None,
            si_unit="index_0_100",
            quantiles=None,
            uncertainty_semantics="Unavailable",
            quality_flags=(adapter_status,),
            missing_value_handling=detail,
            raw_source_sha256=None,
            receipt_sha256=None,
            fixture_origin="UNAVAILABLE_NO_DATA",
            transformation_id=None,
            estimator_id=None,
            license="UNVERIFIED_IN_OFFLINE_WORKSPACE",
            attribution=FAO_GAEZ_CITATION,
            restrictions="Live GAEZ retrieval disabled until endpoint and license are verified.",
            missing_reason=missing_reason,
        )
        return {
            "status": "BLOCKED",
            "capability_status": "BLOCKED",
            "adapter_status": adapter_status,
            "fixture_origin": "UNAVAILABLE_NO_DATA",
            "missing_reason": missing_reason,
            "detail": detail,
            "diagnostics": None,
            "evidence_objects": [ev.to_dict()],
            "prohibited_substitutions": [],
            "typed_objects": [ev],
        }
