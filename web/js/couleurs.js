/**
 * Module de gestion centralisée des couleurs (palette unique)
 * MesChampis — Source unique de vérité pour la carte et la légende
 */

export function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      let val = t;
      if (val < 0) val += 1;
      if (val > 1) val -= 1;
      if (val < 1 / 6) return p + (q - p) * 6 * val;
      if (val < 1 / 2) return q;
      if (val < 2 / 3) return p + (q - p) * (2 / 3 - val) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function rgbToStr([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Couleur d'exposition selon l'azimut en degrés [0, 360[
 * 0°=Nord (Bleu ciel), 90°=Est (Vert), 180°=Sud (Orange), 270°=Ouest (Violet)
 * @param {number} deg
 * @returns {[number, number, number]} [r, g, b]
 */
export function couleurExpo(deg) {
  const normDeg = ((deg % 360) + 360) % 360;
  const hue = (195 - normDeg + 360) % 360;
  return hslToRgb(hue / 360, 0.85, 0.52);
}

/**
 * Couleur pour terrain plat (pente < 3°)
 */
export const COULEUR_PLAT = [156, 163, 175]; // #9ca3af

/**
 * Génère le conic-gradient CSS de la roue d'exposition tous les 15°
 */
export function getConicGradientExpo() {
  const stops = [];
  for (let deg = 0; deg <= 360; deg += 15) {
    const rgb = couleurExpo(deg);
    stops.push(`${rgbToStr(rgb)} ${deg}deg`);
  }
  return `conic-gradient(from 0deg, ${stops.join(', ')})`;
}

/**
 * Couleur d'altitude normalisée t dans [0, 1] (250m -> 1600m)
 */
export function couleurAltitude(t) {
  const k = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (k < 0.5) {
    const f = k * 2;
    r = Math.round(16 + (234 - 16) * f);
    g = Math.round(185 + (179 - 185) * f);
    b = Math.round(129 + (8 - 129) * f);
  } else {
    const f = (k - 0.5) * 2;
    r = Math.round(234 + (239 - 234) * f);
    g = Math.round(179 * (1 - f) + 68 * f);
    b = Math.round(8 * (1 - f) + 68 * f);
  }
  return [r, g, b];
}

export function getLinearGradientAltitude() {
  const c0 = rgbToStr(couleurAltitude(0));
  const c50 = rgbToStr(couleurAltitude(0.5));
  const c100 = rgbToStr(couleurAltitude(1.0));
  return `linear-gradient(90deg, ${c0} 0%, ${c50} 50%, ${c100} 100%)`;
}

/**
 * Couleur de pente normalisée t dans [0, 1] (0° -> 40°)
 */
export function couleurPente(t) {
  const k = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (k < 0.4) {
    const f = k / 0.4;
    r = Math.round(34 + (234 - 34) * f);
    g = Math.round(197 + (179 - 197) * f);
    b = Math.round(94 + (8 - 94) * f);
  } else {
    const f = (k - 0.4) / 0.6;
    r = Math.round(234 + (185 - 234) * f);
    g = Math.round(179 * (1 - f) + 28 * f);
    b = Math.round(8 * (1 - f) + 28 * f);
  }
  return [r, g, b];
}

export function getLinearGradientPente() {
  const c0 = rgbToStr(couleurPente(0));
  const c40 = rgbToStr(couleurPente(0.4));
  const c100 = rgbToStr(couleurPente(1.0));
  return `linear-gradient(90deg, ${c0} 0%, ${c40} 40%, ${c100} 100%)`;
}

/**
 * Couleur de distance lisière t dans [0, 1] (0m -> 250m)
 */
export function couleurLisiere(t) {
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(245 * (1 - k) + 16 * k);
  const g = Math.round(180 * (1 - k) + 120 * k);
  const b = Math.round(20 * (1 - k) + 50 * k);
  return [r, g, b];
}

export function getLinearGradientLisiere() {
  const c0 = rgbToStr(couleurLisiere(0));
  const c100 = rgbToStr(couleurLisiere(1.0));
  return `linear-gradient(90deg, ${c0} 0%, ${c100} 100%)`;
}

/**
 * Couleur pour une essence forestière selon son code numérique
 * Essence 255 = "Inconnue" (forêt MNH hors polygone BD Forêt) -> vert sauge neutre
 */
export function couleurEssence(code) {
  if (code === 255) {
    return [110, 150, 125]; // Vert sauge doux pour essence inconnue
  }
  const hue = Math.round((code * 137.5) % 360);
  return hslToRgb(hue / 360, 0.75, 0.48);
}

/**
 * Couleur pour zone ouverte en forêt (foret = 2, coupe rase / clairière récente)
 * Gris clair semi-transparent
 */
export const COULEUR_OUVERT = [220, 220, 225, 170];

/**
 * Couleur du couvert arboré ratio t dans [0, 1] (0% -> 100%)
 * Dégradé à fort contraste : Or clair -> Citron vert -> Émeraude -> Cyan -> Sarcelle profond
 */
export function couleurCouvert(t) {
  const k = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (k < 0.25) {
    const f = k / 0.25;
    r = Math.round(254 * (1 - f) + 163 * f);
    g = Math.round(240 * (1 - f) + 230 * f);
    b = Math.round(138 * (1 - f) + 53 * f);
  } else if (k < 0.5) {
    const f = (k - 0.25) / 0.25;
    r = Math.round(163 * (1 - f) + 34 * f);
    g = Math.round(230 * (1 - f) + 197 * f);
    b = Math.round(53 * (1 - f) + 94 * f);
  } else if (k < 0.75) {
    const f = (k - 0.5) / 0.25;
    r = Math.round(34 * (1 - f) + 6 * f);
    g = Math.round(197 * (1 - f) + 182 * f);
    b = Math.round(94 * (1 - f) + 212 * f);
  } else {
    const f = (k - 0.75) / 0.25;
    r = Math.round(6 * (1 - f) + 15 * f);
    g = Math.round(182 * (1 - f) + 118 * f);
    b = Math.round(212 * (1 - f) + 110 * f);
  }
  return [r, g, b];
}

export function getLinearGradientCouvert() {
  return 'linear-gradient(90deg, #fef08a 0%, #a3e635 25%, #22c55e 50%, #06b6d4 75%, #0f766e 100%)';
}

/**
 * Couleur de la hauteur des arbres ratio t dans [0, 1] (0m -> 40m+)
 * Dégradé jaune -> vert -> bleu-noir
 */
export function couleurHauteur(t) {
  const k = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (k < 0.35) {
    // 0m à ~14m : Jaune [248, 222, 64] -> Vert clair [56, 190, 82]
    const f = k / 0.35;
    r = Math.round(248 * (1 - f) + 56 * f);
    g = Math.round(222 * (1 - f) + 190 * f);
    b = Math.round(64 * (1 - f) + 82 * f);
  } else if (k < 0.7) {
    // ~14m à ~28m : Vert clair [56, 190, 82] -> Bleu canard [20, 120, 145]
    const f = (k - 0.35) / 0.35;
    r = Math.round(56 * (1 - f) + 20 * f);
    g = Math.round(190 * (1 - f) + 120 * f);
    b = Math.round(82 * (1 - f) + 145 * f);
  } else {
    // ~28m à 40m+ : Bleu canard [20, 120, 145] -> Bleu-noir [12, 28, 58]
    const f = (k - 0.7) / 0.3;
    r = Math.round(20 * (1 - f) + 12 * f);
    g = Math.round(120 * (1 - f) + 28 * f);
    b = Math.round(145 * (1 - f) + 58 * f);
  }
  return [r, g, b];
}

export function getLinearGradientHauteur() {
  const c0 = rgbToStr(couleurHauteur(0));
  const c35 = rgbToStr(couleurHauteur(0.35));
  const c70 = rgbToStr(couleurHauteur(0.7));
  const c100 = rgbToStr(couleurHauteur(1.0));
  return `linear-gradient(90deg, ${c0} 0%, ${c35} 35%, ${c70} 70%, ${c100} 100%)`;
}
