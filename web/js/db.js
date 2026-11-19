/**
 * Module de persistance locale IndexedDB et chiffrement de sauvegarde
 * MesChampis — Carnet de cueillette 100% privé
 */

const estModeDemoUrl = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
const DB_NOM_DEFAUT = estModeDemoUrl ? 'meschampis_db_demo' : 'meschampis_db';
const DB_VERSION = 2; // Version 2 pour indexer espece_nom, date et type

let nomBaseDefaut = DB_NOM_DEFAUT;
const connexionsOuvertes = new Map();

/**
 * Configure le nom de base par défaut pour le module
 * @param {string} nom
 */
export function definirNomBaseDefaut(nom) {
  nomBaseDefaut = nom || DB_NOM_DEFAUT;
}

/**
 * Récupère le nom de base par défaut
 * @returns {string}
 */
export function obtenirNomBaseDefaut() {
  return nomBaseDefaut;
}

/**
 * Ferme une connexion ouverte et la retire du cache
 * @param {string} [nom]
 */
export async function fermerBase(nom = nomBaseDefaut) {
  if (connexionsOuvertes.has(nom)) {
    try {
      const db = await connexionsOuvertes.get(nom);
      db.close();
    } catch (e) {}
    connexionsOuvertes.delete(nom);
  }
}

/**
 * Ouvre ou met à niveau la base de données IndexedDB
 * @param {string} [nom='meschampis_db']
 * @returns {Promise<IDBDatabase>}
 */
