/**
 * MesChampis — Gestionnaire de la Carte de Chaleur de Démonstration (Étape 3 / Démo D5)
 * Utilise un Web Worker dédié pour calculer les scores écologiques cellule par cellule
 * et les projeter sur la carte MapLibre sous la couche des cueillettes.
 */

import { peutVoirRecommandations } from './droits.js';

export class GestionnaireCarteChaleur {
  /**
   * @param {maplibregl.Map} map
   * @param {any} gestionnaireGrille
   */
  constructor(map, gestionnaireGrille) {
    this.map = map;
    this.grille = gestionnaireGrille;
    this.worker = null;
    this.active = false;
    this.tuilesScore = new Map(); // cle "tx,ty" -> Uint8Array(256*256)
    this.tempsTotalCalculMs = 0;
    this.nbTuilesCalculees = 0;

    this.initialiserWorker();
    this.attacherClicExplication();
  }

  initialiserWorker() {
    try {
      this.worker = new Worker('./js/worker_chaleur.js');
      this.worker.onmessage = (e) => this.gererMessageWorker(e.data);
    } catch (err) {
      console.warn('[CarteChaleur] Impossible d\'initialiser le Web Worker :', err);
    }
  }

  /**
   * Active ou désactive la carte de chaleur
   * @param {boolean} activer
   */
  async basculer(activer) {
    this.active = Boolean(activer);
    const bandeauMention = document.getElementById('mention-chaleur-demo');

    if (this.active) {
      if (!peutVoirRecommandations()) {
        console.warn('[CarteChaleur] Droits insuffisants (essai ou premium requis).');
        return false;
      }
      if (bandeauMention) bandeauMention.classList.remove('hidden');
      await this.calculerEtAfficherToutesTuiles();
      return true;
    } else {
      if (bandeauMention) bandeauMention.classList.add('hidden');
      this.masquerCouche();
      return false;
    }
  }

  /**
   * Calcule et affiche la carte de chaleur pour l'ensemble des tuiles de la grille
   */
  async calculerEtAfficherToutesTuiles() {
    if (!this.worker) return;

    const t0 = performance.now();
    this.tempsTotalCalculMs = 0;
    this.nbTuilesCalculees = 0;

    // Récupérer les tuiles en cache ou charger la tuile centrale Puy-de-Dôme si cache vide
    const cacheTuiles = this.grille?.cacheTuiles || new Map();
    if (cacheTuiles.size === 0 && this.grille?.chargerTuile) {
      await this.grille.chargerTuile(515, 380);
    }

    const promises = [];

    for (const [cle, tuileData] of cacheTuiles.entries()) {
      if (!tuileData || !tuileData.foret || !tuileData.foret.buffer) continue;
      const [txStr, tyStr] = cle.split('_');
      const tx = parseInt(txStr, 10);
      const ty = parseInt(tyStr, 10);

      // Copier le buffer sous-jacent pour le transfert sécurisé au Web Worker
      const bufferCopie = tuileData.foret.buffer.slice(0);
      promises.push(this.envoyerTuileAuWorker(tx, ty, bufferCopie));
    }

    await Promise.all(promises);
    const dureeTotale = performance.now() - t0;
    console.log(`[CarteChaleur] Calcul achevé : ${this.nbTuilesCalculees} tuiles traitées en ${dureeTotale.toFixed(1)} ms.`);

    // Stocker la statistique pour le rapport
    window.__tempsCalculCarteChaleur = {
      dureeTotaleMs: dureeTotale,
      nbTuiles: this.nbTuilesCalculees,
      dureeMoyenneParTuileMs: this.nbTuilesCalculees > 0 ? (dureeTotale / this.nbTuilesCalculees) : 0,
      estimationTotalDepartement247TuilesMs: this.nbTuilesCalculees > 0 ? ((dureeTotale / this.nbTuilesCalculees) * 247) : 0
    };
  }

