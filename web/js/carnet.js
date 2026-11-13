/**
 * Module UI et logique du Carnet de cueillette
 * MesChampis — 100% privé, stocké localement dans IndexedDB
 */

import {
  ouvrirDB,
  ajouterCueillette,
  modifierCueillette,
  supprimerCueillette,
  listerCueillettes,
  obtenirCueillette,
  compterCueillettes,
  obtenirMeta,
  definirMeta,
  demanderPersistance,
  exporterSauvegardeChiffree,
  importerSauvegardeChiffree
} from './db.js';
import { synchroniserCarnet, incrementerModifsEnAttente } from './sync_carnet.js';
import { ouvrirModale, fermerModale } from './modales.js';

export class GestionnaireCarnet {
  constructor(map, gestionnaireGrille) {
    this.map = map;
    this.grille = gestionnaireGrille;

    this.especes = [];
    this.visible = true; // Affichage des points sur la carte
    this.markerSaisie = null;
    this.pointEnCours = null; // { lon, lat, precision_m, source_position, cellule }
    this.cueilletteEnEdition = null;
    this.popupActive = null;

    // Éléments du DOM
    this.btnFab = document.getElementById('btn-fab-carnet');
    this.fabMenu = document.getElementById('fab-menu');
    this.modalForm = document.getElementById('modal-carnet-form');
    this.modalCarnet = document.getElementById('modal-mon-carnet');
    this.modalExport = document.getElementById('modal-export-mcb');
    this.modalImport = document.getElementById('modal-import-mcb');
    this.modalAvertissement = document.getElementById('modal-avertissement-securite');

    this.init();
  }

  async init() {
    // 1. Charger la liste des espèces du Massif central
    try {
      const resp = await fetch('data/especes.json');
      if (resp.ok) {
        this.especes = await resp.json();
      }
    } catch (e) {
      console.warn('[Carnet] Impossible de charger especes.json :', e);
    }

    // 2. Initialiser la couche MapLibre pour les points du carnet
    const attacherCouche = () => {
      this.initialiserCoucheCarte();
      this.rafraichirCoucheCarte();
    };

    if (this.map.isStyleLoaded() || (typeof this.map.loaded === 'function' && this.map.loaded())) {
      attacherCouche();
    } else {
      this.map.once('load', attacherCouche);
    }
    this.map.on('style.load', attacherCouche);

    // 3. Attacher les écouteurs d'événements UI
    this.attacherEvenementsUI();

    // 4. Charger et rafraîchir les points initiaux
    this.rafraichirCoucheCarte();

    // 5. Vérifier le premier avertissement de sécurité et initialiser la pastille du carnet
    this.verifierPremierAvertissement();
    this.mettreAJourCompteurBadge();
  }

