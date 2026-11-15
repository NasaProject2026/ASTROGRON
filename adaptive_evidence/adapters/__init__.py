"""Real-source and offline-verifiable adapters for ASTRAGRON Global Adaptive Evidence."""
from .nasa_power import NASAPowerAdapter
from .soilgrids import SoilGridsWCSAdapter
from .fao_gaez import FAOGAEZAdapter

__all__ = ["NASAPowerAdapter", "SoilGridsWCSAdapter", "FAOGAEZAdapter"]
