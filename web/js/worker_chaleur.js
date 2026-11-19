/**
 * MesChampis — Web Worker de calcul de carte de chaleur écologique (expérimental)
 * Calcule un score écologique de démonstration (0 à 100) par cellule pour chaque tuile.
 *
 * Critères :
 * - Forêt : foret == 1 (ou 2)
 * - Essence : Hêtre (11), Sapin (12), Épicéa (13) favorisés
 * - Altitude : 700 à 1 300 m (étage montagnard auvergnat)
 * - Exposition : Nord à Est (315° à 90°, versants frais et humides)
 * - Couvert / Lisière : sous-bois favorable
 */

const N_PIXELS = 256 * 256;

// Dégradé de chaleur thermique : Bleu nuit (faible) -> Cyan -> Vert lime -> Jaune -> Rouge carmin (optimal)
function couleurChaleur(score, alphaGlobale = 180) {
  if (score < 25) {
    return [0, 0, 0, 0]; // Transparent pour les scores négligeables
  }

  const t = (score - 25) / 75.0; // [0..1]
  let r, g, b;

  if (t < 0.25) {
    // 25..43.75 : Bleu à Cyan
    const u = t / 0.25;
    r = Math.round(30 + 10 * u);
    g = Math.round(60 + 160 * u);
    b = Math.round(200 + 40 * u);
  } else if (t < 0.5) {
    // 43.75..62.5 : Cyan à Vert lime
    const u = (t - 0.25) / 0.25;
    r = Math.round(40 + 120 * u);
    g = Math.round(220 + 20 * u);
    b = Math.round(240 - 180 * u);
  } else if (t < 0.75) {
    // 62.5..81.25 : Vert lime à Jaune d'or
    const u = (t - 0.5) / 0.25;
    r = Math.round(160 + 90 * u);
    g = Math.round(240 - 20 * u);
    b = Math.round(60 - 40 * u);
  } else {
    // 81.25..100 : Jaune à Rouge carmin chaud
    const u = (t - 0.75) / 0.25;
    r = Math.round(250 + 5 * u);
    g = Math.round(220 - 180 * u);
    b = Math.round(20 + 30 * u);
  }

  // Alpha progressive selon l'intensité du score
  const a = Math.round(alphaGlobale * (0.4 + 0.6 * t));
  return [r, g, b, a];
}

self.onmessage = async (e) => {
  const { action, tuiles, tx, ty, bufferBrut, alpha } = e.data;

  if (action === 'calculerTuile') {
    const t0 = performance.now();
    const result = calculerScoreTuile(bufferBrut, alpha || 180);
    const dureeMs = performance.now() - t0;

    self.postMessage({
      action: 'tuileCalculee',
      tx,
      ty,
      dureeMs,
      scores: result.scores,
      imageBuffer: result.rgbaBuffer
    }, [result.rgbaBuffer.buffer]);
  }
};

/**
 * Traite les 9 couches binaires d'une tuile (256x256)
 * @param {ArrayBuffer} buffer
 * @param {number} alpha
 */
function calculerScoreTuile(buffer, alpha) {
  const u8 = new Uint8Array(buffer);
  const u16 = new Uint16Array(buffer);

  const foret = u8.subarray(0, N_PIXELS);
  const essence = u8.subarray(N_PIXELS, N_PIXELS * 2);
  const alt = u16.subarray(N_PIXELS, N_PIXELS * 2); // offset 2*N_PIXELS octets
  const pente = u8.subarray(N_PIXELS * 4, N_PIXELS * 5);
  const expo = u8.subarray(N_PIXELS * 5, N_PIXELS * 6);
  const lisiere = u8.subarray(N_PIXELS * 6, N_PIXELS * 7);
  const couvert = u8.subarray(N_PIXELS * 7, N_PIXELS * 8);

  const scores = new Uint8Array(N_PIXELS);
  const rgbaBuffer = new Uint8ClampedArray(N_PIXELS * 4);

  for (let i = 0; i < N_PIXELS; i++) {
    const f = foret[i];
    if (f === 0) {
      scores[i] = 0;
      continue;
    }

    let score = 0;

    // 1. Essence forestière (30 points)
    // 11 = Hêtre, 12 = Sapin, 13 = Épicéa
    const ess = essence[i];
    if (ess === 11 || ess === 12 || ess === 13) {
      score += 30;
    } else if (ess === 10 || ess === 14 || ess === 15) {
      score += 18;
    } else if (ess !== 255) {
      score += 8;
    }

    // 2. Altitude (30 points)
    // Optimal : 700 m - 1 300 m
    const a = alt[i];
    if (a >= 700 && a <= 1300) {
      score += 30;
    } else if ((a >= 550 && a < 700) || (a > 1300 && a <= 1500)) {
      score += 15;
    }

    // 3. Exposition (25 points)
    // Expo Nord à Est : azimut 315° à 90°
    const expCode = expo[i];
    if (expCode === 254) {
      // Plat
      score += 18;
    } else if (expCode !== 255) {
      const azimut = expCode * 1.5;
      if (azimut >= 315 || azimut <= 90) {
        score += 25; // Versants froids et humides
      } else if ((azimut > 90 && azimut <= 135) || (azimut >= 270 && azimut < 315)) {
        score += 12;
      }
    }

    // 4. Pente et Lisière (15 points)
    const p = pente[i];
    const lis = lisiere[i];
    if (p <= 25 && lis >= 20 && lis <= 100) {
      score += 15;
    } else if (p <= 35) {
      score += 8;
    }

    scores[i] = score;

    // Rendu pixel couleur
    const col = couleurChaleur(score, alpha);
    const idx4 = i * 4;
    rgbaBuffer[idx4] = col[0];
    rgbaBuffer[idx4 + 1] = col[1];
    rgbaBuffer[idx4 + 2] = col[2];
    rgbaBuffer[idx4 + 3] = col[3];
  }

  return { scores, rgbaBuffer };
}
