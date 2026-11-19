/**
 * Module de gestion de la Grille Raster 25 m
 * MesChampis — Étage principal de visualisation et de calcul
 */

import {
  renderLegendeExposition,
  renderLegendeAltitude,
  renderLegendePente,
  renderLegendeLisiere,
  renderLegendeEssences,
  renderLegendeCouvert,
  renderLegendeHauteur,
  getOrientationTexte
} from './legende.js';

import {
  couleurExpo,
  COULEUR_PLAT,
  couleurAltitude,
  couleurPente,
  couleurLisiere,
  couleurEssence,
  couleurCouvert,
  couleurHauteur,
  COULEUR_OUVERT
} from './couleurs.js';

export class GestionnaireGrille {
  constructor(map, options = {}) {
    this.map = map;
    this.legendContainer = options.legendContainer;
    this.onReady = options.onReady;

    this.manifest = null;
    this.tableEssences = {};
    this.setTuilesDisponibles = new Set();
    this.cacheTuiles = new Map(); // cle "tx_ty" -> { foret, essence, alt, pente, expo, lisiere, couvert, hauteur, _cacheDataUrl }

    // État actif
    this.coucheActive = 'expo'; // 'expo' par défaut
    this.opacite = 0.85;        // 85% par défaut
    this.tuilesAffichees = new Map(); // cle -> { statut: 'en_cours'|'affiche', sourceId, layerId }

    // Compteur de génération pour suivre les changements de filtres
    this.generation = 0;

    // Canvas de rendu unique réutilisable (256x257) : 0 allocation par tuile
    this.canvasRendu = document.createElement('canvas');
    this.canvasRendu.width = 256;
    this.canvasRendu.height = 257;
    this.ctxRendu = this.canvasRendu.getContext('2d', { willReadFrequently: false });
    this.imgDataRendu = this.ctxRendu.createImageData(256, 257);
    this.u32DataRendu = new Uint32Array(this.imgDataRendu.data.buffer);

    // Palettes 32-bit précalculées (ABGR little-endian pour accès mémoire ultra-rapide)
    this.paletteExpo32 = new Uint32Array(240);
    for (let c = 0; c < 240; c++) {
      const col = couleurExpo(c * 1.5);
      this.paletteExpo32[c] = (255 << 24) | (col[2] << 16) | (col[1] << 8) | col[0];
    }
    this.u32Plat = (255 << 24) | (COULEUR_PLAT[2] << 16) | (COULEUR_PLAT[1] << 8) | COULEUR_PLAT[0];
    this.u32Ouvert = (170 << 24) | (COULEUR_OUVERT[2] << 16) | (COULEUR_OUVERT[1] << 8) | COULEUR_OUVERT[0];
    // Teinte ardoise translucide pour les forêts BD Forêt hors couverture LiDAR HD (évite la disparition du massif)
    this.u32HorsLidar = (100 << 24) | (148 << 16) | (116 << 8) | 100;

    // Palette Lisière (0 à 250 m)
    this.paletteLisiere32 = new Uint32Array(256);
    for (let d = 0; d < 256; d++) {
      const col = couleurLisiere(d / 250.0);
      this.paletteLisiere32[d] = (255 << 24) | (col[2] << 16) | (col[1] << 8) | col[0];
    }

    // Palette Pente (0 à 40+ deg)
    this.palettePente32 = new Uint32Array(256);
    for (let p = 0; p < 256; p++) {
      const col = couleurPente(p / 40.0);
      this.palettePente32[p] = (255 << 24) | (col[2] << 16) | (col[1] << 8) | col[0];
    }

    // Palette Couvert (0 à 100%)
    this.paletteCouvert32 = new Uint32Array(256);
    for (let c = 0; c <= 100; c++) {
      const col = couleurCouvert(c / 100.0);
      this.paletteCouvert32[c] = (255 << 24) | (col[2] << 16) | (col[1] << 8) | col[0];
    }

    // Palette Hauteur (0 à 255 -> 0 à 63.75 m)
    this.paletteHauteur32 = new Uint32Array(256);
    for (let h = 0; h < 256; h++) {
      const col = couleurHauteur((h * 0.25) / 40.0);
      this.paletteHauteur32[h] = (255 << 24) | (col[2] << 16) | (col[1] << 8) | col[0];
    }

    // Palette Essence
    this.paletteEssence32 = new Uint32Array(256);
    for (let e = 0; e < 256; e++) {
      const col = couleurEssence(e);
      this.paletteEssence32[e] = (255 << 24) | (col[2] << 16) | (col[1] << 8) | col[0];
    }

    this.popupActive = null;
    this.mapReady = false;
    this.zoomHintEl = null;
    this.timerMove = null;

    this.pret = this.init();
  }

