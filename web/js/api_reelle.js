/**
 * MesChampis — Client de l'API réelle
 * Le serveur n'est pas encore implémenté : chaque appel lève une erreur NON_DISPONIBLE.
 */

export class ErreurApi extends Error {
  /**
   * @param {string} code Code d'erreur typé (RESEAU, NON_AUTHENTIFIE, CONFLIT, etc.)
   * @param {string} message Description lisible
   * @param {any} [details] Informations complémentaires
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ErreurApi';
    this.code = code;
    this.details = details;
  }
}

function nonDisponible() {
  throw new ErreurApi('NON_DISPONIBLE', 'Le serveur de synchronisation n\'est pas encore disponible.');
}

export async function inscrire(email, verifMdp, enveloppes) {
  nonDisponible();
}

export async function verifierEmail(jeton) {
  nonDisponible();
}

export async function connecter(email, verifMdp) {
  nonDisponible();
}

export async function deconnecter() {
  nonDisponible();
}

export async function demanderReinitialisation(email) {
  nonDisponible();
}

export async function reinitialiser(jeton, nouvelleVerif, nouvelleEnveloppe = null) {
  nonDisponible();
}

export async function lireEnveloppes() {
  nonDisponible();
}

export async function envoyerCarnet(bloc, version_attendue) {
  nonDisponible();
}

export async function telechargerCarnet() {
  nonDisponible();
}

export async function etatCompte() {
  return { connecte: false, email: null };
}

export async function supprimerCompte() {
  nonDisponible();
}
