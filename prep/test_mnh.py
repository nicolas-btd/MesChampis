#!/usr/bin/env python3
"""
Tests unitaires pour l'agrégation MNH LiDAR HD (50 cm -> 25 m)
MesChampis
"""

import numpy as np


def aggreger_cellule_mnh(
    valeurs: np.ndarray,
    nodata: float = -9999.0,
    seuil_arbre: float = 3.0,
) -> tuple[int, int]:
    """
    Agrège les 2500 pixels (50x50 à 50 cm) d'une cellule de 25 m.
    Renvoie (couvert_u8, hauteur_u8).
    - couvert: 0-100 %, 255 = nodata
    - hauteur: 0-254 au pas de 0.25 m (ex. 80 = 20 m), 255 = nodata
    """
    # 1. Masque pixels valides
    valid_mask = (valeurs != nodata) & ~np.isnan(valeurs)
    n_valid = int(valid_mask.sum())
    total_pixels = valeurs.size

    # Moins de 50 % de pixels valides -> nodata
    if n_valid < (total_pixels / 2):
        return 255, 255

    # 2. Nettoyage des valeurs négatives ramenées à 0
    vals_valid = np.where(valeurs[valid_mask] < 0, 0.0, valeurs[valid_mask])

    # 3. Couvert : % de pixels avec h >= seuil_arbre
    tree_mask = vals_valid >= seuil_arbre
    n_trees = int(tree_mask.sum())
    couvert_pct = int(round((n_trees / n_valid) * 100.0))
    couvert_pct = max(0, min(100, couvert_pct))

    # 4. Hauteur dominante (percentile 90 des pixels arbres)
    if n_trees > 0:
        p90 = float(np.percentile(vals_valid[tree_mask], 90))
        code_h = int(round(p90 / 0.25))
        code_h = max(0, min(254, code_h))
    else:
        code_h = 0

    return couvert_pct, code_h


def test_dalle_synthetique_moitie_arbre():
    """Moitié 0 m, moitié 20 m -> couvert 50 %, hauteur 20 m (code 80)."""
    cell = np.zeros((50, 50), dtype=np.float32)
    cell[:25, :] = 20.0  # 1250 pixels à 20 m
    # cell[25:, :] = 0.0 (1250 pixels à 0 m)

    couvert, hauteur = aggreger_cellule_mnh(cell)
    assert couvert == 50, f"Attendu 50%, obtenu {couvert}%"
    assert hauteur == 80, f"Attendu 80 (20 m), obtenu {hauteur} ({hauteur * 0.25} m)"
    print("✓ Test moitié arbre (50%, 20m) validé.")


def test_dalle_nodata():
    """Plus de 50 % de nodata -> cellule nodata (255, 255)."""
    cell = np.full((50, 50), -9999.0, dtype=np.float32)
    cell[:20, :] = 15.0  # seulement 1000 pixels valides (< 1250)

    couvert, hauteur = aggreger_cellule_mnh(cell)
    assert couvert == 255, f"Attendu 255 pour couvert nodata, obtenu {couvert}"
    assert hauteur == 255, f"Attendu 255 pour hauteur nodata, obtenu {hauteur}"
    print("✓ Test nodata validé.")


def test_dalle_valeurs_negatives():
    """Valeurs négatives (bruit sol) ramenées à 0 m sans fausser les arbres."""
    cell = np.zeros((50, 50), dtype=np.float32)
    cell[:25, :] = -0.8  # 1250 pixels bruit sol négatif
    cell[25:, :] = 12.0  # 1250 pixels arbres à 12 m

    couvert, hauteur = aggreger_cellule_mnh(cell)
    assert couvert == 50, f"Attendu 50%, obtenu {couvert}%"
    assert hauteur == int(round(12.0 / 0.25)), f"Attendu code 48 (12 m), obtenu {hauteur}"
    print("✓ Test valeurs négatives validé.")