export function ouvrirBase(nom = nomBaseDefaut) {
  const nomCible = nom || nomBaseDefaut;

  // Garde-fou strict Démo : interdiction absolue d'accéder à meschampis_db en mode démo
  if (nomCible === 'meschampis_db' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1') {
    const msg = "GARDE-FOU DÉMO ENCLENCHÉ : Interdiction absolue d'accéder à 'meschampis_db' en mode démo !";
    console.error(msg);
    throw new Error(msg);
  }

  if (connexionsOuvertes.has(nomCible)) {
    return connexionsOuvertes.get(nomCible);
  }

  const promise = new Promise((resolve, reject) => {
    const request = indexedDB.open(nomCible, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Store meta (paramètres, persistance, flags)
      if (!db.objectStoreNames.contains('meta')) {
        const metaStore = db.createObjectStore('meta', { keyPath: 'id' });
        metaStore.add({ id: 'contribution_autorisee', valeur: false });
        metaStore.add({ id: 'config', contribution_autorisee: false });
        metaStore.add({ id: 'stockage_persistant', valeur: false });
      }

      // 2. Store cueillettes (carnet personnel)
      let cueilStore;
      if (!db.objectStoreNames.contains('cueillettes')) {
        cueilStore = db.createObjectStore('cueillettes', { keyPath: 'id' });
      } else {
        cueilStore = event.target.transaction.objectStore('cueillettes');
      }

      // Index demandés : date, espece_nom, type
      if (!cueilStore.indexNames.contains('date')) {
        cueilStore.createIndex('date', 'date', { unique: false });
      }
      if (!cueilStore.indexNames.contains('espece_nom')) {
        cueilStore.createIndex('espece_nom', 'espece_nom', { unique: false });
      }
      if (!cueilStore.indexNames.contains('type')) {
        cueilStore.createIndex('type', 'type', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      db.onclose = () => {
        connexionsOuvertes.delete(nomCible);
      };
      db.onversionchange = () => {
        try {
          db.close();
        } catch (e) {}
        connexionsOuvertes.delete(nomCible);
      };

      // S'assurer de la présence des entrées meta par défaut
      const tx = db.transaction('meta', 'readwrite');
      const metaStore = tx.objectStore('meta');
      const reqGet = metaStore.get('contribution_autorisee');
      reqGet.onsuccess = () => {
        if (!reqGet.result) {
          metaStore.put({ id: 'contribution_autorisee', valeur: false });
        }
      };

      resolve(db);
    };

    request.onerror = (event) => {
      console.error(`[IndexedDB] Erreur ouverture base '${nomCible}' :`, event.target.error);
      connexionsOuvertes.delete(nomCible);
      reject(event.target.error);
    };
  });

  connexionsOuvertes.set(nomCible, promise);
  return promise;
}

export const ouvrirDB = ouvrirBase;

/**
 * Récupère une valeur du store 'meta'
 * @param {string} id
 * @param {string} [nomBase]
 * @returns {Promise<any>}
 */
export async function obtenirMeta(id, nomBase = nomBaseDefaut) {
  const db = await ouvrirBase(nomBase);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readonly');
    const store = tx.objectStore('meta');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ? (req.result.valeur !== undefined ? req.result.valeur : req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Enregistre une valeur dans le store 'meta'
 * @param {string} id
 * @param {any} valeur
 * @param {string} [nomBase]
 * @returns {Promise<void>}
 */
export async function definirMeta(id, valeur, nomBase = nomBaseDefaut) {
  const db = await ouvrirBase(nomBase);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    const req = store.put({ id, valeur, modifie_le: new Date().toISOString() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Tente d'activer le stockage persistant via l'API StorageManager
 * @param {string} [nomBase]
 * @returns {Promise<boolean>}
 */
export async function demanderPersistance(nomBase = nomBaseDefaut) {
  if (navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persist();
      await definirMeta('stockage_persistant', isPersisted, nomBase);
      return isPersisted;
    } catch (e) {
      console.warn('[Storage] Impossible de demander la persistance :', e);
    }
  }
  return false;
}

/**
 * Ajoute une observation de cueillette dans IndexedDB
 * @param {object} donnee
 * @param {string} [nomBase]
 * @returns {Promise<object>} L'enregistrement complet créé
 */
export async function ajouterCueillette(donnee, nomBase = nomBaseDefaut) {
  const db = await ouvrirBase(nomBase);

  const maintenant = new Date().toISOString();
  const id = donnee.id || crypto.randomUUID();

  const especeObj = donnee.type === 'rien' ? null : (donnee.espece || null);
  const especeNom = especeObj ? (typeof especeObj === 'string' ? especeObj : especeObj.nom) : null;
  const especeLatin = especeObj && typeof especeObj === 'object' ? (especeObj.latin || null) : null;

  let cellule = donnee.cellule || null;
  if (cellule && typeof cellule.then === 'function') {
    cellule = await cellule;
  }

  const item = {
    id,
    cree_le: donnee.cree_le || maintenant,
    modifie_le: maintenant,
    date: donnee.date || maintenant.slice(0, 10),
    type: donnee.type === 'rien' ? 'rien' : 'trouve',
    espece: especeObj ? { nom: especeNom, latin: especeLatin } : null,
    espece_nom: especeNom,
    quantite: donnee.type === 'rien' ? null : (donnee.quantite || '1-5'),
    lon: Number(donnee.lon),
    lat: Number(donnee.lat),
    precision_m: donnee.precision_m !== undefined ? donnee.precision_m : null,
    source_position: donnee.source_position === 'gps' ? 'gps' : 'carte',
    arbres: Array.isArray(donnee.arbres) ? donnee.arbres : [],
    milieu: Array.isArray(donnee.milieu) ? donnee.milieu : [],
    note: donnee.note || '',
    cellule
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction('cueillettes', 'readwrite');
    const store = tx.objectStore('cueillettes');
    const req = store.add(item);
    req.onsuccess = async () => {
      // Après le premier enregistrement réussi : demander la persistance si pas encore fait
      try {
        const dejaPersistant = await obtenirMeta('stockage_persistant', nomBase);
        if (dejaPersistant === null || dejaPersistant === false) {
          demanderPersistance(nomBase).catch(() => {});
        }
      } catch (e) {}
      resolve(item);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Modifie une cueillette existante
 * @param {string} id
 * @param {object} modifications
 * @param {string} [nomBase]
 * @returns {Promise<object>} L'enregistrement mis à jour
 */
export async function modifierCueillette(id, modifications, nomBase = nomBaseDefaut) {
  const db = await ouvrirBase(nomBase);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cueillettes', 'readwrite');
    const store = tx.objectStore('cueillettes');
    const reqGet = store.get(id);

    reqGet.onsuccess = () => {
      const existant = reqGet.result;
      if (!existant) {
        reject(new Error(`Cueillette ${id} introuvable`));
        return;
      }

      const maj = {
        ...existant,
        ...modifications,
        id, // Empêche l'altération de l'id
        modifie_le: new Date().toISOString()
      };

      if (maj.type === 'rien') {
        maj.espece = null;
        maj.espece_nom = null;
        maj.quantite = null;
      } else if (maj.espece) {
        maj.espece_nom = typeof maj.espece === 'string' ? maj.espece : (maj.espece.nom || null);
      }

      const reqPut = store.put(maj);
      reqPut.onsuccess = () => resolve(maj);
      reqPut.onerror = () => reject(reqPut.error);
    };

    reqGet.onerror = () => reject(reqGet.error);
  });
}

/**
 * Supprime une cueillette par son id
 * @param {string} id
 * @param {string} [nomBase]
 * @returns {Promise<void>}
 */
export async function supprimerCueillette(id, nomBase = nomBaseDefaut) {
  const db = await ouvrirBase(nomBase);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cueillettes', 'readwrite');
    const store = tx.objectStore('cueillettes');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Récupère une cueillette par son id
 * @param {string} id
 * @param {string} [nomBase]
 * @returns {Promise<object|null>}
 */
export async function obtenirCueillette(id, nomBase = nomBaseDefaut) {
  const db = await ouvrirBase(nomBase);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cueillettes', 'readonly');
    const store = tx.objectStore('cueillettes');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Liste les cueillettes enregistrées avec filtres optionnels
 * @param {object} [filtre] { type, espece_nom, annee }
 * @param {string} [nomBase]
 * @returns {Promise<Array<object>>} Triée de la plus récente à la plus ancienne
 */
export async function listerCueillettes(filtre = {}, nomBase = nomBaseDefaut) {
  const db = await ouvrirBase(nomBase);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cueillettes', 'readonly');
    const store = tx.objectStore('cueillettes');
    const req = store.getAll();

    req.onsuccess = () => {
      let items = req.result || [];

      if (filtre.type && filtre.type !== 'tous') {
        items = items.filter(i => i.type === filtre.type);
      }
      if (filtre.espece_nom) {
        const query = filtre.espece_nom.toLowerCase();
        items = items.filter(i => i.espece_nom && i.espece_nom.toLowerCase().includes(query));
      }
      if (filtre.annee && filtre.annee !== 'toutes') {
        items = items.filter(i => i.date && i.date.startsWith(String(filtre.annee)));
      }

      // Tri chronologique inversé (la plus récente d'abord)
      items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.cree_le || '').localeCompare(a.cree_le || ''));
      resolve(items);
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Compte le nombre de cueillettes selon un filtre
 * @param {object} [filtre]
 * @param {string} [nomBase]
 * @returns {Promise<{ total: number, trouve: number, rien: number, especesUniques: number }>}
 */
export async function compterCueillettes(filtre = {}, nomBase = nomBaseDefaut) {
  const items = await listerCueillettes(filtre, nomBase);
  const total = items.length;
  const trouve = items.filter(i => i.type === 'trouve').length;
  const rien = items.filter(i => i.type === 'rien').length;
  const especesSet = new Set(items.filter(i => i.type === 'trouve' && i.espece_nom).map(i => i.espece_nom));

  return {
    total,
    trouve,
    rien,
    especesUniques: especesSet.size
  };
}

/**
 * Vide le store 'cueillettes' de la base spécifiée (par défaut nomBaseDefaut)
 * @param {string} [nomBase=nomBaseDefaut]
 * @returns {Promise<boolean>}
 */
export async function viderBase(nomBase = nomBaseDefaut) {
  const db = await ouvrirBase(nomBase);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cueillettes', 'readwrite');
    const store = tx.objectStore('cueillettes');
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/* ==============================================================================
   Sauvegarde chiffrée .mcb (Web Crypto API native : PBKDF2 + AES-GCM 256 bits)
   ============================================================================== */

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Dérive une clé AES-GCM 256 bits depuis une phrase de passe et un sel
 */
async function deriverCle(passphrase, sel, iterations = 250000) {
  const enc = new TextEncoder();
  const rawKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: sel,
      iterations,
      hash: 'SHA-256'
    },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Exporte l'intégralité du carnet dans un conteneur chiffré .mcb
 * @param {string} passphrase Phrase de passe (min 10 caractères)
 * @returns {Promise<string>} Contenu JSON du fichier .mcb
/**
 * Chiffre un objet payload { cueillettes, meta } avec PBKDF2-SHA-256 (250 000 iter) et AES-GCM 256 bits
 * @param {string} passphrase Phrase ou mot de passe
 * @param {object} payload Objet contenant les données à chiffrer
 * @returns {Promise<string>} Contenu JSON au format .mcb
 */
export async function chiffrerSauvegarde(passphrase, payload) {
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error('Veuillez saisir une phrase ou un mot de passe.');
  }

  const enc = new TextEncoder();
  const payloadBytes = enc.encode(JSON.stringify(payload));

  const sel = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 250000;

  const cle = await deriverCle(passphrase, sel, iterations);

  const donneesChiffrees = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cle,
    payloadBytes
  );

  const mcb = {
    format: 'meschampis-sauvegarde',
    v: 1,
    kdf: {
      algo: 'PBKDF2-SHA-256',
      iterations,
      sel_b64: arrayBufferToBase64(sel)
    },
    iv_b64: arrayBufferToBase64(iv),
    cree_le: new Date().toISOString(),
    nb: (payload.cueillettes || []).length,
    donnees_b64: arrayBufferToBase64(donneesChiffrees)
  };

  return JSON.stringify(mcb, null, 2);
}

/**
 * Déchiffre une archive JSON .mcb avec la phrase de passe fournie
 * @param {string} mcbJsonText Contenu JSON du fichier .mcb
 * @param {string} passphrase Phrase de passe
 * @returns {Promise<object>} Payload déchiffré { cueillettes, meta }
 */
export async function dechiffrerSauvegarde(mcbJsonText, passphrase) {
  let enveloppe;
  try {
    enveloppe = typeof mcbJsonText === 'string' ? JSON.parse(mcbJsonText) : mcbJsonText;
  } catch (e) {
    throw new Error('Le fichier sélectionné n\'est pas un JSON valide.');
  }

  if (enveloppe.format !== 'meschampis-sauvegarde' || enveloppe.v !== 1) {
    throw new Error('Format de sauvegarde incompatible ou non reconnu (attendu : meschampis-sauvegarde v1).');
  }

  const sel = new Uint8Array(base64ToArrayBuffer(enveloppe.kdf.sel_b64));
  const iv = new Uint8Array(base64ToArrayBuffer(enveloppe.iv_b64));
  const donneesChiffrees = base64ToArrayBuffer(enveloppe.donnees_b64);
  const iterations = enveloppe.kdf.iterations || 250000;

  const cle = await deriverCle(passphrase, sel, iterations);

  let decryptedBytes;
  try {
    decryptedBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cle,
      donneesChiffrees
    );
  } catch (e) {
    throw new Error('Phrase de passe incorrecte ou fichier endommagé.');
  }

  const dec = new TextDecoder();
  const payloadStr = dec.decode(decryptedBytes);
  return JSON.parse(payloadStr);
}

/**
 * Fusionne deux listes d'observations par ID en conservant le `modifie_le` le plus récent
 * @param {Array} existantes Liste locale
 * @param {Array} aImporter Liste issue du fichier importé
 * @returns {{ ajoutees: number, mises_a_jour: number, ignorees: number, liste_finale: Array }}
 */
export function fusionnerCueillettesImport(existantes, aImporter) {
  let ajoutees = 0;
  let mises_a_jour = 0;
  let ignorees = 0;

  const map = new Map();
  for (const item of (existantes || [])) {
    if (item.id) map.set(item.id, item);
  }

  for (const item of (aImporter || [])) {
    if (!item.id) continue;
    if (!map.has(item.id)) {
      map.set(item.id, item);
      ajoutees++;
    } else {
      const existant = map.get(item.id);
      const dateModifImport = item.modifie_le || item.cree_le || '';
      const dateModifLocal = existant.modifie_le || existant.cree_le || '';

      if (dateModifImport > dateModifLocal) {
        map.set(item.id, item);
        mises_a_jour++;
      } else {
        ignorees++;
      }
    }
  }

  return {
    ajoutees,
    mises_a_jour,
    ignorees,
    liste_finale: Array.from(map.values())
  };
}

/**
 * Exporte l'intégralité du carnet et des métadonnées sous forme de fichier chiffré .mcb
 * @param {string} passphrase Phrase ou mot de passe
 * @param {string} [nomBase]
 * @returns {Promise<string>} Contenu JSON du fichier .mcb
 */
export async function exporterSauvegardeChiffree(passphrase, nomBase = nomBaseDefaut) {
  const db = await ouvrirBase(nomBase);
  const cueillettes = await listerCueillettes({}, nomBase);

  // Filtrer strictement les métadonnées exportées
  // À EXPORTER : contribution_autorisee
  // À NE PAS EXPORTER : dernier_export, compteur, messages vus, état persist
  const CLES_META_EXPORTABLES = new Set(['contribution_autorisee']);
  const metasBrutes = await new Promise((resolve) => {
    const tx = db.transaction('meta', 'readonly');
    const store = tx.objectStore('meta');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
  const metas = metasBrutes.filter(m => m && CLES_META_EXPORTABLES.has(m.id));

  const payload = {
    cueillettes,
    meta: metas,
    exporte_le: new Date().toISOString()
  };

  const mcbString = await chiffrerSauvegarde(passphrase, payload);
  return mcbString;
}

/**
 * Importe et déchiffre une sauvegarde .mcb, puis fusionne avec la base locale
 * @param {string} mcbJsonText Contenu JSON du fichier .mcb
 * @param {string} passphrase Phrase de passe utilisée pour le chiffrement
 * @param {string} [nomBase]
 * @returns {Promise<{ totalFichier: number, ajoutees: number, mises_a_jour: number, ignorees: number }>}
 */
export async function importerSauvegardeChiffree(mcbJsonText, passphrase, nomBase = nomBaseDefaut) {
  const payload = await dechiffrerSauvegarde(mcbJsonText, passphrase);
  const importCueillettes = Array.isArray(payload.cueillettes) ? payload.cueillettes : [];

  let ajoutees = 0;
  let mises_a_jour = 0;
  let ignorees = 0;

  const db = await ouvrirBase(nomBase);

  // Restauration des métadonnées (sans écraser un choix local existant)
  if (Array.isArray(payload.meta)) {
    for (const m of payload.meta) {
      if (!m || !m.id) continue;
      if (m.id === 'contribution_autorisee') {
        const local = await obtenirMeta('contribution_autorisee', nomBase);
        if (local === null && m.valeur !== undefined) {
          await definirMeta('contribution_autorisee', Boolean(m.valeur), nomBase);
        }
      }
    }
  }

  for (const item of importCueillettes) {
    if (!item.id) continue;
    const existant = await obtenirCueillette(item.id, nomBase);

    if (!existant) {
      // Nouvelle entrée
      await new Promise((resolve, reject) => {
        const tx = db.transaction('cueillettes', 'readwrite');
        const store = tx.objectStore('cueillettes');
        const req = store.add(item);
        req.onsuccess = () => { ajoutees++; resolve(); };
        req.onerror = () => reject(req.error);
      });
    } else {
      // Fusion par date de modification la plus récente
      const dateModifImport = item.modifie_le || item.cree_le || '';
      const dateModifLocal = existant.modifie_le || existant.cree_le || '';

      if (dateModifImport > dateModifLocal) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('cueillettes', 'readwrite');
          const store = tx.objectStore('cueillettes');
          const req = store.put(item);
          req.onsuccess = () => { mises_a_jour++; resolve(); };
          req.onerror = () => reject(req.error);
        });
      } else {
        ignorees++;
      }
    }
  }

  return {
    totalFichier: importCueillettes.length,
    ajoutees,
    mises_a_jour,
    ignorees
  };
}
