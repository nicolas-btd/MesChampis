# MesChampis

Interactive web map of forest habitat variables at 25 m resolution over the Puy-de-Dôme (France), built from IGN open data (LiDAR HD, BD ALTI, BD Forêt), with a private, encrypted field notebook for mushroom foraging.

---

<div align="center">
  <img src="docs/img/app_desktop.png" alt="MesChampis web map - LiDAR HD canopy height layer" width="850"/>
  <p><em>Canopy height layer (LiDAR HD, 90th percentile) over the Chaîne des Puys, rendered on the IGN orthophoto basemap.</em></p>
</div>

---

## Overview & Goals

- **Fine-Grained Forest Description**: BD Forêt polygons are often several hundred hectares wide and hide the terrain inside them. The project resamples everything onto a common 25 m grid (Lambert-93) so that slope, aspect, canopy cover and distance to the forest edge can be read cell by cell.
- **Open Data Fusion**: Combines the IGN LiDAR HD canopy height model (MNH, 50 cm), the BD ALTI 25 m elevation model and the BD Forêt V2 vegetation map.
- **Lightweight Static Delivery**: The whole department is packed into small gzip binary tiles that the browser decodes directly, with no backend or tile server.
- **Privacy First**: Field observations stay on the device (IndexedDB) and can be exported as an encrypted backup file.

---

## Technical Stack

- **Language**: Python 3.10+, JavaScript (ES modules, Web Worker)
- **Geospatial Processing**: GeoPandas, Rasterio, rasterstats, Shapely
- **Scientific Computing**: NumPy, SciPy (`ndimage.distance_transform_edt`, connected-component labelling)
- **Data Access**: IGN Géoplateforme WFS (LiDAR HD tile catalogue), `requests`
- **Web Mapping**: MapLibre GL JS 4.7.1, Proj4js (Lambert-93 `EPSG:2154` ↔ WGS84 `EPSG:4326`)
- **Browser Storage & Crypto**: IndexedDB, Web Crypto API (PBKDF2-SHA-256 + AES-GCM 256)

---

## Key Features

- **7 Map Layers at 25 m**: aspect, elevation, slope, distance to forest edge, dominant tree species (14 BD Forêt classes), LiDAR canopy cover (% of points ≥ 3 m) and LiDAR canopy height (90th percentile).
- **LiDAR-Corrected Forest Mask**: BD Forêt is cross-checked against LiDAR cover. Cells with ≥ 50 % cover are kept as forest after removing clusters smaller than 8 cells and filling holes of 1–2 cells; BD Forêt cells without trees are flagged as clearings or clear-cuts.
- **Cell Inspector**: Clicking the map shows the decoded values of the cell under the cursor.
- **Field Notebook**: Observations (found / nothing found) are geolocated and store a snapshot of the cell's habitat values. Data lives in IndexedDB and can be exported/imported as an encrypted `.mcb` file (password → PBKDF2 → AES-GCM).
- **Quick Navigation**: Shortcut buttons to the main forest areas (Chaîne des Puys, Sancy, Livradois, Combrailles, Bois Noirs).
- **Demo Mode (`?demo=1`)**: A simulated backend (accounts, encrypted sync, e-mails) used to prototype the future server API, plus an experimental habitat heatmap computed in a Web Worker with a simple hand-tuned scoring rule.

---

## Development Steps

1. **Grid Synthesis (`prep/01_parcelles.py`, `prep/03_grille.py`)**:
   - Rasterisation of BD Forêt, slope and aspect from BD ALTI, Euclidean distance to the forest edge, and export of 256 × 256 binary tiles with a JSON manifest.
2. **LiDAR HD Integration (`prep/04a_inventaire_mnh.py`, `prep/04_couvert.py`)**:
   - Query of the LiDAR HD tile catalogue through WFS, filtering against BD Forêt to skip non-forest areas, then threaded download and aggregation of each 1 km tile (2000 × 2000 px at 50 cm → 40 × 40 cells at 25 m). Progress is logged so an interrupted run can resume.
