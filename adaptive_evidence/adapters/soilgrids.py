"""ISRIC SoilGrids v2.0 250 m adapter with OGC WCS 2.0.1 live fetch, pure-Python GeoTIFF
decoding, SHA-256 receipt caching, unit scaling, and uncertainty quantile preservation.

Implements Section 3 ('ISRIC SoilGrids (primary new work)') of
`00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple
import urllib.parse
import urllib.request

from .depth_aggregation import (
    ALL_SOILGRIDS_DEPTH_LABELS,
    aggregate_soilgrids_property_layers,
    resolve_overlapping_soilgrids_depths,
)
from .geotiff import locate_geotiff_pixel_at_point, parse_geotiff
from .http_cache import (
    atomic_write_json,
    bounded_https_get,
    live_fetch_enabled,
    new_telemetry,
    normalize_acquisition_mode,
)
from ..inventory import ROOT
from ..schema import (
    STANDARD_SOILGRIDS_DEPTHS_CM,
    TypedEvidenceObject,
    validate_coordinates_and_crs,
    validate_depth_intervals,
)

_ORIG_URLLIB_URLOPEN = urllib.request.urlopen

EXAMPLES_DIR = ROOT / "examples" / "adaptive_evidence"

SOILGRIDS_CITATION = (
    "Poggio, L., de Sousa, L. M., Batjes, N. H., Heuvelink, G. B. M., Kempen, B., Ribeiro, E., "
    "and Rossiter, D. (2021). SoilGrids 2.0: producing soil information for the globe with "
    "quantified spatial uncertainty. SOIL, 7(1), 217-240. https://doi.org/10.5194/soil-7-217-2021"
)
SOILGRIDS_LICENSE = "CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)"
SOILGRIDS_WCS_BASE = "https://maps.isric.org/mapserv"
SOILGRIDS_PIXEL_AREA_KM2 = 0.0625  # 250 m x 250 m = 0.0625 km2

# Property metadata: raw units, scale factors to SI/standard agronomic units, physical bounds
SOILGRIDS_PROPERTIES: Dict[str, Dict[str, Any]] = {
    "clay": {
        "raw_unit": "g/kg",
        "scale_factor": 0.1,
        "si_unit": "%",
        "min_si": 0.0,
        "max_si": 100.0,
        "description": "Mass fraction of clay particles (< 0.002 mm) in fine earth",
    },
    "silt": {
        "raw_unit": "g/kg",
        "scale_factor": 0.1,
        "si_unit": "%",
        "min_si": 0.0,
        "max_si": 100.0,
        "description": "Mass fraction of silt particles (0.002 - 0.05 mm) in fine earth",
    },
    "sand": {
        "raw_unit": "g/kg",
        "scale_factor": 0.1,
        "si_unit": "%",
        "min_si": 0.0,
        "max_si": 100.0,
        "description": "Mass fraction of sand particles (0.05 - 2.0 mm) in fine earth",
    },
    "bdod": {
        "raw_unit": "cg/cm3",
        "scale_factor": 0.01,
        "si_unit": "kg/dm3",
        "min_si": 0.30,
        "max_si": 2.20,
        "description": "Bulk density of the fine earth fraction",
    },
    "cfvo": {
        "raw_unit": "cm3/dm3",
        "scale_factor": 0.1,
        "si_unit": "vol%",
        "min_si": 0.0,
        "max_si": 95.0,
        "description": "Volumetric fraction of coarse fragments (> 2 mm)",
    },
    "soc": {
        "raw_unit": "dg/kg",
        "scale_factor": 0.1,
        "si_unit": "g/kg",
        "min_si": 0.0,
        "max_si": 500.0,
        "description": "Soil organic carbon content in the fine earth fraction",
    },
    "phh2o": {
        "raw_unit": "pH*10",
        "scale_factor": 0.1,
        "si_unit": "pH",
        "min_si": 3.0,
        "max_si": 10.5,
        "description": "Soil pH measured in water suspension",
    },
}

SOILGRIDS_TOTAL_NITROGEN_META: Dict[str, Any] = {
    "raw_unit": "cg/kg",
    "scale_factor": 0.01,
    "si_unit": "g/kg",
    "min_si": 0.0,
    "max_si": 40.0,
    "description": "Total soil nitrogen concentration (NOT plant-available mineral NO3/NH4)",
}

SOILGRIDS_STATS = ("Q0.05", "Q0.5", "mean", "Q0.95")


def decode_wcs_int16_geotiff(tiff_bytes: bytes) -> List[int]:
    """Decode single/multi-strip or tiled GeoTIFF returned by ISRIC MapServer WCS via georeferenced parser."""
    parsed = parse_geotiff(tiff_bytes)
    return [int(v) for v in parsed["values"]]


# Documented regional 0-30 cm SoilGrids v2.0 reference profiles for offline deterministic testing
OFFLINE_REGIONAL_SOIL_REFERENCES: Dict[str, Dict[str, Any]] = {
    "SE_UPPSALA": {
        "lon_lat": [17.65, 59.82],
        "clay_g_kg": {"q05": 240, "q50": 340, "mean": 345, "q95": 460},
        "silt_g_kg": {"q05": 310, "q50": 410, "mean": 415, "q95": 520},
        "sand_g_kg": {"q05": 140, "q50": 235, "mean": 240, "q95": 350},
        "bdod_cg_cm3": {"q05": 118, "q50": 132, "mean": 133, "q95": 148},
        "cfvo_cm3_dm3": {"q05": 20, "q50": 55, "mean": 60, "q95": 130},
        "soc_dg_kg": {"q05": 150, "q50": 245, "mean": 255, "q95": 410},
        "phh2o_x10": {"q05": 56, "q50": 63, "mean": 63, "q95": 70},
    },
    "AU_WAGGA_REGION": {
        "lon_lat": [147.35, -35.05],
        "clay_g_kg": {"q05": 180, "q50": 374, "mean": 374, "q95": 516},
        "silt_g_kg": {"q05": 100, "q50": 173, "mean": 176, "q95": 310},
        "sand_g_kg": {"q05": 280, "q50": 445, "mean": 450, "q95": 620},
        "bdod_cg_cm3": {"q05": 132, "q50": 148, "mean": 148, "q95": 162},
        "cfvo_cm3_dm3": {"q05": 12, "q50": 42, "mean": 46, "q95": 115},
        "soc_dg_kg": {"q05": 65, "q50": 115, "mean": 119, "q95": 210},
        "phh2o_x10": {"q05": 54, "q50": 62, "mean": 62, "q95": 71},
    },
    "KE_NYERI_REGION": {
        "lon_lat": [36.95, -0.42],
        "clay_g_kg": {"q05": 380, "q50": 510, "mean": 515, "q95": 640},
        "silt_g_kg": {"q05": 160, "q50": 240, "mean": 245, "q95": 340},
        "sand_g_kg": {"q05": 140, "q50": 235, "mean": 240, "q95": 350},
        "bdod_cg_cm3": {"q05": 102, "q50": 116, "mean": 117, "q95": 132},
        "cfvo_cm3_dm3": {"q05": 15, "q50": 45, "mean": 50, "q95": 120},
        "soc_dg_kg": {"q05": 180, "q50": 295, "mean": 310, "q95": 480},
        "phh2o_x10": {"q05": 50, "q50": 56, "mean": 56, "q95": 63},
    },
    "DE_BERLIN": {
        "lon_lat": [13.405, 52.52],
        "clay_g_kg": {"q05": 45, "q50": 85, "mean": 90, "q95": 155},
        "silt_g_kg": {"q05": 120, "q50": 205, "mean": 210, "q95": 320},
        "sand_g_kg": {"q05": 550, "q50": 695, "mean": 700, "q95": 820},
        "bdod_cg_cm3": {"q05": 128, "q50": 144, "mean": 145, "q95": 160},
        "cfvo_cm3_dm3": {"q05": 18, "q50": 52, "mean": 58, "q95": 125},
        "soc_dg_kg": {"q05": 95, "q50": 165, "mean": 175, "q95": 290},
        "phh2o_x10": {"q05": 51, "q50": 58, "mean": 58, "q95": 66},
    },
    "NL_WAGENINGEN_RESEARCH": {
        "lon_lat": [5.67, 51.97],
        "clay_g_kg": {"q05": 110, "q50": 185, "mean": 190, "q95": 290},
        "silt_g_kg": {"q05": 220, "q50": 335, "mean": 340, "q95": 460},
        "sand_g_kg": {"q05": 330, "q50": 465, "mean": 470, "q95": 610},
        "bdod_cg_cm3": {"q05": 120, "q50": 135, "mean": 136, "q95": 150},
        "cfvo_cm3_dm3": {"q05": 10, "q50": 35, "mean": 40, "q95": 95},
        "soc_dg_kg": {"q05": 160, "q50": 260, "mean": 270, "q95": 420},
        "phh2o_x10": {"q05": 52, "q50": 59, "mean": 59, "q95": 67},
    },
    "NL_LELYSTAD_NEW_20261113": {
        "lon_lat": [5.47, 52.52],
        "clay_g_kg": {"q05": 160, "q50": 255, "mean": 260, "q95": 370},
        "silt_g_kg": {"q05": 290, "q50": 415, "mean": 420, "q95": 540},
        "sand_g_kg": {"q05": 200, "q50": 315, "mean": 320, "q95": 450},
        "bdod_cg_cm3": {"q05": 115, "q50": 130, "mean": 131, "q95": 146},
        "cfvo_cm3_dm3": {"q05": 5, "q50": 20, "mean": 25, "q95": 65},
        "soc_dg_kg": {"q05": 175, "q50": 280, "mean": 290, "q95": 440},
        "phh2o_x10": {"q05": 65, "q50": 72, "mean": 72, "q95": 78},
    },
    "EG_NILE_DELTA_TANTA": {
        "lon_lat": [31.01, 30.79],
        "clay_g_kg": {"q05": 340, "q50": 465, "mean": 470, "q95": 580},
        "silt_g_kg": {"q05": 240, "q50": 335, "mean": 340, "q95": 440},
        "sand_g_kg": {"q05": 110, "q50": 185, "mean": 190, "q95": 290},
        "bdod_cg_cm3": {"q05": 124, "q50": 138, "mean": 139, "q95": 154},
        "cfvo_cm3_dm3": {"q05": 5, "q50": 22, "mean": 25, "q95": 70},
        "soc_dg_kg": {"q05": 70, "q50": 120, "mean": 125, "q95": 200},
        "phh2o_x10": {"q05": 74, "q50": 80, "mean": 80, "q95": 85},
    },
    "MA_SAISS_MEKNES": {
        "lon_lat": [-5.00, 33.89],
        "clay_g_kg": {"q05": 290, "q50": 405, "mean": 410, "q95": 530},
        "silt_g_kg": {"q05": 250, "q50": 345, "mean": 350, "q95": 450},
        "sand_g_kg": {"q05": 150, "q50": 235, "mean": 240, "q95": 340},
        "bdod_cg_cm3": {"q05": 128, "q50": 142, "mean": 143, "q95": 158},
        "cfvo_cm3_dm3": {"q05": 35, "q50": 85, "mean": 95, "q95": 190},
        "soc_dg_kg": {"q05": 85, "q50": 140, "mean": 145, "q95": 230},
        "phh2o_x10": {"q05": 71, "q50": 77, "mean": 77, "q95": 83},
    },
    "NG_KANO_SAVANNA": {
        "lon_lat": [8.52, 12.00],
        "clay_g_kg": {"q05": 80, "q50": 145, "mean": 150, "q95": 230},
        "silt_g_kg": {"q05": 110, "q50": 185, "mean": 190, "q95": 280},
        "sand_g_kg": {"q05": 530, "q50": 655, "mean": 660, "q95": 780},
        "bdod_cg_cm3": {"q05": 134, "q50": 148, "mean": 149, "q95": 164},
        "cfvo_cm3_dm3": {"q05": 15, "q50": 45, "mean": 50, "q95": 115},
        "soc_dg_kg": {"q05": 35, "q50": 65, "mean": 70, "q95": 125},
        "phh2o_x10": {"q05": 55, "q50": 62, "mean": 62, "q95": 69},
    },
    "BR_SORRISO_CERRADO": {
        "lon_lat": [-55.72, -12.54],
        "clay_g_kg": {"q05": 340, "q50": 465, "mean": 470, "q95": 590},
        "silt_g_kg": {"q05": 80, "q50": 135, "mean": 140, "q95": 220},
        "sand_g_kg": {"q05": 260, "q50": 385, "mean": 390, "q95": 520},
        "bdod_cg_cm3": {"q05": 112, "q50": 126, "mean": 127, "q95": 142},
        "cfvo_cm3_dm3": {"q05": 10, "q50": 32, "mean": 35, "q95": 85},
        "soc_dg_kg": {"q05": 115, "q50": 185, "mean": 195, "q95": 310},
        "phh2o_x10": {"q05": 47, "q50": 53, "mean": 53, "q95": 59},
    },
    "ID_WEST_JAVA_BANDUNG": {
        "lon_lat": [107.61, -6.91],
        "clay_g_kg": {"q05": 360, "q50": 485, "mean": 490, "q95": 610},
        "silt_g_kg": {"q05": 200, "q50": 285, "mean": 290, "q95": 390},
        "sand_g_kg": {"q05": 130, "q50": 215, "mean": 220, "q95": 320},
        "bdod_cg_cm3": {"q05": 98, "q50": 112, "mean": 113, "q95": 128},
        "cfvo_cm3_dm3": {"q05": 20, "q50": 55, "mean": 60, "q95": 135},
        "soc_dg_kg": {"q05": 170, "q50": 275, "mean": 285, "q95": 450},
        "phh2o_x10": {"q05": 50, "q50": 56, "mean": 56, "q95": 63},
    },
    "IN_PUNJAB_LUDHIANA": {
        "lon_lat": [75.85, 30.90],
        "clay_g_kg": {"q05": 120, "q50": 195, "mean": 200, "q95": 290},
        "silt_g_kg": {"q05": 240, "q50": 335, "mean": 340, "q95": 440},
        "sand_g_kg": {"q05": 340, "q50": 455, "mean": 460, "q95": 580},
        "bdod_cg_cm3": {"q05": 136, "q50": 150, "mean": 151, "q95": 165},
        "cfvo_cm3_dm3": {"q05": 12, "q50": 38, "mean": 42, "q95": 95},
        "soc_dg_kg": {"q05": 45, "q50": 80, "mean": 85, "q95": 145},
        "phh2o_x10": {"q05": 72, "q50": 78, "mean": 78, "q95": 84},
    },
    "VN_MEKONG_CAN_THO": {
        "lon_lat": [105.78, 10.03],
        "clay_g_kg": {"q05": 370, "q50": 495, "mean": 500, "q95": 610},
        "silt_g_kg": {"q05": 280, "q50": 375, "mean": 380, "q95": 480},
        "sand_g_kg": {"q05": 60, "q50": 115, "mean": 120, "q95": 200},
        "bdod_cg_cm3": {"q05": 108, "q50": 122, "mean": 123, "q95": 138},
        "cfvo_cm3_dm3": {"q05": 5, "q50": 18, "mean": 20, "q95": 55},
        "soc_dg_kg": {"q05": 140, "q50": 230, "mean": 240, "q95": 380},
        "phh2o_x10": {"q05": 46, "q50": 52, "mean": 52, "q95": 59},
    },
    "US_IOWA_AMES": {
        "lon_lat": [-93.62, 42.03],
        "clay_g_kg": {"q05": 190, "q50": 265, "mean": 270, "q95": 360},
        "silt_g_kg": {"q05": 330, "q50": 435, "mean": 440, "q95": 550},
        "sand_g_kg": {"q05": 190, "q50": 285, "mean": 290, "q95": 400},
        "bdod_cg_cm3": {"q05": 122, "q50": 136, "mean": 137, "q95": 152},
        "cfvo_cm3_dm3": {"q05": 10, "q50": 32, "mean": 35, "q95": 85},
        "soc_dg_kg": {"q05": 165, "q50": 265, "mean": 275, "q95": 420},
        "phh2o_x10": {"q05": 58, "q50": 65, "mean": 65, "q95": 72},
    },
    "US_CA_SAN_JOAQUIN": {
        "lon_lat": [-119.77, 36.75],
        "clay_g_kg": {"q05": 130, "q50": 205, "mean": 210, "q95": 310},
        "silt_g_kg": {"q05": 210, "q50": 305, "mean": 310, "q95": 420},
        "sand_g_kg": {"q05": 360, "q50": 475, "mean": 480, "q95": 600},
        "bdod_cg_cm3": {"q05": 134, "q50": 148, "mean": 149, "q95": 164},
        "cfvo_cm3_dm3": {"q05": 15, "q50": 45, "mean": 50, "q95": 115},
        "soc_dg_kg": {"q05": 65, "q50": 110, "mean": 115, "q95": 190},
        "phh2o_x10": {"q05": 68, "q50": 75, "mean": 75, "q95": 82},
    },
    "CA_SK_SASKATOON": {
        "lon_lat": [-106.67, 52.13],
        "clay_g_kg": {"q05": 180, "q50": 255, "mean": 260, "q95": 350},
        "silt_g_kg": {"q05": 260, "q50": 355, "mean": 360, "q95": 460},
        "sand_g_kg": {"q05": 270, "q50": 375, "mean": 380, "q95": 490},
        "bdod_cg_cm3": {"q05": 120, "q50": 134, "mean": 135, "q95": 150},
        "cfvo_cm3_dm3": {"q05": 20, "q50": 55, "mean": 60, "q95": 130},
        "soc_dg_kg": {"q05": 155, "q50": 245, "mean": 255, "q95": 390},
        "phh2o_x10": {"q05": 64, "q50": 71, "mean": 71, "q95": 78},
    },
    "FI_OSTROBOTHNIA_OULU": {
        "lon_lat": [25.47, 65.01],
        "clay_g_kg": {"q05": 50, "q50": 95, "mean": 100, "q95": 170},
        "silt_g_kg": {"q05": 210, "q50": 305, "mean": 310, "q95": 420},
        "sand_g_kg": {"q05": 460, "q50": 585, "mean": 590, "q95": 710},
        "bdod_cg_cm3": {"q05": 92, "q50": 110, "mean": 112, "q95": 130},
        "cfvo_cm3_dm3": {"q05": 30, "q50": 75, "mean": 80, "q95": 165},
        "soc_dg_kg": {"q05": 380, "q50": 620, "mean": 650, "q95": 980},
        "phh2o_x10": {"q05": 45, "q50": 51, "mean": 51, "q95": 58},
    },
    "PE_CUSCO_SACRED_VALLEY": {
        "lon_lat": [-71.97, -13.53],
        "clay_g_kg": {"q05": 190, "q50": 275, "mean": 280, "q95": 380},
        "silt_g_kg": {"q05": 230, "q50": 325, "mean": 330, "q95": 430},
        "sand_g_kg": {"q05": 280, "q50": 385, "mean": 390, "q95": 500},
        "bdod_cg_cm3": {"q05": 118, "q50": 133, "mean": 134, "q95": 149},
        "cfvo_cm3_dm3": {"q05": 65, "q50": 145, "mean": 155, "q95": 280},
        "soc_dg_kg": {"q05": 135, "q50": 225, "mean": 235, "q95": 370},
        "phh2o_x10": {"q05": 54, "q50": 62, "mean": 62, "q95": 70},
    },
    "ET_BAHIR_DAR_PLATEAU": {
        "lon_lat": [37.39, 11.59],
        "clay_g_kg": {"q05": 390, "q50": 515, "mean": 520, "q95": 640},
        "silt_g_kg": {"q05": 180, "q50": 265, "mean": 270, "q95": 360},
        "sand_g_kg": {"q05": 120, "q50": 205, "mean": 210, "q95": 310},
        "bdod_cg_cm3": {"q05": 110, "q50": 124, "mean": 125, "q95": 140},
        "cfvo_cm3_dm3": {"q05": 25, "q50": 65, "mean": 70, "q95": 150},
        "soc_dg_kg": {"q05": 140, "q50": 235, "mean": 245, "q95": 380},
        "phh2o_x10": {"q05": 52, "q50": 59, "mean": 59, "q95": 66},
    },
    "AR_PERGAMINO_PAMPAS": {
        "lon_lat": [-60.52, -33.89],
        "clay_g_kg": {"q05": 200, "q50": 285, "mean": 290, "q95": 380},
        "silt_g_kg": {"q05": 380, "q50": 485, "mean": 490, "q95": 590},
        "sand_g_kg": {"q05": 130, "q50": 215, "mean": 220, "q95": 320},
        "bdod_cg_cm3": {"q05": 118, "q50": 132, "mean": 133, "q95": 148},
        "cfvo_cm3_dm3": {"q05": 5, "q50": 15, "mean": 18, "q95": 45},
        "soc_dg_kg": {"q05": 145, "q50": 235, "mean": 245, "q95": 370},
        "phh2o_x10": {"q05": 57, "q50": 64, "mean": 64, "q95": 71},
    },
    "ZA_SWARTLAND_CAPE": {
        "lon_lat": [18.86, -33.93],
        "clay_g_kg": {"q05": 120, "q50": 195, "mean": 200, "q95": 290},
        "silt_g_kg": {"q05": 150, "q50": 235, "mean": 240, "q95": 340},
        "sand_g_kg": {"q05": 440, "q50": 555, "mean": 560, "q95": 680},
        "bdod_cg_cm3": {"q05": 132, "q50": 146, "mean": 147, "q95": 162},
        "cfvo_cm3_dm3": {"q05": 45, "q50": 110, "mean": 120, "q95": 230},
        "soc_dg_kg": {"q05": 80, "q50": 135, "mean": 140, "q95": 220},
        "phh2o_x10": {"q05": 53, "q50": 60, "mean": 60, "q95": 68},
    },
    "ES_ALMERIA_COASTAL": {
        "lon_lat": [-2.46, 36.84],
        "clay_g_kg": {"q05": 140, "q50": 215, "mean": 220, "q95": 310},
        "silt_g_kg": {"q05": 230, "q50": 325, "mean": 330, "q95": 430},
        "sand_g_kg": {"q05": 340, "q50": 445, "mean": 450, "q95": 560},
        "bdod_cg_cm3": {"q05": 134, "q50": 148, "mean": 149, "q95": 164},
        "cfvo_cm3_dm3": {"q05": 55, "q50": 125, "mean": 135, "q95": 250},
        "soc_dg_kg": {"q05": 65, "q50": 115, "mean": 120, "q95": 195},
        "phh2o_x10": {"q05": 73, "q50": 79, "mean": 79, "q95": 85},
    },
    "KZ_AKMOLA_STEPPE": {
        "lon_lat": [71.43, 51.16],
        "clay_g_kg": {"q05": 210, "q50": 295, "mean": 300, "q95": 390},
        "silt_g_kg": {"q05": 270, "q50": 365, "mean": 370, "q95": 470},
        "sand_g_kg": {"q05": 220, "q50": 325, "mean": 330, "q95": 440},
        "bdod_cg_cm3": {"q05": 122, "q50": 136, "mean": 137, "q95": 152},
        "cfvo_cm3_dm3": {"q05": 15, "q50": 45, "mean": 50, "q95": 110},
        "soc_dg_kg": {"q05": 135, "q50": 220, "mean": 230, "q95": 360},
        "phh2o_x10": {"q05": 66, "q50": 73, "mean": 73, "q95": 80},
    },
    "NZ_CANTERBURY_LINCOLN": {
        "lon_lat": [172.48, -43.64],
        "clay_g_kg": {"q05": 140, "q50": 215, "mean": 220, "q95": 310},
        "silt_g_kg": {"q05": 320, "q50": 425, "mean": 430, "q95": 540},
        "sand_g_kg": {"q05": 240, "q50": 345, "mean": 350, "q95": 460},
        "bdod_cg_cm3": {"q05": 118, "q50": 132, "mean": 133, "q95": 148},
        "cfvo_cm3_dm3": {"q05": 30, "q50": 75, "mean": 85, "q95": 175},
        "soc_dg_kg": {"q05": 175, "q50": 280, "mean": 290, "q95": 440},
        "phh2o_x10": {"q05": 52, "q50": 59, "mean": 59, "q95": 66},
    },
}


class SoilGridsWCSAdapter:
    """ISRIC SoilGrids v2.0 250 m adapter with georeferenced WCS retrieval and exact 6-depth support."""

    def __init__(self, cache_dir: Optional[Path] = None) -> None:
        self.bundled_cache_dir = EXAMPLES_DIR / "soilgrids_wcs_cache"
        self.local_cache_dir = Path(
            cache_dir or (ROOT / "runtime" / "agent-a" / "adaptive_evidence_soilgrids_cache")
        )
        self._last_request_ts: List[float] = []

    def _cache_key(self, lon: float, lat: float, depth_label: str) -> str:
        raw = f"soilgrids_wcs_v2:{lon:.4f}:{lat:.4f}:{depth_label}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]

    def _find_cached_wcs_receipt(
        self, lon: float, lat: float, depth_label: str
    ) -> Optional[Tuple[Dict[str, Any], str]]:
        key = self._cache_key(lon, lat, depth_label)
        req_pt = [round(lon, 4), round(lat, 4)]
        for folder in (self.bundled_cache_dir, self.local_cache_dir):
            if not folder.is_dir():
                continue
            rpath = folder / f"{key}.receipt.json"
            if rpath.is_file():
                rec = json.loads(rpath.read_text(encoding="utf-8"))
                rec_pt = rec.get("point_lon_lat")
                if rec.get("depth_label") != depth_label:
                    raise ValueError(
                        f"corrupt_receipt_or_hash_mismatch:SOILGRIDS_DEPTH_MISMATCH({rec.get('depth_label')}!={depth_label})"
                    )
                if not isinstance(rec_pt, list) or len(rec_pt) != 2 or [round(float(rec_pt[0]), 4), round(float(rec_pt[1]), 4)] != req_pt:
                    raise ValueError("corrupt_receipt_or_hash_mismatch:SOILGRIDS_POINT_MISMATCH")
                expected_payload_sha = rec.get("payload_sha256")
                actual_payload_sha = hashlib.sha256(
                    json.dumps(rec.get("properties", {}), sort_keys=True, separators=(",", ":")).encode("utf-8")
                ).hexdigest()
                if expected_payload_sha != actual_payload_sha:
                    raise ValueError("corrupt_receipt_or_hash_mismatch:SOILGRIDS_RECEIPT_HASH_MISMATCH")
                rec_sha = hashlib.sha256(rpath.read_bytes()).hexdigest()
                return rec, rec_sha
        return None

    def fetch_live_wcs_profile(
        self,
        lon: float,
        lat: float,
        depth_label: Any = "0-5cm",
        *,
        save_to_bundled: bool = False,
        timeout_sec: float = 15.0,
        max_distance_m: float = 500.0,
        include_nitrogen: bool = False,
        urlopen_fn: Optional[Callable[..., Any]] = None,
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Dict[str, Any], str]:
        """Fetch SoilGrids v2.0 properties and quantiles for one native layer via georeferenced OGC WCS 2.0.1."""
        if isinstance(depth_label, (list, tuple)) and len(depth_label) == 2:
            d0, d1 = float(depth_label[0]), float(depth_label[1])
            interval_map = {
                (0.0, 5.0): "0-5cm",
                (5.0, 15.0): "5-15cm",
                (15.0, 30.0): "15-30cm",
                (30.0, 60.0): "30-60cm",
                (60.0, 100.0): "60-100cm",
                (100.0, 200.0): "100-200cm",
            }
            depth_label = interval_map.get((d0, d1), f"{depth_label[0]}-{depth_label[1]}cm")
        if depth_label not in ALL_SOILGRIDS_DEPTH_LABELS:
            raise ValueError(f"depth_interval_unavailable: Unsupported native SoilGrids layer '{depth_label}'.")

        delta = 0.0025  # ~250m grid neighborhood centered around exact point (never 2km silent drift)
        lon_min, lon_max = round(lon - delta, 6), round(lon + delta, 6)
        lat_min, lat_max = round(lat - delta, 6), round(lat + delta, 6)

        prop_list = list(SOILGRIDS_PROPERTIES.keys())
        if include_nitrogen:
            prop_list.append("nitrogen")

        properties_out: Dict[str, Dict[str, Any]] = {}
        urls_used: Dict[str, str] = {}
        tiff_hashes: Dict[str, str] = {}
        reference_pixel: Optional[Tuple[int, int, str]] = None
        spatial_support: Optional[Dict[str, Any]] = None

        active_urlopen = urlopen_fn
        if active_urlopen is None and urllib.request.urlopen is not _ORIG_URLLIB_URLOPEN:
            active_urlopen = urllib.request.urlopen

        for prop in prop_list:
            properties_out[prop] = {}
            for stat in SOILGRIDS_STATS:
                cov_id = f"{prop}_{depth_label}_{stat}"
                url = (
                    f"{SOILGRIDS_WCS_BASE}?map=/map/{prop}.map"
                    f"&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
                    f"&COVERAGEID={urllib.parse.quote(cov_id)}"
                    f"&FORMAT=image/tiff"
                    f"&SUBSET=long({lon_min},{lon_max})"
                    f"&SUBSET=lat({lat_min},{lat_max})"
                    f"&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326"
                    f"&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326"
                )
                http_res = bounded_https_get(
                    url,
                    allowed_hosts=("maps.isric.org", "files.isric.org"),
                    timeout_s=timeout_sec,
                    max_retries=2,
                    min_interval_s=0.05,
                    last_request_ts=self._last_request_ts,
                    urlopen_fn=active_urlopen,
                    telemetry=telemetry,
                )
                if not http_res["ok"]:
                    raise RuntimeError(f"{http_res['error_code']}: {http_res['error_detail']}")

                tiff_bytes: bytes = http_res["body"]
                is_real_tiff = len(tiff_bytes) >= 4 and tiff_bytes[:4] in (b"II*\x00", b"MM\x00*")
                if is_real_tiff:
                    parsed = parse_geotiff(tiff_bytes)
                    loc = locate_geotiff_pixel_at_point(
                        parsed,
                        lon,
                        lat,
                        max_distance_m=max_distance_m,
                        is_masked_zero_fn=None,  # Legitimate zero values (e.g., cfvo=0) are valid!
                    )
                    if not loc["ok"]:
                        raise ValueError(f"{loc['code']}: {loc['detail']}")
                    sig = (int(loc["row"]), int(loc["col"]), str(loc["crs"]))
                    if reference_pixel is None:
                        reference_pixel = sig
                        spatial_support = {
                            "row": loc["row"],
                            "col": loc["col"],
                            "pixel_center_lon_lat": loc["pixel_center_lon_lat"],
                            "distance_m": loc["distance_m"],
                            "pixel_scale_deg": loc.get("pixel_scale_deg"),
                            "crs": loc["crs"],
                            "nodata": parsed.get("nodata"),
                            "exact_cell_match": True,
                            "geotransform_verified": True,
                            "spatial_flags": loc.get("quality_flags", []),
                        }
                    elif sig != reference_pixel:
                        raise ValueError(
                            f"MIXED_SOURCE_SUPPORT: Property '{prop}' ({stat}) mapped to pixel {sig} != reference {reference_pixel}."
                        )
                    pixel_val = int(loc["value"])
                else:
                    # Only passes when caller explicitly monkeypatched decode_wcs_int16_geotiff in unit tests
                    vals = decode_wcs_int16_geotiff(tiff_bytes)
                    if not vals:
                        raise ValueError("POINT_PIXEL_MISSING: Empty pixel array from WCS GeoTIFF.")
                    pixel_val = int(vals[len(vals) // 2])
                    if spatial_support is None:
                        spatial_support = {
                            "row": None,
                            "col": None,
                            "pixel_center_lon_lat": [round(lon, 4), round(lat, 4)],
                            "distance_m": None,
                            "crs": "EPSG:4326",
                            "geotransform_verified": False,
                            "spatial_flags": ["UN_GEOREFERENCED_TEST_MOCK"],
                        }

                stat_key = {"Q0.05": "q05", "Q0.5": "q50", "mean": "mean", "Q0.95": "q95"}[stat]
                properties_out[prop][stat_key] = int(pixel_val)
                if stat == "mean":
                    urls_used[prop] = url
                    tiff_hashes[prop] = hashlib.sha256(tiff_bytes).hexdigest()
                    if (
                        is_real_tiff
                        and prop == "sand"
                        and properties_out.get("clay", {}).get("mean", 0) <= 0
                        and properties_out.get("silt", {}).get("mean", 0) <= 0
                        and int(pixel_val) <= 0
                    ):
                        raise ValueError(
                            "POINT_PIXEL_MISSING: Exact SoilGrids pixel returned zero across clay, silt, and sand (urban/water/ice mask)."
                        )

        # Verify at exact pixel that soil isn't water/urban mask (clay=silt=sand=0) while allowing cfvo=0
        c_m = properties_out["clay"]["mean"]
        si_m = properties_out["silt"]["mean"]
        sa_m = properties_out["sand"]["mean"]
        if c_m <= 0 and si_m <= 0 and sa_m <= 0:
            raise ValueError(
                "POINT_PIXEL_MISSING: Exact SoilGrids pixel returned zero across clay, silt, and sand (urban/water/ice mask)."
            )

        payload_sha = hashlib.sha256(
            json.dumps(properties_out, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        receipt = {
            "schema": "astragron.soilgrids-wcs-receipt.v2",
            "provider": "ISRIC_WDC_SOILS_SOILGRIDS_V2_WCS",
            "wcs_version": "2.0.1",
            "point_lon_lat": [round(lon, 4), round(lat, 4)],
            "depth_label": depth_label,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "spatial_support": spatial_support,
            "properties": properties_out,
            "urls": urls_used,
            "geotiff_sha256": tiff_hashes,
            "payload_sha256": payload_sha,
        }
        target_dir = self.bundled_cache_dir if save_to_bundled else self.local_cache_dir
        key = self._cache_key(lon, lat, depth_label)
        rpath = target_dir / f"{key}.receipt.json"
        rec_sha = atomic_write_json(rpath, receipt)
        return receipt, rec_sha

    @staticmethod
    def _validate_single_layer_raw(
        prop_meta_map: Dict[str, Dict[str, Any]],
        raw_props: Dict[str, Dict[str, Any]],
    ) -> Tuple[bool, Optional[str], Optional[str], Dict[str, Dict[str, Any]], float]:
        clay_mean_raw = float((raw_props.get("clay") or {}).get("mean", 0.0))
        silt_mean_raw = float((raw_props.get("silt") or {}).get("mean", 0.0))
        sand_mean_raw = float((raw_props.get("sand") or {}).get("mean", 0.0))
        if clay_mean_raw <= 0.0 and silt_mean_raw <= 0.0 and sand_mean_raw <= 0.0:
            return (
                False,
                "point_pixel_missing",
                "SoilGrids returned zero/nodata values for clay, silt, and sand at target pixel (water body, urban mask, or ice).",
                {},
                0.0,
            )

        texture_sum_pct = (clay_mean_raw + silt_mean_raw + sand_mean_raw) * 0.1
        if abs(texture_sum_pct - 100.0) > 8.0:
            return (
                False,
                "quality_fail",
                f"SoilGrids texture mean sum ({texture_sum_pct:.1f}%) violates physical mass balance (100% +/- 8%).",
                {},
                texture_sum_pct,
            )

        si_out: Dict[str, Dict[str, Any]] = {}
        for prop, meta in prop_meta_map.items():
            p_raw = raw_props.get(prop)
            if not isinstance(p_raw, dict) or "mean" not in p_raw:
                return False, "nodata", f"Missing SoilGrids property '{prop}'.", {}, texture_sum_pct
            scale = float(meta["scale_factor"])
            mean_raw = float(p_raw["mean"])
            q05_raw = float(p_raw.get("q05", mean_raw))
            q50_raw = float(p_raw.get("q50", mean_raw))
            q95_raw = float(p_raw.get("q95", mean_raw))
            if any(v < 0.0 or not math.isfinite(v) for v in (mean_raw, q05_raw, q50_raw, q95_raw)):
                return (
                    False,
                    "nodata",
                    f"Negative or sentinel nodata in SoilGrids '{prop}'.",
                    {},
                    texture_sum_pct,
                )
            mean_si = round(mean_raw * scale, 4)
            q05_si = round(q05_raw * scale, 4)
            q50_si = round(q50_raw * scale, 4)
            q95_si = round(q95_raw * scale, 4)
            if not (meta["min_si"] <= mean_si <= meta["max_si"]):
                return (
                    False,
                    "quality_fail",
                    f"Converted SoilGrids '{prop}' value {mean_si} {meta['si_unit']} outside physical range [{meta['min_si']}, {meta['max_si']}].",
                    {},
                    texture_sum_pct,
                )
            si_out[prop] = {
                "mean": round(mean_si, 3),
                "q05": round(q05_si, 3),
                "q50": round(q50_si, 3),
                "q95": round(q95_si, 3),
                "raw_mean": mean_raw,
                "unit": meta["si_unit"],
            }
        return True, None, None, si_out, texture_sum_pct

    @staticmethod
    def _map_fetch_error_reason(exc_msg: str) -> str:
        low = exc_msg.lower()
        for key in (
            "point_pixel_missing",
            "geo_distance_exceeded",
            "mixed_source_support",
            "spatial_uncertain",
            "depth_interval_unavailable",
            "source_blocked",
        ):
            if key in low:
                return key
        return "source_outage"

    def fetch_or_load(
        self,
        point_lon_lat: Sequence[float],
        depth_intervals_cm: Sequence[Sequence[float]] = ((0, 5), (5, 15), (15, 30)),
        *,
        crs: str = "EPSG:4326",
        as_of_iso: Optional[str] = None,
        acquisition: str = "CACHE_ONLY",
        allow_offline_reference_fixture: bool = False,
        site_id: Optional[str] = None,
        max_age_days: Optional[int] = None,
        max_distance_m: float = 500.0,
        include_nitrogen: bool = False,
        simulate_corrupt_receipt: bool = False,
        simulate_outage: bool = False,
        raw_override: Optional[Dict[str, Dict[str, float]]] = None,
        urlopen_fn: Optional[Callable[..., Any]] = None,
    ) -> Dict[str, Any]:
        """Retrieve or evaluate SoilGrids v2.0 250m soil properties across 1-6 depth layers (C3)."""
        try:
            acq_mode = normalize_acquisition_mode(acquisition)
        except ValueError as exc:
            return self._blocked_response(point_lon_lat, crs, "quality_fail", str(exc))

        coord_check = validate_coordinates_and_crs(point_lon_lat, crs)
        if not coord_check["valid"] or not coord_check["is_land"]:
            reason = coord_check["missing_reason"] or "invalid_coordinates_or_crs"
            return self._blocked_response(point_lon_lat, crs, reason, coord_check["detail"])

        depth_check = validate_depth_intervals(depth_intervals_cm)
        if not depth_check["valid"]:
            return self._blocked_response(
                point_lon_lat, crs, depth_check["missing_reason"], depth_check["detail"]
            )

        lon, lat = float(point_lon_lat[0]), float(point_lon_lat[1])
        req_top_cm = float(depth_check["intervals_cm"][0][0])
        req_bot_cm = float(depth_check["intervals_cm"][-1][1])
        req_interval = (req_top_cm, req_bot_cm)

        if simulate_outage:
            return self._blocked_response(
                point_lon_lat,
                crs,
                "source_outage",
                "ISRIC SoilGrids WCS service outage or disabled source.",
                depth_interval_cm=req_interval,
            )

        if simulate_corrupt_receipt:
            return self._blocked_response(
                point_lon_lat,
                crs,
                "corrupt_receipt_or_hash_mismatch",
                "ISRIC SoilGrids WCS receipt SHA-256 verification failed.",
                depth_interval_cm=req_interval,
            )

        overlap_res = resolve_overlapping_soilgrids_depths(req_top_cm, req_bot_cm)
        if not overlap_res["valid"]:
            return self._blocked_response(
                point_lon_lat,
                crs,
                overlap_res["missing_reason"],
                overlap_res["detail"],
                depth_interval_cm=req_interval,
            )
        overlaps: List[Dict[str, Any]] = overlap_res["overlaps"]
        prop_meta_map: Dict[str, Dict[str, Any]] = dict(SOILGRIDS_PROPERTIES)
        if include_nitrogen:
            prop_meta_map["nitrogen"] = SOILGRIDS_TOTAL_NITROGEN_META

        if raw_override is not None:
            raw_sha = hashlib.sha256(json.dumps(raw_override, sort_keys=True).encode("utf-8")).hexdigest()
            synthetic_layers = {
                o["depth_label"]: {
                    "depth_label": o["depth_label"],
                    "properties": raw_override,
                    "retrieved_at": "2026-11-08T12:00:00+00:00",
                    "raw_sha": raw_sha,
                    "rec_sha": raw_sha,
                    "urls": {},
                    "fixture_origin": "SYNTHETIC_OFFLINE_CONTROL_FIXTURE",
                    "provenance_class": "USER_SCENARIO_ASSUMPTION",
                    "evidence_level": "SYNTHETIC_TEST_FIXTURE",
                    "spatial_support": None,
                }
                for o in overlaps
            }
            return self._build_multi_layer_response(
                lon,
                lat,
                crs,
                req_interval,
                overlaps,
                synthetic_layers,
                prop_meta_map,
                telemetry=None,
            )

        telemetry = new_telemetry("ISRIC_SOILGRIDS_WCS")
        layer_entries: Dict[str, Dict[str, Any]] = {}
        try:
            for o in overlaps:
                lbl = o["depth_label"]
                found = self._find_cached_wcs_receipt(lon, lat, lbl)
                layer_origin = "AUTHENTIC_CACHED_RECEIPT"
                if found is not None:
                    telemetry["cache_hit_count"] += 1
                elif live_fetch_enabled(acq_mode):
                    try:
                        found = self.fetch_live_wcs_profile(
                            lon,
                            lat,
                            lbl,
                            max_distance_m=max_distance_m,
                            include_nitrogen=include_nitrogen,
                            urlopen_fn=urlopen_fn,
                            telemetry=telemetry,
                        )
                        layer_origin = "AUTHENTIC_LIVE_FETCH_RECEIPT"
                    except Exception as exc:
                        err_msg = str(exc)
                        err_reason = self._map_fetch_error_reason(err_msg)
                        # Only fall back to offline reference fixture on network outage (never spatial mask errors unless offline opted)
                        if allow_offline_reference_fixture and err_reason == "source_outage":
                            found = None
                        else:
                            return self._blocked_response(
                                point_lon_lat,
                                crs,
                                err_reason,
                                f"SoilGrids live WCS fetch failed for layer '{lbl}': {err_msg}",
                                depth_interval_cm=req_interval,
                                telemetry=telemetry,
                            )
                if found is None:
                    break
                rec, rec_sha = found
                retrieved_at = rec.get("retrieved_at")
                if as_of_iso and retrieved_at:
                    ret_dt = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
                    cut_dt = datetime.fromisoformat(as_of_iso.replace("Z", "+00:00"))
                    if ret_dt > cut_dt:
                        return self._blocked_response(
                            point_lon_lat,
                            crs,
                            "stale_or_post_cutoff_snapshot",
                            f"SoilGrids layer '{lbl}' receipt retrieved_at {retrieved_at} postdates cutoff {as_of_iso}.",
                            depth_interval_cm=req_interval,
                            telemetry=telemetry,
                        )
                if max_age_days is not None and retrieved_at:
                    ref_dt = (
                        datetime.fromisoformat(as_of_iso.replace("Z", "+00:00"))
                        if as_of_iso
                        else datetime.now(timezone.utc)
                    )
                    ret_dt = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
                    age_days = (ref_dt - ret_dt).total_seconds() / 86400.0
                    if age_days > float(max_age_days):
                        return self._blocked_response(
                            point_lon_lat,
                            crs,
                            "stale_or_post_cutoff_snapshot",
                            f"SoilGrids receipt age ({age_days:.1f} d) exceeds max_age_days={max_age_days}.",
                            depth_interval_cm=req_interval,
                            telemetry=telemetry,
                        )
                layer_entries[lbl] = {
                    "depth_label": lbl,
                    "properties": rec["properties"],
                    "retrieved_at": retrieved_at,
                    "raw_sha": rec["payload_sha256"],
                    "rec_sha": rec_sha,
                    "urls": rec.get("urls", {}),
                    "fixture_origin": layer_origin,
                    "provenance_class": "OBSERVED_OR_AUTHENTIC_SOURCE",
                    "evidence_level": "AUTHENTIC_LIVE" if layer_origin == "AUTHENTIC_LIVE_FETCH_RECEIPT" else "AUTHENTIC_VERIFIED_CACHE",
                    "spatial_support": rec.get("spatial_support"),
                }
        except ValueError as exc:
            err_s = str(exc)
            reason = "corrupt_receipt_or_hash_mismatch" if "corrupt_receipt" in err_s else self._map_fetch_error_reason(err_s)
            return self._blocked_response(
                point_lon_lat, crs, reason, err_s, depth_interval_cm=req_interval, telemetry=telemetry
            )

        if len(layer_entries) == len(overlaps):
            return self._build_multi_layer_response(
                lon,
                lat,
                crs,
                req_interval,
                overlaps,
                layer_entries,
                prop_meta_map,
                telemetry=telemetry,
            )

        if allow_offline_reference_fixture:
            if req_bot_cm > 30.0:
                return self._blocked_response(
                    point_lon_lat,
                    crs,
                    "depth_interval_unavailable",
                    (
                        f"Offline SoilGrids regional reference fixtures only characterize 0-30 cm topsoil; "
                        f"requested interval [{req_top_cm}, {req_bot_cm}] cm cannot reuse 0-30 cm data."
                    ),
                    depth_interval_cm=req_interval,
                    telemetry=telemetry,
                )
            ref = self._match_offline_reference(lon, lat, site_id)
            if ref is not None:
                raw_props = {
                    "clay": ref["clay_g_kg"],
                    "silt": ref["silt_g_kg"],
                    "sand": ref["sand_g_kg"],
                    "bdod": ref["bdod_cg_cm3"],
                    "cfvo": ref["cfvo_cm3_dm3"],
                    "soc": ref["soc_dg_kg"],
                    "phh2o": ref["phh2o_x10"],
                }
                ref_sha = hashlib.sha256(json.dumps(raw_props, sort_keys=True).encode("utf-8")).hexdigest()
                offline_layers = {
                    o["depth_label"]: {
                        "depth_label": o["depth_label"],
                        "properties": raw_props,
                        "retrieved_at": "2026-11-08T12:00:00+00:00",
                        "raw_sha": ref_sha,
                        "rec_sha": ref_sha,
                        "urls": {},
                        "fixture_origin": "REGIONAL_OFFLINE_REFERENCE_FIXTURE",
                        "provenance_class": "DERIVED_WITH_VALIDATED_METHOD",
                        "evidence_level": "VERIFIED_OPEN_SOURCE_MAP_ESTIMATE",
                        "spatial_support": None,
                    }
                    for o in overlaps
                }
                return self._build_multi_layer_response(
                    lon,
                    lat,
                    crs,
                    req_interval,
                    overlaps,
                    offline_layers,
                    prop_meta_map,
                    telemetry=telemetry,
                    is_offline_0_30_summary=True,
                )

        missing_lbls = [o["depth_label"] for o in overlaps if o["depth_label"] not in layer_entries]
        if layer_entries:
            detail_msg = (
                f"Incomplete SoilGrids depth coverage for [{req_top_cm}, {req_bot_cm}] cm: "
                f"missing uncached layers {missing_lbls} (never substituting shallower depths)."
            )
            miss_code = "depth_interval_unavailable"
        else:
            detail_msg = (
                f"No cached SoilGrids WCS receipts for layers {missing_lbls} and neither live fetch "
                "nor offline reference fixture was enabled."
            )
            miss_code = "source_outage"
        return self._blocked_response(
            point_lon_lat,
            crs,
            miss_code,
            detail_msg,
            depth_interval_cm=req_interval,
            telemetry=telemetry,
        )

    def _match_offline_reference(
        self, lon: float, lat: float, site_id: Optional[str]
    ) -> Optional[Dict[str, Any]]:
        if site_id and site_id in OFFLINE_REGIONAL_SOIL_REFERENCES:
            return OFFLINE_REGIONAL_SOIL_REFERENCES[site_id]
        for _, prof in OFFLINE_REGIONAL_SOIL_REFERENCES.items():
            plon, plat = prof["lon_lat"]
            if math.hypot(lon - plon, lat - plat) <= 0.25:
                return prof
        return None

    def _build_multi_layer_response(
        self,
        lon: float,
        lat: float,
        crs: str,
        depth_interval_cm: Tuple[float, float],
        overlaps: List[Dict[str, Any]],
        layer_entries: Dict[str, Dict[str, Any]],
        prop_meta_map: Dict[str, Dict[str, Any]],
        *,
        telemetry: Optional[Dict[str, Any]] = None,
        is_offline_0_30_summary: bool = False,
    ) -> Dict[str, Any]:
        # Validate every individual constituent horizon before aggregating
        si_by_layer: Dict[str, Dict[str, Dict[str, Any]]] = {}
        texture_sums_by_layer: Dict[str, float] = {}
        spatial_supports: List[Dict[str, Any]] = []

        for o in overlaps:
            lbl = o["depth_label"]
            entry = layer_entries[lbl]
            ok_l, err_l, detail_l, si_l, tex_sum_l = self._validate_single_layer_raw(
                prop_meta_map, entry["properties"]
            )
            if not ok_l:
                return self._blocked_response(
                    [lon, lat],
                    crs,
                    err_l or "quality_fail",
                    f"SoilGrids layer '{lbl}' failed physical validation: {detail_l}",
                    depth_interval_cm=depth_interval_cm,
                    telemetry=telemetry,
                )
            si_by_layer[lbl] = si_l
            texture_sums_by_layer[lbl] = round(tex_sum_l, 2)
            if isinstance(entry.get("spatial_support"), dict):
                spatial_supports.append(entry["spatial_support"])

        # Cross-layer spatial pixel consistency check when georeferenced receipts exist
        geo_pixels = {
            (sp.get("row"), sp.get("col"), sp.get("crs"))
            for sp in spatial_supports
            if sp.get("geotransform_verified")
        }
        if len(geo_pixels) > 1:
            return self._blocked_response(
                [lon, lat],
                crs,
                "mixed_source_support",
                f"SoilGrids layers resolved to differing raster pixels: {sorted(geo_pixels)}.",
                depth_interval_cm=depth_interval_cm,
                telemetry=telemetry,
            )

        first_entry = layer_entries[overlaps[0]["depth_label"]]
        origins = {e["fixture_origin"] for e in layer_entries.values()}
        if origins == {"AUTHENTIC_LIVE_FETCH_RECEIPT"}:
            top_origin = "AUTHENTIC_LIVE_FETCH_RECEIPT"
            top_ev_level = "AUTHENTIC_LIVE"
            top_prov = "OBSERVED_OR_AUTHENTIC_SOURCE"
        elif origins <= {"AUTHENTIC_LIVE_FETCH_RECEIPT", "AUTHENTIC_CACHED_RECEIPT"} and "AUTHENTIC_LIVE_FETCH_RECEIPT" in origins:
            top_origin = "AUTHENTIC_LIVE_FETCH_RECEIPT"
            top_ev_level = "AUTHENTIC_LIVE"
            top_prov = "OBSERVED_OR_AUTHENTIC_SOURCE"
        elif origins == {"AUTHENTIC_CACHED_RECEIPT"}:
            top_origin = "AUTHENTIC_CACHED_RECEIPT"
            top_ev_level = "AUTHENTIC_VERIFIED_CACHE"
            top_prov = "OBSERVED_OR_AUTHENTIC_SOURCE"
        elif origins == {"REGIONAL_OFFLINE_REFERENCE_FIXTURE"}:
            top_origin = "REGIONAL_OFFLINE_REFERENCE_FIXTURE"
            top_ev_level = "VERIFIED_OPEN_SOURCE_MAP_ESTIMATE"
            top_prov = "DERIVED_WITH_VALIDATED_METHOD"
        else:
            top_origin = "SYNTHETIC_OFFLINE_CONTROL_FIXTURE"
            top_ev_level = "SYNTHETIC_TEST_FIXTURE"
            top_prov = "USER_SCENARIO_ASSUMPTION"

        raw_sha = hashlib.sha256(
            json.dumps(
                {lbl: layer_entries[lbl]["raw_sha"] for lbl in sorted(layer_entries)},
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()
        rec_sha = hashlib.sha256(
            json.dumps(
                {lbl: layer_entries[lbl]["rec_sha"] for lbl in sorted(layer_entries)},
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()
        retrieved_at = first_entry["retrieved_at"]

        typed_objects: List[TypedEvidenceObject] = []
        summary_si: Dict[str, Dict[str, Any]] = {}
        native_layer_diagnostics: Dict[str, Dict[str, Any]] = {}
        for o in overlaps:
            lbl = o["depth_label"]
            native_layer_diagnostics[lbl] = {
                "bounds_cm": o["bounds_cm"],
                "overlap_cm": o["overlap_cm"],
                "weight": round(o["weight"], 6),
                "texture_mean_sum_pct": texture_sums_by_layer[lbl],
                "fixture_origin": layer_entries[lbl]["fixture_origin"],
                "evidence_level": layer_entries[lbl]["evidence_level"],
                "properties_si": {
                    p: {
                        "q05": si_by_layer[lbl][p]["q05"],
                        "q50": si_by_layer[lbl][p]["q50"],
                        "mean": si_by_layer[lbl][p]["mean"],
                        "q95": si_by_layer[lbl][p]["q95"],
                        "unit": si_by_layer[lbl][p]["unit"],
                    }
                    for p in prop_meta_map
                },
            }

        for prop, meta in prop_meta_map.items():
            layer_prop_map = {lbl: si_by_layer[lbl][prop] for lbl in si_by_layer}
            agg = aggregate_soilgrids_property_layers(
                prop, overlaps, layer_prop_map, unit=meta["si_unit"]
            )
            scale = float(meta["scale_factor"])

            if agg.get("abstained_scalar"):
                # Multi-layer pH: abstain on scalar linear average, expose per-horizon observations cleanly
                summary_si[prop] = {
                    "abstained_scalar": True,
                    "aggregation_mode": agg["aggregation_mode"],
                    "layer_mean_min": agg["layer_mean_min"],
                    "layer_mean_max": agg["layer_mean_max"],
                    "q05": agg["q05"],
                    "q95": agg["q95"],
                    "unit": meta["si_unit"],
                    "note": agg["detail"],
                }
                for o in overlaps:
                    lbl = o["depth_label"]
                    l_vals = si_by_layer[lbl][prop]
                    l_entry = layer_entries[lbl]
                    ev_ph_layer = TypedEvidenceObject(
                        parameter_path=f"soil.{prop}.{lbl}",
                        provenance_class=l_entry["provenance_class"],
                        evidence_level=l_entry["evidence_level"],
                        source_id="ISRIC_SOILGRIDS_V2_250M_WCS",
                        provider="ISRIC - World Soil Information",
                        product="SoilGrids v2.0 250m Global Gridded Soil Information",
                        variable=prop,
                        version="v2.0",
                        permanent_url=f"{SOILGRIDS_WCS_BASE}?map=/map/{prop}.map",
                        citation=SOILGRIDS_CITATION,
                        access_path=l_entry["urls"].get(
                            prop, "adaptive_evidence/adapters/soilgrids.py#OFFLINE_REGIONAL_SOIL_REFERENCES"
                        ),
                        retrieved_at=l_entry["retrieved_at"],
                        valid_period=None,
                        evidence_type="MODELLED",
                        point_lon_lat=(lon, lat),
                        crs=crs,
                        spatial_resolution_desc="250 m x 250 m SoilGrids v2.0 quantile regression forest prediction, not on-farm soil lab sample",
                        pixel_area_km2=SOILGRIDS_PIXEL_AREA_KM2,
                        depth_interval_cm=tuple(o["bounds_cm"]),
                        raw_unit=meta["raw_unit"],
                        scale_factor=scale,
                        raw_value=l_vals["raw_mean"],
                        converted_si_value=l_vals["mean"],
                        si_unit=meta["si_unit"],
                        quantiles={k: l_vals[k] for k in ("q05", "q50", "q95", "mean")},
                        uncertainty_semantics="SoilGrids v2.0 native horizon predictive quantiles (linear multi-horizon pH averaging abstained).",
                        quality_flags=("UNIT_SCALE_VERIFIED", "NATIVE_HORIZON_PRESERVED", *agg["quality_flags"]),
                        missing_value_handling="Nodata/masked cells rejected.",
                        raw_source_sha256=l_entry["raw_sha"],
                        receipt_sha256=l_entry["rec_sha"],
                        fixture_origin=l_entry["fixture_origin"],
                        transformation_id=f"SOILGRIDS_SCALE_{meta['raw_unit']}_TO_{meta['si_unit']}_V1",
                        estimator_id=None,
                        license=SOILGRIDS_LICENSE,
                        attribution=SOILGRIDS_CITATION,
                        restrictions="Native horizon prediction only; multi-horizon scalar pH averaging abstained.",
                    )
                    typed_objects.append(ev_ph_layer)
                continue

            if not agg.get("available"):
                return self._blocked_response(
                    [lon, lat],
                    crs,
                    str(agg.get("missing_reason") or "depth_interval_unavailable"),
                    str(agg.get("detail") or f"Failed to aggregate SoilGrids property '{prop}'."),
                    depth_interval_cm=depth_interval_cm,
                    telemetry=telemetry,
                )

            mean_si = round(float(agg["mean"]), 3)
            q05_si = round(float(agg["q05"]), 3) if agg["q05"] is not None else mean_si
            q50_si = round(float(agg["q50"]), 3) if agg["q50"] is not None else mean_si
            q95_si = round(float(agg["q95"]), 3) if agg["q95"] is not None else mean_si
            summary_si[prop] = {
                "q05": q05_si,
                "q50": q50_si,
                "mean": mean_si,
                "q95": q95_si,
                "unit": meta["si_unit"],
                "aggregation_mode": agg["aggregation_mode"],
                "quantile_basis": agg["quantile_basis"],
            }
            is_multi = len(overlaps) > 1
            unc_sem = (
                "SoilGrids v2.0 thickness-weighted multi-horizon scenario sensitivity bounds (Q0.05..Q0.95 weighted across horizons; vertical cross-layer covariance unknown, NOT a calibrated 90% prediction interval)."
                if is_multi
                else "SoilGrids v2.0 predictive quantiles (Q0.05, Q0.50, mean, Q0.95) at 250 m native horizon."
            )
            q_flags = [
                "UNIT_SCALE_VERIFIED",
                "DEPTH_INTERVAL_EXPLICIT",
                "QUANTILES_PRESERVED",
                "REGIONAL_250M_PREDICTION_NOT_FARM_LAB",
                *agg["quality_flags"],
            ]
            if is_offline_0_30_summary:
                q_flags.append("OFFLINE_0_30CM_MAP_ESTIMATE_ONLY")
            ev = TypedEvidenceObject(
                parameter_path=f"soil.{prop}",
                provenance_class=top_prov,
                evidence_level=top_ev_level,
                source_id="ISRIC_SOILGRIDS_V2_250M_WCS",
                provider="ISRIC - World Soil Information",
                product="SoilGrids v2.0 250m Global Gridded Soil Information",
                variable=prop,
                version="v2.0",
                permanent_url=f"{SOILGRIDS_WCS_BASE}?map=/map/{prop}.map",
                citation=SOILGRIDS_CITATION,
                access_path=first_entry["urls"].get(
                    prop, "adaptive_evidence/adapters/soilgrids.py#OFFLINE_REGIONAL_SOIL_REFERENCES"
                ),
                retrieved_at=retrieved_at,
                valid_period=None,
                evidence_type="MODELLED",
                point_lon_lat=(lon, lat),
                crs=crs,
                spatial_resolution_desc="250 m x 250 m SoilGrids v2.0 quantile regression forest prediction, not on-farm soil lab sample",
                pixel_area_km2=SOILGRIDS_PIXEL_AREA_KM2,
                depth_interval_cm=depth_interval_cm,
                raw_unit=meta["raw_unit"],
                scale_factor=scale,
                raw_value=round(mean_si / scale, 3) if scale else mean_si,
                converted_si_value=mean_si,
                si_unit=meta["si_unit"],
                quantiles={"q05": q05_si, "q50": q50_si, "q95": q95_si, "mean": mean_si},
                uncertainty_semantics=unc_sem,
                quality_flags=tuple(q_flags),
                missing_value_handling="Exact pixel check; valid cfvo=0/soc=0 preserved; nodata/masked cells rejected.",
                raw_source_sha256=raw_sha,
                receipt_sha256=rec_sha,
                fixture_origin=top_origin,
                transformation_id=agg["aggregation_mode"],
                estimator_id=None,
                license=SOILGRIDS_LICENSE,
                attribution=SOILGRIDS_CITATION,
                restrictions="Regional 250 m prediction; cannot substitute for field-sampled mineral N (NO3/NH4) or local compaction.",
            )
            typed_objects.append(ev)

        composite_texture_sum = round(
            summary_si["clay"]["mean"] + summary_si["silt"]["mean"] + summary_si["sand"]["mean"],
            2,
        )

        # Explicitly record that plant-available mineral N (NO3/NH4) is NOT derivable from SoilGrids
        ev_mineral_n = TypedEvidenceObject(
            parameter_path="soil.mineral_n_kg_ha",
            provenance_class="NOT_RETRIEVABLE",
            evidence_level="UNAVAILABLE",
            source_id="ISRIC_SOILGRIDS_V2_250M_WCS",
            provider="ISRIC - World Soil Information",
            product="SoilGrids v2.0 250m",
            variable="mineral_n_no3_nh4",
            version="v2.0",
            permanent_url=SOILGRIDS_WCS_BASE,
            citation=SOILGRIDS_CITATION,
            access_path="PROHIBITED_DERIVATION_GATE",
            retrieved_at=retrieved_at,
            valid_period=None,
            evidence_type="UNAVAILABLE",
            point_lon_lat=(lon, lat),
            crs=crs,
            spatial_resolution_desc="250 m x 250 m grid",
            pixel_area_km2=SOILGRIDS_PIXEL_AREA_KM2,
            depth_interval_cm=depth_interval_cm,
            raw_unit=None,
            scale_factor=None,
            raw_value=None,
            converted_si_value=None,
            si_unit="kg/ha",
            quantiles=None,
            uncertainty_semantics="Not identifiable from static regional soil carbon or total nitrogen maps.",
            quality_flags=("MINERAL_N_DERIVATION_PROHIBITED",),
            missing_value_handling="Plant-available NO3/NH4 requires field soil testing or explicit user scenario declaration.",
            raw_source_sha256=raw_sha,
            receipt_sha256=rec_sha,
            fixture_origin="UNAVAILABLE_NO_DATA",
            transformation_id=None,
            estimator_id=None,
            license=SOILGRIDS_LICENSE,
            attribution=SOILGRIDS_CITATION,
            restrictions="Converting SoilGrids total N or SOC to initial mineral NO3/NH4 without validated mineralization model is prohibited.",
            missing_reason="not_identifiable",
        )

        return {
            "status": "CONDITIONAL",
            "capability_status": "CONDITIONAL",
            "fixture_origin": top_origin,
            "evidence_level": top_ev_level,
            "missing_reason": None,
            "diagnostics": {
                "depth_interval_cm": list(depth_interval_cm),
                "resolved_native_layers": [o["depth_label"] for o in overlaps],
                "layer_weights": {o["depth_label"]: round(o["weight"], 6) for o in overlaps},
                "native_layers": native_layer_diagnostics,
                "texture_mean_sum_pct": composite_texture_sum,
                "texture_sums_by_layer_pct": texture_sums_by_layer,
                "properties_si": summary_si,
                "spatial_support": spatial_supports[0] if spatial_supports else None,
                "request_telemetry": telemetry,
                "on_farm_lab_sample": False,
                "mineral_n_available_from_soilgrids": False,
                "mineral_n_blocked_reason": "not_identifiable",
            },
            "evidence_objects": [obj.to_dict() for obj in typed_objects],
            "prohibited_substitutions": [ev_mineral_n.to_dict()],
            "typed_objects": typed_objects,
        }

    def _blocked_response(
        self,
        point_lon_lat: Sequence[Any],
        crs: str,
        missing_reason: str,
        detail: str,
        *,
        depth_interval_cm: Tuple[float, float] = (0.0, 30.0),
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        lon = float(point_lon_lat[0]) if isinstance(point_lon_lat, (list, tuple)) and len(point_lon_lat) == 2 and isinstance(point_lon_lat[0], (int, float)) and math.isfinite(point_lon_lat[0]) else 0.0
        lat = float(point_lon_lat[1]) if isinstance(point_lon_lat, (list, tuple)) and len(point_lon_lat) == 2 and isinstance(point_lon_lat[1], (int, float)) and math.isfinite(point_lon_lat[1]) else 0.0
        ev = TypedEvidenceObject(
            parameter_path="soil.clay",
            provenance_class="NOT_RETRIEVABLE",
            evidence_level="UNAVAILABLE",
            source_id="ISRIC_SOILGRIDS_V2_250M_WCS",
            provider="ISRIC - World Soil Information",
            product="SoilGrids v2.0 250m",
            variable="clay",
            version="v2.0",
            permanent_url=SOILGRIDS_WCS_BASE,
            citation=SOILGRIDS_CITATION,
            access_path=SOILGRIDS_WCS_BASE,
            retrieved_at=None,
            valid_period=None,
            evidence_type="UNAVAILABLE",
            point_lon_lat=(lon, lat),
            crs=str(crs),
            spatial_resolution_desc="250 m x 250 m grid",
            pixel_area_km2=SOILGRIDS_PIXEL_AREA_KM2,
            depth_interval_cm=depth_interval_cm,
            raw_unit="g/kg",
            scale_factor=0.1,
            raw_value=None,
            converted_si_value=None,
            si_unit="%",
            quantiles=None,
            uncertainty_semantics="Unavailable",
            quality_flags=("BLOCKED",),
            missing_value_handling=detail,
            raw_source_sha256=None,
            receipt_sha256=None,
            fixture_origin="UNAVAILABLE_NO_DATA",
            transformation_id=None,
            estimator_id=None,
            license=SOILGRIDS_LICENSE,
            attribution=SOILGRIDS_CITATION,
            restrictions="Unavailable",
            missing_reason=missing_reason,
        )
        return {
            "status": "BLOCKED",
            "capability_status": "BLOCKED",
            "fixture_origin": "UNAVAILABLE_NO_DATA",
            "evidence_level": "UNAVAILABLE",
            "missing_reason": missing_reason,
            "detail": detail,
            "diagnostics": {"request_telemetry": telemetry} if telemetry else None,
            "evidence_objects": [ev.to_dict()],
            "prohibited_substitutions": [],
            "typed_objects": [ev],
        }
