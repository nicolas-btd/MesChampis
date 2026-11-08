#!/usr/bin/env python3
"""
Étape 1 bis : Génération d'une grille raster de 25 m et tuilage binaire
MesChampis - Webapp non lucrative d'aide à la cueillette de champignons

Ce script :
1. Détermine l'emprise de la BD Forêt (+ marge 500 m) alignée sur un pas de 25 m (EPSG:2154).
2. Rasterise la BD Forêt :
   - Couche 1 : 'foret' (uint8, 1 si forêt fermée, 0 sinon)
   - Couche 2 : 'essence' (uint8, code essence, 0 = hors forêt)
3. Calcule la distance à la lisière non-forêt :
   - Couche 6 : 'lisiere' (uint8, 0 à 250 m, distance_transform_edt * 25)
4. Rééchantillonne et aligne le MNT BD ALTI 25 m sur la grille :
   - Couche 3 : 'alt' (int16, -32768 = nodata)
   - Couche 4 : 'pente' (uint8, degrés arrondis, 255 = nodata)
   - Couche 5 : 'expo' (uint8, 0-239 par pas de 1.5°, 254 = plat, 255 = nodata)
5. Découpe en tuiles de 256x256 cellules :
   - Exclut les tuiles sans aucune cellule forêt
   - Exporte chaque tuile en format binaire compressé gzip (foret, essence, alt, pente, expo, lisiere)
6. Produit manifest.json et essences.json dans data/out/grille/
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.merge import merge
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject
from scipy.ndimage import distance_transform_edt, label


# ==============================================================================
# Fonctions de calcul topographique
# ==============================================================================

def calculer_pente_et_exposition(
    mnt: np.ndarray,
    res_x: float = 25.0,
    res_y: float = 25.0
) -> tuple[np.ndarray, np.ndarray]:
    """
    Calcule la pente en degrés et l'exposition en degrés (azimut de descente).
    0° = Nord, 90° = Est, 180° = Sud, 270° = Ouest.
    Si pente < 3°, l'exposition est fixée à NaN (terrain plat).
    """
    dz_dy, dz_dx = np.gradient(mnt, res_y, res_x)
    norme = np.hypot(dz_dx, dz_dy)
    pente = np.degrees(np.arctan(norme))

    # Direction de descente (y augmente vers le Sud, x vers l'Est)
    d_est = -dz_dx
    d_nord = dz_dy

    expo = (np.degrees(np.arctan2(d_est, d_nord))) % 360.0
    expo = np.where(np.isclose(expo, 360.0) | np.isclose(expo, 0.0), 0.0, expo)

    # Masquer terrain plat
    expo[pente < 3.0] = np.nan

    # Masquer nodata
    masque_nan = np.isnan(mnt)
    pente[masque_nan] = np.nan
    expo[masque_nan] = np.nan

    return pente, expo


def encoder_exposition(expo_deg: np.ndarray, pente_deg: np.ndarray) -> np.ndarray:
    """
    Encode l'exposition sur uint8 :
    - 0 à 239 : azimut par pas de 1.5° (0 = 0°, 60 = 90°, 120 = 180°, 180 = 270°)
    - 254 : terrain plat (pente < 3°)
    - 255 : nodata
    """
    expo_propre = np.nan_to_num(expo_deg, nan=0.0)
    code = np.round(expo_propre / 1.5).astype(np.int32) % 240
    expo_u8 = code.astype(np.uint8)

    # Plat
    expo_u8[pente_deg < 3.0] = 254

    # Nodata
    expo_u8[np.isnan(expo_deg) & (pente_deg >= 3.0)] = 255
    expo_u8[np.isnan(pente_deg)] = 255

    return expo_u8


def decoder_exposition(code_u8: int | np.ndarray) -> float | np.ndarray | None:
    """
    Décode la valeur d'exposition uint8 en degrés réels.
    Retourne None pour nodata (255) ou float/ndarray pour [0, 360[.
    """
    if isinstance(code_u8, (int, np.integer)):
        if code_u8 == 255:
            return None
        if code_u8 == 254:
            return -1.0  # Marqueur plat
        return float(code_u8 * 1.5)

    res = code_u8.astype(np.float32) * 1.5
    res[code_u8 == 254] = np.nan  # Plat
    res[code_u8 == 255] = np.nan  # Nodata
    return res


# ==============================================================================
# Tests rapides de vérification
# ==============================================================================

def tester_grille() -> None:
    """
    Vérifications automatiques :
    1. MNT incliné vers le nord -> exposition ≈ 0° après encodage/décodage.
    2. Aller-retour binaire d'une tuile (compression gzip -> décompression) identique.
    """
    print("=== Tests de validation algorithmique (Étape 1 bis) ===")

    # Test 1 : MNT synthétique incliné vers le nord
    y = np.arange(5)[:, None]
    x = np.arange(5)[None, :]
    mnt_nord = 100.0 + 10.0 * y + 0.0 * x  # Descend vers le Nord
    pente, expo = calculer_pente_et_exposition(mnt_nord, 25.0, 25.0)
    expo_enc = encoder_exposition(expo, pente)
    val_enc = expo_enc[2, 2]
    val_dec = decoder_exposition(val_enc)

    assert abs(val_dec - 0.0) < 1.5, f"Erreur test 1 : attendu ≈ 0°, obtenu {val_dec}°"
    print(f"  [OK] Test 1 : MNT vers le nord -> encodé {val_enc}, décodé {val_dec:.1f}° (attendu ≈ 0°)")

    # Test 2 : Aller-retour d'une tuile binaire (256x256)
    t_foret = np.random.randint(0, 2, size=(256, 256), dtype=np.uint8)
    t_essence = np.random.randint(0, 15, size=(256, 256), dtype=np.uint8)
    t_alt = np.random.randint(300, 1500, size=(256, 256), dtype=np.int16)
    t_pente = np.random.randint(0, 45, size=(256, 256), dtype=np.uint8)
    t_expo = np.random.randint(0, 240, size=(256, 256), dtype=np.uint8)
    t_lisiere = np.random.randint(0, 251, size=(256, 256), dtype=np.uint8)

    buf_raw = (
        t_foret.tobytes() +
        t_essence.tobytes() +
        t_alt.astype('<i2').tobytes() +
        t_pente.tobytes() +
        t_expo.tobytes() +
        t_lisiere.tobytes()
    )
    buf_comp = gzip.compress(buf_raw, compresslevel=6)
    buf_decomp = gzip.decompress(buf_comp)

    N = 256 * 256
    r_foret = np.frombuffer(buf_decomp, dtype=np.uint8, count=N, offset=0).reshape((256, 256))
    r_essence = np.frombuffer(buf_decomp, dtype=np.uint8, count=N, offset=N).reshape((256, 256))
    r_alt = np.frombuffer(buf_decomp, dtype='<i2', count=N, offset=N * 2).reshape((256, 256))
    r_pente = np.frombuffer(buf_decomp, dtype=np.uint8, count=N, offset=N * 4).reshape((256, 256))
    r_expo = np.frombuffer(buf_decomp, dtype=np.uint8, count=N, offset=N * 5).reshape((256, 256))
    r_lisiere = np.frombuffer(buf_decomp, dtype=np.uint8, count=N, offset=N * 6).reshape((256, 256))

    assert np.array_equal(t_foret, r_foret), "Erreur test 2 : couche foret altérée"
    assert np.array_equal(t_essence, r_essence), "Erreur test 2 : couche essence altérée"
    assert np.array_equal(t_alt, r_alt), "Erreur test 2 : couche alt altérée"
    assert np.array_equal(t_pente, r_pente), "Erreur test 2 : couche pente altérée"
    assert np.array_equal(t_expo, r_expo), "Erreur test 2 : couche expo altérée"
    assert np.array_equal(t_lisiere, r_lisiere), "Erreur test 2 : couche lisiere altérée"

    print("  [OK] Test 2 : Aller-retour tuile binaire compressée gzip validé à 100%")
    print("=== Tous les tests de validation ont réussi avec succès ! ===\n")


# ==============================================================================
# Pipeline principal de génération de la grille
# ==============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Génération de la grille raster 25 m et des tuiles binaires de caractéristiques"
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Exécute uniquement les tests de vérification"
    )
    args = parser.parse_args()

    if args.test:
        tester_grille()
        return

    tester_grille()

    racine = Path(__file__).resolve().parent.parent
    dossier_bdforet = racine / "data" / "raw" / "bdforet"
    dossier_bdalti = racine / "data" / "raw" / "bdalti"
    dossier_out = racine / "data" / "out"
    dossier_grille = dossier_out / "grille"
    dossier_tuiles = dossier_grille / "tuiles"

    dossier_tuiles.mkdir(parents=True, exist_ok=True)

    # --------------------------------------------------------------------------
    # 1. Lecture et analyse de la BD Forêt
    # --------------------------------------------------------------------------
    print("--- Étape 1 : Lecture de la BD Forêt V2 et définition de l'emprise ---")
    shp_candidats = list(dossier_bdforet.rglob("FORMATION_VEGETALE.shp"))
    if not shp_candidats:
        shp_candidats = [f for f in dossier_bdforet.rglob("*.shp") if f.name.lower() == "formation_vegetale.shp"]

    if not shp_candidats:
        print(f"[ERREUR] Fichier FORMATION_VEGETALE.shp introuvable dans {dossier_bdforet}")
        sys.exit(1)

    chemin_shp = shp_candidats[0]
    gdf = gpd.read_file(chemin_shp)
    if gdf.crs is None or gdf.crs.to_epsg() != 2154:
        gdf = gdf.to_crs(epsg=2154)

    gdf_foret = gdf[gdf["CODE_TFV"].astype(str).str.strip().str.upper().str.startswith("F")].copy()
    print(f"Parcelles forestières retenues : {len(gdf_foret)}")

    # Table des essences distinctes (code 0 = hors forêt)
    essences_uniques = sorted(list(set(gdf_foret["ESSENCE"].dropna().astype(str))))
    code_essence_map = {ess: idx + 1 for idx, ess in enumerate(essences_uniques)}
    table_essences = {"0": "Hors forêt"}
    for ess, code in code_essence_map.items():
        table_essences[str(code)] = ess

    with open(dossier_grille / "essences.json", "w", encoding="utf-8") as f:
        json.dump(table_essences, f, indent=2, ensure_ascii=False)
    print(f"Table des essences enregistrée ({len(essences_uniques)} essences) dans essences.json")

    # Emprise globale BD Forêt + marge de 500 m, alignée sur des multiples de 25 m
    minx, miny, maxx, maxy = gdf_foret.total_bounds
    pas = 25.0
    grid_minx = np.floor((minx - 500.0) / pas) * pas
    grid_maxx_brut = np.ceil((maxx + 500.0) / pas) * pas
    grid_miny_brut = np.floor((miny - 500.0) / pas) * pas
    grid_maxy = np.ceil((maxy + 500.0) / pas) * pas

    largeur_brute = int((grid_maxx_brut - grid_minx) / pas)
    hauteur_brute = int((grid_maxy - grid_miny_brut) / pas)

    # Ajustement pour être un multiple de 256 (taille de tuile)
    nb_tx = int(np.ceil(largeur_brute / 256.0))
    nb_ty = int(np.ceil(hauteur_brute / 256.0))
    W = nb_tx * 256
    H = nb_ty * 256

    grid_maxx = grid_minx + W * pas
    grid_miny = grid_maxy - H * pas

    transform_grille = Affine(pas, 0.0, grid_minx, 0.0, -pas, grid_maxy)

    print(f"Emprise Lambert-93 : X=[{grid_minx:.0f}, {grid_maxx:.0f}], Y=[{grid_miny:.0f}, {grid_maxy:.0f}]")
    print(f"Dimensions grille globale : {W} x {H} cellules (25 m) -> {nb_tx} x {nb_ty} tuiles potentielles")

    # --------------------------------------------------------------------------
    # 2. Rasterisation des couches forêt et essence
    # --------------------------------------------------------------------------
    print("\n--- Étape 2 : Rasterisation des couches forêt et essence ---")
    t0 = time.time()

    # Couche foret (uint8, 1 si polygone CODE_TFV commence par F, 0 sinon)
    geometries_foret = [(geom, 1) for geom in gdf_foret.geometry if geom is not None and not geom.is_empty]
    couche_foret = rasterize(
        geometries_foret,
        out_shape=(H, W),
        fill=0,
        transform=transform_grille,
        dtype=np.uint8,
        all_touched=False
    )
    print(f"Couche forêt rasterisée en {time.time() - t0:.2f} s ({np.count_nonzero(couche_foret)} cellules)")

    # Couche essence (uint8, code essence, 0 = hors forêt)
    t0 = time.time()
    geometries_essence = [
        (geom, code_essence_map[str(ess)])
        for geom, ess in zip(gdf_foret.geometry, gdf_foret["ESSENCE"])
        if geom is not None and not geom.is_empty and str(ess) in code_essence_map
    ]
    couche_essence = rasterize(
        geometries_essence,
        out_shape=(H, W),
        fill=0,
        transform=transform_grille,
        dtype=np.uint8,
        all_touched=False
    )
    print(f"Couche essence rasterisée en {time.time() - t0:.2f} s")

    # --------------------------------------------------------------------------
    # 2 bis. Intégration du MNH LiDAR HD (Zone Pilote tx: 6..8, ty: 7..9)
    # --------------------------------------------------------------------------
    print("\n--- Étape 2 bis : Intégration MNH LiDAR HD (couvert, hauteur, masque forêt) ---")
    couche_couvert = np.full((H, W), 255, dtype=np.uint8)
    couche_hauteur = np.full((H, W), 255, dtype=np.uint8)

    fichier_mnh_couvert = dossier_out / "mnh_couvert.tif"
    fichier_mnh_hauteur = dossier_out / "mnh_hauteur.tif"

    tuiles_pilote_coords = {(tx, ty) for tx in range(6, 9) for ty in range(7, 10)}
    pilote_stats = {
        "nb_foret_bd": 0,
        "nb_foret_mnh": 0,
        "accord_strict": 0,
        "nb_foret_2_ouvert": 0,
        "nb_foret_hors_bd": 0,
        "nb_total_cellules_pilote": 9 * 256 * 256,
    }

    if fichier_mnh_couvert.exists() and fichier_mnh_hauteur.exists():
        print(f"Chargement des rasters MNH : {fichier_mnh_couvert.name} et {fichier_mnh_hauteur.name}")
        with rasterio.open(fichier_mnh_couvert) as ds_cov, rasterio.open(fichier_mnh_hauteur) as ds_h:
            mnh_cov_arr = ds_cov.read(1)
            mnh_h_arr = ds_h.read(1)
            trans_mnh = ds_cov.transform

        mnh_x0 = trans_mnh.c
        mnh_y0 = trans_mnh.f
        c_offset = int(round((mnh_x0 - grid_minx) / pas))
        r_offset = int(round((grid_maxy - mnh_y0) / pas))
        mnh_h, mnh_w = mnh_cov_arr.shape

        print(f"Position MNH dans grille globale : col={c_offset}, row={r_offset}, taille={mnh_w}x{mnh_h}")
        couche_couvert[r_offset:r_offset + mnh_h, c_offset:c_offset + mnh_w] = mnh_cov_arr
        couche_hauteur[r_offset:r_offset + mnh_h, c_offset:c_offset + mnh_w] = mnh_h_arr

        masque_valide_mnh = (couche_couvert != 255)
        nb_valides = np.count_nonzero(masque_valide_mnh)
        print(f"Cellules avec MNH LiDAR HD valide : {nb_valides} ({nb_valides / couche_couvert.size * 100:.2f} %)")

        if nb_valides > 0:
            # Couvert >= 50 %
            mnh_arbres = (couche_couvert >= 50) & masque_valide_mnh

            # 1. Supprimer les groupes < 8 cellules (8-connexité)
            struct8 = np.ones((3, 3), dtype=bool)
            labeled_arbres, num_arbres = label(mnh_arbres, structure=struct8)
            if num_arbres > 0:
                sizes = np.bincount(labeled_arbres.ravel())
                keep_mask = (sizes >= 8)
                keep_mask[0] = False
                mnh_foret_clean = keep_mask[labeled_arbres]
            else:
                mnh_foret_clean = np.zeros_like(mnh_arbres, dtype=bool)

            # 2. Reboucher les trous non-forêt <= 2 cellules
            non_foret = ~mnh_foret_clean
            struct4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)
            labeled_holes, num_holes = label(non_foret, structure=struct4)
            if num_holes > 0:
                hole_sizes = np.bincount(labeled_holes.ravel())
                small_holes = (hole_sizes <= 2)
                small_holes[0] = False
                fill_mask = small_holes[labeled_holes]
                mnh_foret_clean = mnh_foret_clean | fill_mask

            # 3. Nouveau masque foret et essence sur l'ensemble des zones MNH
            foret_bd_avant = couche_foret.copy()
            essence_bd_avant = couche_essence.copy()

            # - foret = 1 si forêt MNH
            # - foret = 2 si BD Forêt disait 1 mais MNH ne voit pas d'arbres (coupe/clairière)
            # - foret = 0 si hors forêt dans les deux
            couche_foret[masque_valide_mnh & mnh_foret_clean] = 1
            couche_foret[masque_valide_mnh & (~mnh_foret_clean) & (foret_bd_avant == 1)] = 2
            couche_foret[masque_valide_mnh & (~mnh_foret_clean) & (foret_bd_avant != 1)] = 0

            # Essence 255 = "inconnue" si forêt MNH hors polygone BD Forêt
            couche_essence[masque_valide_mnh & (couche_foret == 1) & (foret_bd_avant == 0)] = 255

            # Calcul des statistiques
            pilote_stats["nb_foret_bd"] = int(np.count_nonzero((foret_bd_avant == 1) & masque_valide_mnh))
            pilote_stats["nb_foret_mnh"] = int(np.count_nonzero((couche_foret == 1) & masque_valide_mnh))
            pilote_stats["accord_strict"] = int(np.count_nonzero(((foret_bd_avant == 1) == (couche_foret == 1)) & masque_valide_mnh))
            pilote_stats["nb_foret_2_ouvert"] = int(np.count_nonzero((couche_foret == 2) & masque_valide_mnh))
            pilote_stats["nb_foret_hors_bd"] = int(np.count_nonzero((couche_foret == 1) & (foret_bd_avant == 0) & masque_valide_mnh))
            pilote_stats["nb_total_cellules_pilote"] = int(nb_valides)
    else:
        print("[ATTENTION] Fichiers MNH introuvables. Mode BD Forêt seul.")

    # --------------------------------------------------------------------------
    # 3. Calcul de la couche lisière
    # --------------------------------------------------------------------------
    print("\n--- Étape 3 : Calcul de la distance à la lisière (scipy.ndimage) ---")
    t0 = time.time()
    # distance_transform_edt sur couche_foret == 1 (les cellules foret == 2 ne comptent pas comme forêt)
    masque_foret_strict = (couche_foret == 1)
    distance_cellules = distance_transform_edt(masque_foret_strict)
    distance_metres = distance_cellules * pas
    couche_lisiere = np.clip(np.round(distance_metres), 0, 250).astype(np.uint8)
    print(f"Couche lisière calculée en {time.time() - t0:.2f} s (max: {couche_lisiere.max()} m)")

    # --------------------------------------------------------------------------
    # 4. Fusion du MNT et calcul de l'altitude, pente et exposition
    # --------------------------------------------------------------------------
    print("\n--- Étape 4 : Traitement du MNT (BD ALTI 25 m) ---")
    dalles_asc = sorted(list(dossier_bdalti.rglob("*.asc")) + list(dossier_bdalti.rglob("*.ASC")))
    if not dalles_asc:
        print(f"[ERREUR] Aucune dalle .asc trouvée dans {dossier_bdalti}")
        sys.exit(1)

    print(f"Fusion de {len(dalles_asc)} dalles .asc...")
    ds_list = [rasterio.open(f) for f in dalles_asc]
    try:
        mnt_fusion, trans_fusion = merge(ds_list, nodata=-9999.0)
    finally:
        for ds in ds_list:
            ds.close()

    src_mnt = mnt_fusion[0].astype(np.float32)
    src_mnt[src_mnt == -9999.0] = np.nan

    # Rééchantillonnage et alignement sur la grille de calcul exacte
    print("Rééchantillonnage et alignement sur la grille Lambert-93...")
    dst_mnt = np.full((H, W), np.nan, dtype=np.float32)
    reproject(
        source=src_mnt,
        destination=dst_mnt,
        src_transform=trans_fusion,
        src_crs="EPSG:2154",
        dst_transform=transform_grille,
        dst_crs="EPSG:2154",
        resampling=Resampling.bilinear,
        src_nodata=np.nan,
        dst_nodata=np.nan
    )

    # Couche altitude (int16, -32768 = nodata)
    couche_alt = np.where(np.isnan(dst_mnt), -32768, np.round(dst_mnt)).astype("<i2")

    # Calcul de la pente et de l'exposition
    print("Calcul de la pente et de l'exposition (gradient 25 m)...")
    pente_deg, expo_deg = calculer_pente_et_exposition(dst_mnt, res_x=pas, res_y=pas)

    # Couche pente (uint8, degrés arrondis, 255 = nodata)
    couche_pente = np.where(np.isnan(pente_deg), 255, np.clip(np.round(pente_deg), 0, 90)).astype(np.uint8)

    # Couche exposition (uint8, codée 0-239, 254 = plat < 3°, 255 = nodata)
    couche_expo = encoder_exposition(expo_deg, pente_deg)

    # --------------------------------------------------------------------------
    # 5. Découpage en tuiles binaires v2 (9 octets/cellule) et export gzip
    # --------------------------------------------------------------------------
    print("\n--- Étape 5 : Découpage en tuiles 256x256 et export binaire v2 (9 o/cellule) ---")
    tuiles_existantes: list[str] = []
    tuiles_meta: dict[str, dict] = {}
    total_octets = 0

    taille_tuile = 256
    for ty in range(nb_ty):
        for tx in range(nb_tx):
            y0 = ty * taille_tuile
            y1 = y0 + taille_tuile
            x0 = tx * taille_tuile
            x1 = x0 + taille_tuile

            t_foret = couche_foret[y0:y1, x0:x1]

            # Règle : Ne PAS écrire les tuiles sans aucune cellule forêt (1) ou ouverte (2)
            if np.count_nonzero(t_foret) == 0:
                continue

            t_essence = couche_essence[y0:y1, x0:x1]
            t_alt = couche_alt[y0:y1, x0:x1]
            t_pente = couche_pente[y0:y1, x0:x1]
            t_expo = couche_expo[y0:y1, x0:x1]
            t_lisiere = couche_lisiere[y0:y1, x0:x1]
            t_couvert = couche_couvert[y0:y1, x0:x1]
            t_hauteur = couche_hauteur[y0:y1, x0:x1]

            # Concaténation row-major, little-endian des 8 couches (9 octets/cellule)
            raw_bytes = (
                t_foret.tobytes() +
                t_essence.tobytes() +
                t_alt.tobytes() +
                t_pente.tobytes() +
                t_expo.tobytes() +
                t_lisiere.tobytes() +
                t_couvert.tobytes() +
                t_hauteur.tobytes()
            )

            compressed_bytes = gzip.compress(raw_bytes, compresslevel=6)
            nom_tuile = f"{tx}_{ty}"
            fichier_tuile = dossier_tuiles / f"{nom_tuile}.bin.gz"

            with open(fichier_tuile, "wb") as f_out:
                f_out.write(compressed_bytes)

            total_octets += len(compressed_bytes)
            tuiles_existantes.append(nom_tuile)

            is_pilote = (tx, ty) in tuiles_pilote_coords
            tuiles_meta[nom_tuile] = {
                "mnh": is_pilote,
                "lidar_millesime": 2022 if is_pilote else None
            }

    # --------------------------------------------------------------------------
    # 6. Écriture du manifest.json v2
    # --------------------------------------------------------------------------
    manifest = {
        "version_format": 2,
        "version_grille": "20261031_mnh_pdd_v2",
        "region": {
            "nom": "Puy-de-Dôme (63)",
            "epsg": 2154,
            "proj4": "+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
            "origine_x": float(grid_minx),
            "origine_y": float(grid_maxy),
            "pas": int(pas),
            "taille_tuile": taille_tuile,
            "nb_tuiles_x": nb_tx,
            "nb_tuiles_y": nb_ty,
            "emprise": {
                "minx": float(grid_minx),
                "miny": float(grid_miny),
                "maxx": float(grid_maxx),
                "maxy": float(grid_maxy),
            }
        },
        "crs": "EPSG:2154",
        "taille_cellule_m": pas,
        "taille_tuile": taille_tuile,
        "origine_x": float(grid_minx),
        "origine_y": float(grid_maxy),
        "emprise": {
            "minx": float(grid_minx),
            "miny": float(grid_miny),
            "maxx": float(grid_maxx),
            "maxy": float(grid_maxy),
        },
        "nb_tuiles_x": nb_tx,
        "nb_tuiles_y": nb_ty,
        "couches": [
            {
                "nom": "foret",
                "type": "uint8",
                "bytes": 1,
                "offset": 0,
                "nodata": 0,
                "echelle": 1,
                "unite": "",
                "description": "1 = forêt fermée, 2 = ouvert/coupe (MNH), 0 = hors forêt"
            },
            {
                "nom": "essence",
                "type": "uint8",
                "bytes": 1,
                "offset": 65536,
                "nodata": 0,
                "echelle": 1,
                "unite": "",
                "description": "Code essence forestière (255 = inconnue LiDAR)"
            },
            {
                "nom": "alt",
                "type": "int16",
                "bytes": 2,
                "offset": 131072,
                "endian": "little",
                "nodata": -32768,
                "echelle": 1,
                "unite": "m",
                "description": "Altitude en mètres (BD ALTI 25 m)"
            },
            {
                "nom": "pente",
                "type": "uint8",
                "bytes": 1,
                "offset": 262144,
                "nodata": 255,
                "echelle": 1,
                "unite": "deg",
                "description": "Pente en degrés (255 = nodata)"
            },
            {
                "nom": "expo",
                "type": "uint8",
                "bytes": 1,
                "offset": 327680,
                "nodata": 255,
                "valeur_plat": 254,
                "echelle": 1.5,
                "unite": "deg",
                "description": "Exposition (0-239 à 1.5°, 254 = plat < 3°, 255 = nodata)"
            },
            {
                "nom": "lisiere",
                "type": "uint8",
                "bytes": 1,
                "offset": 393216,
                "nodata": 0,
                "plafond_m": 250,
                "echelle": 1,
                "unite": "m",
                "description": "Distance en mètres à la lisière non-forêt (max 250 m)"
            },
            {
                "nom": "couvert",
                "type": "uint8",
                "bytes": 1,
                "offset": 458752,
                "nodata": 255,
                "echelle": 1,
                "unite": "%",
                "description": "Couvert arboré LiDAR HD (% pixels h >= 3 m, 255 = nodata)"
            },
            {
                "nom": "hauteur",
                "type": "uint8",
                "bytes": 1,
                "offset": 524288,
                "nodata": 255,
                "echelle": 0.25,
                "unite": "m",
                "description": "Hauteur dominante p90 LiDAR HD (0-63.5 m par pas 0.25 m, 255 = nodata)"
            }
        ],
        "tuiles": tuiles_existantes,
        "tuiles_meta": tuiles_meta
    }

    with open(dossier_grille / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    nb_tuiles = len(tuiles_existantes)
    poids_total_mo = total_octets / (1024 * 1024)
    poids_moyen_ko = (total_octets / nb_tuiles / 1024) if nb_tuiles > 0 else 0

    print("\n========================================================")
    print("BILAN DE GÉNÉRATION DE LA GRILLE RASTER v2")
    print("========================================================")
    print(f"Tuiles créées (avec forêt/ouvert) : {nb_tuiles} / {nb_tx * nb_ty} potentielles")
    print(f"Poids total des tuiles            : {poids_total_mo:.2f} Mo")
    print(f"Poids moyen par tuile             : {poids_moyen_ko:.1f} Ko")
    print(f"Fichiers de métadonnées           : manifest.json v2 & essences.json")

    if pilote_stats["nb_total_cellules_pilote"] > 0:
        tot_p = pilote_stats["nb_total_cellules_pilote"]
        pct_bd = pilote_stats["nb_foret_bd"] / tot_p * 100
        pct_mnh = pilote_stats["nb_foret_mnh"] / tot_p * 100
        pct_accord = pilote_stats["accord_strict"] / tot_p * 100
        print("\n--- RAPPORT CHIFFRÉ ZONE PILOTE (3x3 tuiles, 19.2 km x 19.2 km) ---")
        print(f"Total cellules pilote            : {tot_p}")
        print(f"Forêt selon BD Forêt             : {pilote_stats['nb_foret_bd']} ({pct_bd:.2f} %)")
        print(f"Forêt selon MNH LiDAR HD         : {pilote_stats['nb_foret_mnh']} ({pct_mnh:.2f} %)")
        print(f"Accord strict BD Forêt / MNH     : {pilote_stats['accord_strict']} ({pct_accord:.2f} %)")
        print(f"Cellules ouvertes en forêt (code 2) : {pilote_stats['nb_foret_2_ouvert']}")
        print(f"Cellules forêt hors BD Forêt (code 255): {pilote_stats['nb_foret_hors_bd']}")
    print("========================================================")



if __name__ == "__main__":
    main()
