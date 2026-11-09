#!/usr/bin/env python3
"""
MesChampis — Phase A : Inventaire des dalles MNH LiDAR HD IGN
Support multi-massifs et découpage en 4 parties pour couvrir le reste du 63.

Ce script :
1. Détermine l'emprise du ou des massifs demandés (+ marge lisière).
2. Interroge le WFS de la Géoplateforme (IGNF_LIDAR-HD_METADONNEE:metadata).
3. Optionnel (--foret-seule, par défaut) : filtre via la BD Forêt pour ne garder que les dalles contenant des arbres.
4. Récupère et valide les dalles MNH disponibles (nom, emprise, URL, millésime).
5. Fusionne avec les dalles déjà répertoriées dans data/raw/mnh/inventaire.json.
6. Calcule les métriques de couverture et le volume estimé.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import geopandas as gpd
from shapely.geometry import box
import requests

MASSIFS = {
    # Déjà traités
    "puys": {
        "nom": "Chaîne des Puys (Zone pilote)",
        "tx_min": 6, "tx_max": 8, "ty_min": 7, "ty_max": 9
    },
    "sancy": {
        "nom": "Massif du Sancy & Cézallier",
        "tx_min": 4, "tx_max": 8, "ty_min": 10, "ty_max": 14
    },
    "livradois": {
        "nom": "Livradois & Forez Sud (Ambert / Arlanc)",
        "tx_min": 14, "tx_max": 18, "ty_min": 10, "ty_max": 15
    },
    # Les 4 nouvelles parties équilibrées (~1h30 chacune)
    "partie1": {
        "nom": "Partie 1 — Forez Nord & Bois Noirs (Thiers / Chabreloche)",
        "tx_min": 13, "tx_max": 18, "ty_min": 5, "ty_max": 9
    },
    "partie2": {
        "nom": "Partie 2 — Artense & Ouest-Sancy (Tauves / La Tour-d'Auvergne)",
        "tx_min": 1, "tx_max": 5, "ty_min": 9, "ty_max": 14
    },
    "partie3": {
        "nom": "Partie 3 — Combrailles Sud & Sioule amont (Pontaumur / Giat)",
        "tx_min": 1, "tx_max": 6, "ty_min": 6, "ty_max": 9
    },
    "partie4": {
        "nom": "Partie 4 — Combrailles Nord & Limagne boisée (Saint-Gervais / Menat / Manzat)",
        "tx_min": 1, "tx_max": 13, "ty_min": 1, "ty_max": 5
    },
}

WFS_URL = "https://data.geopf.fr/wfs/ows"
LAYER_NAME = "IGNF_LIDAR-HD_METADONNEE:metadata"

BASE_DIR = Path(__file__).resolve().parent.parent
MANIFEST_PATH = BASE_DIR / "web" / "data" / "grille" / "manifest.json"
OUT_DIR = BASE_DIR / "data" / "raw" / "mnh"
INVENTAIRE_PATH = OUT_DIR / "inventaire.json"
BDFORET_DIR = BASE_DIR / "data" / "raw" / "bdforet"


def extraire_bbox_url(url: str) -> list[float] | None:
    """Extrait [minx, miny, maxx, maxy] des paramètres BBOX de l'URL WMS-R."""
    parsed = urlparse(url)
    qs = {k.lower(): v for k, v in parse_qs(parsed.query).items()}
    bbox_str = qs.get("bbox", [None])[0]
    if bbox_str:
        try:
            return [float(v) for v in bbox_str.split(",")]
        except ValueError:
            pass
    return None


def interroger_wfs_emprise(minx: float, miny: float, maxx: float, maxy: float) -> list[dict]:
    """Interroge le WFS pour une emprise Lambert-93 donnée."""
    bbox_param = f"{minx:.1f},{miny:.1f},{maxx:.1f},{maxy:.1f},urn:ogc:def:crs:EPSG::2154"
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": LAYER_NAME,
        "bbox": bbox_param,
        "outputFormat": "application/json",
        "count": 5000,
    }
    resp = requests.get(WFS_URL, params=params, timeout=60)
    resp.raise_for_status()
    wfs_data = resp.json()
    return wfs_data.get("features", [])


