/**
 * MesChampis — État du compte (connecté ou non, e-mail)
 * En mode démo (?demo=1), l'état est lu depuis le serveur simulé.
 * Sinon, l'application fonctionne en local sans compte.
 */

import { estModeDemo, etatCompte as apiEtatCompte } from './api.js';

let etatCache = null;

/**
 * Relit l'état du compte depuis l'API (serveur simulé en mode démo)
 * @returns {Promise<{ connecte: boolean, email: string|null }>}
 */
export async function rafraichirEtatCompte() {
  if (estModeDemo()) {
    try {
      etatCache = await apiEtatCompte();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('meschampis:compte-actualise', { detail: etatCache }));
      }
      return etatCache;
    } catch {
      return etatCompte();
    }
  }
  return etatCompte();
}

/**
 * Retourne l'état du compte connu en mémoire
 * @returns {{ connecte: boolean, email: string|null }}
 */
export function etatCompte() {
  if (estModeDemo() && etatCache) {
    return etatCache;
  }
  return { connecte: true, email: null };
}