3. **Web Map (`web/js/grille.js`, `web/js/couleurs.js`, `web/js/legende.js`)**:
   - Tile decoding with typed arrays, colour palettes per layer, rendering as MapLibre image sources.
4. **Field Notebook & Encryption (`web/js/carnet.js`, `web/js/db.js`, `web/js/crypto_compte.js`)**:
   - IndexedDB storage, encrypted export/import, and a client-side key scheme (master key wrapped by password and recovery code) designed for a future end-to-end encrypted sync. The server side is not implemented yet; see `docs/API.md` for the planned contract.

---

## Data at a Glance

| Item | Value |
| :--- | :--- |
| Grid extent | 5,120 × 4,352 cells (128 km × 109 km, Lambert-93) |
| Cells with valid LiDAR HD data | 9,332,232 (≈ 5,833 km²) |
| Tiles exported (cells with forest only) | 247 of 340 |
| Total size of tiles (gzip) | ≈ 46 MB |
| Bytes per cell | 9 |

### Tile Format

Each tile is a gzip file of 256 × 256 cells. Layers are stored one after another (row-major, little-endian):

| Layer | Type | Encoding |
| :--- | :--- | :--- |
| `foret` | `uint8` | 0 = non-forest, 1 = forest, 2 = clearing / clear-cut (LiDAR) |
| `essence` | `uint8` | Species code (see `essences.json`), 255 = forest outside BD Forêt |
| `alt` | `int16` | Metres, -32768 = no data |
| `pente` | `uint8` | Degrees, 255 = no data |
| `expo` | `uint8` | Azimuth in 1.5° steps (0–239), 254 = flat (< 3°), 255 = no data |
| `lisiere` | `uint8` | Distance to forest edge in metres, capped at 250 |
| `couvert` | `uint8` | LiDAR cover in %, 255 = no data |
| `hauteur` | `uint8` | Canopy height in 0.25 m steps, 255 = no data |

---

## Quick Start

### Installation

```bash
git clone https://github.com/nicolas-btd/MesChampis.git
cd MesChampis
```

### Running the Web App

The pre-built 25 m tiles for the Puy-de-Dôme are included in `web/data/grille/`, so the map works right after cloning:

```bash
python3 -m http.server 8000 --directory web
```

Open [http://localhost:8000](http://localhost:8000), or [http://localhost:8000?demo=1](http://localhost:8000?demo=1) for the demo mode.

### Rebuilding the Data (optional)

Raw IGN data is not included. Download BD Forêt V2 and BD ALTI 25 m for département 63 from the IGN Géoplateforme into `data/raw/bdforet/` and `data/raw/bdalti/`, then run:

```bash
# 0. Python environment
python3 -m venv .venv && source .venv/bin/activate
pip install -r prep/requirements.txt

# 1. List the LiDAR HD tiles that intersect forests
python prep/04a_inventaire_mnh.py

# 2. Download and aggregate LiDAR tiles (50 cm -> 25 m)
python prep/04_couvert.py --workers 4

# 3. Build the 25 m grid and binary tiles
python prep/03_grille.py

# 4. Copy the tiles into the web app
python prep/02_copier_web.py
```

### Tests

```bash
python prep/test_mnh.py
python prep/03_grille.py --test
```

Browser tests (encryption round-trip, tile decoding, tile-edge alignment, reprojection) run at [http://localhost:8000/tests.html](http://localhost:8000/tests.html), on a separate test database.

---

## Data & Licences

- **IGN BD Forêt V2, BD ALTI 25 m, LiDAR HD MNH**: [Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/)
- **Basemaps**: Plan IGN and IGN orthophotos via the Géoplateforme
- **MapLibre GL JS**: BSD-3-Clause
- **Proj4js**: MIT

Details in [LICENCES.md](LICENCES.md).

> Mushroom identification is never provided by this app. Always have your harvest checked by a pharmacist or a mycological society before eating it.