  async init() {
    try {
      // 1. Charger immédiatement le manifest et essences (indépendant de MapLibre)
      const ts = Date.now();
      const [respManifest, respEssences] = await Promise.all([
        fetch(`data/grille/manifest.json?v=${ts}`, { cache: 'no-store' }),
        fetch(`data/grille/essences.json?v=${ts}`, { cache: 'no-store' })
      ]);

      if (!respManifest.ok || !respEssences.ok) {
        throw new Error('Impossible de charger manifest.json ou essences.json');
      }

      this.manifest = await respManifest.json();
      this.tableEssences = await respEssences.json();
      this.setTuilesDisponibles = new Set(this.manifest.tuiles || []);

      // Lecture intégrale de la section "region" du manifest (aucune constante géographique en dur)
      const reg = this.manifest.region || {};
      this.epsgCode = reg.epsg || 2154;
      this.epsgKey = `EPSG:${this.epsgCode}`;
      if (reg.proj4 && window.proj4) {
        proj4.defs(this.epsgKey, reg.proj4);
      }
      this.pas = reg.pas !== undefined ? reg.pas : (this.manifest.taille_cellule_m || 25);
      this.tailleTuile = reg.taille_tuile !== undefined ? reg.taille_tuile : (this.manifest.taille_tuile || 256);
      this.x0 = reg.origine_x !== undefined ? reg.origine_x : this.manifest.origine_x;
      this.y0 = reg.origine_y !== undefined ? reg.origine_y : this.manifest.origine_y;
      this.nbTuilesX = reg.nb_tuiles_x !== undefined ? reg.nb_tuiles_x : this.manifest.nb_tuiles_x;
      this.nbTuilesY = reg.nb_tuiles_y !== undefined ? reg.nb_tuiles_y : this.manifest.nb_tuiles_y;

      console.info(
        `[Grille] Initialisée région ${reg.nom || this.epsgKey} : ${this.setTuilesDisponibles.size} tuiles disponibles (${this.pas}m / cellule)`
      );

      // Si aucune carte MapLibre n'est fournie (ex: tests unitaires isolés), la grille est prête pour valeursAuPoint
      if (!this.map) {
        if (this.onReady) {
          this.onReady(this.manifest);
        }
        return this.manifest;
      }

      // 2. Attendre que la carte soit prête pour le rendu et les couches
      if (this.map.isStyleLoaded() || (typeof this.map.loaded === 'function' && this.map.loaded())) {
        this.mapReady = true;
      } else {
        await new Promise((r) => {
          let resolu = false;
          const onPret = () => {
            if (resolu) return;
            resolu = true;
            this.mapReady = true;
            r();
          };
          this.map.once('load', onPret);
          this.map.once('style.load', onPret);
          if (this.map.isStyleLoaded() || (typeof this.map.loaded === 'function' && this.map.loaded())) {
            onPret();
          }
        });
      }

      // Référence sur l'indicateur de zoom
      this.zoomHintEl = document.getElementById('zoom-hint');

      // Mettre à jour la légende initiale
      this.mettreAJourLegende();

      // Écouter moveend avec anti-rebond (debounce) 70 ms pour fluidité maximale
      this.map.on('moveend', () => {
        if (this.timerMove) clearTimeout(this.timerMove);
        this.timerMove = setTimeout(() => this.mettreAJourTuilesVisibles(), 70);
      });

      // Si le style de carte est rechargé (passage de style), réattacher immédiatement la grille
      this.map.on('style.load', () => {
        this.mapReady = true;
        this.tuilesAffichees.clear();
        this.mettreAJourImagesTuilesExistantes();
        this.mettreAJourTuilesVisibles();
      });

      // Écouter le clic pour afficher la fiche de la cellule
      this.attacherClicCarte();

      // Premier affichage des tuiles visibles
      this.mettreAJourTuilesVisibles();

      if (this.onReady) {
        this.onReady(this.manifest);
      }
    } catch (err) {
      console.error('[Grille] Erreur initialisation :', err);
    }
  }