def test_dalle_aucun_arbre():
    """Zone ouverte (herbe / pré) -> couvert 0 %, hauteur 0 m."""
    cell = np.full((50, 50), 0.5, dtype=np.float32)  # herbe 0.5 m (< 3 m)

    couvert, hauteur = aggreger_cellule_mnh(cell)
    assert couvert == 0, f"Attendu 0%, obtenu {couvert}%"
    assert hauteur == 0, f"Attendu 0, obtenu {hauteur}"
    print("✓ Test aucun arbre (couvert 0, hauteur 0) validé.")


def test_masque_foret_nettoyage():
    """Filtre les bosquets < 8 cellules et rebouche les trous non-forêt <= 2 cellules."""
    from scipy.ndimage import label

    # Grille 20x20
    # Massif 1 : 10x10 = 100 cellules avec un trou de 1 cellule et un trou de 4 cellules
    arbres = np.zeros((20, 20), dtype=bool)
    arbres[2:12, 2:12] = True
    arbres[5, 5] = False        # trou de 1 cellule -> doit être rebouché
    arbres[8:10, 8:10] = False  # trou de 4 cellules -> doit rester ouvert

    # Bosquet isolé de 4 cellules (< 8) -> doit être supprimé
    arbres[15:17, 15:17] = True

    # 1. Suppression < 8 cellules (8-connexité)
    struct8 = np.ones((3, 3), dtype=bool)
    lbl, num = label(arbres, structure=struct8)
    sizes = np.bincount(lbl.ravel())
    keep_mask = (sizes >= 8)
    keep_mask[0] = False
    foret_clean = keep_mask[lbl]

    assert not foret_clean[15, 15], "Le bosquet de 4 cellules doit être supprimé (< 8)"
    assert foret_clean[2, 2], "Le massif principal doit être conservé"

    # 2. Rebouchage des trous non-forêt <= 2 cellules
    non_foret = ~foret_clean
    struct4 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)
    lbl_h, num_h = label(non_foret, structure=struct4)
    hole_sizes = np.bincount(lbl_h.ravel())
    small_holes = (hole_sizes <= 2)
    small_holes[0] = False
    fill_mask = small_holes[lbl_h]
    foret_clean[fill_mask] = True

    assert foret_clean[5, 5], "Le trou de 1 cellule doit être rebouché"
    assert not foret_clean[8, 8], "La trouée de 4 cellules doit rester non-forêt"
    print("✓ Test nettoyage masque forêt (groupes < 8, trous <= 2) validé.")


def test_codes_foret_et_essence():
    """Vérifie foret=2 (coupe rase) et essence=255 (haie/bosquet hors BD Forêt)."""
    # Cas 1 : BD Forêt = 1, MNH = 0 -> foret = 2, essence conservée
    bd_foret = 1
    bd_essence = 12
    mnh_clean = False
    valide_mnh = True

    code_foret = 1 if (valide_mnh and mnh_clean) else (2 if (valide_mnh and not mnh_clean and bd_foret == 1) else 0)
    code_essence = bd_essence if code_foret == 2 else bd_essence
    assert code_foret == 2, f"Attendu foret=2 pour coupe rase, obtenu {code_foret}"
    assert code_essence == 12, "L'essence BD Forêt doit être conservée en zone ouverte"

    # Cas 2 : BD Forêt = 0, MNH = 1 -> foret = 1, essence = 255
    bd_foret = 0
    bd_essence = 0
    mnh_clean = True
    code_foret = 1 if (valide_mnh and mnh_clean) else 0
    code_essence = 255 if (code_foret == 1 and bd_foret == 0) else bd_essence
    assert code_foret == 1, "Doit être forêt MNH"
    assert code_essence == 255, "Essence doit être 255 (inconnue) hors BD Forêt"
    print("✓ Test codes forêt (foret=2 coupe rase, essence=255 inconnue) validé.")


if __name__ == "__main__":
    test_dalle_synthetique_moitie_arbre()
    test_dalle_nodata()
    test_dalle_valeurs_negatives()
    test_dalle_aucun_arbre()
    test_masque_foret_nettoyage()
    test_codes_foret_et_essence()
    print("\nTous les tests MNH sont passés.")
