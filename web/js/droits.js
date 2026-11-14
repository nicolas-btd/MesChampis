/**
 * MesChampis — Module de gestion des droits et abonnements
 * En mode démo (?demo=1), les droits sont synchronisés avec le serveur simulé.
 * En mode classique / tests, les droits restent ouverts sans blocage.
 */

import { estModeDemo, droits as apiDroits } from './api.js';

let droitsCache = null;

/**
 * Actualise les droits depuis l'API (serveur simulé ou réel)
 * @returns {Promise<any>}
 */
export async function rafraichirDroits() {
  if (estModeDemo()) {
    try {
      droitsCache = await apiDroits();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('meschampis:droits-actualises', { detail: droitsCache }));
      }
      return droitsCache;
    } catch {
      return droits();
    }
  }
  return droits();
}

/**
 * Définit manuellement les droits en mémoire (pour le panneau démo)
 */
export function definirDroitsMemoire(nouveauxDroits) {
  droitsCache = Object.assign({}, droitsCache, nouveauxDroits);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('meschampis:droits-actualises', { detail: droitsCache }));
  }
}

/**
 * Retourne l'état des droits de l'utilisateur
 * @returns {{ connecte: boolean, email?: string|null, premium: boolean, essai_fin: string | null, essai_utilise: boolean, statut_abonnement?: string }}
 */
export function droits() {
  if (estModeDemo() && droitsCache) {
    return droitsCache;
  }
  return {
    connecte: true,
    premium: false,
    essai_fin: null,
    essai_utilise: false,
    statut_abonnement: 'aucun'
  };
}

/**
 * Vérifie si l'utilisateur a accès aux recommandations écologiques avancées / cartes de chaleur
 * @returns {boolean}
 */
export function peutVoirRecommandations() {
  const d = droits();
  if (d.premium) return true;
  if (d.essai_fin !== null) {
    const fin = new Date(d.essai_fin).getTime();
    if (!isNaN(fin) && Date.now() < fin) {
      return true;
    }
  }
  return false;
}