  /**
   * Charge et décompresse une tuile binaire gzip (256x256 cellules)
   * Découpage binaire déterministe basé sur la taille du buffer pour éviter toute désynchronisation.
   */
  async chargerTuile(tx, ty) {
    const cle = `${tx}_${ty}`;
    if (!this.setTuilesDisponibles.has(cle)) {
      return null;
    }

    if (this.cacheTuiles.has(cle)) {
      return this.cacheTuiles.get(cle);
    }

    try {
      const resp = await fetch(`data/grille/tuiles/${cle}.bin.gz`);
      if (!resp.ok) {
        console.warn(`[Grille] HTTP ${resp.status} pour tuile ${cle}`);
        return null;
      }

      const ds = new DecompressionStream('gzip');
      const decompressedStream = resp.body.pipeThrough(ds);
      const arrayBuffer = await new Response(decompressedStream).arrayBuffer();

      const N = 256 * 256;
      const donneesTuile = { tx, ty, _cacheDataUrl: {} };
      const isV2 = arrayBuffer.byteLength >= N * 9;

      // Découpage strict et déterministe
      donneesTuile.foret = new Uint8Array(arrayBuffer, 0, N);
      donneesTuile.essence = new Uint8Array(arrayBuffer, N, N);
      donneesTuile.alt = new Int16Array(arrayBuffer, N * 2, N);
      donneesTuile.pente = new Uint8Array(arrayBuffer, N * 4, N);
      donneesTuile.expo = new Uint8Array(arrayBuffer, N * 5, N);
      donneesTuile.lisiere = new Uint8Array(arrayBuffer, N * 6, N);

      if (isV2) {
        donneesTuile.couvert = new Uint8Array(arrayBuffer, N * 7, N);
        donneesTuile.hauteur = new Uint8Array(arrayBuffer, N * 8, N);
      } else {
        donneesTuile.couvert = null;
        donneesTuile.hauteur = null;
      }

      this.cacheTuiles.set(cle, donneesTuile);
      return donneesTuile;
    } catch (err) {
      console.error(`[Grille] Erreur chargement tuile ${cle}:`, err);
      return null;
    }
  }

  /**
   * Renvoie les caractéristiques exactes de la cellule de 25 m
   */
  async valeursAuPoint(lon, lat) {
    if (!this.manifest || !window.proj4) return null;

    const [x, y] = proj4('EPSG:4326', this.epsgKey, [lon, lat]);

    const pas = this.pas;
    const x0 = this.x0;
    const y0 = this.y0;
    const taille = this.tailleTuile;

    const colGlobale = Math.floor((x - x0) / pas);
    const rowGlobale = Math.floor((y0 - y) / pas);

    if (colGlobale < 0 || rowGlobale < 0) return null;

    const tx = Math.floor(colGlobale / taille);
    const ty = Math.floor(rowGlobale / taille);
    const c = colGlobale % taille;
    const r = rowGlobale % taille;

    const tuile = await this.chargerTuile(tx, ty);
    if (!tuile) return null;

    const idx = r * taille + c;
    const codeForet = tuile.foret[idx];
    const estForet = codeForet === 1;
    const estOuvert = codeForet === 2;
    const codeEssence = tuile.essence[idx];
    const alt = tuile.alt[idx] !== -32768 ? tuile.alt[idx] : null;
    const pente = tuile.pente[idx] !== 255 ? tuile.pente[idx] : null;
    const expoCode = tuile.expo[idx];
    const lisiere = tuile.lisiere[idx];

    const couvertVal = tuile.couvert ? tuile.couvert[idx] : 255;
    const couvert = couvertVal !== 255 ? couvertVal : null;

    const hauteurVal = tuile.hauteur ? tuile.hauteur[idx] : 255;
    const hauteur = hauteurVal !== 255 ? hauteurVal * 0.25 : null;

    let expoDeg = null;
    let typeExpo = 'nodata';
    const plat = expoCode === 254;
    if (plat) {
      typeExpo = 'plat';
    } else if (expoCode < 240) {
      expoDeg = expoCode * 1.5;
      typeExpo = 'oriente';
    }

    const essenceExact = codeEssence !== 255 ? codeEssence : null;

    let nomEssence = 'Hors forêt';
    if (codeEssence === 255) {
      nomEssence = 'Essence inconnue (LiDAR)';
    } else if (estOuvert) {
      const base = this.tableEssences[String(codeEssence)] || 'Forêt';
      nomEssence = `${base} (zone ouverte)`;
    } else if (estForet) {
      nomEssence = this.tableEssences[String(codeEssence)] || 'Forêt';
    } else if (codeEssence > 0) {
      nomEssence = this.tableEssences[String(codeEssence)] || 'Forêt';
    }

    const cleTuile = `${tx}_${ty}`;
    const tuileMeta = this.manifest?.tuiles_meta ? this.manifest.tuiles_meta[cleTuile] : null;
    const aLidar = couvert !== null;
    const lidarMillesime = aLidar ? (tuileMeta?.lidar_millesime ?? null) : null;

    return {
      version_grille: this.manifest?.version_grille || '20261031_mnh_pdd_v2',
      x: Math.round(x),
      y: Math.round(y),
      codeForet,
      estForet,
      estOuvert,
      nomEssence,
      codeEssence,
      essence: essenceExact,
      alt,
      pente,
      expo: expoDeg,
      expoCode,
      plat,
      typeExpo,
      lisiere,
      couvert,
      hauteur,
      aLidar,
      lidarMillesime,
      tx,
      ty,
      col: c,
      lig: r,
      foret: codeForet,
      mnh: aLidar,
      colGlobale,
      rowGlobale
    };
  }

