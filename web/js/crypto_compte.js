/**
 * MesChampis — Cryptographie client pour compte et sauvegarde chiffrée (Étape 3 / 6)
 * Architecture Zero-Knowledge :
 * - Clé maître AES-256 aléatoire
 * - Double enveloppe :
 *     1) enveloppe_mdp (dérivée du mot de passe avec sel propre)
 *     2) enveloppe_secours (dérivée d'un code de secours lisible)
 * - Dérivation séparée pour l'authentification (empreinte_auth transmise au serveur)
 * - Bloc carnet chiffré par la clé maître
 */

const ALGO_AES = 'AES-GCM';
const ITERATIONS_PBKDF2 = 250000;
const HASH_PBKDF2 = 'SHA-256';

// Cache volatile en mémoire pour la session active
let cleMaitreActive = null;

// Alphabet sans caractères ambigus (pas de 0, O, 1, I)
const ALPHABET_SECOURS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Utilitaires Base64 <-> ArrayBuffer
 */
function bufferVersB64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function b64VersBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function stringVersBuffer(str) {
  return new TextEncoder().encode(str);
}

function bufferVersString(buffer) {
  return new TextDecoder().decode(buffer);
}

function bufferVersHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Génère un sel cryptographique aléatoire
 * @param {number} tailleOctets
 * @returns {Uint8Array}
 */
export function genererSel(tailleOctets = 16) {
  return crypto.getRandomValues(new Uint8Array(tailleOctets));
}

/**
 * Génère un code de secours lisible de 6 groupes de 4 caractères
 * Exemple : "7D4F-9K2M-P8X3-N5R6-W4Y7-2B9C"
 * @returns {string}
 */
export function genererCodeSecours() {
  const octets = crypto.getRandomValues(new Uint8Array(24));
  const groupes = [];
  for (let g = 0; g < 6; g++) {
    let groupe = '';
    for (let c = 0; c < 4; c++) {
      const idx = octets[g * 4 + c] % ALPHABET_SECOURS.length;
      groupe += ALPHABET_SECOURS[idx];
    }
    groupes.push(groupe);
  }
  return groupes.join('-');
}

/**
 * Normalise un code de secours (retire tirets et espaces, passe en majuscules)
 * @param {string} code
 * @returns {string}
 */
export function normaliserCodeSecours(code) {
  return String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Dérive une clé CryptoKey via PBKDF2
 */
async function deriverClePBKDF2(secretString, sel, usage = ['encrypt', 'decrypt']) {
  const secretBuffer = stringVersBuffer(secretString);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    secretBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: sel,
      iterations: ITERATIONS_PBKDF2,
      hash: HASH_PBKDF2
    },
    baseKey,
    { name: ALGO_AES, length: 256 },
    true,
    usage
  );
}

/**
 * Calcule l'empreinte d'authentification à transmettre au serveur (dérivation séparée)
 * @param {string} motDePasse
 * @param {Uint8Array} selAuth
 * @returns {Promise<{ empreinteAuth: string, selAuthB64: string }>}
 */
export async function calculerEmpreinteAuth(motDePasse, selAuth = null) {
  const sel = selAuth || genererSel(16);
  // Dérivation d'une clé d'auth distincte
  const baseKey = await crypto.subtle.importKey(
    'raw',
    stringVersBuffer(motDePasse),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const authBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: sel,
      iterations: ITERATIONS_PBKDF2,
      hash: HASH_PBKDF2
    },
    baseKey,
    256
  );

  // SHA-256 de ces bits pour obtenir l'empreinte finale
  const hashDigest = await crypto.subtle.digest('SHA-256', authBits);
  const empreinteAuth = bufferVersHex(hashDigest);

  return {
    empreinteAuth,
    selAuthB64: bufferVersB64(sel)
  };
}

/**
 * Chiffre des données brutes avec une clé AES-GCM
 */
async function chiffrerEnveloppe(cleCrypto, donneeBuffer) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO_AES, iv },
    cleCrypto,
    donneeBuffer
  );

  return {
    iv_b64: bufferVersB64(iv),
    donnees_b64: bufferVersB64(ciphertext)
  };
}

