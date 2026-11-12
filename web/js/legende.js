/**
 * Module de gestion des légendes et palettes de la grille 25 m
 * MesChampis — Couleurs strictement synchronisées via couleurs.js
 */

import {
  getConicGradientExpo,
  getLinearGradientAltitude,
  getLinearGradientPente,
  getLinearGradientLisiere,
  getLinearGradientCouvert,
  getLinearGradientHauteur,
  couleurEssence,
  COULEUR_OUVERT,
  rgbToStr
} from './couleurs.js';

/**
 * Rendu de la légende d'exposition (roue chromatique cyclique 360°)
 */
export function renderLegendeExposition(container) {
  const gradientCss = getConicGradientExpo();
  container.innerHTML = `
    <div class="legend-expo">
      <div class="expo-wheel-container">
        <span class="expo-label nord">N</span>
        <span class="expo-label est">E</span>
        <span class="expo-label sud">S</span>
        <span class="expo-label ouest">O</span>
        <div class="expo-wheel" style="background: ${gradientCss};"></div>
      </div>
      <div class="legend-expo-flat">
        <span class="dot-flat"></span>
        <span>Plat (pente &lt; 3°)</span>
      </div>
      <div class="legend-expo-flat" style="margin-top: 4px;">
        <span class="dot-flat" style="background-color: rgba(220, 220, 225, 0.85); border: 1px solid #94a3b8;"></span>
        <span>Ouvert / coupe récente</span>
      </div>
    </div>
  `;
}

/**
 * Rendu de la légende d'altitude (250m -> 1900m)
 */
export function renderLegendeAltitude(container, minAlt = 250, maxAlt = 1900) {
  const medAlt = Math.round((minAlt + maxAlt) / 2);
  const rampCss = getLinearGradientAltitude();
  container.innerHTML = `
    <div class="legend-altitude">
      <div class="control-label" style="margin-bottom:0.3rem;">Altitude (mètres) :</div>
      <div class="altitude-ramp" style="background: ${rampCss};"></div>
      <div class="altitude-labels">
        <span>${minAlt} m</span>
        <span>${medAlt} m</span>
        <span>${maxAlt} m</span>
      </div>
    </div>
  `;
}

/**
 * Rendu de la légende du couvert arboré (0-100%, LiDAR HD)
 */
export function renderLegendeCouvert(container, map = null) {
  const rampCss = getLinearGradientCouvert();
  container.innerHTML = `
    <div class="legend-couvert">
      <div class="control-label" style="margin-bottom:0.3rem;">Couvert arboré (% pixels &ge; 3 m) :</div>
      <div class="altitude-ramp" style="background: ${rampCss};"></div>
      <div class="altitude-labels">
        <span>0 % (Clairière)</span>
        <span>50 % (Seuil forêt)</span>
        <span>100 % (Dense)</span>
      </div>
      <div class="legend-item" style="margin-top: 8px;">
        <div class="legend-item-left">
          <span class="legend-dot" style="background-color: rgb(100, 116, 139); opacity: 0.9;"></span>
          <span style="font-size: 0.78rem; color: var(--text-muted);">Forêt hors couverture LiDAR HD</span>
        </div>
      </div>
      <div class="pilot-zone-box">
        <div class="pilot-badge">✅ LiDAR HD — 100% des forêts du 63</div>
        <p class="pilot-text">Accès rapide aux massifs forestiers :</p>
        <div class="pilot-buttons-row">
          <button class="btn-goto-massif btn-goto-puys" type="button">🎯 Puys</button>
          <button class="btn-goto-massif btn-goto-sancy" type="button">🎯 Sancy</button>
          <button class="btn-goto-massif btn-goto-livradois" type="button">🎯 Livradois</button>
          <button class="btn-goto-massif btn-goto-combrailles" type="button">🎯 Combrailles</button>
          <button class="btn-goto-massif btn-goto-foreznord" type="button">🎯 Bois Noirs</button>
        </div>
      </div>
    </div>
  `;

  attacherBoutonsMassifs(container);
}

/**
 * Rendu de la légende de hauteur des arbres (0-40m+, LiDAR HD)
 */
export function renderLegendeHauteur(container) {
  const rampCss = getLinearGradientHauteur();
  container.innerHTML = `
    <div class="legend-hauteur">
      <div class="control-label" style="margin-bottom:0.3rem;">Hauteur dominante (percentile 90) :</div>
      <div class="altitude-ramp" style="background: ${rampCss};"></div>
      <div class="altitude-labels">
        <span>0 m</span>
        <span>14 m</span>
        <span>28 m</span>
        <span>&ge; 40 m</span>
      </div>
      <div class="pilot-zone-box" style="margin-top: 10px;">
        <div class="pilot-badge">✅ LiDAR HD — 100% des forêts du 63</div>
        <p class="pilot-text">Accès rapide aux massifs forestiers :</p>
        <div class="pilot-buttons-row">
          <button class="btn-goto-massif btn-goto-puys" type="button">🎯 Puys</button>
          <button class="btn-goto-massif btn-goto-sancy" type="button">🎯 Sancy</button>
          <button class="btn-goto-massif btn-goto-livradois" type="button">🎯 Livradois</button>
          <button class="btn-goto-massif btn-goto-combrailles" type="button">🎯 Combrailles</button>
          <button class="btn-goto-massif btn-goto-foreznord" type="button">🎯 Bois Noirs</button>
        </div>
      </div>
    </div>
  `;

  attacherBoutonsMassifs(container);
}