  /**
   * Extrait l'instantané exact d'une cellule telle qu'enregistrée dans le carnet
   */
  formaterSnapshotCellule(info) {
    if (!info) return null;
    const expoCode = info.expoCode !== undefined ? info.expoCode : (info.expo !== null && info.expo !== undefined ? Math.round(info.expo / 1.5) : 255);
    const plat = info.plat !== undefined ? Boolean(info.plat) : (expoCode === 254);
    const expo = (expoCode < 240 && !plat) ? (info.expo !== undefined && info.expo !== null ? info.expo : expoCode * 1.5) : null;
    const rawEssence = info.essence !== undefined ? info.essence : info.codeEssence;
    const essenceVal = (rawEssence !== 255 && rawEssence !== null && rawEssence !== undefined) ? rawEssence : null;
    const hauteur = (info.hauteur !== undefined && info.hauteur !== null) ? info.hauteur : null;

    return {
      version_grille: info.version_grille || this.manifest?.version_grille || '20261031_mnh_pdd_v2',
      tx: info.tx,
      ty: info.ty,
      col: info.col !== undefined ? info.col : 0,
      lig: info.lig !== undefined ? info.lig : 0,
      foret: info.foret !== undefined ? info.foret : (info.codeForet ?? 0),
      essence: essenceVal,
      alt: info.alt ?? null,
      pente: info.pente ?? null,
      expo: expo,
      plat: plat,
      lisiere: info.lisiere ?? null,
      couvert: info.couvert ?? null,
      hauteur: hauteur,
      mnh: Boolean(info.mnh !== undefined ? info.mnh : info.aLidar)
    };
  }

  /**
   * Modifie le mode de coloriage de la grille SANS supprimer les couches (pas de clignotement)
   */
  definirCouche(mode) {
    if (this.coucheActive === mode) return;
    this.coucheActive = mode;
    this.generation++;
    this.mettreAJourLegende();
    this.mettreAJourImagesTuilesExistantes();
    this.mettreAJourTuilesVisibles();
  }

  /**
   * Modifie l'opacité de la grille en direct
   */
  definirOpacite(opaciteVal) {
    this.opacite = Math.max(0.05, Math.min(1.0, opaciteVal));
    for (const [, info] of this.tuilesAffichees.entries()) {
      if (info.statut === 'affiche' && this.map.getLayer(info.layerId)) {
        this.map.setPaintProperty(info.layerId, 'raster-opacity', this.opacite);
      }
    }
  }

  /**
   * Met à jour la légende affichée selon le mode actif
   */
  mettreAJourLegende() {
    if (!this.legendContainer) return;
    switch (this.coucheActive) {
      case 'expo':
        renderLegendeExposition(this.legendContainer);
        break;
      case 'alt':
        renderLegendeAltitude(this.legendContainer, 250, 1900);
        break;
      case 'pente':
        renderLegendePente(this.legendContainer);
        break;
      case 'lisiere':
        renderLegendeLisiere(this.legendContainer);
        break;
      case 'essence':
        renderLegendeEssences(this.legendContainer, this.tableEssences);
        break;
      case 'couvert':
        renderLegendeCouvert(this.legendContainer, this.map);
        break;
      case 'hauteur':
        renderLegendeHauteur(this.legendContainer);
        break;
    }
  }

  /**
   * Affiche ou masque l'indicateur invitant à zoomer (quand zoom < 8.5)
   */
  afficherIndicateurZoom(visible) {
    if (!this.zoomHintEl) {
      this.zoomHintEl = document.getElementById('zoom-hint');
    }
    if (this.zoomHintEl) {
      if (visible) {
        this.zoomHintEl.classList.remove('hidden');
      } else {
        this.zoomHintEl.classList.add('hidden');
      }
    }
  }

