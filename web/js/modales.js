/**
 * MesChampis — Gestionnaire Centralisé des Modales et Fenêtres
 * Garantit l'absence totale de superposition, la fermeture fiable (croix, clic extérieur, Échap),
 * et la gestion propre du z-index et de l'état d'affichage.
 */

import { droits } from './droits.js';

let modaleActive = null;

/**
 * Ferme toutes les modales ouvertes dans l'application
 */
export function fermerToutesModales() {
  document.querySelectorAll('.modal-backdrop').forEach((m) => {
    m.classList.add('hidden');
  });

  // Fermer également le tiroir démo s'il est ouvert pour éviter tout chevauchement
  const drawerDemo = document.getElementById('panneau-demo-drawer');
  if (drawerDemo) drawerDemo.classList.add('hidden');

  modaleActive = null;
  document.body.classList.remove('modal-open');
}

/**
 * Ouvre une modale en garantissant qu'aucune autre fenêtre ne se superpose
 * @param {HTMLElement|string} cible Elément modale ou son identifiant DOM
 * @param {Object} [options]
 * @param {boolean} [options.masquerHero=true] Masque l'overlay d'accueil non connecté
 */
export function ouvrirModale(cible, options = {}) {
  const modal = typeof cible === 'string' ? document.getElementById(cible) : cible;
  if (!modal) return;

  // 1. Fermer toutes les autres modales pour interdire les superpositions sauvages
  fermerToutesModales();

  // 2. Masquer temporairement le hero accueil pour qu'il ne passe jamais par-dessus ni en dessous
  const hero = document.getElementById('hero-accueil-non-connecte');
  if (hero && options.masquerHero !== false) {
    hero.classList.add('hidden');
  }

  // 3. Afficher la modale cible
  modal.classList.remove('hidden');
  modaleActive = modal;
  document.body.classList.add('modal-open');

  // 4. Donner le focus au premier champ texte ou bouton de fermeture
  const focusable = modal.querySelector('input:not([readonly]), button.btn-primary, button.btn-modal-close');
  if (focusable) {
    setTimeout(() => focusable.focus(), 50);
  }
}

/**
 * Ferme une modale spécifique
 * @param {HTMLElement|string} cible
 */
export function fermerModale(cible) {
  const modal = typeof cible === 'string' ? document.getElementById(cible) : cible;
  if (!modal) return;

  modal.classList.add('hidden');
  if (modaleActive === modal) {
    modaleActive = null;
  }

  // Si aucune modale n'est désormais visible
  const autreModaleVisible = document.querySelector('.modal-backdrop:not(.hidden)');
  if (!autreModaleVisible) {
    document.body.classList.remove('modal-open');

    // Si l'utilisateur n'est pas connecté et qu'on est en mode démo, réafficher le hero d'accueil
    const d = droits();
    if (!d.connecte && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1') {
      const hero = document.getElementById('hero-accueil-non-connecte');
      if (hero) hero.classList.remove('hidden');
      const map = document.getElementById('map');
      if (map) map.classList.add('blurred-map');
    }
  }
}

/**
 * Initialise les écouteurs globaux pour toutes les croix de fermeture,
 * les clics extérieurs (backdrop) et la touche Échap.
 */
export function initialiserGestionnaireModales() {
  // 1. Délégation globale de clic sur les boutons de fermeture
  document.addEventListener('click', (e) => {
    // Bouton de découverte invité
    if (e.target.id === 'btn-hero-decouverte') {
      e.preventDefault();
      const hero = document.getElementById('hero-accueil-non-connecte');
      if (hero) hero.classList.add('hidden');
      document.getElementById('map')?.classList.remove('blurred-map');
      return;
    }

    // Bouton de fermeture générique
    const btnClose = e.target.closest('.btn-modal-close, [data-close-modal], .btn-close-compte-modal');
    if (btnClose) {
      e.preventDefault();
      e.stopPropagation();

      // Cas spécifique : fermeture de l'écran d'accueil invité
      if (btnClose.id === 'btn-fermer-hero' || btnClose.closest('#hero-accueil-non-connecte')) {
        const hero = document.getElementById('hero-accueil-non-connecte');
        if (hero) hero.classList.add('hidden');
        document.getElementById('map')?.classList.remove('blurred-map');
        return;
      }

      const modal = btnClose.closest('.modal-backdrop, .panneau-demo-drawer');
      if (modal) {
        if (modal.classList.contains('panneau-demo-drawer')) {
          modal.classList.add('hidden');
        } else {
          fermerModale(modal);
        }
      }
      return;
    }

    // Clic sur l'arrière-plan flouté (#hero-accueil-non-connecte)
    if (e.target.id === 'hero-accueil-non-connecte') {
      e.preventDefault();
      e.target.classList.add('hidden');
      document.getElementById('map')?.classList.remove('blurred-map');
      return;
    }

    // Clic sur l'arrière-plan flouté (.modal-backdrop) à l'extérieur de la carte
    if (e.target.classList.contains('modal-backdrop')) {
      // Vérifier si la modale interdit la fermeture extérieure (ex: avertissement obligatoire)
      if (e.target.dataset.noBackdropClose === 'true') {
        return;
      }
      e.preventDefault();
      fermerModale(e.target);
    }
  });

  // 2. Touche Échap pour fermer la fenêtre active ou annuler le placement
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      // 0. Annuler le mode de positionnement manuel sur la carte si actif
      if (document.body.classList.contains('mode-positionnement-actif')) {
        const btnAnnuler = document.getElementById('btn-annuler-positionnement');
        if (btnAnnuler) {
          btnAnnuler.click();
        } else if (window.__meschampis?.carnet?.annulerPlacementCarte) {
          window.__meschampis.carnet.annulerPlacementCarte();
        }
        return;
      }

      // 1. Fermer le tiroir démo si ouvert
      const drawerDemo = document.getElementById('panneau-demo-drawer');
      if (drawerDemo && !drawerDemo.classList.contains('hidden')) {
        drawerDemo.classList.add('hidden');
        return;
      }

      // 2. Fermer la modale active prioritairement
      const modaleOuverte = document.querySelector('.modal-backdrop:not(.hidden)');
      if (modaleOuverte) {
        if (modaleOuverte.dataset.noBackdropClose !== 'true') {
          fermerModale(modaleOuverte);
        }
        return;
      }

      // 3. Fermer l'accueil hero si ouvert
      const hero = document.getElementById('hero-accueil-non-connecte');
      if (hero && !hero.classList.contains('hidden')) {
        hero.classList.add('hidden');
        document.getElementById('map')?.classList.remove('blurred-map');
        return;
      }

      // 4. Fermer le panneau latéral mobile si ouvert
      const sidePanel = document.getElementById('side-panel');
      if (sidePanel && sidePanel.classList.contains('open')) {
        sidePanel.classList.remove('open');
        return;
      }
    }
  });
}