def charger_index_foret():
    """Charge la BD Forêt et construit un index spatial R-Tree pour filtrage ultra-rapide."""
    shp_files = list(BDFORET_DIR.rglob("FORMATION_VEGETALE.shp"))
    if not shp_files:
        return None, None
    gdf = gpd.read_file(shp_files[0])
    if gdf.crs.to_epsg() != 2154:
        gdf = gdf.to_crs(epsg=2154)
    gdf_f = gdf[gdf["CODE_TFV"].astype(str).str.strip().str.upper().str.startswith("F")].copy()
    return gdf_f, gdf_f.sindex


def parser_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inventaire MNH LiDAR HD pour les massifs forestiers du 63")
    parser.add_argument(
        "--massif",
        type=str,
        default="partie1",
        choices=["puys", "sancy", "livradois", "partie1", "partie2", "partie3", "partie4", "toutes_parties", "tous", "custom"],
        help="Massif ou partie à inventorier (défaut: partie1)"
    )
    parser.add_argument("--tx-min", type=int, help="tx min (si --massif custom)")
    parser.add_argument("--tx-max", type=int, help="tx max (si --massif custom)")
    parser.add_argument("--ty-min", type=int, help="ty min (si --massif custom)")
    parser.add_argument("--ty-max", type=int, help="ty max (si --massif custom)")
    parser.add_argument("--marge", type=float, default=300.0, help="Marge en mètres pour la lisière (défaut: 300 m)")
    parser.add_argument("--foret-seule", action="store_true", default=True, help="Ne garder que les dalles contenant des parcelles de forêt (Option 1)")
    parser.add_argument("--toutes-dalles", dest="foret_seule", action="store_false", help="Garder toutes les dalles même sans forêt")
    parser.add_argument("--no-merge", action="store_true", help="Ne pas fusionner avec l'inventaire existant")
    return parser.parse_args()


