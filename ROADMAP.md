# MesChampis — Feuille de route

Ce document décrit les principes du projet et les prochaines étapes envisagées.

---

## Principes

1. **Outil strictement personnel**
   - Les coins à champignons restent privés : aucun partage public, aucun « spot communautaire », aucun croisement de données entre utilisateurs.
   - Les données publiques de biodiversité (OpenObs / INPN, GBIF sous licences CC0 ou CC BY) pourront servir de point de départ aux utilisateurs sans carnet, agrégées en **milieux favorables**, sans jamais restituer de points précis.

2. **Calculs locaux et confidentialité**
   - Les calculs écologiques (lecture de la grille, scores, carte de chaleur) s'exécutent sur l'appareil de l'utilisateur.
   - Un éventuel serveur se limiterait à distribuer les tuiles statiques et à stocker une sauvegarde chiffrée du carnet.

---

## Sauvegarde chiffrée de bout en bout (prévue)

- Les données du carnet (positions, espèces, notes) sont chiffrées sur l'appareil avant tout envoi.
- La clé maître est générée côté client et enveloppée deux fois : par le mot de passe et par un **code de secours** remis à l'inscription.
- Le serveur ne peut pas lire les cueillettes, les espèces ni les coordonnées.
- La partie client est implémentée et testée ; le serveur est simulé en mode démo (`?demo=1`). Le contrat d'API prévu est décrit dans [docs/API.md](docs/API.md).

---

## Prochaines étapes

```text
1. Fiabilisation du carnet (tests, compatibilité Safari et Web Crypto)
2. Couches de contexte forestier complémentaires
3. Profil écologique à partir du carnet et validation des scores de similarité
4. Milieux favorables à partir des données publiques (OpenObs / GBIF), si le diagnostic est concluant
5. Intégration météo (pluviométrie et températures)
6. Serveur de synchronisation chiffrée et déploiement
```