/**
 * Déchiffre une enveloppe avec une clé AES-GCM
 */
async function dechiffrerEnveloppe(cleCrypto, ivB64, donneesB64) {
  const iv = b64VersBuffer(ivB64);
  const ciphertext = b64VersBuffer(donneesB64);
  return crypto.subtle.decrypt(
    { name: ALGO_AES, iv },
    cleCrypto,
    ciphertext
  );
}

/**
 * Crée un trousseau complet à l'inscription :
 * - Clé maître AES-256 aléatoire
 * - Enveloppe mot de passe
 * - Enveloppe code de secours
 * - Empreinte d'authentification
 *
 * @param {string} motDePasse
 * @param {string} codeSecours
 * @returns {Promise<{ cleMaitreRaw: Uint8Array, empreinteAuth: string, enveloppes: any }>}
 */
export async function creerTrousseauInscription(motDePasse, codeSecours) {
  // 1. Clé maître aléatoire de 256 bits
  const cleMaitreRaw = crypto.getRandomValues(new Uint8Array(32));

  // 2. Empreinte d'authentification
  const selAuth = genererSel(16);
  const { empreinteAuth, selAuthB64 } = await calculerEmpreinteAuth(motDePasse, selAuth);

  // 3. Enveloppe 1 : Clé dérivée du mot de passe
  const selMdp = genererSel(16);
  const cleMdp = await deriverClePBKDF2(motDePasse, selMdp);
  const envMdpChiffree = await chiffrerEnveloppe(cleMdp, cleMaitreRaw);

  const enveloppe_mdp = {
    algo: ALGO_AES,
    iv: envMdpChiffree.iv_b64,
    sel_kdf: bufferVersB64(selMdp),
    sel_auth: selAuthB64,
    iterations: ITERATIONS_PBKDF2,
    donnees: envMdpChiffree.donnees_b64
  };

  // 4. Enveloppe 2 : Clé dérivée du code de secours normalisé
  const codeNorm = normaliserCodeSecours(codeSecours);
  const selSecours = genererSel(16);
  const cleSecours = await deriverClePBKDF2(codeNorm, selSecours);
  const envSecoursChiffree = await chiffrerEnveloppe(cleSecours, cleMaitreRaw);

  const enveloppe_secours = {
    algo: ALGO_AES,
    iv: envSecoursChiffree.iv_b64,
    sel_kdf: bufferVersB64(selSecours),
    iterations: ITERATIONS_PBKDF2,
    donnees: envSecoursChiffree.donnees_b64
  };

  cleMaitreActive = cleMaitreRaw;

  return {
    cleMaitreRaw,
    empreinteAuth,
    enveloppes: {
      enveloppe_mdp,
      enveloppe_secours
    }
  };
}

/**
 * Ouvre l'enveloppe mot de passe pour retrouver la clé maître
 * @param {any} enveloppeMdp
 * @param {string} motDePasse
 * @returns {Promise<Uint8Array>}
 */
export async function ouvrirEnveloppeMdp(enveloppeMdp, motDePasse) {
  const selMdp = new Uint8Array(b64VersBuffer(enveloppeMdp.sel_kdf));
  const cleMdp = await deriverClePBKDF2(motDePasse, selMdp);

  try {
    const cleMaitreBuffer = await dechiffrerEnveloppe(
      cleMdp,
      enveloppeMdp.iv,
      enveloppeMdp.donnees
    );
    const cleMaitre = new Uint8Array(cleMaitreBuffer);
    cleMaitreActive = cleMaitre;
    return cleMaitre;
  } catch {
    throw new Error('Mot de passe incorrect ou enveloppe corrompue.');
  }
}

/**
 * Ouvre l'enveloppe de secours pour retrouver la clé maître
 * @param {any} enveloppeSecours
 * @param {string} codeSecours
 * @returns {Promise<Uint8Array>}
 */