function attacherBoutonsMassifs(container) {
  const massifs = [
    { selector: '.btn-goto-puys', center: [2.97, 45.77], zoom: 12.2 },
    { selector: '.btn-goto-sancy', center: [2.85, 45.54], zoom: 12.0 },
    { selector: '.btn-goto-livradois', center: [3.78, 45.54], zoom: 11.8 },
    { selector: '.btn-goto-combrailles', center: [2.88, 46.07], zoom: 12.0 },
    { selector: '.btn-goto-foreznord', center: [3.68, 45.92], zoom: 11.8 },
  ];
  massifs.forEach(m => {
    container.querySelectorAll(m.selector).forEach(btn => {
      btn.addEventListener('click', () => {
        const targetMap = map || window.__meschampis?.gestionnaireGrille?.map || window.__meschampis?.grille?.map;
        if (targetMap) {
          targetMap.flyTo({ center: m.center, zoom: m.zoom, speed: 1.3 });
        }
      });
    });
  });
}

/**
 * Rendu de la légende de pente
 */
export function renderLegendePente(container) {
  const rampCss = getLinearGradientPente();
  container.innerHTML = `
    <div class="legend-pente">
      <div class="control-label" style="margin-bottom:0.3rem;">Pente du terrain (degrés) :</div>
      <div class="pente-ramp" style="background: ${rampCss};"></div>
      <div class="altitude-labels">
        <span>0° (plat)</span>
        <span>15° (moyen)</span>
        <span>&ge; 35° (abrupt)</span>
      </div>
    </div>
  `;
}

/**
 * Rendu de la légende de lisière
 */
export function renderLegendeLisiere(container) {
  const rampCss = getLinearGradientLisiere();
  container.innerHTML = `
    <div class="legend-lisiere">
      <div class="control-label" style="margin-bottom:0.3rem;">Distance à la lisière non-forêt :</div>
      <div class="lisiere-ramp" style="background: ${rampCss};"></div>
      <div class="altitude-labels">
        <span>0 m (Bordure)</span>
        <span>100 m</span>
        <span>&ge; 250 m (Cœur)</span>
      </div>
    </div>
  `;
}

/**
 * Rendu de la légende des essences forestières
 */
export function renderLegendeEssences(container, tableEssences) {
  let itemsHtml = '<div class="legend-list">';
  const codes = Object.keys(tableEssences || {}).map(Number).sort((a, b) => a - b);

  for (const code of codes) {
    if (code === 0) continue; // Ignorer hors-forêt dans la légende
    const nom = tableEssences[code];
    const colRgb = couleurEssence(code);
    const colCss = rgbToStr(colRgb);

    itemsHtml += `
      <div class="legend-item" title="${nom}">
        <div class="legend-item-left">
          <span class="legend-dot" style="background-color: ${colCss};"></span>
          <span>${nom}</span>
        </div>
      </div>
    `;
  }

  // Essence inconnue (haies / bosquets LiDAR)
  itemsHtml += `
    <div class="legend-item" title="Forêt détectée par LiDAR hors polygone BD Forêt">
      <div class="legend-item-left">
        <span class="legend-dot" style="background-color: rgb(110, 150, 125);"></span>
        <span>Essence inconnue (LiDAR)</span>
      </div>
    </div>
    <div class="legend-item" title="Polygone BD Forêt sans arbres détectés par LiDAR">
      <div class="legend-item-left">
        <span class="legend-dot" style="background-color: rgb(220, 220, 225); border: 1px solid #94a3b8;"></span>
        <span>Ouvert / coupe récente</span>
      </div>
    </div>
  `;
  itemsHtml += '</div>';

  container.innerHTML = `
    <div class="legend-essence">
      <div class="legend-notice">
        ℹ️ L'essence est issue de la BD Forêt® V2 et des détections LiDAR HD.
      </div>
      ${itemsHtml}
    </div>
  `;
}

/**
 * Convertit un azimut en degrés [0, 360[ en direction cardinale (16 points)
 */
export function getOrientationTexte(deg) {
  if (deg === null || deg === undefined || isNaN(deg)) {
    return '—';
  }
  const directions = [
    'Nord', 'Nord-Nord-Est', 'Nord-Est', 'Est-Nord-Est',
    'Est', 'Est-Sud-Est', 'Sud-Est', 'Sud-Sud-Est',
    'Sud', 'Sud-Sud-Ouest', 'Sud-Ouest', 'Ouest-Sud-Ouest',
    'Ouest', 'Ouest-Nord-Ouest', 'Nord-Ouest', 'Nord-Nord-Ouest'
  ];
  const index = Math.round((deg % 360) / 22.5) % 16;
  return `${directions[index]} (${deg.toFixed(1)}°)`;
}