def main() -> int:
    args = parser_args()
    print("=" * 70)
    print("MesChampis — Inventaire MNH LiDAR HD")
    print(f"Cible sélectionnée : {args.massif} (Filtre forêt seule : {'OUI' if args.foret_seule else 'NON'})")
    print("=" * 70)

    if not MANIFEST_PATH.exists():
        print(f"Erreur : manifest introuvable à {MANIFEST_PATH}", file=sys.stderr)
        return 1

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    pas = manifest["taille_cellule_m"]
    taille_tuile_cells = manifest["taille_tuile"]
    taille_tuile_m = pas * taille_tuile_cells
    x0 = manifest["origine_x"]
    y0 = manifest["origine_y"]

    # Identifier les massifs / parties à traiter
    if args.massif == "toutes_parties":
        cibles = ["partie1", "partie2", "partie3", "partie4"]
    elif args.massif == "tous":
        cibles = list(MASSIFS.keys())
    elif args.massif == "custom":
        if None in (args.tx_min, args.tx_max, args.ty_min, args.ty_max):
            print("Erreur : --tx-min, --tx-max, --ty-min et --ty-max requis avec --massif custom", file=sys.stderr)
            return 1
        cibles = ["custom"]
        MASSIFS["custom"] = {
            "nom": "Zone personnalisée",
            "tx_min": args.tx_min, "tx_max": args.tx_max,
            "ty_min": args.ty_min, "ty_max": args.ty_max
        }
    else:
        cibles = [args.massif]

    # Charger index spatial de la BD Forêt si demandé
    gdf_f = None
    sindex = None
    if args.foret_seule:
        print("Chargement de l'index spatial BD Forêt pour filtrer les dalles boisées...")
        gdf_f, sindex = charger_index_foret()
        if gdf_f is not None:
            print(f"Index BD Forêt prêt ({len(gdf_f)} polygones forestiers)")
        else:
            print("Attention : BD Forêt introuvable, filtrage désactivé.")

    # Charger l'inventaire existant si présent
    dalles_existantes: dict[str, dict] = {}
    if not args.no_merge and INVENTAIRE_PATH.exists():
        try:
            with open(INVENTAIRE_PATH, "r", encoding="utf-8") as f:
                ancien_inv = json.load(f)
                for d in ancien_inv.get("dalles", []):
                    dalles_existantes[d["nom_fichier"]] = d
            print(f"Inventaire existant chargé : {len(dalles_existantes)} dalles déjà répertoriées")
        except Exception as e:
            print(f"Attention, impossible de charger l'ancien inventaire : {e}")

    dalles_dict: dict[str, dict] = dict(dalles_existantes)

    for cible in cibles:
        cfg = MASSIFS[cible]
        nom_massif = cfg["nom"]
        tx_min, tx_max = cfg["tx_min"], cfg["tx_max"]
        ty_min, ty_max = cfg["ty_min"], cfg["ty_max"]

        p_minx = x0 + tx_min * taille_tuile_m
        p_maxx = x0 + (tx_max + 1) * taille_tuile_m
        p_maxy = y0 - ty_min * taille_tuile_m
        p_miny = y0 - (ty_max + 1) * taille_tuile_m

        req_minx = p_minx - args.marge
        req_maxx = p_maxx + args.marge
        req_miny = p_miny - args.marge
        req_maxy = p_maxy + args.marge

        col_min = int(req_minx // 1000)
        col_max = int(req_maxx // 1000)
        row_min = int(req_miny // 1000)
        row_max = int(req_maxy // 1000)
        nb_attendues = (col_max - col_min + 1) * (row_max - row_min + 1)

        print(f"\n--- {nom_massif} (tx {tx_min}..{tx_max}, ty {ty_min}..{ty_max}) ---")
        print(f"Emprise : X [{p_minx:.0f}, {p_maxx:.0f}], Y [{p_miny:.0f}, {p_maxy:.0f}]")
        print(f"Dalles 1 km potentielles : {nb_attendues}")

        try:
            features = interroger_wfs_emprise(req_minx, req_miny, req_maxx, req_maxy)
            print(f"Dalles retournées par l'IGN : {len(features)}")
        except Exception as err:
            print(f"Erreur requête WFS pour {nom_massif} : {err}", file=sys.stderr)
            continue

        nb_ajoutees = 0
        nb_exclues_sans_foret = 0

        for f in features:
            props = f.get("properties", {})
            url_mnh = props.get("url_mnh")
            if not url_mnh:
                continue

            nw_coord = props.get("coordonnees_nw") or "inconnu"
            m = re.search(r"FILENAME=([^&]+)", url_mnh)
            nom_fichier = m.group(1) if m else f"MNH_{nw_coord}.tif"
            bbox_l93 = extraire_bbox_url(url_mnh)
            date_acq = props.get("date_debut_acquisition") or props.get("date_fin_acquisition") or props.get("date_edition")
            millesime = date_acq[:4] if date_acq and len(date_acq) >= 4 else None

            # Filtrage spatial : la dalle 1 km intersecte-t-elle la forêt ?
            if sindex is not None and bbox_l93:
                minx, miny, maxx, maxy = bbox_l93
                cand = list(sindex.intersection((minx, miny, maxx, maxy)))
                if not cand or not gdf_f.iloc[cand].intersects(box(minx, miny, maxx, maxy)).any():
                    nb_exclues_sans_foret += 1
                    continue

            if nom_fichier not in dalles_dict:
                nb_ajoutees += 1

            dalles_dict[nom_fichier] = {
                "id": nw_coord,
                "nom_fichier": nom_fichier,
                "url_mnh": url_mnh,
                "bbox_l93": bbox_l93,
                "date_acquisition": date_acq,
                "millesime": int(millesime) if millesime and millesime.isdigit() else None,
                "mission": props.get("code_mission"),
                "massif": cible,
            }

        print(f"Dalles retenues avec forêt : {len(features) - nb_exclues_sans_foret} (exclues sans forêt : {nb_exclues_sans_foret})")
        print(f"Nouvelles dalles ajoutées à l'inventaire : {nb_ajoutees}")

    dalles = sorted(dalles_dict.values(), key=lambda d: d["nom_fichier"])
    nb_total_dispos = len(dalles)
    taille_moy_mo = 15.26
    volume_total_go = (nb_total_dispos * taille_moy_mo) / 1024
    millesimes = sorted({d["millesime"] for d in dalles if d.get("millesime") is not None})

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    inventaire = {
        "massifs_inclus": cibles,
        "stats": {
            "nb_dalles_totales": nb_total_dispos,
            "taille_moyenne_mo": taille_moy_mo,
            "volume_estime_go": round(volume_total_go, 2),
            "millesimes": millesimes,
        },
        "dalles": dalles,
    }

    with open(INVENTAIRE_PATH, "w", encoding="utf-8") as f:
        json.dump(inventaire, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 70)
    print(f"Total dalles MNH dans inventaire.json : {nb_total_dispos}")
    print(f"Volume transitoire total estimé : {volume_total_go:.2f} Go")
    print(f"Fichier mis à jour : {INVENTAIRE_PATH}")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
