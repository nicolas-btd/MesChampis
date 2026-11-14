/**
 * MesChampis — Client API Réelle (Étape 6)
 * Actuellement vide / non disponible : sera implémenté lors du déploiement du vrai serveur.
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
  throw new ErreurApi('NON_DISPONIBLE', 'Le serveur réel sera disponible à l\'étape 6.');
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

export async function droits() {
  return {
    connecte: false,
    email: null,
    premium: false,
    essai_debut: null,
    essai_fin: null,
    essai_utilise: false,
    statut_abonnement: 'aucun'
  };
}

export async function demarrerEssai() {
  nonDisponible();
}

export async function creerSessionPaiement(offre) {
  nonDisponible();
}

export async function portailClient() {
  nonDisponible();
}

export async function supprimerCompte() {
  nonDisponible();
}
