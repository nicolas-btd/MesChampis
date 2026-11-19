#!/usr/bin/env python3
"""
MesChampis — Téléchargement et agrégation dalle par dalle du MNH LiDAR HD
Support multi-massifs et grille départementale Puy-de-Dôme (4352 x 5120 cellules 25 m).

Ce script :
1. Charge data/raw/mnh/inventaire.json (support filtrage par massif).
2. Télécharge les dalles 1 km MNH en multi-threading avec reprise sur incident.
3. Agrège les pixels 50 cm en cellules 25 m (couvert % et hauteur p90).
4. Supprime la dalle brute après agrégation (sauf avec --garder-brut).
5. Met à jour data/out/mnh_couvert.tif et data/out/mnh_hauteur.tif au fur et à mesure.
6. Maintient data/raw/mnh/journal_dalles.json pour reprise sans doublon.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import RLock

import numpy as np
import rasterio
from rasterio.transform import Affine
import requests

SEUIL_ARBRE = 3.0  # Hauteur min (m) pour qu'un pixel MNH compte comme arbre

# Grille départementale Puy-de-Dôme
ORIGIN_X = 652025.0
ORIGIN_Y = 6573425.0
GRID_ROWS = 4352
GRID_COLS = 5120
PAS_CELLULE = 25.0

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_INVENTAIRE = BASE_DIR / "data" / "raw" / "mnh" / "inventaire.json"
DEFAULT_OUT_DIR = BASE_DIR / "data" / "out"
DEFAULT_RAW_DIR = BASE_DIR / "data" / "raw" / "mnh"
JOURNAL_PATH = DEFAULT_RAW_DIR / "journal_dalles.json"


def aggreger_blocs_dalle(
    blocks: np.ndarray,
    nodata: float,
    seuil_arbre: float = SEUIL_ARBRE
) -> tuple[np.ndarray, np.ndarray]:
    """
    Agrège un tableau de blocs (40, 40, 2500) en 40x40 cellules de 25 m.
    Renvoie (couvert_2d, hauteur_2d) en uint8.
    """
    is_valid = (blocks != nodata) & ~np.isnan(blocks)
    valid_counts = is_valid.sum(axis=-1)  # (40, 40)

    blocks_clean = np.where(blocks < 0, 0.0, blocks)
    cell_valid = valid_counts >= 1250

    trees = is_valid & (blocks_clean >= seuil_arbre)
    trees_counts = trees.sum(axis=-1)

    couvert = np.full((40, 40), 255, dtype=np.uint8)
    pcts = np.zeros((40, 40), dtype=np.float32)
    np.divide(trees_counts * 100.0, valid_counts, out=pcts, where=cell_valid)
    couvert[cell_valid] = np.clip(np.round(pcts[cell_valid]), 0, 100).astype(np.uint8)

    hauteur = np.full((40, 40), 255, dtype=np.uint8)
    for r in range(40):
        for c in range(40):
            if not cell_valid[r, c]:
                continue
            if trees_counts[r, c] == 0:
                hauteur[r, c] = 0
            else:
                v_mask = is_valid[r, c] & (blocks_clean[r, c] >= seuil_arbre)
                tree_vals = blocks_clean[r, c, v_mask]
                p90 = float(np.percentile(tree_vals, 90))
                code_h = min(254, int(round(p90 / 0.25)))
                hauteur[r, c] = code_h

    return couvert, hauteur


def telecharger_dalle(url: str, dest_path: Path, max_retries: int = 4) -> bool:
    """Télécharge une dalle avec reprises exponentielles en cas d'erreur ou limitation."""
    temp_path = dest_path.with_suffix(".tmp")
    headers = {"User-Agent": "MesChampis/1.0 (pipeline de traitement LiDAR HD)"}

    for tentative in range(1, max_retries + 1):
        try:
            with requests.get(url, headers=headers, stream=True, timeout=90) as r:
                if r.status_code == 429:
                    attente = 5 * tentative
                    print(f"  [IGN 429 Limite] Attente {attente}s avant réessai...")
                    time.sleep(attente)
                    continue

                r.raise_for_status()
                with open(temp_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            f.write(chunk)
            temp_path.replace(dest_path)
            return True
        except Exception as e:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass
            if tentative == max_retries:
                print(f"  [ERREUR] Échec téléchargement après {max_retries} tentatives : {dest_path.name} ({e})")
                return False
            time.sleep(2 * tentative)
    return False


def traiter_une_dalle(
    dalle: dict,
    dalles_dir: Path,
    supprimer_brut: bool
) -> tuple[str, np.ndarray, np.ndarray, float, float] | None:
    """Télécharge, vérifie et agrège une dalle MNH."""
    nom_fichier = dalle["nom_fichier"]
    dest_path = dalles_dir / nom_fichier
    url = dalle["url_mnh"]

    if not dest_path.exists() or dest_path.stat().st_size < 1000:
        ok = telecharger_dalle(url, dest_path)
        if not ok:
            return None

    try:
        with rasterio.open(dest_path) as ds:
            bounds = ds.bounds
            left = bounds.left
            top = bounds.top
            data = ds.read(1)
            nodata = ds.nodata if ds.nodata is not None else -9999.0

            # Découpage en 40x40 blocs de 50x50 pixels (dalle 2000x2000)
            blocks = data.reshape(40, 50, 40, 50).swapaxes(1, 2).reshape(40, 40, 2500)
            couvert, hauteur = aggreger_blocs_dalle(blocks, nodata)

    except Exception as e:
        print(f"  [ERREUR] Impossible de traiter la dalle {nom_fichier} : {e}")
        return None
    finally:
        if supprimer_brut and dest_path.exists():
            try:
                dest_path.unlink()
            except OSError:
                pass

    return nom_fichier, couvert, hauteur, left, top


def generer_apercu_png(couvert_arr: np.ndarray, png_path: Path):
    """Génère un aperçu visuel PNG du couvert arboré (0-100%)."""
    try:
        from PIL import Image

        h, w = couvert_arr.shape
        # Sous-échantillonnage pour aperçu rapide
        step = max(1, h // 800)
        sub_arr = couvert_arr[::step, ::step]
        sh, sw = sub_arr.shape

        rgba = np.zeros((sh, sw, 4), dtype=np.uint8)
        valid = sub_arr <= 100
        pct = sub_arr[valid] / 100.0

        rgba[valid, 0] = (255 * (1.0 - pct)).astype(np.uint8)
        rgba[valid, 1] = (180 + 75 * pct).astype(np.uint8)
        rgba[valid, 2] = (100 * (1.0 - pct)).astype(np.uint8)
        rgba[valid, 3] = (60 + 195 * pct).astype(np.uint8)

        nodata_mask = sub_arr == 255
        rgba[nodata_mask, 0] = 100
        rgba[nodata_mask, 1] = 116
        rgba[nodata_mask, 2] = 139
        rgba[nodata_mask, 3] = 30

        img = Image.fromarray(rgba, mode="RGBA")
        img.save(png_path)
        print(f"Aperçu PNG généré : {png_path} ({sw}x{sh})")
    except Exception as e:
        print(f"Aperçu PNG ignoré : {e}")


def main():
    parser = argparse.ArgumentParser(description="Téléchargement et agrégation du MNH LiDAR HD pour le 63")
    parser.add_argument("--inventaire", type=Path, default=DEFAULT_INVENTAIRE)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--massif", type=str, default=None, choices=["puys", "sancy", "livradois", "forez_nord", "partie1", "partie2", "partie3", "partie4", "principaux", None], help="Filtrer sur un massif spécifique")
    parser.add_argument("--garder-brut", dest="supprimer_brut", action="store_false", help="Conserver les dalles brutes (supprimées par défaut après agrégation)")
    parser.add_argument("--workers", type=int, default=2, help="Nombre de téléchargements parallèles (défaut: 2)")
    parser.add_argument("--max-dalles", type=int, default=None, help="Limite le nombre de dalles à traiter")
    args = parser.parse_args()

    print("=" * 70)
    print("MesChampis — Agrégation MNH LiDAR HD")
    print(f"Cible massif : {args.massif or 'Tous les massifs de l inventaire'}")
    print("=" * 70)

    if not args.inventaire.exists():
        print(f"Erreur : inventaire introuvable à {args.inventaire}. Lancez d'abord 04a_inventaire_mnh.py", file=sys.stderr)
        return 1

    with open(args.inventaire, "r", encoding="utf-8") as f:
        inv = json.load(f)

    dalles = list(inv["dalles"])

    # Filtrer par massif si demandé
    if args.massif == "principaux":
        dalles = [d for d in dalles if d.get("massif") in ("puys", "sancy", "livradois")]
    elif args.massif:
        dalles = [d for d in dalles if d.get("massif") == args.massif]

    # Déterminer le centre de priorité pour le tri des dalles
    centres = {
        "sancy": (693625.0, 6493425.0),
        "livradois": (757625.0, 6490225.0),
        "forez_nord": (752000.0, 6540000.0),
        "puys": (700000.0, 6519000.0),
        "partie1": (752000.0, 6540000.0),
        "partie2": (670000.0, 6495000.0),
        "partie3": (675000.0, 6525000.0),
        "partie4": (705000.0, 6555000.0),
    }
    centre_ref = centres.get(args.massif, (700000.0, 6519000.0))

    dalles.sort(
        key=lambda d: (
            ((d["bbox_l93"][0] + d["bbox_l93"][2]) / 2.0 - centre_ref[0]) ** 2
            + ((d["bbox_l93"][1] + d["bbox_l93"][3]) / 2.0 - centre_ref[1]) ** 2
        )
    )

    if args.max_dalles:
        dalles = dalles[:args.max_dalles]

    total_dalles = len(dalles)
    print(f"Nombre de dalles sélectionnées : {total_dalles}")
    print(f"Parallélisme : {args.workers} workers")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    dalles_dir = args.raw_dir / "dalles"
    dalles_dir.mkdir(parents=True, exist_ok=True)

    transform_global = Affine(PAS_CELLULE, 0.0, ORIGIN_X, 0.0, -PAS_CELLULE, ORIGIN_Y)
    crs_global = "EPSG:2154"

    tif_couvert = args.out_dir / "mnh_couvert.tif"
    tif_hauteur = args.out_dir / "mnh_hauteur.tif"

    # Initialisation ou migration vers la grille départementale
    if tif_couvert.exists() and tif_hauteur.exists():
        with rasterio.open(tif_couvert) as ds:
            shape = ds.shape
            trans = ds.transform
            old_cov = ds.read(1)
        with rasterio.open(tif_hauteur) as ds:
            old_h = ds.read(1)

        if shape == (GRID_ROWS, GRID_COLS):
            print("Grille départementale (4352x5120) chargée.")
            couvert_global = old_cov
            hauteur_global = old_h
        elif shape == (800, 800):
            print("Migration de la zone pilote 800x800 vers la grille départementale (4352x5120)...")
            couvert_global = np.full((GRID_ROWS, GRID_COLS), 255, dtype=np.uint8)
            hauteur_global = np.full((GRID_ROWS, GRID_COLS), 255, dtype=np.uint8)
            c_off = int(round((trans.c - ORIGIN_X) / PAS_CELLULE))
            r_off = int(round((ORIGIN_Y - trans.f) / PAS_CELLULE))
            couvert_global[r_off : r_off + 800, c_off : c_off + 800] = old_cov
            hauteur_global[r_off : r_off + 800, c_off : c_off + 800] = old_h
        else:
            print(f"Format inconnu {shape}, réinitialisation complète...")
            couvert_global = np.full((GRID_ROWS, GRID_COLS), 255, dtype=np.uint8)
            hauteur_global = np.full((GRID_ROWS, GRID_COLS), 255, dtype=np.uint8)
    else:
        couvert_global = np.full((GRID_ROWS, GRID_COLS), 255, dtype=np.uint8)
        hauteur_global = np.full((GRID_ROWS, GRID_COLS), 255, dtype=np.uint8)

    journal: set[str] = set()
    if JOURNAL_PATH.exists():
        try:
            with open(JOURNAL_PATH, "r", encoding="utf-8") as f:
                journal = set(json.load(f))
            print(f"Dalles déjà dans le journal : {len(journal)}")
        except Exception:
            pass

    dalles_a_traiter = [d for d in dalles if d["nom_fichier"] not in journal]
    print(f"Dalles restantes à traiter : {len(dalles_a_traiter)} / {total_dalles}")

    lock_save = RLock()  # réentrant : le handler SIGINT peut sauvegarder pendant une sauvegarde

    def sauvegarder_rasters():
        with lock_save:
            meta = {
                "driver": "GTiff",
                "height": GRID_ROWS,
                "width": GRID_COLS,
                "count": 1,
                "dtype": "uint8",
                "crs": crs_global,
                "transform": transform_global,
                "nodata": 255,
                "compress": "deflate",
            }
            with rasterio.open(tif_couvert, "w", **meta) as ds:
                ds.write(couvert_global, 1)
            with rasterio.open(tif_hauteur, "w", **meta) as ds:
                ds.write(hauteur_global, 1)
            with open(JOURNAL_PATH, "w", encoding="utf-8") as f:
                json.dump(sorted(list(journal)), f, indent=2)

    def signal_handler(sig, frame):
        print("\n[Interruption détectée] Sauvegarde des rasters en cours...")
        sauvegarder_rasters()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    if not dalles_a_traiter:
        print("Toutes les dalles demandées sont déjà traitées.")
        sauvegarder_rasters()
        return 0

    print(f"\nDébut du traitement de {len(dalles_a_traiter)} dalles...")
    start_time = time.time()
    nb_succes = 0

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        fut_to_dalle = {
            executor.submit(traiter_une_dalle, d, dalles_dir, args.supprimer_brut): d
            for d in dalles_a_traiter
        }

        for i, fut in enumerate(as_completed(fut_to_dalle), 1):
            res = fut.result()
            if res is not None:
                nom_fichier, couvert, hauteur, left, top = res
                col_start = int(round((left - ORIGIN_X) / PAS_CELLULE))
                row_start = int(round((ORIGIN_Y - top) / PAS_CELLULE))

                if 0 <= row_start <= GRID_ROWS - 40 and 0 <= col_start <= GRID_COLS - 40:
                    with lock_save:
                        couvert_global[row_start : row_start + 40, col_start : col_start + 40] = couvert
                        hauteur_global[row_start : row_start + 40, col_start : col_start + 40] = hauteur
                        journal.add(nom_fichier)
                    nb_succes += 1

            if i % 20 == 0 or i == len(dalles_a_traiter):
                sauvegarder_rasters()
                elapsed = time.time() - start_time
                vitesse = i / elapsed if elapsed > 0 else 0
                restant_s = (len(dalles_a_traiter) - i) / vitesse if vitesse > 0 else 0
                print(f"[{i}/{len(dalles_a_traiter)}] {nb_succes} dalles agrégées ({vitesse:.2f} dalle/s, restant env. {restant_s/60:.1f} min)")

    sauvegarder_rasters()
    png_path = args.out_dir / "apercu_couvert.png"
    generer_apercu_png(couvert_global, png_path)

    print("\n" + "=" * 70)
    print("Traitement terminé.")
    print(f"Dalles ajoutées au journal : {nb_succes}")
    print(f"Total dalles traitées dans journal_dalles.json : {len(journal)}")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
