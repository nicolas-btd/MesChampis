/**
 * MesChampis — Serveur simulé (Mode Démo ?demo=1)
 * Simule fidèlement un backend REST avec base de données dédiée 'meschampis_serveur_simule'.
 * Zéro-knowledge : aucune clé ni donnée en clair n'est reçue ou enregistrée.
 */

import { ErreurApi } from './api_reelle.js';

export { ErreurApi };

const NOM_DB_SERVEUR = 'meschampis_serveur_simule';
const VERSION_DB_SERVEUR = 1;

let dbPromise = null;
let reseauCoupe = false;
let dateVirtuelleDecalageMs = 0;

/**
 * Obtient l'horodatage actuel, prenant en compte le décalage virtuel du panneau de démo
 * @returns {Date}
 */
export function dateVirtuelle() {
  return new Date(Date.now() + dateVirtuelleDecalageMs);
}

/**
 * Configure le décalage de la date virtuelle (en millisecondes)
 * @param {number} decalageMs
 */
export function definirDecalageDateVirtuelle(decalageMs) {
  dateVirtuelleDecalageMs = decalageMs;
}

/**
 * Active ou désactive la simulation de panne réseau (ex: zone blanche en forêt)
 * @param {boolean} etat
 */
export function definirReseauCoupe(etat) {
  reseauCoupe = Boolean(etat);
}

export function estReseauCoupe() {
  return reseauCoupe;
}

/**
 * Ouvre ou initialise la base IndexedDB du serveur simulé
 * @returns {Promise<IDBDatabase>}
 */
function ouvrirServeurDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NOM_DB_SERVEUR, VERSION_DB_SERVEUR);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('comptes')) {
        db.createObjectStore('comptes', { keyPath: 'email' });
      }
      if (!db.objectStoreNames.contains('carnets')) {
        db.createObjectStore('carnets', { keyPath: 'email' });
      }
      if (!db.objectStoreNames.contains('emails')) {
        db.createObjectStore('emails', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('session')) {
        db.createObjectStore('session', { keyPath: 'cle' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

/**
 * Simule la latence réseau (200 à 600 ms) et vérifie l'état de la connexion
 * @returns {Promise<void>}
 */
async function simulerReseau() {
  const delai = 200 + Math.random() * 400;
  await new Promise((r) => setTimeout(r, delai));
  if (reseauCoupe) {
    throw new ErreurApi('RESEAU', 'Connexion réseau impossible : serveur injoignable (hors-ligne).');
  }
}

// -----------------------------------------------------------------------------
// Gestion de la session active côté client / serveur
// -----------------------------------------------------------------------------
let sessionMemoire = null;

async function obtenirSession() {
  if (sessionMemoire) return sessionMemoire;
  try {
    const db = await ouvrirServeurDB();
    return new Promise((resolve) => {
      const tx = db.transaction('session', 'readonly');
      const store = tx.objectStore('session');
      const req = store.get('active');
      req.onsuccess = () => {
        sessionMemoire = req.result ? req.result.valeur : null;
        resolve(sessionMemoire);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function enregistrerSession(session) {
  sessionMemoire = session;
  const db = await ouvrirServeurDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('session', 'readwrite');
    const store = tx.objectStore('session');
    const req = session
      ? store.put({ cle: 'active', valeur: session })
      : store.delete('active');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// -----------------------------------------------------------------------------
// Endpoints d'authentification
// -----------------------------------------------------------------------------

/**
 * Inscription d'un nouveau compte
 */
export async function inscrire(email, verifMdp, enveloppes) {
  await simulerReseau();
  const emailNorm = String(email).trim().toLowerCase();
  const db = await ouvrirServeurDB();

  // Vérifier unicité
  const compteExistant = await new Promise((resolve) => {
    const tx = db.transaction('comptes', 'readonly');
    const store = tx.objectStore('comptes');
    const req = store.get(emailNorm);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  if (compteExistant) {
    throw new ErreurApi('EMAIL_DEJA_UTILISE', 'Un compte existe déjà avec cette adresse e-mail.');
  }

  const jetonVerif = crypto.randomUUID();
  const nouveauCompte = {
    email: emailNorm,
    empreinte_auth: verifMdp,
    enveloppe_mdp: enveloppes.enveloppe_mdp,
    enveloppe_secours: enveloppes.enveloppe_secours,
    email_verifie: false,
    jeton_verif: jetonVerif,
    jeton_reinit: null,
    cree_le: dateVirtuelle().toISOString(),
    essai_debut: null,
    essai_fin: null,
    premium_fin: null,
    statut_abonnement: 'aucun'
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction('comptes', 'readwrite');
    const store = tx.objectStore('comptes');
    const req = store.add(nouveauCompte);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // Ajouter l'e-mail de confirmation dans la messagerie simulée
  const urlValidation = `?demo=1&action=verifier-email&jeton=${jetonVerif}`;
  await ajouterEmailSimule({
    email: emailNorm,
    type: 'verification',
    sujet: 'Confirmez votre compte MesChampis',
    corps: `Bienvenue sur MesChampis ! Cliquez sur le lien ci-dessous pour activer votre sauvegarde chiffrée.`,
    jeton: jetonVerif,
    url_action: urlValidation
  });

  return {
    succes: true,
    email: emailNorm,
    email_verifie: false,
    message: 'Compte créé avec succès. Vérifiez vos e-mails pour l\'activer.'
  };
}

/**
 * Validation de l'e-mail par jeton
 */
export async function verifierEmail(jeton) {
  await simulerReseau();
  const db = await ouvrirServeurDB();

  const comptes = await new Promise((resolve) => {
    const tx = db.transaction('comptes', 'readonly');
    const store = tx.objectStore('comptes');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });

  const compte = comptes.find((c) => c.jeton_verif === jeton);
  if (!compte) {
    throw new ErreurApi('JETON_INVALIDE', 'Lien de validation expiré ou invalide.');
  }

  compte.email_verifie = true;
  compte.jeton_verif = null;

  await new Promise((resolve, reject) => {
    const tx = db.transaction('comptes', 'readwrite');
    const store = tx.objectStore('comptes');
    const req = store.put(compte);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // Connecter automatiquement après validation
  const session = { email: compte.email, jeton_session: crypto.randomUUID() };
  await enregistrerSession(session);

  return { succes: true, email: compte.email, email_verifie: true };
}

/**
 * Connexion par e-mail et empreinte d'authentification
 */
export async function connecter(email, verifMdp) {
  await simulerReseau();
  const emailNorm = String(email).trim().toLowerCase();
  const db = await ouvrirServeurDB();

  const compte = await new Promise((resolve) => {
    const tx = db.transaction('comptes', 'readonly');
    const store = tx.objectStore('comptes');
    const req = store.get(emailNorm);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  if (!compte) {
    throw new ErreurApi('COMPTE_NON_TROUVE', 'Aucun compte associé à cette adresse e-mail.');
  }

  if (compte.empreinte_auth !== verifMdp) {
    throw new ErreurApi('IDENTIFIANTS_INVALIDES', 'Adresse e-mail ou mot de passe incorrect.');
  }

  if (!compte.email_verifie) {
    throw new ErreurApi('EMAIL_NON_VERIFIE', 'Veuillez valider votre adresse e-mail avant de vous connecter.');
  }

  const session = { email: compte.email, jeton_session: crypto.randomUUID() };
  await enregistrerSession(session);

  return {
    succes: true,
    session,
    enveloppes: {
      enveloppe_mdp: compte.enveloppe_mdp,
      enveloppe_secours: compte.enveloppe_secours
    }
  };
}

/**
 * Déconnexion de l'utilisateur
 */
export async function deconnecter() {
  await simulerReseau();
  await enregistrerSession(null);
  return { succes: true };
}

/**
 * Demande de réinitialisation de mot de passe
 */
export async function demanderReinitialisation(email) {
  await simulerReseau();
  const emailNorm = String(email).trim().toLowerCase();
  const db = await ouvrirServeurDB();

  const compte = await new Promise((resolve) => {
    const tx = db.transaction('comptes', 'readonly');
    const store = tx.objectStore('comptes');
    const req = store.get(emailNorm);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  if (compte) {
    const jetonReinit = crypto.randomUUID();
    compte.jeton_reinit = jetonReinit;

    await new Promise((resolve) => {
      const tx = db.transaction('comptes', 'readwrite');
      const store = tx.objectStore('comptes');
      const req = store.put(compte);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });

    const urlReinit = `?demo=1&action=reinitialiser&jeton=${jetonReinit}`;
    await ajouterEmailSimule({
      email: emailNorm,
      type: 'reinitialisation',
      sujet: 'Réinitialisation de votre mot de passe MesChampis',
      corps: `Une demande de réinitialisation de mot de passe a été émise. Utilisez ce lien pour définir votre nouveau mot de passe.`,
      jeton: jetonReinit,
      url_action: urlReinit
    });
  }

  return {
    succes: true,
    message: 'Si cette adresse existe, un lien de réinitialisation a été envoyé.'
  };
}

/**
 * Réinitialisation effective
 */
export async function reinitialiser(jeton, nouvelleVerif, nouvelleEnveloppeMdp = null) {
  await simulerReseau();
  const db = await ouvrirServeurDB();

  const comptes = await new Promise((resolve) => {
    const tx = db.transaction('comptes', 'readonly');
    const store = tx.objectStore('comptes');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });

  const compte = comptes.find((c) => c.jeton_reinit === jeton);
  if (!compte) {
    throw new ErreurApi('JETON_INVALIDE', 'Lien de réinitialisation expiré ou invalide.');
  }

  compte.empreinte_auth = nouvelleVerif;
  if (nouvelleEnveloppeMdp) {
    compte.enveloppe_mdp = nouvelleEnveloppeMdp;
  }
  compte.jeton_reinit = null;

  await new Promise((resolve, reject) => {
    const tx = db.transaction('comptes', 'readwrite');
    const store = tx.objectStore('comptes');
    const req = store.put(compte);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  return { succes: true };
}

/**
 * Récupère les enveloppes chiffrées du compte actif
 */
export async function lireEnveloppes() {
  await simulerReseau();
  const session = await obtenirSession();
  if (!session) {
    throw new ErreurApi('NON_AUTHENTIFIE', 'Vous devez être connecté.');
  }

  const db = await ouvrirServeurDB();
  const compte = await new Promise((resolve) => {
    const tx = db.transaction('comptes', 'readonly');
    const store = tx.objectStore('comptes');
    const req = store.get(session.email);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  if (!compte) {
    throw new ErreurApi('COMPTE_NON_TROUVE', 'Compte introuvable.');
  }

  return {
    enveloppe_mdp: compte.enveloppe_mdp,
    enveloppe_secours: compte.enveloppe_secours
  };
}

/**
 * Supprime le compte et toutes ses données chiffrées
 */
export async function supprimerCompte() {
  await simulerReseau();
  const session = await obtenirSession();
  if (!session) {
    throw new ErreurApi('NON_AUTHENTIFIE', 'Vous devez être connecté.');
  }

  const db = await ouvrirServeurDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['comptes', 'carnets', 'session'], 'readwrite');
    tx.objectStore('comptes').delete(session.email);
    tx.objectStore('carnets').delete(session.email);
    tx.objectStore('session').delete('active');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  sessionMemoire = null;
  return { succes: true };
}

// -----------------------------------------------------------------------------
// Synchronisation du carnet (Push & Pull)
// -----------------------------------------------------------------------------

/**
 * Envoie le bloc carnet chiffré au serveur simulé (Push)
 */
export async function envoyerCarnet(bloc, version_attendue = 0) {
  await simulerReseau();
  const session = await obtenirSession();
  if (!session) {
    throw new ErreurApi('NON_AUTHENTIFIE', 'Connexion requise pour sauvegarder le carnet.');
  }

  const db = await ouvrirServeurDB();

  const carnetExistant = await new Promise((resolve) => {
    const tx = db.transaction('carnets', 'readonly');
    const store = tx.objectStore('carnets');
    const req = store.get(session.email);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  const versionActuelle = carnetExistant ? carnetExistant.version : 0;

  // Détection de conflit de concurrence
  if (version_attendue !== versionActuelle) {
    throw new ErreurApi('CONFLIT', 'Une version plus récente du carnet existe sur le serveur.', {
      version_actuelle: versionActuelle
    });
  }

  const nouvelleVersion = versionActuelle + 1;
  const maintenant = dateVirtuelle().toISOString();

  await new Promise((resolve, reject) => {
    const tx = db.transaction('carnets', 'readwrite');
    const store = tx.objectStore('carnets');
    const req = store.put({
      email: session.email,
      version: nouvelleVersion,
      bloc,
      modifie_le: maintenant
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  return {
    succes: true,
    version: nouvelleVersion,
    synchronise_le: maintenant
  };
}

/**
 * Télécharge le bloc carnet chiffré depuis le serveur simulé (Pull)
 */
export async function telechargerCarnet() {
  await simulerReseau();
  const session = await obtenirSession();
  if (!session) {
    throw new ErreurApi('NON_AUTHENTIFIE', 'Connexion requise pour récupérer le carnet.');
  }

  const db = await ouvrirServeurDB();
  const carnet = await new Promise((resolve) => {
    const tx = db.transaction('carnets', 'readonly');
    const store = tx.objectStore('carnets');
    const req = store.get(session.email);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  if (!carnet) {
    return { version: 0, bloc: null, modifie_le: null };
  }

  return {
    version: carnet.version,
    bloc: carnet.bloc,
    modifie_le: carnet.modifie_le
  };
}

// -----------------------------------------------------------------------------
// Droits, Essai gratuit & Abonnements Stripe
// -----------------------------------------------------------------------------

/**
 * Récupère l'état des droits et abonnements
 */
export async function droits() {
  const session = await obtenirSession();
  if (!session) {
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

  const db = await ouvrirServeurDB();
  const compte = await new Promise((resolve) => {
    const tx = db.transaction('comptes', 'readonly');
    const store = tx.objectStore('comptes');
    const req = store.get(session.email);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  if (!compte) {
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

  const maintenant = dateVirtuelle().getTime();

  // Vérifier si premium actif
  let estPremium = false;
  if (compte.premium_fin) {
    const finP = new Date(compte.premium_fin).getTime();
    if (!isNaN(finP) && maintenant < finP) {
      estPremium = true;
    }
  }

  // Vérifier si essai actif
  let essaiEnCours = false;
  if (compte.essai_fin) {
    const finE = new Date(compte.essai_fin).getTime();
    if (!isNaN(finE) && maintenant < finE) {
      essaiEnCours = true;
    }
  }

  return {
    connecte: true,
    email: compte.email,
    premium: estPremium,
    essai_debut: compte.essai_debut,
    essai_fin: compte.essai_fin,
    essai_actif: essaiEnCours,
    essai_utilise: Boolean(compte.essai_debut),
    statut_abonnement: compte.statut_abonnement || (estPremium ? 'actif' : 'aucun')
  };
}

/**
 * Déclenche l'essai de 7 jours
 */
export async function demarrerEssai() {
  await simulerReseau();
  const session = await obtenirSession();
  if (!session) {
    throw new ErreurApi('NON_AUTHENTIFIE', 'Connexion requise pour démarrer l\'essai.');
  }

  const db = await ouvrirServeurDB();
  const compte = await new Promise((resolve) => {
    const tx = db.transaction('comptes', 'readonly');
    const store = tx.objectStore('comptes');
    const req = store.get(session.email);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  if (!compte) {
    throw new ErreurApi('COMPTE_NON_TROUVE', 'Compte introuvable.');
  }

  if (compte.essai_debut) {
    throw new ErreurApi('ESSAI_DEJA_UTILISE', 'L\'essai de 7 jours a déjà été activé pour ce compte.');
  }

  const debut = dateVirtuelle();
  const fin = new Date(debut.getTime() + 7 * 86400000);

  compte.essai_debut = debut.toISOString();
  compte.essai_fin = fin.toISOString();

  await new Promise((resolve, reject) => {
    const tx = db.transaction('comptes', 'readwrite');
    const store = tx.objectStore('comptes');
    const req = store.put(compte);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  return {
    succes: true,
    essai_debut: compte.essai_debut,
    essai_fin: compte.essai_fin
  };
}

/**
 * Création d'une session de paiement factice
 */
export async function creerSessionPaiement(offre = 'pass_saison') {
  await simulerReseau();
  const session = await obtenirSession();
  if (!session) {
    throw new ErreurApi('NON_AUTHENTIFIE', 'Connexion requise pour souscrire.');
  }

  return {
    session_url: '#modal-paiement-stripe',
    session_id: 'cs_demo_' + Date.now(),
    offre
  };
}

export async function portailClient() {
  await simulerReseau();
  return { url: '#modal-reglages' };
}

// -----------------------------------------------------------------------------
// Outils de simulation pour le Panneau Démo (D6)
// -----------------------------------------------------------------------------

async function ajouterEmailSimule({ email, type, sujet, corps, jeton, url_action }) {
  const db = await ouvrirServeurDB();
  const record = {
    date: dateVirtuelle().toISOString(),
    email,
    type,
    sujet,
    corps,
    jeton,
    url_action,
    lu: false
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction('emails', 'readwrite');
    const store = tx.objectStore('emails');
    const req = store.add(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // Déclencher un événement dans la fenêtre pour que le panneau se mette à jour immédiatement
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('meschampis:email-recu', { detail: record }));
  }
}

export async function listerEmailsSimules() {
  const db = await ouvrirServeurDB();
  return new Promise((resolve) => {
    const tx = db.transaction('emails', 'readonly');
    const store = tx.objectStore('emails');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

export async function purgerEmailsSimules() {
  const db = await ouvrirServeurDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('emails', 'readwrite');
    const store = tx.objectStore('emails');
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Simule la réception d'un webhook Stripe (succès ou échec de paiement)
 */
export async function simulerWebhookPaiement(email, statut = 'succes', finMois = 12) {
  const emailNorm = String(email).trim().toLowerCase();
  const db = await ouvrirServeurDB();

  const compte = await new Promise((resolve) => {
    const tx = db.transaction('comptes', 'readonly');
    const store = tx.objectStore('comptes');
    const req = store.get(emailNorm);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  if (!compte) {
    throw new ErreurApi('COMPTE_NON_TROUVE', 'Compte introuvable pour ce webhook.');
  }

  if (statut === 'succes') {
    const debut = dateVirtuelle();
    const fin = new Date(debut.getTime() + finMois * 30 * 86400000);
    compte.premium_fin = fin.toISOString();
    compte.statut_abonnement = 'actif';
  } else {
    // Échec de paiement ou résiliation
    compte.statut_abonnement = 'paiement_refuse';
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction('comptes', 'readwrite');
    const store = tx.objectStore('comptes');
    const req = store.put(compte);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('meschampis:droits-modifies', { detail: { email: emailNorm, statut } }));
  }

  return { succes: true, statut, compte };
}

/**
 * Purge complète du serveur simulé
 */
export async function purgerServeurSimule() {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  sessionMemoire = null;
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(NOM_DB_SERVEUR);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
