# Licences & Mentions Légales des Données — MesChampis 🍄

Ce document recense l'ensemble des données géographiques, modèles numériques et bibliothèques tierces utilisés dans le projet **MesChampis**, ainsi que leurs licences respectives, leurs mentions d'attribution obligatoires et leurs dates de récupération.

---

## 1. Données Géographiques & Modèles Numériques (IGN)

Toutes les données publiques produites par l'**Institut national de l'information géographique et forestière (IGN)** sont diffusées sous la **[Licence Ouverte Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/)** (compatible CC-BY 2.0).

### 🌲 BD Forêt® Version 2.0
* **Producteur :** Institut national de l'information géographique et forestière (IGN).
* **Licence :** Licence Ouverte Etalab 2.0.
* **Mention d'attribution obligatoire :** `Source : IGN – BD Forêt® Version 2.0`
* **Édition / Millésime :** D063 (Puy-de-Dôme), millésime du 01/04/2014.
* **Date de téléchargement :** 30 octobre 2026.
* **Usage :** Délimitation vectorielle des parcelles forestières, masques de forêt fermée (`CODE_TFV` commençant par `F`) et typologie des essences arborées dominantes.

### ⛰️ BD ALTI® 25 m
* **Producteur :** Institut national de l'information géographique et forestière (IGN).
* **Licence :** Licence Ouverte Etalab 2.0.
* **Mention d'attribution obligatoire :** `Source : IGN – BD ALTI® 25 m`
* **Édition / Millésime :** D063 (Puy-de-Dôme), millésime du 22/01/2021 (24 dalles ASCII Grid `.asc` en Lambert-93 / EPSG:2154).
* **Date de téléchargement :** 30 octobre 2026.
* **Usage :** Modèle Numérique de Terrain (MNT), calcul de l'altitude, de la pente et de l'exposition azimutale (gradient 25 m).

### 🛰️ LiDAR HD — Modèle Numérique de Hauteur (MNH)
* **Producteur :** Institut national de l'information géographique et forestière (IGN).
* **Licence :** Licence Ouverte Etalab 2.0.
* **Mention d'attribution obligatoire :** [`LiDAR HD © IGN`](https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_MNH-LIDAR-HD)
* **Jeu de données de référence :** [IGNF_MNH-LIDAR-HD sur Cartes.gouv.fr](https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_MNH-LIDAR-HD)
* **Source / Service :** Géoplateforme IGN — métadonnées interrogées via l'API Web Feature Service (WFS 2.0.0, couche `IGNF_LIDAR-HD_METADONNEE:metadata`) ; dalles GeoTIFF MNH à 50 cm de résolution.
* **Dates de téléchargement & moissonnage :** 31 octobre 2026 et 1er novembre 2026 (5 833 dalles de 1 km² agrégées sur l'ensemble des forêts du Puy-de-Dôme).
* **Usage :** Modèle Numérique de Hauteur de canopée : calcul du taux de couverture arborée (%) et de la hauteur dominante percentile 90 des arbres (0 à 63,5 m par pas de 0,25 m).

### 🗺️ Plan IGN (Plan IGN V2)
* **Producteur :** IGN – Géoplateforme.
* **Licence :** Licence Ouverte Etalab 2.0.
* **Mention d'attribution obligatoire :** `© IGN – Géoplateforme`
* **Service :** Flux WMTS public temps réel (couche `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`).
* **Date d'accès :** Flux dynamique temps réel (novembre 2026).
* **Usage :** Fond de carte cartographique de référence multi-échelles.

### 📷 Photos Aériennes (Ortho IGN)
* **Producteur :** IGN – Géoplateforme.
* **Licence :** Licence Ouverte Etalab 2.0.
* **Mention d'attribution obligatoire :** `© IGN – Géoplateforme`
* **Service :** Flux WMTS public temps réel (couche `ORTHOIMAGERY.ORTHOPHOTOS`).
* **Date d'accès :** Flux dynamique temps réel (novembre 2026).
* **Usage :** Fond d'imagerie aérienne haute résolution pour l'observation des versants et boisements.

---

## 2. Bibliothèques Logicielles Tierces

### 🗺️ MapLibre GL JS
* **Auteurs :** MapLibre Contributors (https://maplibre.org/).
* **Version intégrée :** 4.7.1 (hébergement local autonome dans `web/vendor/`).
* **Licence :** BSD 3-Clause License.
* **Notice de copyright :**
  ```text
  Copyright (c) 2020, MapLibre contributors
  All rights reserved.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

  1. Redistributions of source code must retain the above copyright notice, this
     list of conditions and the following disclaimer.

  2. Redistributions in binary form must reproduce the above copyright notice,
     this list of conditions and the following disclaimer in the documentation
     and/or other materials provided with the distribution.

  3. Neither the name of the copyright holder nor the names of its
     contributors may be used to endorse or promote products derived from
     this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
  FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
  DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
  SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
  CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
  OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
  ```

### 🌐 Proj4js
* **Auteurs :** Mike Adair, Richard Greenwood, Didier Richard, Stephen Woodbridge, Ed McNierney et contributeurs (https://github.com/proj4js/proj4js).
* **Version intégrée :** 2.9.2 (hébergement local autonome dans `web/vendor/`).
* **Licence :** MIT License.
* **Notice de copyright :**
  ```text
  Copyright (c) 2014 Mike Adair, Richard Greenwood, Didier Richard, Stephen Woodbridge, Ed McNierney

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  ```