  /**
   * Met à jour le compteur de tuiles actives affiché dans l'interface
   */
  mettreAJourStatTuiles() {
    const el = document.getElementById('stat-tuiles-count');
    if (el) {
      el.textContent = `${this.tuilesAffichees.size}`;
    }
  }

  /**
   * Calcule les coordonnées [NW, NE, SE, SW] en WGS84 (lon, lat) d'une tuile (tx, ty).
   * L'emprise couvre 256 colonnes et 257 lignes (soit 25 m de plus au sud) pour
   * s'aligner exactement avec le canvas 256x257 (la 257e ligne étant 100% transparente).
   */
  coinsTuile(tx, ty) {
    const pas = this.pas;
    const taille = this.tailleTuile;
    const x0 = this.x0 + tx * taille * pas;
    const x1 = x0 + taille * pas;
    const yNord = this.y0 - ty * taille * pas;
    const ySud = yNord - (taille + 1) * pas; // taille+1 cellules (ex: 257) = bord sud étendu d'une cellule (25 m)

    const nw = proj4(this.epsgKey, 'EPSG:4326', [x0, yNord]);
    const ne = proj4(this.epsgKey, 'EPSG:4326', [x1, yNord]);
    const se = proj4(this.epsgKey, 'EPSG:4326', [x1, ySud]);
    const sw = proj4(this.epsgKey, 'EPSG:4326', [x0, ySud]);

    return [nw, ne, se, sw];
  }

  /**
   * Vérifie si une tuile (tx, ty) est actuellement visible dans les bounds de la carte
   */
  tuileEstVisible(tx, ty, marge = 1) {
    if (!this.manifest || !window.proj4) return false;
    const zoom = this.map.getZoom();
    if (zoom < 8.5) return false;

    const bounds = this.map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    const [minX, minY] = proj4('EPSG:4326', this.epsgKey, [sw.lng, sw.lat]);
    const [maxX, maxY] = proj4('EPSG:4326', this.epsgKey, [ne.lng, ne.lat]);

    const pas = this.pas;
    const x0 = this.x0;
    const y0 = this.y0;
    const tailleTuileM = this.tailleTuile * pas;

    const txMin = Math.max(0, Math.floor((minX - x0) / tailleTuileM) - marge);
    const txMax = Math.min(this.nbTuilesX - 1, Math.floor((maxX - x0) / tailleTuileM) + marge);
    const tyMin = Math.max(0, Math.floor((y0 - maxY) / tailleTuileM) - marge);
    const tyMax = Math.min(this.nbTuilesY - 1, Math.floor((y0 - minY) / tailleTuileM) + marge);

    return tx >= txMin && tx <= txMax && ty >= tyMin && ty <= tyMax;
  }