export async function ouvrirEnveloppeSecours(enveloppeSecours, codeSecours) {
  const codeNorm = normaliserCodeSecours(codeSecours);
  const selSecours = new Uint8Array(b64VersBuffer(enveloppeSecours.sel_kdf));
  const cleSecours = await deriverClePBKDF2(codeNorm, selSecours);

  try {
    const cleMaitreBuffer = await dechiffrerEnveloppe(
      cleSecours,
      enveloppeSecours.iv,
      enveloppeSecours.donnees
    );
    const cleMaitre = new Uint8Array(cleMaitreBuffer);
    cleMaitreActive = cleMaitre;
    return cleMaitre;
  } catch {
    throw new Error('Code de secours invalide ou enveloppe corrompue.');
  }
}

/**
 * Recrée une enveloppe mot de passe à partir d'une clé maître existante
 * (Utilisé lors du changement ou de la réinitialisation de mot de passe)
 * @param {Uint8Array} cleMaitreRaw
 * @param {string} nouveauMotDePasse
 * @returns {Promise<{ enveloppe_mdp: any, nouvelleEmpreinteAuth: string }>}
 */
export async function reenvelopperCleMaitre(cleMaitreRaw, nouveauMotDePasse) {
  const selAuth = genererSel(16);
  const { empreinteAuth, selAuthB64 } = await calculerEmpreinteAuth(nouveauMotDePasse, selAuth);

  const selMdp = genererSel(16);
  const cleMdp = await deriverClePBKDF2(nouveauMotDePasse, selMdp);
  const envChiffree = await chiffrerEnveloppe(cleMdp, cleMaitreRaw);

  const enveloppe_mdp = {
    algo: ALGO_AES,
    iv: envChiffree.iv_b64,
    sel_kdf: bufferVersB64(selMdp),
    sel_auth: selAuthB64,
    iterations: ITERATIONS_PBKDF2,
    donnees: envChiffree.donnees_b64
  };

  cleMaitreActive = cleMaitreRaw;

  return {
    enveloppe_mdp,
    nouvelleEmpreinteAuth: empreinteAuth
  };
}

/**
 * Chiffre la charge utile du carnet (payload identique au .mcb) avec la clé maître
 * @param {any} payload Objet { cueillettes, meta, exporte_le, ... }
 * @param {Uint8Array} [cleMaitre] Clé maître (ou clé active en session)
 * @returns {Promise<{ algo: string, iv: string, donnees: string }>}
 */
export async function chiffrerBlocCarnet(payload, cleMaitre = cleMaitreActive) {
  if (!cleMaitre) {
    throw new Error('Clé maître absente : connexion ou déverrouillage requis.');
  }

  const cleCrypto = await crypto.subtle.importKey(
    'raw',
    cleMaitre,
    { name: ALGO_AES },
    false,
    ['encrypt']
  );

  const jsonStr = JSON.stringify(payload);
  const jsonBuf = stringVersBuffer(jsonStr);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO_AES, iv },
    cleCrypto,
    jsonBuf
  );

  return {
    algo: ALGO_AES,
    iv: bufferVersB64(iv),
    donnees: bufferVersB64(ciphertext)
  };
}

/**
 * Déchiffre le bloc carnet avec la clé maître
 * @param {{ iv: string, donnees: string }} bloc
 * @param {Uint8Array} [cleMaitre]
 * @returns {Promise<any>} Payload restauré
 */
export async function dechiffrerBlocCarnet(bloc, cleMaitre = cleMaitreActive) {
  if (!cleMaitre) {
    throw new Error('Clé maître absente : connexion ou déverrouillage requis.');
  }

  const cleCrypto = await crypto.subtle.importKey(
    'raw',
    cleMaitre,
    { name: ALGO_AES },
    false,
    ['decrypt']
  );

  const iv = b64VersBuffer(bloc.iv);
  const ciphertext = b64VersBuffer(bloc.donnees);

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: ALGO_AES, iv },
    cleCrypto,
    ciphertext
  );

  const jsonStr = bufferVersString(decryptedBuf);
  return JSON.parse(jsonStr);
}

/**
 * Gère la clé maître en mémoire de session
 */
export function definirCleMaitreSession(cle) {
  cleMaitreActive = cle;
}

export function obtenirCleMaitreSession() {
  return cleMaitreActive;
}

export function purgerCleMaitreSession() {
  cleMaitreActive = null;
}
