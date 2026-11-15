"""ASTRAGRON Global Adaptive Evidence & Intelligent Fallback Sidecar.

Independent versioned module (`astragron.adaptive-evidence.v1`) that evaluates
geographic coverage, source provenance, defensible estimators, and capability
readiness (`C1`..`C10`) without altering the upstream scientific engine (`brain/`)
or protected baseline files (`SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109/release/`).
"""

SCHEMA_VERSION = "astragron.adaptive-evidence.v1"
MODULE_VERSION = "1.0.0"

from .adapters import FAOGAEZAdapter, NASAPowerAdapter, SoilGridsWCSAdapter
from .engine import AdaptiveEvidenceEngine
from .integration import AdaptiveClientDecisionBridge
from .schema import TypedEvidenceObject
from .sensitivity import DecisionSensitivityAnalyzer

__all__ = [
    "SCHEMA_VERSION",
    "MODULE_VERSION",
    "AdaptiveEvidenceEngine",
    "DecisionSensitivityAnalyzer",
    "AdaptiveClientDecisionBridge",
    "TypedEvidenceObject",
    "NASAPowerAdapter",
    "SoilGridsWCSAdapter",
    "FAOGAEZAdapter",
]
