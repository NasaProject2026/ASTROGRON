# Third-Party Software and Data Notices — ASTRAGRON Adaptive Evidence

This notice applies to the `adaptive_evidence` sidecar package and associated tests/examples. Original owned sidecar code is governed by **Apache-2.0** per owner approval (without creating or modifying a root repository `LICENSE`). Third-party software libraries and scientific datasets retain their original licenses below.

## 1. Third-Party Python & Native Software Dependencies
| Component | Version | SPDX License | Transitive Native Library / Obligation |
|---|---|---|---|
| `shapely` | 2.2.0 | `BSD-3-Clause` | Bundles GEOS (`LGPL-2.1-or-later`); retain BSD-3-Clause & LGPL-2.1 notices when redistributing wheels |
| `pyproj` | 3.7.2 | `MIT` | Bundles PROJ (`MIT`); retain MIT notice |
| `pyshp` | 3.0.3 | `MIT` | Pure Python shapefile reader; retain MIT notice |
| `certifi` | 2026.1.4 | `MPL-2.0` | Mozilla CA bundle under MPL-2.0 |
| `numpy` | 2.x | `BSD-3-Clause` | Retain BSD-3-Clause notice |

## 2. Scientific Data Providers & Mandatory Attributions
- **NASA POWER Project**: Langley Research Center (LaRC) POWER Daily Point API v2 (`T2M_MIN`, `T2M_MAX`, `PRECTOTCORR`, `ALLSKY_SFC_SW_DWN`). NASA Earth Science / Public Domain. Cite: *NASA Prediction Of Worldwide Energy Resources (POWER)*.
- **ISRIC SoilGrids v2.0**: Poggio et al. (2021), *SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty*, SOIL 7, 217–240. **CC BY 4.0** (`https://creativecommons.org/licenses/by/4.0/`). CC BY 4.0 is a data license, NOT Apache-2.0.
- **Natural Earth 10m Physical Vectors**: Made with Natural Earth (`ne_10m_land`, `ne_10m_lakes`, `ne_10m_minor_islands`). **Public Domain** (`https://www.naturalearthdata.com/about/terms-of-use/`).
- **FAO & IIASA GAEZ v4 / v5**: Fischer et al. (2021). **Disabled by default**; enabled ONLY when a caller supplies a per-layer receipt carrying an explicit non-commercial-free open license (`CC-BY-4.0`).

## 3. Pedotransfer & Agronomic Formulas (Cited Methods)
- **Saxton & Rawls (2006)**: *Soil Water Characteristic Estimates by Texture and Organic Matter for Hydrologic Solutions*, SSSAJ 70:1569–1578.
- **Wosten et al. (1999)**: *Development and use of a database of hydraulic properties of European soils*, Geoderma 90:169–185.
- **Allen et al. (1998)** & **Hargreaves-Samani (1985)**: FAO-56 reference evapotranspiration & conditional screening formulas.
