#!/usr/bin/env python3
"""
Copie des données (parcelles et grille raster) vers le dossier web
MesChampis - Webapp non lucrative d'aide à la cueillette de champignons
"""

import shutil
import sys
from pathlib import Path


def copier_donnees() -> None:
    racine = Path(__file__).resolve().parent.parent
    cible_data = racine / "web" / "data"
    cible_data.mkdir(parents=True, exist_ok=True)

    # 1. Copie de parcelles.geojson si disponible
    src_parcelles = racine / "data" / "out" / "parcelles.geojson"
    dst_parcelles = cible_data / "parcelles.geojson"
    if src_parcelles.exists():
        taille_mo = src_parcelles.stat().st_size / (1024 * 1024)
        print(f"Copie de {src_parcelles.relative_to(racine)} ({taille_mo:.1f} Mo) vers {dst_parcelles.relative_to(racine)}...")
        shutil.copy2(src_parcelles, dst_parcelles)
    else:
        print(f"[INFO] {src_parcelles.relative_to(racine)} absent (optionnel pour la grille).")

    # 2. Copie de la grille raster (manifest, essences, tuiles)
    src_grille = racine / "data" / "out" / "grille"
    dst_grille = cible_data / "grille"
    if src_grille.exists():
        print(f"Copie de l'arborescence {src_grille.relative_to(racine)} vers {dst_grille.relative_to(racine)}...")
        dst_grille.mkdir(parents=True, exist_ok=True)

        # Copie des fichiers JSON
        for json_file in src_grille.glob("*.json"):
            shutil.copy2(json_file, dst_grille / json_file.name)

        # Copie du dossier tuiles
        src_tuiles = src_grille / "tuiles"
        dst_tuiles = dst_grille / "tuiles"
        dst_tuiles.mkdir(parents=True, exist_ok=True)
        if src_tuiles.exists():
            tuiles = list(src_tuiles.glob("*.bin.gz"))
            print(f"  - Copie de {len(tuiles)} tuiles binaires compressées...")
            for t in tuiles:
                shutil.copy2(t, dst_tuiles / t.name)
        print("[SUCCÈS] Grille raster synchronisée avec le dossier web.")
    else:
        print(f"[ATTENTION] {src_grille.relative_to(racine)} introuvable. Exécutez : python prep/03_grille.py")


if __name__ == "__main__":
    copier_donnees()
