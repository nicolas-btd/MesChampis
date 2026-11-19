/**
 * MesChampis — Contrat d'API (Client unifié)
 * Aiguille vers api_simulee.js en mode démo (?demo=1) ou api_reelle.js sinon.
 */

import * as apiReelle from './api_reelle.js';
import * as apiSimulee from './api_simulee.js';
import { ErreurApi } from './api_reelle.js';

export { ErreurApi };

/**
 * Détecte si l'application est en mode démonstration via l'URL
 * @returns {boolean}
 */
export function estModeDemo() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('demo') === '1';
}

function getBackend() {
  return estModeDemo() ? apiSimulee : apiReelle;
}

export async function inscrire(email, verifMdp, enveloppes) {
  return getBackend().inscrire(email, verifMdp, enveloppes);
}

export async function verifierEmail(jeton) {
  return getBackend().verifierEmail(jeton);
}

export async function connecter(email, verifMdp) {
  return getBackend().connecter(email, verifMdp);
}

export async function deconnecter() {
  return getBackend().deconnecter();
}

export async function demanderReinitialisation(email) {
  return getBackend().demanderReinitialisation(email);
}

export async function reinitialiser(jeton, nouvelleVerif, nouvelleEnveloppe = null) {
  return getBackend().reinitialiser(jeton, nouvelleVerif, nouvelleEnveloppe);
}

export async function lireEnveloppes() {
  return getBackend().lireEnveloppes();
}

export async function envoyerCarnet(bloc, version_attendue) {
  return getBackend().envoyerCarnet(bloc, version_attendue);
}

export async function telechargerCarnet() {
  return getBackend().telechargerCarnet();
}

export async function etatCompte() {
  return getBackend().etatCompte();
}

export async function supprimerCompte() {
  return getBackend().supprimerCompte();
}

export const serveurSimuleControl = {
  definirReseauCoupe: apiSimulee.definirReseauCoupe,
  estReseauCoupe: apiSimulee.estReseauCoupe,
  definirDecalageDateVirtuelle: apiSimulee.definirDecalageDateVirtuelle,
  dateVirtuelle: apiSimulee.dateVirtuelle,
  listerEmailsSimules: apiSimulee.listerEmailsSimules,
  purgerEmailsSimules: apiSimulee.purgerEmailsSimules,
  purgerServeurSimule: apiSimulee.purgerServeurSimule
};