  /**
   * Calcule les tuiles visibles dans la vue courante, les trie par proximité au centre
   * et charge au maximum 42 tuiles pour préserver un framerate fluide de 60 FPS.
   */
  async mettreAJourTuilesVisibles() {
    if (!this.manifest || !window.proj4) return;

    const zoom = this.map.getZoom();
    if (zoom < 8.5) {
      this.nettoyerToutesTuiles();
      this.afficherIndicateurZoom(true);
      this.mettreAJourStatTuiles();
      return;
    }
    this.afficherIndicateurZoom(false);

    const bounds = this.map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    const [minX, minY] = proj4('EPSG:4326', this.epsgKey, [sw.lng, sw.lat]);
    const [maxX, maxY] = proj4('EPSG:4326', this.epsgKey, [ne.lng, ne.lat]);

    const centre = this.map.getCenter();
    const [cx, cy] = proj4('EPSG:4326', this.epsgKey, [centre.lng, centre.lat]);

    const pas = this.pas;
    const x0 = this.x0;
    const y0 = this.y0;
    const tailleTuileM = this.tailleTuile * pas;

    const marge = 1;
    const txMin = Math.max(0, Math.floor((minX - x0) / tailleTuileM) - marge);
    const txMax = Math.min(this.nbTuilesX - 1, Math.floor((maxX - x0) / tailleTuileM) + marge);
    const tyMin = Math.max(0, Math.floor((y0 - maxY) / tailleTuileM) - marge);
    const tyMax = Math.min(this.nbTuilesY - 1, Math.floor((y0 - minY) / tailleTuileM) + marge);

    const candidats = [];

    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const cle = `${tx}_${ty}`;
        if (this.setTuilesDisponibles.has(cle)) {
          const tileCx = x0 + (tx + 0.5) * tailleTuileM;
          const tileCy = y0 - (ty + 0.5) * tailleTuileM;
          const dist = Math.hypot(tileCx - cx, tileCy - cy);
          candidats.push({ tx, ty, cle, dist });
        }
      }
    }

    // Prioriser les tuiles les plus proches du centre de l'écran
    candidats.sort((a, b) => a.dist - b.dist);

    const MAX_TUILES_SIMULTANEES = 42;
    const selection = candidats.slice(0, MAX_TUILES_SIMULTANEES);
    const aGarder = new Set(selection.map((s) => s.cle));
    const currentGen = this.generation;

    for (const item of selection) {
      if (!this.tuilesAffichees.has(item.cle)) {
        const sourceId = `grille-src-${item.cle}`;
        const layerId = `grille-lyr-${item.cle}`;
        this.tuilesAffichees.set(item.cle, { statut: 'en_cours', sourceId, layerId });
        this.afficherTuile(item.tx, item.ty, currentGen);
      }
    }

    // Nettoyer les tuiles hors de la sélection active
    for (const [cle] of this.tuilesAffichees.entries()) {
      if (!aGarder.has(cle)) {
        this.nettoyerTuile(cle);
      }
    }

    this.mettreAJourStatTuiles();
  }

  /**
   * Génère le dataURL pour une tuile selon le mode actif.
   * Utilise le canvas unique préalloué et les écritures mémoire 32-bit (vitesse instantanée).
   */
  genererCanvasDataUrl(tuile) {
    const mode = this.coucheActive;
    tuile._cacheDataUrl = tuile._cacheDataUrl || {};
    if (tuile._cacheDataUrl[mode]) {
      return tuile._cacheDataUrl[mode];
    }

    // NE PAS repasser en 256×256 : MapLibre 4.x lie les textures ImageSource
    // POT avec LINEAR_MIPMAP_NEAREST sans générer de mipmaps → texture
    // incomplète → rendu noir. Hauteur 257 (dernière ligne transparente,
    // emprise étendue de 25 m au sud) = non-POT, alignement exact.
    const u32 = this.u32DataRendu;
    u32.fill(0); // Réinitialise tout à transparent (la 257e ligne reste 100% alpha 0)

    const { foret, essence, alt, pente, expo, lisiere, couvert, hauteur } = tuile;

    if (mode === 'expo') {
      for (let i = 0; i < 65536; i++) {
        const f = foret[i];
        if (f === 0) continue;
        if (f === 2) { u32[i] = this.u32Ouvert; continue; }
        const code = expo[i];
        if (code === 254) u32[i] = this.u32Plat;
        else if (code < 240) u32[i] = this.paletteExpo32[code];
      }
    } else if (mode === 'alt') {
      for (let i = 0; i < 65536; i++) {
        const f = foret[i];
        if (f === 0) continue;
        if (f === 2) { u32[i] = this.u32Ouvert; continue; }
        const aVal = alt[i];
        if (aVal !== -32768) {
          const ratio = (aVal - 250) / 1650;
          const col = couleurAltitude(ratio);
          u32[i] = (255 << 24) | (col[2] << 16) | (col[1] << 8) | col[0];
        }
      }
    } else if (mode === 'pente') {
      for (let i = 0; i < 65536; i++) {
        const f = foret[i];
        if (f === 0) continue;
        if (f === 2) { u32[i] = this.u32Ouvert; continue; }
        const pVal = pente[i];
        if (pVal !== 255) u32[i] = this.palettePente32[pVal];
      }
    } else if (mode === 'lisiere') {
      for (let i = 0; i < 65536; i++) {
        const f = foret[i];
        if (f === 0) continue;
        if (f === 2) { u32[i] = this.u32Ouvert; continue; }
        const dist = lisiere[i];
        u32[i] = this.paletteLisiere32[dist];
      }
    } else if (mode === 'essence') {
      for (let i = 0; i < 65536; i++) {
        const f = foret[i];
        if (f === 0) continue;
        if (f === 2) { u32[i] = this.u32Ouvert; continue; }
        const essCode = essence[i];
        u32[i] = this.paletteEssence32[essCode];
      }
    } else if (mode === 'couvert') {
      for (let i = 0; i < 65536; i++) {
        const f = foret[i];
        if (f === 0) continue;
        const cVal = couvert ? couvert[i] : 255;
        if (cVal <= 100) {
          u32[i] = this.paletteCouvert32[cVal];
        } else {
          // Forêt BD Forêt hors couverture LiDAR HD (silhouette conservée)
          u32[i] = this.u32HorsLidar;
        }
      }
    } else if (mode === 'hauteur') {
      for (let i = 0; i < 65536; i++) {
        const f = foret[i];
        if (f === 0) continue;
        const hVal = hauteur ? hauteur[i] : 255;
        if (hVal !== 255) {
          u32[i] = this.paletteHauteur32[hVal];
        } else {
          // Forêt BD Forêt hors couverture LiDAR HD (silhouette conservée)
          u32[i] = this.u32HorsLidar;
        }
      }
    }

    this.ctxRendu.putImageData(this.imgDataRendu, 0, 0);
    const dataUrl = this.canvasRendu.toDataURL('image/png');
    tuile._cacheDataUrl[mode] = dataUrl;
    return dataUrl;
  }

  /**
   * Met à jour les images des tuiles existantes en appelant updateImage (sans supprimer la couche)
   */
  async mettreAJourImagesTuilesExistantes() {
    const currentGen = this.generation;

    for (const [cle, info] of this.tuilesAffichees.entries()) {
      if (this.generation !== currentGen) return;

      const tuile = this.cacheTuiles.get(cle);
      if (!tuile) continue;

      const dataUrl = this.genererCanvasDataUrl(tuile);

      if (this.generation !== currentGen) return;

      const source = this.map.getSource(info.sourceId);
      if (source && typeof source.updateImage === 'function') {
        try {
          const [txStr, tyStr] = cle.split('_');
          const coordinates = this.coinsTuile(Number(txStr), Number(tyStr));
          source.updateImage({ url: dataUrl, coordinates });
          info.statut = 'affiche';
        } catch (err) {
          console.error(`[Grille] Erreur updateImage sur ${cle}:`, err);
        }
      }
    }
  }

  /**
   * Dessine la tuile et l'ajoute à la carte
   */
  async afficherTuile(tx, ty, gen) {
    const cle = `${tx}_${ty}`;
    const sourceId = `grille-src-${cle}`;
    const layerId = `grille-lyr-${cle}`;

    const tuile = await this.chargerTuile(tx, ty);

    // Vérifier après l'await si la tuile est toujours visible dans le viewport étendu
    if (!this.tuileEstVisible(tx, ty, 1)) {
      this.nettoyerTuile(cle);
      return;
    }

    if (!tuile) {
      this.tuilesAffichees.delete(cle);
      this.mettreAJourStatTuiles();
      return;
    }

    // Générer l'image selon la couche active courante (ne perd pas la tuile si la génération a changé)
    const dataUrl = this.genererCanvasDataUrl(tuile);

    // Attendre que la carte soit prête
    if (!this.mapReady) {
      if (!this.map._loaded) {
        await new Promise((r) => this.map.once('load', r));
      }
      this.mapReady = true;
    }

    const coordinates = this.coinsTuile(tx, ty);

    // Si la source existe déjà, la mettre à jour sans recréer
    const sourceExistante = this.map.getSource(sourceId);
    if (sourceExistante && typeof sourceExistante.updateImage === 'function') {
      try {
        sourceExistante.updateImage({ url: dataUrl, coordinates });
        this.tuilesAffichees.set(cle, { statut: 'affiche', sourceId, layerId });
        this.mettreAJourStatTuiles();
      } catch (err) {
        console.error(`[Grille] Erreur updateImage ${cle}:`, err);
      }
      return;
    }

    try {
      this.map.addSource(sourceId, {
        type: 'image',
        url: dataUrl,
        coordinates: coordinates
      });

      // Insérer sous les contours BD Forêt pour que les lignes restent nettes au-dessus
      const beforeLayerId = this.map.getLayer('parcelles-line') ? 'parcelles-line' : undefined;

      this.map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': this.opacite,
          'raster-resampling': 'nearest',
          'raster-fade-duration': 0
        }
      }, beforeLayerId);

      this.tuilesAffichees.set(cle, { statut: 'affiche', sourceId, layerId });
      this.mettreAJourStatTuiles();
    } catch (err) {
      console.error(`[Grille] Erreur lors de l'ajout de la tuile ${cle}:`, err);
      this.tuilesAffichees.delete(cle);
      this.mettreAJourStatTuiles();
    }
  }

  nettoyerTuile(cle) {
    const info = this.tuilesAffichees.get(cle);
    if (info) {
      if (this.map.getLayer(info.layerId)) {
        try { this.map.removeLayer(info.layerId); } catch (_) {}
      }
      if (this.map.getSource(info.sourceId)) {
        try { this.map.removeSource(info.sourceId); } catch (_) {}
      }
      this.tuilesAffichees.delete(cle);
    }
    this.mettreAJourStatTuiles();
  }

  nettoyerToutesTuiles() {
    for (const cle of Array.from(this.tuilesAffichees.keys())) {
      const info = this.tuilesAffichees.get(cle);
      if (info) {
        if (this.map.getLayer(info.layerId)) {
          try { this.map.removeLayer(info.layerId); } catch (_) {}
        }
        if (this.map.getSource(info.sourceId)) {
          try { this.map.removeSource(info.sourceId); } catch (_) {}
        }
      }
    }
    this.tuilesAffichees.clear();
    this.mettreAJourStatTuiles();
  }

  /**
   * Attache le clic sur la carte : popup basée UNIQUEMENT sur valeursAuPoint()
   */
  attacherClicCarte() {
    this.map.on('click', async (e) => {
      // Ignorer tout clic avant que la grille et la projection soient prêtes
      if (!this.mapReady || !this.manifest || !window.proj4) return;

      const info = await this.valeursAuPoint(e.lngLat.lng, e.lngLat.lat);
      if (!info) return;

      const formatVal = (v, suffix = '') => (v !== null && v !== undefined ? `${v}${suffix}` : '—');

      let expoLabel = '—';
      if (info.typeExpo === 'plat') {
        expoLabel = 'Plat (pente &lt; 3°)';
      } else if (info.expo !== null) {
        expoLabel = getOrientationTexte(info.expo);
      }

      const lisiereLabel = info.estForet
        ? (info.lisiere >= 250 ? '≥ 250 m (Cœur de massif)' : `${info.lisiere} m`)
        : '0 m (Hors forêt)';

      let statutBadge = '<span class="cell-badge out-forest">Hors forêt</span>';
      if (info.codeForet === 1) {
        statutBadge = '<span class="cell-badge in-forest">En forêt</span>';
      } else if (info.codeForet === 2) {
        statutBadge = '<span class="cell-badge open-forest" style="background:#e2e8f0; color:#334155; border:1px solid #94a3b8;">Milieu ouvert (coupe / clairière)</span>';
      }

      const couvertStr = info.couvert !== null ? `${info.couvert} %` : '—';
      const hauteurStr = info.hauteur !== null ? `${Number(info.hauteur.toFixed(1))} m` : '—';
      const lidarStr = info.aLidar
        ? (info.lidarMillesime ? `LiDAR HD (${info.lidarMillesime})` : 'LiDAR HD')
        : 'Hors zone LiDAR';

      const html = `
        <div class="parcel-popup cell-popup-only">
          <div class="parcel-popup-header">
            <div class="parcel-popup-title">
              ${info.nomEssence}
            </div>
            <div class="parcel-popup-meta">
              ${statutBadge}
              <span class="cell-coords">L93: (${info.x}, ${info.y})</span>
            </div>
          </div>
          <div class="parcel-popup-grid">
            <div class="parcel-popup-item">
              <span class="popup-k">Altitude</span>
              <span class="popup-v">${formatVal(info.alt, ' m')}</span>
            </div>
            <div class="parcel-popup-item">
              <span class="popup-k">Pente</span>
              <span class="popup-v">${formatVal(info.pente, '°')}</span>
            </div>
            <div class="parcel-popup-item full-width">
              <span class="popup-k">Exposition</span>
              <span class="popup-v">${expoLabel}</span>
            </div>
            <div class="parcel-popup-item full-width">
              <span class="popup-k">Distance lisière</span>
              <span class="popup-v">${lisiereLabel}</span>
            </div>
            <div class="parcel-popup-item">
              <span class="popup-k">Couvert</span>
              <span class="popup-v">${couvertStr}</span>
            </div>
            <div class="parcel-popup-item">
              <span class="popup-k">Hauteur arbres</span>
              <span class="popup-v">${hauteurStr}</span>
            </div>
            <div class="parcel-popup-item full-width">
              <span class="popup-k">Source LiDAR</span>
              <span class="popup-v">${lidarStr}</span>
            </div>
          </div>
        </div>
      `;

      if (this.popupActive) {
        this.popupActive.remove();
      }

      this.popupActive = new maplibregl.Popup({ maxWidth: '300px' })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(this.map);
    });
  }
}