  /**
   * Initialise la source et la couche de cercles MapLibre pour les cueillettes
   */
  initialiserCoucheCarte() {
    if (!this.map.getSource('carnet-points-src')) {
      this.map.addSource('carnet-points-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    // Couche de cercles (vert pour trouvé, gris pour rien)
    if (!this.map.getLayer('carnet-points-layer')) {
      this.map.addLayer({
        id: 'carnet-points-layer',
        type: 'circle',
        source: 'carnet-points-src',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            8, 5,
            12, 8,
            16, 12
          ],
          'circle-color': [
            'case',
            ['==', ['get', 'type'], 'trouve'], '#10b981',
            '#64748b'
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.95
        }
      });

      // Interaction au clic sur un point du carnet
      this.map.on('click', 'carnet-points-layer', (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        e.originalEvent?.stopPropagation(); // Évite le déclenchement de la popup raster
        this.afficherPopupCueillette(feat.properties.id, feat.geometry.coordinates);
      });

      this.map.on('mouseenter', 'carnet-points-layer', () => {
        this.map.getCanvas().style.cursor = 'pointer';
      });
      this.map.on('mouseleave', 'carnet-points-layer', () => {
        this.map.getCanvas().style.cursor = '';
      });
    }

    try {
      this.map.moveLayer('carnet-points-layer');
    } catch (e) {}
  }

  /**
   * Met à jour la source GeoJSON depuis les enregistrements IndexedDB
   */
  async rafraichirCoucheCarte() {
    if (!this.map || !this.map.getSource('carnet-points-src')) return;

    const items = await listerCueillettes();
    const features = items
      .filter(i => typeof i.lon === 'number' && typeof i.lat === 'number')
      .map(i => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i.lon, i.lat] },
        properties: {
          id: i.id,
          type: i.type,
          espece_nom: i.espece_nom || '',
          date: i.date || '',
          quantite: i.quantite || ''
        }
      }));

    this.map.getSource('carnet-points-src').setData({
      type: 'FeatureCollection',
      features
    });

    // Mettre à jour la pastille N des cueillettes modifiées/créées depuis le dernier export
    await this.mettreAJourCompteurBadge();
  }

  /**
   * Recharge l'ensemble des données du carnet (carte, liste, compteurs)
   */
  async chargerCueillettes() {
    await this.rafraichirCoucheCarte();
    await this.rafraichirListeCarnet();
  }

  /**
   * Liste toutes les observations enregistrées
   */
  async listerToutes() {
    return listerCueillettes();
  }

  /**
   * Ajoute une observation et actualise l'affichage
   * @param {Object} obs
   */
  async ajouterObservation(obs) {
    const id = await ajouterCueillette(obs);
    await this.chargerCueillettes();
    return id;
  }

  /**
   * Active ou masque l'affichage des cueillettes sur la carte
   */
  definirVisibilite(visible) {
    this.visible = visible;
    if (this.map.getLayer('carnet-points-layer')) {
      this.map.setLayoutProperty('carnet-points-layer', 'visibility', visible ? 'visible' : 'none');
    }
  }

  /**
   * Démarre la saisie par géolocalisation haute précision (jusqu'à 15 s)
   */
  async demarrerSaisieGPS(forceRien = false) {
    if (!navigator.geolocation) {
      alert('La géolocalisation n\'est pas supportée par votre navigateur.');
      return;
    }

    this.fermerFabMenu();
    this.afficherToast('📡 Recherche de la position GPS (haute précision)...');

    let meilleurePrecision = Infinity;
    let meilleurePosition = null;
    let timerTimeout = null;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const crd = pos.coords;
        if (crd.accuracy < meilleurePrecision) {
          meilleurePrecision = crd.accuracy;
          meilleurePosition = {
            lon: crd.longitude,
            lat: crd.latitude,
            precision_m: Math.round(crd.accuracy),
            source_position: 'gps'
          };
        }

        // Si la précision est déjà excellente (< 15 m), on valide sans attendre 15 s
        if (crd.accuracy <= 15) {
          cleanup();
          this.finaliserPointSaisie(meilleurePosition, forceRien);
        }
      },
      (err) => {
        console.warn('[GPS] Erreur watchPosition :', err);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );

    const cleanup = () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
      if (timerTimeout) clearTimeout(timerTimeout);
    };

    // Au bout de 15 s max, on prend la meilleure mesure obtenue
    timerTimeout = setTimeout(() => {
      cleanup();
      if (meilleurePosition) {
        this.finaliserPointSaisie(meilleurePosition, forceRien);
      } else {
        alert('Impossible d\'obtenir une position GPS précise. Vous pouvez placer votre point directement sur la carte.');
        this.demarrerPlacementCarte(forceRien);
      }
    }, 15000);
  }

  /**
   * Démarre le placement interactif d'un point sur la carte avec curseur de visée
   */
  demarrerPlacementCarte(forceRien = false) {
    this.fermerFabMenu();
    this.enPlacementCarte = true;
    this._forceRienPlacement = forceRien;

    // Transformation du curseur en réticule de précision et affichage du bandeau de guidage
    document.body.classList.add('mode-positionnement-actif');
    const bandeau = document.getElementById('bandeau-positionnement-carte');
    if (bandeau) bandeau.classList.remove('hidden');
    if (this.map?.getCanvas()) {
      this.map.getCanvas().style.cursor = 'crosshair';
    }

    this.afficherToast('🎯 Pointeur actif : cliquez sur la carte pour déposer votre trouvaille');

    this._onMapClickPlacement = (e) => {
      this.quitterModePlacement();
      const pos = {
        lon: e.lngLat.lng,
        lat: e.lngLat.lat,
        precision_m: null,
        source_position: 'carte'
      };
      this.finaliserPointSaisie(pos, forceRien);
    };

    this.map.once('click', this._onMapClickPlacement);
  }

  /**
   * Quitte le mode de placement interactif et restaure le curseur normal
   */
  quitterModePlacement() {
    this.enPlacementCarte = false;
    document.body.classList.remove('mode-positionnement-actif');
    const bandeau = document.getElementById('bandeau-positionnement-carte');
    if (bandeau) bandeau.classList.add('hidden');
    if (this.map?.getCanvas()) {
      this.map.getCanvas().style.cursor = '';
    }
    if (this._onMapClickPlacement) {
      this.map.off('click', this._onMapClickPlacement);
      this._onMapClickPlacement = null;
    }
  }

  /**
   * Annule le placement sur la carte (bouton Annuler ou touche Échap)
   */
  annulerPlacementCarte() {
    if (!this.enPlacementCarte && !document.body.classList.contains('mode-positionnement-actif')) return;
    this.quitterModePlacement();
    this.afficherToast('Positionnement annulé');
  }

  /**
   * Finalise le positionnement, affiche le marqueur déplaçable et ouvre le formulaire
   */
  async finaliserPointSaisie(position, forceRien = false) {
    this.quitterModePlacement();
    this.pointEnCours = { ...position };

    // Si précision GPS > 50 m, prévenir l'utilisateur
    if (position.precision_m && position.precision_m > 50) {
      this.afficherToast(`⚠️ Précision GPS modérée (${position.precision_m} m). Vous pouvez ajuster le marqueur à la main.`);
    }

    // Centrer la carte sur le point
    this.map.flyTo({ center: [position.lon, position.lat], zoom: Math.max(this.map.getZoom(), 14), speed: 1.2 });

    // Créer ou repositionner le marqueur déplaçable
    if (this.markerSaisie) this.markerSaisie.remove();

    const el = document.createElement('div');
    el.className = 'marker-saisie-carnet';
    el.innerHTML = forceRien ? '🍃' : '🍄';

    this.markerSaisie = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([position.lon, position.lat])
      .addTo(this.map);

    this.markerSaisie.on('dragend', async () => {
      const lngLat = this.markerSaisie.getLngLat();
      this.pointEnCours.lon = lngLat.lng;
      this.pointEnCours.lat = lngLat.lat;
      this.pointEnCours.source_position = 'carte';
      this.pointEnCours.precision_m = null;
      await this.mettreAJourCelluleFormulaire();
    });

    // Extraire les valeurs de la cellule raster de 25 m
    await this.mettreAJourCelluleFormulaire();

    // Ouvrir le formulaire
    this.ouvrirFormulaire({
      type: forceRien ? 'rien' : 'trouve',
      lon: position.lon,
      lat: position.lat,
      precision_m: position.precision_m,
      source_position: position.source_position
    });
  }

  /**
   * Récupère l'instantané de la cellule courante via valeursAuPoint
   */
  async mettreAJourCelluleFormulaire() {
    if (!this.pointEnCours || !this.grille) return;

    const cellRaw = await this.grille.valeursAuPoint(this.pointEnCours.lon, this.pointEnCours.lat);
    this.pointEnCours.cellule = this.grille.formaterSnapshotCellule(cellRaw);

    // Mettre à jour le panneau de prévisualisation dans le formulaire
    const box = document.getElementById('cell-preview-box');
    const warningHorsGrille = document.getElementById('cell-hors-grille-warning');

    if (!box) return;

    if (!this.pointEnCours.cellule || cellRaw === null) {
      box.style.display = 'none';
      if (warningHorsGrille) warningHorsGrille.style.display = 'block';
    } else {
      box.style.display = 'block';
      if (warningHorsGrille) warningHorsGrille.style.display = 'none';

      const c = this.pointEnCours.cellule;
      const elAlt = document.getElementById('preview-cell-alt');
      const elEssence = document.getElementById('preview-cell-essence');
      const elCouvert = document.getElementById('preview-cell-couvert');
      const elHauteur = document.getElementById('preview-cell-hauteur');
      const elLisiere = document.getElementById('preview-cell-lisiere');

      if (elAlt) elAlt.textContent = c.alt !== null ? `${c.alt} m` : '—';
      if (elEssence) elEssence.textContent = cellRaw.nomEssence || 'Hors forêt';
      if (elCouvert) elCouvert.textContent = c.couvert !== null ? `${c.couvert} %` : '—';
      if (elHauteur) elHauteur.textContent = c.hauteur !== null ? `${Number(c.hauteur.toFixed(1))} m` : '—';
      if (elLisiere) elLisiere.textContent = c.lisiere !== null ? `${c.lisiere} m` : '—';
    }
  }

  /**
   * Ouvre la fenêtre modale du formulaire de cueillette simplifiée
   */
  ouvrirFormulaire(donneesExistantes = null) {
    this.cueilletteEnEdition = donneesExistantes?.id ? donneesExistantes : null;
    const isEdit = Boolean(this.cueilletteEnEdition);

    const titleEl = document.getElementById('form-carnet-title');
    if (titleEl) {
      titleEl.textContent = isEdit ? 'Modifier la trouvaille' : 'Ajouter une trouvaille';
    }

    const type = donneesExistantes?.type || 'trouve';
    this.definirTypeFormulaire(type);

    // Remplissage des champs
    const dateInput = document.getElementById('carnet-date');
    if (dateInput) {
      dateInput.value = donneesExistantes?.date || new Date().toISOString().slice(0, 10);
    }

    const nomEspece = donneesExistantes?.espece_nom || '';
    const especeInput = document.getElementById('carnet-espece');
    if (especeInput) {
      especeInput.value = nomEspece;
    }

    // Mise à jour de la pastille d'accès rapide sélectionnée
    document.querySelectorAll('.btn-quick-species').forEach(btn => {
      const nom = btn.dataset.espece || btn.textContent.trim();
      if (nomEspece && nom.toLowerCase() === nomEspece.toLowerCase()) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Quantité (radio buttons)
    const qVal = donneesExistantes?.quantite || '1-5';
    document.querySelectorAll('input[name="carnet-quantite"]').forEach(r => {
      r.checked = (r.value === qVal);
    });

    const noteInput = document.getElementById('carnet-note');
    if (noteInput) {
      noteInput.value = donneesExistantes?.note || '';
    }

    // Affichage des coordonnées et de la précision
    const coordsEl = document.getElementById('carnet-form-coords');
    if (coordsEl) {
      const lon = (this.pointEnCours?.lon || donneesExistantes?.lon || 0).toFixed(4);
      const lat = (this.pointEnCours?.lat || donneesExistantes?.lat || 0).toFixed(4);
      const prec = this.pointEnCours?.precision_m ? `(GPS ±${this.pointEnCours.precision_m}m)` : '(Point carte)';
      coordsEl.textContent = `${lat}, ${lon} ${prec}`;
    }

    ouvrirModale(this.modalForm);
  }

  fermerFormulaire() {
    fermerModale(this.modalForm);
    if (this.markerSaisie) {
      this.markerSaisie.remove();
      this.markerSaisie = null;
    }
    this.pointEnCours = null;
    this.cueilletteEnEdition = null;
  }

  /**
   * Bascule entre le formulaire 'trouve' (champ espèce + quantité) et 'rien' (absence)
   */
  definirTypeFormulaire(type) {
    const btnTrouve = document.getElementById('btn-type-trouve');
    const btnRien = document.getElementById('btn-type-rien');
    const trouveSection = document.getElementById('form-section-trouve');

    if (type === 'rien') {
      btnRien?.classList.add('active');
      btnTrouve?.classList.remove('active');
      if (trouveSection) trouveSection.style.display = 'none';
      if (this.markerSaisie) this.markerSaisie.getElement().innerHTML = '🍃';
    } else {
      btnTrouve?.classList.add('active');
      btnRien?.classList.remove('active');
      if (trouveSection) trouveSection.style.display = 'block';
      if (this.markerSaisie) this.markerSaisie.getElement().innerHTML = '🍄';
    }
  }

  /**
   * Enregistre l'observation saisie dans IndexedDB
   */
  async enregistrerFormulaire() {
    const isRien = document.getElementById('btn-type-rien')?.classList.contains('active');
    const type = isRien ? 'rien' : 'trouve';

    const date = document.getElementById('carnet-date')?.value || new Date().toISOString().slice(0, 10);
    const especeNom = document.getElementById('carnet-espece')?.value?.trim() || (isRien ? null : 'Inconnu');

    // Trouver le nom latin si connu dans especes.json
    let especeLatin = null;
    if (especeNom) {
      const match = this.especes.find(e => e.nom.toLowerCase() === especeNom.toLowerCase());
      if (match) especeLatin = match.latin;
    }

    let quantite = null;
    if (type === 'trouve') {
      const qCheck = document.querySelector('input[name="carnet-quantite"]:checked');
      quantite = qCheck ? qCheck.value : '1-5';
    }

    const note = document.getElementById('carnet-note')?.value?.trim() || '';

    const lon = this.pointEnCours?.lon || this.cueilletteEnEdition?.lon;
    const lat = this.pointEnCours?.lat || this.cueilletteEnEdition?.lat;
    const precision_m = this.pointEnCours?.precision_m !== undefined ? this.pointEnCours.precision_m : (this.cueilletteEnEdition?.precision_m || null);
    const source_position = this.pointEnCours?.source_position || this.cueilletteEnEdition?.source_position || 'carte';
    const cellule = this.pointEnCours?.cellule || this.cueilletteEnEdition?.cellule || null;

    // Arbres : intégration automatique depuis l'essence détectée 25 m sans importuner l'utilisateur
    let arbres = this.cueilletteEnEdition?.arbres || [];
    if (arbres.length === 0 && cellule?.essence && cellule.essence !== 'Hors forêt') {
      arbres = [cellule.essence];
    }
    const milieu = this.cueilletteEnEdition?.milieu || [];

    const payload = {
      type,
      date,
      espece: type === 'trouve' ? { nom: especeNom, latin: especeLatin } : null,
      espece_nom: type === 'trouve' ? especeNom : null,
      quantite,
      lon,
      lat,
      precision_m,
      source_position,
      arbres,
      milieu,
      note,
      cellule
    };

    if (this.cueilletteEnEdition?.id) {
      await modifierCueillette(this.cueilletteEnEdition.id, payload);
      this.afficherToast('✅ Observation modifiée avec succès');
    } else {
      await ajouterCueillette(payload);
      this.afficherToast(type === 'trouve' ? '🍄 Cueillette enregistrée dans votre carnet !' : '🍃 Zone notée "rien trouvé" pour l\'analyse.');
    }

    this.fermerFormulaire();
    await this.rafraichirCoucheCarte();
    await this.mettreAJourCompteurBadge();
    await this.verifierModeInstalleApresEnregistrement();
    await this.verifierBandeauApresEnregistrement();
    await this.rafraichirStatutStockage();
    if (!this.modalCarnet.classList.contains('hidden')) {
      this.rafraichirListeCarnet();
    }

    // Déclencher la synchronisation en arrière-plan
    incrementerModifsEnAttente();
    synchroniserCarnet().catch(() => {});
  }

  /**
   * Affiche la fiche de résumé popup d'une cueillette au clic sur la carte
   */
  async afficherPopupCueillette(id, lngLat) {
    const item = await obtenirCueillette(id);
    if (!item) return;

    if (this.popupActive) {
      this.popupActive.remove();
    }

    const typeBadge = item.type === 'trouve'
      ? `<span class="cell-badge in-forest" style="background:#10b981; color:#fff;">🍄 ${item.quantite ? item.quantite + ' ex.' : 'Trouvé'}</span>`
      : `<span class="cell-badge out-forest" style="background:#64748b; color:#fff;">🍃 Rien trouvé</span>`;

    const especeTitre = item.type === 'trouve' ? (item.espece_nom || 'Champignon') : 'Zone sans trouvaille';
    const latinSub = item.espece?.latin ? `<div style="font-style:italic; font-size:0.8rem; color:var(--text-muted); margin-bottom:6px;">${item.espece.latin}</div>` : '';

    const milieuBadges = (item.milieu || []).map(m => `<span class="tag-pill">${m}</span>`).join(' ');
    const arbresBadges = (item.arbres || []).map(a => `<span class="tag-pill tag-arbre">🌳 ${a}</span>`).join(' ');

    const cellSnap = item.cellule ? `
      <div class="parcel-popup-grid" style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:6px;">
        <div class="parcel-popup-item"><span class="popup-k">Altitude</span><span class="popup-v">${item.cellule.alt ? item.cellule.alt + ' m' : '—'}</span></div>
        <div class="parcel-popup-item"><span class="popup-k">Couvert</span><span class="popup-v">${item.cellule.couvert !== null ? item.cellule.couvert + ' %' : '—'}</span></div>
        <div class="parcel-popup-item"><span class="popup-k">Hauteur</span><span class="popup-v">${item.cellule.hauteur !== null ? Number(item.cellule.hauteur.toFixed(1)) + ' m' : '—'}</span></div>
        <div class="parcel-popup-item"><span class="popup-k">Lisière</span><span class="popup-v">${item.cellule.lisiere !== null ? item.cellule.lisiere + ' m' : '—'}</span></div>
      </div>
    ` : '';

    const html = `
      <div class="parcel-popup carnet-popup">
        <div class="parcel-popup-header">
          <div>
            <div class="parcel-popup-title">${especeTitre}</div>
            ${latinSub}
          </div>
          <div>${typeBadge}</div>
        </div>
        <div style="font-size:0.82rem; color:var(--text-muted); margin-bottom:8px;">
          📅 ${item.date || ''} ${item.source_position === 'gps' ? '• 📡 GPS' : '• 🗺️ Carte'}
        </div>
        ${item.note ? `<p style="font-size:0.85rem; margin-bottom:8px; background:rgba(0,0,0,0.2); padding:6px; border-radius:4px;">« ${item.note} »</p>` : ''}
        ${arbresBadges || milieuBadges ? `<div style="margin-bottom:6px;">${arbresBadges} ${milieuBadges}</div>` : ''}
        ${cellSnap}
        <div class="popup-actions-row">
          <button id="btn-edit-popup-${item.id}" class="btn-carnet-sm btn-edit-obs">✏️ Modifier</button>
          <button id="btn-del-popup-${item.id}" class="btn-carnet-sm btn-danger btn-del-obs">🗑️ Supprimer</button>
        </div>
      </div>
    `;

    this.popupActive = new maplibregl.Popup({ offset: 12, closeButton: true, maxWidth: '320px' })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(this.map);

    setTimeout(() => {
      document.getElementById(`btn-edit-popup-${item.id}`)?.addEventListener('click', () => {
        this.popupActive.remove();
        this.pointEnCours = { lon: item.lon, lat: item.lat, precision_m: item.precision_m, source_position: item.source_position, cellule: item.cellule };
        this.ouvrirFormulaire(item);
      });

      document.getElementById(`btn-del-popup-${item.id}`)?.addEventListener('click', async () => {
        if (confirm(`Confirmez-vous la suppression de cette observation (${especeTitre} du ${item.date}) ?`)) {
          this.popupActive.remove();
          await supprimerCueillette(item.id);
          this.afficherToast('🗑️ Observation supprimée.');
          await this.rafraichirCoucheCarte();
          if (!this.modalCarnet.classList.contains('hidden')) {
            this.rafraichirListeCarnet();
          }
          incrementerModifsEnAttente();
          synchroniserCarnet().catch(() => {});
        }
      });
    }, 50);
  }

  /**
   * Ouvre la modale complète du carnet de cueillette
   */
  async ouvrirMonCarnet() {
    ouvrirModale(this.modalCarnet);
    await this.rafraichirListeCarnet();
    this.rafraichirStatutStockage();
  }

  fermerMonCarnet() {
    fermerModale(this.modalCarnet);
  }

  /**
   * Rafraîchit la liste et les compteurs de la modale "Mon carnet"
   */
  async rafraichirListeCarnet() {
    const typeFiltre = document.getElementById('carnet-filtre-type')?.value || 'tous';
    const anneeFiltre = document.getElementById('carnet-filtre-annee')?.value || 'toutes';
    const query = document.getElementById('carnet-filtre-recherche')?.value || '';

    const items = await listerCueillettes({ type: typeFiltre, annee: anneeFiltre, espece_nom: query });
    const stats = await compterCueillettes();

    // Mettre à jour les compteurs d'en-tête
    const countSorties = document.getElementById('stat-carnet-sorties');
    const countEspeces = document.getElementById('stat-carnet-especes');
    const countRien = document.getElementById('stat-carnet-rien');

    if (countSorties) countSorties.textContent = `${stats.total}`;
    if (countEspeces) countEspeces.textContent = `${stats.especesUniques}`;
    if (countRien) countRien.textContent = `${stats.rien}`;

    const listContainer = document.getElementById('carnet-items-list');
    if (!listContainer) return;

    if (items.length === 0) {
      listContainer.innerHTML = `
        <div class="carnet-empty-state">
          <div style="font-size:2.5rem; margin-bottom:8px;">🍄</div>
          <div style="font-weight:700; font-size:1.05rem; margin-bottom:6px; color:#f8fafc;">Votre carnet est vide</div>
          <p style="font-size:0.9rem; color:#cbd5e1; margin-bottom:12px; line-height:1.4;">
            Ajoutez vos premières cueillettes pour accéder à l'analyse.
          </p>
          <a href="#" class="btn-lien-milieux-favorables" style="font-size:0.8rem; color:#38bdf8; text-decoration:underline; line-height:1.3; display:inline-block;">
            Pas encore de coin ? Découvrir les milieux favorables d'après les observations naturalistes
          </a>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = items.map(item => {
      const isTrouve = item.type === 'trouve';
      const titre = isTrouve ? (item.espece_nom || 'Champignon') : 'Rien trouvé';
      const badgeClass = isTrouve ? 'badge-trouve' : 'badge-rien';
      const badgeIcon = isTrouve ? '🍄' : '🍃';
      const qText = item.quantite ? `(${item.quantite} spécimens)` : '';

      return `
        <div class="carnet-row" data-id="${item.id}" data-lon="${item.lon}" data-lat="${item.lat}">
          <div class="carnet-row-left">
            <span class="carnet-row-icon ${badgeClass}">${badgeIcon}</span>
            <div>
              <div class="carnet-row-title">${titre} <span style="font-size:0.75rem; color:var(--text-dim);">${qText}</span></div>
              <div class="carnet-row-meta">📅 ${item.date || 'Date inconnue'} • ${item.source_position === 'gps' ? 'GPS' : 'Carte'}</div>
              ${item.note ? `<div class="carnet-row-note">${item.note}</div>` : ''}
            </div>
          </div>
          <div class="carnet-row-actions">
            <button class="btn-carnet-action btn-row-zoom" title="Voir sur la carte">🎯</button>
            <button class="btn-carnet-action btn-row-del" title="Supprimer">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    // Attacher clics sur les lignes
    listContainer.querySelectorAll('.carnet-row').forEach(row => {
      const id = row.dataset.id;
      const lon = Number(row.dataset.lon);
      const lat = Number(row.dataset.lat);

      row.querySelector('.btn-row-zoom')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.fermerMonCarnet();
        this.map.flyTo({ center: [lon, lat], zoom: 14, speed: 1.4 });
        setTimeout(() => this.afficherPopupCueillette(id, [lon, lat]), 800);
      });

      row.querySelector('.btn-row-del')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Confirmez-vous la suppression de cette observation ?')) {
          await supprimerCueillette(id);
          this.afficherToast('🗑️ Observation supprimée.');
          await this.rafraichirCoucheCarte();
          this.rafraichirListeCarnet();
          incrementerModifsEnAttente();
          synchroniserCarnet().catch(() => {});
        }
      });

      row.addEventListener('click', () => {
        this.fermerMonCarnet();
        this.map.flyTo({ center: [lon, lat], zoom: 14, speed: 1.4 });
        setTimeout(() => this.afficherPopupCueillette(id, [lon, lat]), 800);
      });
    });
  }

  /**
   * Génère le nom de fichier au format meschampis_AAAA-MM-JJ_HHhMM.mcb
   */
  genererNomFichierExport() {
    const d = new Date();
    const aaaa = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const jj = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `meschampis_${aaaa}-${mm}-${jj}_${hh}h${min}.mcb`;
  }

  /**
   * Calcule le nombre de cueillettes créées ou modifiées depuis le dernier export
   */
  async obtenirNbModifsDepuisExport() {
    const items = await listerCueillettes();
    const dernierExport = await obtenirMeta('dernier_export');
    if (!dernierExport) {
      return items.length;
    }
    return items.filter(i => {
      const tModif = i.modifie_le || i.cree_le || '';
      return tModif > dernierExport;
    }).length;
  }

  /**
   * Met à jour la pastille « N » sur Mon carnet dès N >= 1
   */
  async mettreAJourCompteurBadge() {
    const n = await this.obtenirNbModifsDepuisExport();
    const badge = document.getElementById('carnet-compteur-badge');
    if (badge) {
      badge.textContent = `${n}`;
      badge.style.display = n >= 1 ? 'inline-flex' : 'none';
      badge.title = n >= 1 ? `${n} cueillette(s) modifiée(s) depuis le dernier export` : 'Sauvegarde à jour';
    }
    return n;
  }

  /**
   * Met à jour le bloc de statut du stockage dans Mon carnet
   */
  async rafraichirStatutStockage() {
    const stats = await compterCueillettes();
    let persistant = false;
    try {
      persistant = (await navigator.storage?.persisted?.()) || (await obtenirMeta('stockage_persistant'));
    } catch (e) {
      persistant = await obtenirMeta('stockage_persistant');
    }
    const dernierExport = await obtenirMeta('dernier_export');

    const elPersist = document.getElementById('stat-stockage-persist');
    const elTotal = document.getElementById('stat-stockage-total');
    const elExport = document.getElementById('stat-stockage-export');

    if (elPersist) {
      elPersist.textContent = persistant ? 'Stockage protégé' : 'Stockage non garanti : exportez régulièrement';
      elPersist.style.color = persistant ? '#34d399' : '#fbbf24';
    }
    if (elTotal) elTotal.textContent = `${stats.total} observation${stats.total > 1 ? 's' : ''}`;
    if (elExport) {
      if (dernierExport) {
        const d = new Date(dernierExport);
        elExport.textContent = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } else {
        elExport.textContent = 'Jamais';
      }
    }
  }

  /**
   * Vérifie après un enregistrement si le bandeau discret d'export doit s'afficher (si N >= 3 ou dernier export > 7 jours)
   */
  async verifierBandeauApresEnregistrement() {
    const n = await this.obtenirNbModifsDepuisExport();
    const dernierExport = await obtenirMeta('dernier_export');
    let diffJours = 0;
    if (dernierExport) {
      diffJours = (Date.now() - new Date(dernierExport).getTime()) / (1000 * 3600 * 24);
    } else {
      diffJours = 999;
    }

    if (n >= 3 || diffJours > 7) {
      this.afficherBandeauRappelExport(n, diffJours);
    } else {
      this.masquerBandeauRappelExport();
    }
  }

  afficherBandeauRappelExport(n, diffJours) {
    const banner = document.getElementById('rappel-export-banner');
    if (!banner) return;
    const txt = banner.querySelector('.rappel-text');
    if (txt) {
      const detail = n >= 3
        ? `${n} cueillettes modifiées depuis votre sauvegarde`
        : `dernier export il y a plus de ${Math.floor(diffJours)} jours`;
      txt.innerHTML = `<strong>Sauvegarde conseillée (${detail})</strong><p>Safari peut effacer les données d'un site non visité. Exportez une copie .mcb pour immuniser vos données.</p>`;
    }
    banner.classList.remove('hidden');
  }

  masquerBandeauRappelExport() {
    const banner = document.getElementById('rappel-export-banner');
    if (banner) banner.classList.add('hidden');
  }

  /**
   * Si non installé en mode standalone : message unique après le premier enregistrement
   */
  async verifierModeInstalleApresEnregistrement() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || Boolean(navigator.standalone);
    if (isStandalone) return;

    const vu = await obtenirMeta('message_standalone_vu');
    if (vu) return;

    await definirMeta('message_standalone_vu', true);
    ouvrirModale('modal-standalone-info');
  }

  /**
   * Sauvegarde chiffrée .mcb (Export)
   */
  async lancerExportChiffre() {
    const pass1 = document.getElementById('export-pass-1')?.value;
    const pass2 = document.getElementById('export-pass-2')?.value;
    const errBox = document.getElementById('export-error-msg');

    if (!pass1 || pass1.trim().length === 0) {
      if (errBox) errBox.textContent = 'Veuillez saisir une phrase ou un mot de passe.';
      return;
    }
    if (pass1 !== pass2) {
      if (errBox) errBox.textContent = 'Les deux phrases de passe ne sont pas identiques.';
      return;
    }

    try {
      this.afficherToast('🔒 Chiffrement PBKDF2 + AES-GCM 256 bits en cours...');
      const mcbJson = await exporterSauvegardeChiffree(pass1);

      // Nom de fichier exact meschampis_AAAA-MM-JJ_HHhMM.mcb
      const filename = this.genererNomFichierExport();
      const blob = new Blob([mcbJson], { type: 'application/json' });
      const fichier = new File([blob], filename, { type: 'application/json' });

      let exportReussi = false;

      // C7. Partage via Web Share API si supporté (iPhone : Enregistrer dans Fichiers -> iCloud Drive)
      if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [fichier] })) {
        try {
          await navigator.share({
            files: [fichier],
            title: 'Sauvegarde MesChampis'
          });
          exportReussi = true;
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') {
            // Annulation volontaire par l'utilisateur : pas de mise à jour de dernier_export
            this.afficherToast('Partage annulé.');
            return;
          }
          console.warn('navigator.share a échoué, repli sur le téléchargement classique :', shareErr);
        }
      }

      // Si le partage n'est pas supporté ou a échoué (hors annulation) : téléchargement classique
      if (!exportReussi) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        exportReussi = true;
      }

      // meta.dernier_export mis à jour seulement si le partage ou le téléchargement réussit
      if (exportReussi) {
        const mcbObj = JSON.parse(mcbJson);
        await definirMeta('dernier_export', mcbObj.cree_le || new Date().toISOString());
        this.modalExport.classList.add('hidden');
        this.afficherToast(`✅ Sauvegarde chiffrée exportée : ${filename}`);
        this.masquerBandeauRappelExport();
        await this.mettreAJourCompteurBadge();
        this.rafraichirStatutStockage();
      }
    } catch (e) {
      if (errBox) errBox.textContent = 'Erreur lors de l\'export : ' + e.message;
    }
  }

  /**
   * Restauration chiffrée .mcb (Import)
   */
  async lancerImportChiffre() {
    const fileInput = document.getElementById('import-file-input');
    const passInput = document.getElementById('import-pass');
    const errBox = document.getElementById('import-error-msg');
    const resultBox = document.getElementById('import-result-msg');

    if (!fileInput?.files?.[0]) {
      if (errBox) errBox.textContent = 'Veuillez sélectionner un fichier de sauvegarde (.mcb).';
      return;
    }
    const passphrase = passInput?.value;
    if (!passphrase) {
      if (errBox) errBox.textContent = 'Veuillez saisir votre phrase de passe de déchiffrement.';
      return;
    }

    try {
      const file = fileInput.files[0];
      const text = await file.text();
      this.afficherToast('🔓 Déchiffrement AES-GCM et fusion des données...');

      const res = await importerSauvegardeChiffree(text, passphrase);

      if (errBox) errBox.textContent = '';
      if (resultBox) {
        resultBox.textContent = `Succès : ${res.ajoutees} ajoutée(s), ${res.mises_a_jour} mise(s) à jour, ${res.ignorees} inchangée(s).`;
        resultBox.style.display = 'block';
      }

      await this.rafraichirCoucheCarte();
      await this.rafraichirListeCarnet();
      await this.mettreAJourCompteurBadge();
      this.rafraichirStatutStockage();
      this.afficherToast('✅ Sauvegarde restaurée avec succès !');

      setTimeout(() => {
        this.modalImport.classList.add('hidden');
        if (resultBox) resultBox.style.display = 'none';
      }, 2000);
    } catch (e) {
      if (errBox) errBox.textContent = e.message;
    }
  }

  reporterRappelExport(jours = 7) {
    this.masquerBandeauRappelExport();
  }

  /**
   * Vérifie l'avertissement de sécurité à la première utilisation
   */
  async verifierPremierAvertissement() {
    const vu = await obtenirMeta('avertissement_securite_vu');
    if (!vu) {
      ouvrirModale(this.modalAvertissement);
    }
  }

  validerAvertissementSecurite() {
    fermerModale(this.modalAvertissement);
    definirMeta('avertissement_securite_vu', true);
  }

  fermerFabMenu() {
    this.fabMenu?.classList.add('hidden');
  }

  toggleFabMenu() {
    this.fabMenu?.classList.toggle('hidden');
  }

  afficherToast(msg) {
    let toast = document.getElementById('carnet-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'carnet-toast';
      toast.className = 'carnet-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  /**
   * Attache tous les événements DOM de l'interface
   */
  attacherEvenementsUI() {
    // Bouton FAB principal "+ Cueillette"
    this.btnFab?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFabMenu();
    });

    document.addEventListener('click', (e) => {
      if (!this.fabMenu?.contains(e.target) && e.target !== this.btnFab) {
        this.fermerFabMenu();
      }
    });

    // Options du menu FAB
    document.getElementById('fab-opt-gps')?.addEventListener('click', () => this.demarrerSaisieGPS(false));
    document.getElementById('fab-opt-carte')?.addEventListener('click', () => this.demarrerPlacementCarte(false));
    document.getElementById('fab-opt-rien')?.addEventListener('click', () => this.demarrerSaisieGPS(true));

    // Boutons de bascule Type dans le formulaire
    document.getElementById('btn-type-trouve')?.addEventListener('click', () => this.definirTypeFormulaire('trouve'));
    document.getElementById('btn-type-rien')?.addEventListener('click', () => this.definirTypeFormulaire('rien'));

    // Bouton enregistrer formulaire
    document.getElementById('btn-submit-carnet')?.addEventListener('click', () => this.enregistrerFormulaire());
    document.getElementById('btn-cancel-carnet')?.addEventListener('click', () => this.fermerFormulaire());
    document.getElementById('btn-close-form-modal')?.addEventListener('click', () => this.fermerFormulaire());

    // Annulation du mode de placement manuel par le bandeau
    document.getElementById('btn-annuler-positionnement')?.addEventListener('click', () => {
      this.annulerPlacementCarte();
    });

    // Pastilles d'accès direct aux espèces fréquentes
    const updateQuickChips = (nomSelectionne) => {
      document.querySelectorAll('.btn-quick-species').forEach(chip => {
        const val = chip.dataset.espece || chip.textContent.trim();
        if (nomSelectionne && val.toLowerCase() === nomSelectionne.toLowerCase()) {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      });
    };

    document.querySelectorAll('.btn-quick-species').forEach(chip => {
      chip.addEventListener('click', () => {
        const nom = chip.dataset.espece || chip.textContent.trim();
        const especeInput = document.getElementById('carnet-espece');
        if (especeInput) {
          especeInput.value = nom;
          updateQuickChips(nom);
          const suggestList = document.getElementById('carnet-espece-suggestions');
          if (suggestList) suggestList.style.display = 'none';
        }
      });
    });

    // Suggestions espèces
    const especeInput = document.getElementById('carnet-espece');
    const suggestList = document.getElementById('carnet-espece-suggestions');
    if (especeInput && suggestList) {
      especeInput.addEventListener('input', () => {
        const q = especeInput.value.trim().toLowerCase();
        updateQuickChips(especeInput.value.trim());
        if (q.length < 1) {
          suggestList.innerHTML = '';
          suggestList.style.display = 'none';
          return;
        }
        const matches = this.especes.filter(e =>
          e.nom.toLowerCase().includes(q) || e.latin.toLowerCase().includes(q)
        ).slice(0, 6);

        if (matches.length === 0) {
          suggestList.innerHTML = '';
          suggestList.style.display = 'none';
          return;
        }

        suggestList.innerHTML = matches.map(m => `
          <div class="suggest-item" data-nom="${m.nom}">
            <span class="suggest-nom">${m.nom}</span>
            <span class="suggest-latin">${m.latin}</span>
          </div>
        `).join('');
        suggestList.style.display = 'block';

        suggestList.querySelectorAll('.suggest-item').forEach(item => {
          item.addEventListener('click', () => {
            especeInput.value = item.dataset.nom;
            updateQuickChips(item.dataset.nom);
            suggestList.innerHTML = '';
            suggestList.style.display = 'none';
          });
        });
      });
    }

    // Bouton supérieur "Mon carnet"
    document.getElementById('btn-open-carnet')?.addEventListener('click', () => this.ouvrirMonCarnet());
    document.getElementById('btn-close-mon-carnet')?.addEventListener('click', () => this.fermerMonCarnet());

    // Filtres carnet
    document.getElementById('carnet-filtre-type')?.addEventListener('change', () => this.rafraichirListeCarnet());
    document.getElementById('carnet-filtre-annee')?.addEventListener('change', () => this.rafraichirListeCarnet());
    document.getElementById('carnet-filtre-recherche')?.addEventListener('input', () => this.rafraichirListeCarnet());

    // Checkbox couche cueillettes
    const chk = document.getElementById('check-afficher-cueillettes');
    if (chk) {
      chk.checked = true;
      chk.addEventListener('change', () => this.definirVisibilite(chk.checked));
    }

    // Modale Export .mcb
    document.getElementById('btn-open-export')?.addEventListener('click', () => {
      document.getElementById('export-pass-1').value = '';
      document.getElementById('export-pass-2').value = '';
      document.getElementById('export-error-msg').textContent = '';
      ouvrirModale(this.modalExport);
    });
    document.getElementById('btn-close-export')?.addEventListener('click', () => fermerModale(this.modalExport));
    document.getElementById('btn-do-export')?.addEventListener('click', () => this.lancerExportChiffre());

    // Modale Import .mcb
    document.getElementById('btn-open-import')?.addEventListener('click', () => {
      document.getElementById('import-file-input').value = '';
      document.getElementById('import-pass').value = '';
      document.getElementById('import-error-msg').textContent = '';
      document.getElementById('import-result-msg').style.display = 'none';
      ouvrirModale(this.modalImport);
    });
    document.getElementById('btn-close-import')?.addEventListener('click', () => fermerModale(this.modalImport));
    document.getElementById('btn-do-import')?.addEventListener('click', () => this.lancerImportChiffre());

    // Rappel export banner
    document.getElementById('btn-rappel-export-maintenant')?.addEventListener('click', () => {
      this.masquerBandeauRappelExport();
      ouvrirModale(this.modalExport);
    });
    document.getElementById('btn-rappel-export-tard')?.addEventListener('click', () => {
      this.masquerBandeauRappelExport();
    });

    // Avertissement sécurité
    document.getElementById('btn-compris-securite')?.addEventListener('click', () => this.validerAvertissementSecurite());

    // Modale Information mode installé PWA
    const modalStandalone = document.getElementById('modal-standalone-info');
    document.getElementById('btn-close-standalone-info')?.addEventListener('click', () => fermerModale(modalStandalone));
    document.getElementById('btn-compris-standalone')?.addEventListener('click', () => fermerModale(modalStandalone));
  }
}
