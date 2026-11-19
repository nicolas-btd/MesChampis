/**
 * Point d'entrée principal de la webapp MesChampis
 * MesChampis — Grille raster 25 m principale
 */

import { GestionnaireCarte } from './carte.js';
import { GestionnaireGrille } from './grille.js';
import { GestionnaireCarnet } from './carnet.js';
import { ouvrirDB } from './db.js';
import { estModeDemo } from './api.js';
import { GestionnaireCompteUI } from './compte_ui.js';
import { GestionnaireCarteChaleur } from './carte_chaleur.js';
import { PanneauDemo } from './panneau_demo.js';
import { initialiserGestionnaireModales, ouvrirModale, fermerModale, fermerToutesModales } from './modales.js';

function initialiserApp() {
  // Initialiser le gestionnaire centralisé de modales (Échap, croix, backdrop, zéro superposition)
  initialiserGestionnaireModales();

  // Initialisation préventive de la base de données locale (store meta et carnet privé)
  ouvrirDB().catch((e) => console.warn('[IndexedDB] Init différée :', e));
  const legendContainer = document.getElementById('legend-container');
  const loadingOverlay = document.getElementById('loading-overlay');
  const errorBanner = document.getElementById('error-banner');
  const errorMessage = document.getElementById('error-message');

  const btnPlan = document.getElementById('btn-basemap-plan');
  const btnOrtho = document.getElementById('btn-basemap-ortho');
  const btnLocate = document.getElementById('btn-locate');

  const sliderOpacity = document.getElementById('slider-opacity');
  const sliderOpacityVal = document.getElementById('slider-opacity-val');
  const checkLimitesForet = document.getElementById('check-limites-foret');
  const statTuilesCount = document.getElementById('stat-tuiles-count');

  const btnTogglePanel = document.getElementById('btn-toggle-panel');
  const btnClosePanel = document.getElementById('btn-close-panel');
  const sidePanel = document.getElementById('side-panel');

  const modeTabs = document.querySelectorAll('.btn-color-tab');

  // Désactiver visuellement les boutons de mode tant que la grille n'est pas prête
  modeTabs.forEach((tab) => {
    tab.classList.add('disabled');
    tab.disabled = true;
  });

  // 1. Initialisation de la carte (fond IGN)
  const gestionnaireCarte = new GestionnaireCarte('map', {
    onLoaded: () => {
      // Carte chargée
    },
    onError: (err) => {
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
      if (errorMessage) errorMessage.textContent = err.message || 'Erreur chargement carte';
      if (errorBanner) errorBanner.classList.remove('hidden');
    }
  });

  // 2. Initialisation de la grille raster 25 m (couche principale)
  const gestionnaireGrille = new GestionnaireGrille(gestionnaireCarte.map, {
    legendContainer: legendContainer,
    onReady: (manifest) => {
      // Activer les boutons de mode une fois la grille prête
      modeTabs.forEach((tab) => {
        tab.classList.remove('disabled');
        tab.disabled = false;
      });

      gestionnaireGrille.mettreAJourStatTuiles();
      if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
      }
    }
  });

  // 3. Initialisation du carnet de cueillette (IndexedDB local, chiffré)
  const gestionnaireCarnet = new GestionnaireCarnet(gestionnaireCarte.map, gestionnaireGrille);

  // 4. Initialisation de la carte de chaleur (Web Worker)
  const gestionnaireCarteChaleur = new GestionnaireCarteChaleur(gestionnaireCarte.map, gestionnaireGrille);

  // 5. Initialisation du parcours utilisateur et gestion de compte
  const gestionnaireCompteUI = new GestionnaireCompteUI(gestionnaireCarnet, gestionnaireGrille);
  gestionnaireCompteUI.demarrer().catch((err) => console.warn('[CompteUI] Erreur demarrage :', err));

  // 6. Initialisation du panneau de démo interactif (actif si ?demo=1)
  const panneauDemo = new PanneauDemo(gestionnaireCarnet, gestionnaireCompteUI, gestionnaireCarteChaleur);

  // Exposer les instances sous window.__meschampis uniquement sur localhost / 127.0.0.1 ou avec ?debug=1 / ?demo=1
  const isDebug = typeof window !== 'undefined' && (
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    new URLSearchParams(location.search).get('debug') === '1' ||
    estModeDemo()
  );

  if (isDebug) {
    window.__meschampis = {
      gestionnaireCarte,
      gestionnaireGrille,
      gestionnaireCarnet,
      gestionnaireCarteChaleur,
      gestionnaireCompteUI,
      panneauDemo,
      carte: gestionnaireCarte,
      grille: gestionnaireGrille,
      carnet: gestionnaireCarnet,
      chaleur: gestionnaireCarteChaleur,
      compteUI: gestionnaireCompteUI,
      modales: { ouvrirModale, fermerModale, fermerToutesModales }
    };
  }

  // 7. Bascule du fond de carte (Plan IGN / Photos Aériennes)
  btnPlan.addEventListener('click', () => {
    btnPlan.classList.add('active');
    btnOrtho.classList.remove('active');
    gestionnaireCarte.changerFond('plan');
  });

  btnOrtho.addEventListener('click', () => {
    btnOrtho.classList.add('active');
    btnPlan.classList.remove('active');
    gestionnaireCarte.changerFond('ortho');
  });

  // 8. Sélecteur de mode de coloriage de la grille (Expo, Alt, Pente, Lisière, Essence, Chaleur)
  modeTabs.forEach((tab) => {
    tab.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (tab.disabled || tab.classList.contains('disabled')) return;

      const mode = tab.dataset.mode;
      if (mode === 'chaleur') {
        modeTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        await gestionnaireCarteChaleur.basculer(true);
      } else {
        await gestionnaireCarteChaleur.basculer(false);
        modeTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        gestionnaireGrille.definirCouche(mode);
      }
    });
  });

  // 5. Curseur d'opacité de la grille
  if (sliderOpacity) {
    sliderOpacity.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (sliderOpacityVal) sliderOpacityVal.textContent = `${val}%`;
      gestionnaireGrille.definirOpacite(val / 100.0);
    });
  }

  // 6. Case à cocher : Limites BD Forêt (contours vectoriels secondaires)
  if (checkLimitesForet) {
    checkLimitesForet.addEventListener('change', (e) => {
      gestionnaireCarte.setLimitesVisibles(e.target.checked);
    });
  }

  // 7. Bouton de géolocalisation
  btnLocate.addEventListener('click', () => {
    gestionnaireCarte.activerGeolocalisation();
  });

  // 8. Gestion de l'ouverture/fermeture du panneau sur mobile
  if (btnTogglePanel && sidePanel) {
    btnTogglePanel.addEventListener('click', () => {
      sidePanel.classList.toggle('open');
    });
  }

  if (btnClosePanel && sidePanel) {
    btnClosePanel.addEventListener('click', () => {
      sidePanel.classList.remove('open');
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialiserApp);
} else {
  initialiserApp();
}
