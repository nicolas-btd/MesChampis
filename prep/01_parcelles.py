#!/usr/bin/env python3
"""
Étape 1 : Préparation des données - Fiches écologiques des parcelles forestières
MesChampis - Webapp non lucrative d'aide à la cueillette de champignons

Ce script :
1. Charge les parcelles de la BD Forêt V2 (FORMATION_VEGETALE.shp), les filtre (CODE_TFV débutant par 'F')
   et les reprojette en EPSG:2154.
2. Fusionne les dalles MNT .asc de la BD ALTI 25 m IGN (nodata = -9999 -> NaN).
3. Calcule la pente (degrés) et l'exposition (azimut de descente, 0° = Nord, 90° = Est) via numpy.gradient.
   L'exposition est fixée à NaN si la pente est inférieure à 3°.
4. Extrait les statistiques zonales par parcelle : altitude (moy, min, max), pente moyenne,
   et sin/cos moyens de l'exposition.
5. Calcule l'exposition moyenne circulaire (atan2(mean_sin, mean_cos) % 360) et l'exposition nette (hypot).
6. Simplifie les géométries (tolérance 5 m), arrondit les attributs et exporte en EPSG:4326 (GeoJSON).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.merge import merge
from rasterstats import zonal_stats
import shapely


# ==============================================================================
# Fonctions de calcul topographique
# ==============================================================================

def calculer_pente_et_exposition(
    mnt: np.ndarray,
    res_x: float,
    res_y: float
) -> tuple[np.ndarray, np.ndarray]:
    """
    Calcule la pente en degrés et l'exposition en degrés (azimut de descente).

    Paramètres :
        mnt   : Grille 2D d'altitudes (en mètres).
        res_x : Taille du pixel en X (largeur en mètres, > 0).
        res_y : Taille du pixel en Y (hauteur en mètres, > 0).

    Convention raster :
        - Axe 0 (lignes) : va du Nord vers le Sud (y augmente vers le Sud).
        - Axe 1 (colonnes) : va de l'Ouest vers l'Est (x augmente vers l'Est).

    Exposition (direction de descente du terrain) :
        - 0° = Nord, 90° = Est, 180° = Sud, 270° = Ouest.
        - Si dz_dy > 0, l'altitude augmente vers le Sud, donc le terrain descend vers le Nord (d_nord > 0).
        - Si dz_dx > 0, l'altitude augmente vers l'Est, donc le terrain descend vers l'Ouest (d_est < 0).
        - Si pente < 3°, l'exposition est fixée à NaN (terrain plat).
    """
    # Gradient selon les axes y (lignes) et x (colonnes)
    dz_dy, dz_dx = np.gradient(mnt, res_y, res_x)

    # Norme de la pente et conversion en degrés
    norme_gradient = np.hypot(dz_dx, dz_dy)
    pente = np.degrees(np.arctan(norme_gradient))

    # Composantes du vecteur de plus grande pente (direction de descente)
    # d_est  : composante vers l'Est (opposée à la montée vers l'Est)
    # d_nord : composante vers le Nord (puisque y augmente vers le Sud, la montée vers le Sud = descente vers le Nord)
    d_est = -dz_dx
    d_nord = dz_dy

    # Azimut géographique de descente en degrés (0° = Nord, sens horaire)
    expo = (np.degrees(np.arctan2(d_est, d_nord))) % 360.0
    # Normalisation stricte pour éviter 360.0 flottant à la place de 0.0
    expo = np.where(np.isclose(expo, 360.0) | np.isclose(expo, 0.0), 0.0, expo)

    # Terrain quasi-plat (< 3°) : exposition indéterminée
    expo[pente < 3.0] = np.nan

    # Propagation des NaN d'élévation
    masque_nan = np.isnan(mnt)
    pente[masque_nan] = np.nan
    expo[masque_nan] = np.nan

    return pente, expo


def moyenne_circulaire(
    mean_sin: float | None,
    mean_cos: float | None
) -> tuple[float | None, float]:
    """
    Calcule l'angle moyen circulaire et l'indice de concentration (expo_nette).

    Retourne :
        (expo_deg, expo_nette)
        - expo_deg   : angle moyen circulaire en degrés [0, 360[, ou None si indéterminé.
        - expo_nette : norme du vecteur moyen dans [0, 1] (0 = plat / versants variés, 1 = exposition homogène).
    """
    if mean_sin is None or mean_cos is None:
        return None, 0.0
    if np.isnan(mean_sin) or np.isnan(mean_cos):
        return None, 0.0

    expo_nette = float(np.hypot(mean_sin, mean_cos))

    # Si le vecteur moyen est nul (terrain plat ou versants parfaitement opposés)
    if expo_nette < 1e-4:
        return None, 0.0

    angle = float(np.degrees(np.arctan2(mean_sin, mean_cos)) % 360.0)
    if abs(angle - 360.0) < 1e-6 or abs(angle) < 1e-6:
        angle = 0.0

    return angle, expo_nette


# ==============================================================================
# Tests rapides de vérification
# ==============================================================================

def tester_calculs() -> None:
    """
    Vérification automatique des calculs topographiques et circulaires :
    1. Sur un plan incliné descendant vers le Nord, l'exposition doit être ≈ 0°.
    2. La moyenne circulaire de 350° et 10° doit donner ≈ 0°.
    3. Sur un terrain plat (< 3°), l'exposition doit être NaN.
    4. Sur un plan incliné descendant vers l'Est, l'exposition doit être ≈ 90°.
    """
    print("=== Exécution des tests de vérification algorithmique ===")

    # Test 1 : Plan incliné descendant vers le Nord (5x5 pixels de 25m)
    # Les lignes vont du Nord (y=0) vers le Sud (y=4).
    # Altitude plus basse au Nord (y=0) et plus haute au Sud (y=4) -> le terrain descend vers le Nord !
    y = np.arange(5)[:, None]
    x = np.arange(5)[None, :]
    mnt_nord = 100.0 + 10.0 * y + 0.0 * x  # Pente ~ 21.8° vers le Nord
    pente_nord, expo_nord = calculer_pente_et_exposition(mnt_nord, res_x=25.0, res_y=25.0)

    val_expo_nord = float(expo_nord[2, 2])
    val_pente_nord = float(pente_nord[2, 2])
    assert val_pente_nord > 3.0, f"Erreur test 1 : pente trop faible ({val_pente_nord}°)"
    assert abs(val_expo_nord - 0.0) < 1e-3, (
        f"Erreur test 1 : l'exposition attendue est ≈ 0°, obtenue : {val_expo_nord}°"
    )
    print(f"  [OK] Test 1 : Plan incliné descendant vers le Nord -> expo = {val_expo_nord:.1f}° (attendu ≈ 0°)")

    # Test 2 : Moyenne circulaire de 350° et 10°
    angles = np.array([350.0, 10.0])
    mean_sin = float(np.mean(np.sin(np.radians(angles))))
    mean_cos = float(np.mean(np.cos(np.radians(angles))))
    expo_circ, expo_nette = moyenne_circulaire(mean_sin, mean_cos)

    assert expo_circ is not None, "Erreur test 2 : expo_circ est None"
    assert abs(expo_circ - 0.0) < 1e-3, (
        f"Erreur test 2 : la moyenne circulaire de [350°, 10°] doit donner ≈ 0°, obtenue : {expo_circ}°"
    )
    assert expo_nette > 0.95, f"Erreur test 2 : expo_nette attendue > 0.95, obtenue : {expo_nette}"
    print(
        f"  [OK] Test 2 : Moyenne circulaire de 350° et 10° -> {expo_circ:.1f}° "
        f"(expo_nette = {expo_nette:.2f})"
    )

    # Test 3 : Pente < 3° -> exposition = NaN
    mnt_plat = 100.0 + 0.1 * y + 0.0 * x  # Pente < 1°
    pente_plat, expo_plat = calculer_pente_et_exposition(mnt_plat, res_x=25.0, res_y=25.0)
    assert np.isnan(expo_plat[2, 2]), "Erreur test 3 : l'exposition pour pente < 3° doit être NaN"
    print("  [OK] Test 3 : Pente < 3° -> expo = NaN")

    # Test 4 : Plan incliné descendant vers l'Est (x=0 haut, x=4 bas)
    mnt_est = 200.0 - 10.0 * x + 0.0 * y
    pente_est, expo_est = calculer_pente_et_exposition(mnt_est, res_x=25.0, res_y=25.0)
    val_expo_est = float(expo_est[2, 2])
    assert abs(val_expo_est - 90.0) < 1e-3, (
        f"Erreur test 4 : l'exposition attendue est ≈ 90°, obtenue : {val_expo_est}°"
    )
    print(f"  [OK] Test 4 : Plan incliné descendant vers l'Est -> expo = {val_expo_est:.1f}° (attendu ≈ 90°)")

    print("=== Tous les tests de validation ont réussi avec succès ! ===\n")


# ==============================================================================
# Pipeline de traitement principal
# ==============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Préparation des parcelles forestières pour MesChampis (IGN BD Forêt V2 + BD ALTI 25 m)"
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Exécute uniquement les tests algorithmiques de validation"
    )
    args = parser.parse_args()

    # Si le mode test est demandé
    if args.test:
        tester_calculs()
        return

    # Exécution systématique du test rapide pour garantir l'intégrité des formules
    tester_calculs()

    # Définition des chemins avec pathlib
    racine_projet = Path(__file__).resolve().parent.parent
    dossier_bdforet = racine_projet / "data" / "raw" / "bdforet"
    dossier_bdalti = racine_projet / "data" / "raw" / "bdalti"
    dossier_out = racine_projet / "data" / "out"
    fichier_sortie = dossier_out / "parcelles.geojson"

    dossier_out.mkdir(parents=True, exist_ok=True)

    # --------------------------------------------------------------------------
    # 1. Lecture et filtrage de la BD Forêt V2
    # --------------------------------------------------------------------------
    print("--- Étape 1 : Lecture de la BD Forêt V2 ---")
    shp_candidats = list(dossier_bdforet.rglob("FORMATION_VEGETALE.shp"))
    if not shp_candidats:
        # Recherche insensible à la casse
        shp_candidats = [
            f for f in dossier_bdforet.rglob("*.shp")
            if f.name.lower() == "formation_vegetale.shp"
        ]

    if not shp_candidats:
        print(f"\n[ERREUR CRITIQUE] Fichier FORMATION_VEGETALE.shp introuvable dans {dossier_bdforet}")
        print("Veuillez télécharger la BD Forêt V2 IGN pour votre département et extraire")
        print(f"l'archive dans : {dossier_bdforet.resolve()}\n")
        sys.exit(1)

    chemin_shp = shp_candidats[0]
    print(f"Fichier shapefile détecté : {chemin_shp.relative_to(racine_projet)}")

    gdf_foret = gpd.read_file(chemin_shp)
    print(f"Entités lues : {len(gdf_foret)}")

    # Vérification stricte des colonnes requises
    colonnes_requises = ["CODE_TFV", "TFV", "ESSENCE"]
    colonnes_manquantes = [col for col in colonnes_requises if col not in gdf_foret.columns]
    if colonnes_manquantes:
        print(f"\n[ERREUR CRITIQUE] Les colonnes suivantes sont absentes : {colonnes_manquantes}")
        print(f"Colonnes disponibles dans le shapefile ({len(gdf_foret.columns)}) :")
        for col in sorted(gdf_foret.columns):
            print(f"  - {col}")
        sys.exit(1)

    # Reprojection en Lambert-93 (EPSG:2154) si nécessaire
    if gdf_foret.crs is None or gdf_foret.crs.to_epsg() != 2154:
        print("Reprojection de la BD Forêt en EPSG:2154 (Lambert-93)...")
        gdf_foret = gdf_foret.to_crs(epsg=2154)

    # Filtrer les formations végétales fermées / forêts : CODE_TFV commençant par "F"
    gdf_foret = gdf_foret[
        gdf_foret["CODE_TFV"].astype(str).str.strip().str.upper().str.startswith("F")
    ].copy()

    if len(gdf_foret) == 0:
        print("\n[ATTENTION] Aucune parcelle forestière trouvée avec CODE_TFV débutant par 'F'.")
        sys.exit(0)

    print(f"Parcelles forestières retenues (CODE_TFV ~ 'F*') : {len(gdf_foret)}")

    # --------------------------------------------------------------------------
    # 2. Fusion des dalles MNT BD ALTI 25 m
    # --------------------------------------------------------------------------
    print("\n--- Étape 2 : Fusion des dalles BD ALTI 25 m ---")
    dalles_asc = sorted(list(dossier_bdalti.rglob("*.asc")) + list(dossier_bdalti.rglob("*.ASC")))

    if not dalles_asc:
        print(f"\n[ERREUR CRITIQUE] Aucune dalle .asc trouvée dans {dossier_bdalti}")
        print("Veuillez télécharger les dalles BD ALTI 25 m IGN (format ASCII .asc) de votre")
        print(f"département et les placer dans : {dossier_bdalti.resolve()}\n")
        sys.exit(1)

    print(f"{len(dalles_asc)} dalle(s) .asc trouvée(s). Fusion en cours...")
    datasets_ouverts = [rasterio.open(f) for f in dalles_asc]

    try:
        mnt_fusionne, transfo_mnt = merge(datasets_ouverts, nodata=-9999.0)
    finally:
        for ds in datasets_ouverts:
            ds.close()

    # mnt_fusionne est de dimension (1, hauteur, largeur)
    mnt_array = mnt_fusionne[0].astype(np.float64)
    mnt_array[mnt_array == -9999.0] = np.nan
    print(f"Dimensions du MNT fusionné : {mnt_array.shape[1]} x {mnt_array.shape[0]} pixels")

    # --------------------------------------------------------------------------
    # 3. Calcul de la pente et de l'exposition
    # --------------------------------------------------------------------------
    print("\n--- Étape 3 : Calcul de la pente et de l'exposition ---")
    res_x = abs(float(transfo_mnt.a))
    res_y = abs(float(transfo_mnt.e))
    print(f"Résolution spatiale du pixel : dx = {res_x:.2f} m, dy = {res_y:.2f} m")

    pente_deg, expo_deg = calculer_pente_et_exposition(mnt_array, res_x=res_x, res_y=res_y)

    # --------------------------------------------------------------------------
    # 4. Statistiques zonales par parcelle
    # --------------------------------------------------------------------------
    print("\n--- Étape 4 : Extraction des statistiques zonales (rasterstats) ---")
    expo_rad = np.radians(expo_deg)
    sin_expo = np.sin(expo_rad)
    cos_expo = np.cos(expo_rad)

    # Statistiques zonales
    print("  - Altitude (moyenne, min, max)...")
    stats_alt = zonal_stats(
        gdf_foret,
        mnt_array,
        affine=transfo_mnt,
        stats=["mean", "min", "max"],
        nodata=np.nan,
        all_touched=True
    )

    print("  - Pente moyenne...")
    stats_pente = zonal_stats(
        gdf_foret,
        pente_deg,
        affine=transfo_mnt,
        stats=["mean"],
        nodata=np.nan,
        all_touched=True
    )

    print("  - Moyennes trigonométriques de l'exposition (sin, cos)...")
    stats_sin = zonal_stats(
        gdf_foret,
        sin_expo,
        affine=transfo_mnt,
        stats=["mean"],
        nodata=np.nan,
        all_touched=True
    )
    stats_cos = zonal_stats(
        gdf_foret,
        cos_expo,
        affine=transfo_mnt,
        stats=["mean"],
        nodata=np.nan,
        all_touched=True
    )

    # --------------------------------------------------------------------------
    # 5. Moyenne circulaire et exposition nette
    # --------------------------------------------------------------------------
    print("\n--- Étape 5 : Calcul de la moyenne circulaire d'exposition ---")
    expositions_moyennes = []
    expositions_nettes = []

    for s_sin, s_cos in zip(stats_sin, stats_cos):
        val_sin = s_sin["mean"]
        val_cos = s_cos["mean"]
        angle_moy, expo_nette = moyenne_circulaire(val_sin, val_cos)
        if angle_moy is not None:
            angle_arrondi = round(angle_moy, 1) % 360.0
        else:
            angle_arrondi = None
        expositions_moyennes.append(angle_arrondi)
        expositions_nettes.append(round(expo_nette, 2))

    # --------------------------------------------------------------------------
    # 6. Structuration des colonnes et simplification géométrique
    # --------------------------------------------------------------------------
    print("\n--- Étape 6 : Préparation des attributs et simplification (5 m) ---")
    # Surface en hectares calculée sur la géométrie en mètres (EPSG:2154)
    surfaces_ha = (gdf_foret.geometry.area / 10000.0).round(2).tolist()

    # Simplification de la géométrie (tolérance 5 mètres)
    geometries_simplifiees = gdf_foret.geometry.simplify(
        tolerance=5.0,
        preserve_topology=True
    )

    alt_moy = [round(s["mean"], 1) if s["mean"] is not None and not np.isnan(s["mean"]) else None for s in stats_alt]
    alt_min = [round(s["min"], 1) if s["min"] is not None and not np.isnan(s["min"]) else None for s in stats_alt]
    alt_max = [round(s["max"], 1) if s["max"] is not None and not np.isnan(s["max"]) else None for s in stats_alt]
    pente_moy = [round(s["mean"], 1) if s["mean"] is not None and not np.isnan(s["mean"]) else None for s in stats_pente]

    # Construction du GeoDataFrame de sortie épuré
    gdf_resultat = gpd.GeoDataFrame(
        {
            "id": list(range(1, len(gdf_foret) + 1)),
            "essence": gdf_foret["ESSENCE"].astype(str).tolist(),
            "tfv": gdf_foret["TFV"].astype(str).tolist(),
            "surface_ha": surfaces_ha,
            "alt_moy": alt_moy,
            "alt_min": alt_min,
            "alt_max": alt_max,
            "pente_moy": pente_moy,
            "expo": expositions_moyennes,
            "expo_nette": expositions_nettes,
        },
        geometry=geometries_simplifiees,
        crs="EPSG:2154"
    )

    # --------------------------------------------------------------------------
    # 7. Reprojection en EPSG:4326 et export GeoJSON (précision 6 décimales)
    # --------------------------------------------------------------------------
    print("\n--- Étape 7 : Reprojection en EPSG:4326 et export GeoJSON ---")
    gdf_resultat = gdf_resultat.to_crs(epsg=4326)

    # Réduction de précision des coordonnées à 6 décimales (~10 cm sur le terrain)
    gdf_resultat.geometry = shapely.set_precision(gdf_resultat.geometry, grid_size=1e-6)

    # Écriture du fichier GeoJSON
    gdf_resultat.to_file(fichier_sortie, driver="GeoJSON")
    print(f"Export terminé avec succès : {fichier_sortie.relative_to(racine_projet)}")

    # Affichage du bilan
    print(f"\nNombre total de parcelles exportées : {len(gdf_resultat)}")
    colonnes_stats = ["surface_ha", "alt_moy", "alt_min", "alt_max", "pente_moy", "expo", "expo_nette"]
    print("\nStatistiques descriptives des colonnes écologiques :")
    print(gdf_resultat[colonnes_stats].describe().to_string())


if __name__ == "__main__":
    main()
