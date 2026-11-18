# MesChampis — Feuille de route & Décisions produit 🍄

Ce document formalise les orientations techniques, économiques et fonctionnelles du projet **MesChampis**.

---

## 🧭 Principes fondamentaux

1. **Outil strictement personnel, aucun modèle collectif**
   - Les coins à champignons restent la propriété exclusive de chaque utilisateur. Aucun partage public, aucun « spot communautaire », aucun croisement de données entre utilisateurs.
   - Les données publiques de biodiversité (OpenObs / INPN, GBIF sous licences ouvertes CC0 ou CC BY) ne seront utilisées qu'en mode secours pour les utilisateurs sans carnet historique : elles seront agrégées sous forme d'enveloppes de **milieux favorables**, sans jamais restituer de points précis de localisation.

2. **Calculs locaux & Confidentialité par conception**
   - Tous les calculs écologiques (croisement raster, similarité, indices) s'exécutent en local sur l'appareil de l'utilisateur.
   - L'infrastructure distante se limite à la distribution des dalles géographiques statiques, de la météo et à la synchronisation chiffrée.

---

## 🔐 Architecture du compte & Sauvegarde chiffrée de bout en bout (Étape 6)

- **Connexion obligatoire (à partir de l'étape 6)** :
  - Authentification simple : e-mail vérifié + mot de passe robuste.
- **Sauvegarde chiffrée de bout en bout (Zero-Knowledge)** :
  - Les données du carnet (positions, espèces, notes) sont chiffrées sur le terminal client avant tout envoi réseau.
  - La clé maître de déchiffrement est dérivée côté client et enveloppée par le mot de passe principal ainsi que par un **code de secours unique** fourni à l'utilisateur lors de son inscription.
  - **Le serveur est dans l'incapacité technique totale de lire les cueillettes, les espèces ou les coordonnées géographiques.**

---

## 💎 Modèle économique (Freemium éthique)

### Volet Gratuit (Base solide et pérenne)
- Exploration cartographique complète (fond IGN Plan & Photos aériennes).
- Les 7 couches raster écologiques haute résolution de 25 m (Exposition, Altitude, Pente, Lisières, Essences forestières, Couvert arboré LiDAR HD, Hauteur de canopée LiDAR HD).
- Carnet de cueillette privé illimité en local.
- Sauvegarde chiffrée manuelle exportable (`.mcb`).

### Volet Payant (Abonnement saisonnier / annuel)
- **Carte de chaleur écologique globale** : calcul du score de similarité prédictif sur l'ensemble du département (recommandation des massifs les plus favorables selon l'historique du carnet).
- **Météo prédictive (Météo-France)** : cumul des précipitations, hygrométrie et chocs thermiques favorables aux poussées.
- **Alertes de fructification** : notifications lors de l'alignement des conditions écologiques et météorologiques optimales.

### Période d'essai
- Essai gratuit de 7 jours déclenché à l'initiative de l'utilisateur (un seul essai par e-mail).
- La marque `essai_utilise: true` est tracée dans le store `meta` et incluse dans les sauvegardes `.mcb`.

### Gestion des paiements (Stripe)
- Utilisation directe de **Stripe Checkout** et du **Portail Client Stripe**.
- MesChampis ne stocke aucune coordonnée bancaire ni e-mail de facturation : seuls l'identifiant Stripe (`stripe_customer_id`), le statut de l'abonnement et la date d'échéance sont conservés.
- Protection anti-contournement minimale et pragmatique (les fichiers de données avancées comme `meteo.json` seront réservés aux comptes actifs lors de l'étape 6).

---

## 🗺️ Ordre des étapes de développement

```text
Étape 3 (C)   ──> Fiabilisation du carnet, isolation des tests, robustesse Safari & Web Crypto
Étape 4a      ──> Couches de contexte forestier v3 (données complémentaires)
Étape 4       ──> Modèle de profil écologique & Validation des scores de similarité
Étape 4 bis   ──> Module de secours public (OpenObs/GBIF - conditionné au diagnostic GO/NO-GO)
Étape 5       ──> Intégration météo (pluviométrie & températures Météo-France)
Étape 6       ──> Comptes utilisateurs, synchronisation chiffrée E2E, Stripe & Déploiement
Lancement     ──> Mise en production publique
```