  envoyerTuileAuWorker(tx, ty, buffer) {
    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.action === 'tuileCalculee' && e.data.tx === tx && e.data.ty === ty) {
          this.worker.removeEventListener('message', handler);
          resolve();
        }
      };
      this.worker.addEventListener('message', handler);
      this.worker.postMessage({
        action: 'calculerTuile',
        tx,
        ty,
        bufferBrut: buffer,
        alpha: 190
      }, [buffer]);
    });
  }

  gererMessageWorker(data) {
    if (data.action !== 'tuileCalculee') return;

    const { tx, ty, dureeMs, scores, imageBuffer } = data;
    this.tempsTotalCalculMs += dureeMs;
    this.nbTuilesCalculees++;
    this.tuilesScore.set(`${tx},${ty}`, scores);

    // Mettre à jour ou ajouter la couche raster/canvas MapLibre
    this.afficherTuileChaleur(tx, ty, imageBuffer);
  }

  afficherTuileChaleur(tx, ty, imageBuffer) {
    if (!this.map || !this.active) return;

    const sourceId = `chaleur-source-${tx}-${ty}`;
    const layerId = `chaleur-layer-${tx}-${ty}`;

    // Calculer les coordonnées géographiques des 4 coins de la tuile
    const coins = this.grille?.coinsTuile ? this.grille.coinsTuile(tx, ty) : null;
    if (!coins) return;

    // Convertir Uint8ClampedArray en canvas ImageBitmap ou dataUrl
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const imgData = new ImageData(new Uint8ClampedArray(imageBuffer), 256, 256);
    ctx.putImageData(imgData, 0, 0);

    const dataUrl = canvas.toDataURL();

    if (this.map.getSource(sourceId)) {
      this.map.getSource(sourceId).updateImage({ url: dataUrl, coordinates: coins });
    } else {
      this.map.addSource(sourceId, {
        type: 'image',
        url: dataUrl,
        coordinates: coins
      });

      // Positionner impérativement SOUS la couche des points de carnet 'carnet-points-layer'
      const avantCouche = this.map.getLayer('carnet-points-layer') ? 'carnet-points-layer' : undefined;
      this.map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': 0.82,
          'raster-fade-duration': 150
        }
      }, avantCouche);
    }
  }

  masquerCouche() {
    if (!this.map) return;
    for (const key of this.tuilesScore.keys()) {
      const [tx, ty] = key.split(',');
      const layerId = `chaleur-layer-${tx}-${ty}`;
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
      const sourceId = `chaleur-source-${tx}-${ty}`;
      if (this.map.getSource(sourceId)) {
        this.map.removeSource(sourceId);
      }
    }
  }

  attacherClicExplication() {
    if (!this.map) return;

    this.map.on('click', (e) => {
      if (!this.active) return;

      const { lng, lat } = e.lngLat;
      const snap = this.grille?.valeursAuPoint ? this.grille.valeursAuPoint(lng, lat) : null;
      if (!snap || snap.foret === 0) return;

      // Récupérer le score calculé pour cette cellule
      const cle = `${snap.tx},${snap.ty}`;
      const scores = this.tuilesScore.get(cle);
      const score = scores ? scores[snap.lig * 256 + snap.col] : null;

      if (score === null || score < 25) return;

      this.afficherPopupExplication(lng, lat, score, snap);
    });
  }

  afficherPopupExplication(lng, lat, score, snap) {
    const criteres = [];

    // Analyse des critères satisfaits
    if (snap.essence === 11) criteres.push('🌳 Peuplement de <strong>Hêtre</strong> (essence très favorable)');
    else if (snap.essence === 12) criteres.push('🌲 Présence de <strong>Sapin pectiné</strong> (hôte mycorhizien de choix)');
    else if (snap.essence === 13) criteres.push('🌲 Forêt d\'<strong>Épicéa commun</strong> (biotope à cèpes & bolets)');
    else if (snap.essence) criteres.push(`🌲 Essence forestière favorable (${snap.essence})`);

    if (snap.alt >= 700 && snap.alt <= 1300) {
      criteres.push(`⛰️ Altitude optimale : <strong>${snap.alt} m</strong> (étage montagnard auvergnat)`);
    }

    if (snap.expo !== null && (snap.expo >= 315 || snap.expo <= 90)) {
      criteres.push(`🧭 Exposition <strong>Nord-Est (${snap.expo.toFixed(0)}°)</strong> : versant frais conservant l'humidité`);
    } else if (snap.plat) {
      criteres.push('🧭 Relief de replat / plateau forestier');
    }

    if (snap.pente <= 25) {
      criteres.push(`📐 Pente modérée (<strong>${snap.pente}°</strong>) favorisant la rétention hydrique du sol`);
    }

    const popupHtml = `
      <div class="popup-chaleur-explication" style="padding: 0.5rem; max-width: 280px; font-size: 0.85rem; line-height: 1.4;">
        <div style="font-weight: 800; font-size: 1rem; color: #f59e0b; margin-bottom: 0.35rem; display: flex; justify-content: space-between;">
          <span>🎯 Score écologique : ${score}/100</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.5px;">
          Pourquoi cette zone ?
        </div>
        <ul style="padding-left: 1.1rem; margin: 0 0 0.5rem 0; font-size: 0.8rem; color: #e2e8f0;">
          ${criteres.map((c) => `<li style="margin-bottom: 0.25rem;">${c}</li>`).join('')}
        </ul>
        <div style="font-size: 0.72rem; color: var(--text-muted); border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.35rem; font-style: italic;">
          ⚠️ Aperçu de démonstration, pas l'algorithme final.
        </div>
      </div>
    `;

    new maplibregl.Popup({ closeButton: true, maxWidth: '320px' })
      .setLngLat([lng, lat])
      .setHTML(popupHtml)
      .addTo(this.map);
  }
}
