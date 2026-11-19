/**
 * MesChampis — Module de synchronisation automatique du carnet
 * Gère le Push/Pull chiffré vers le serveur (simulé ou réel),
 * la résolution de conflit par fusion automatique et l'indicateur d'état.
 */

import * as api from './api.js';
import {
  obtenirCueillette,
  listerCueillettes,
  obtenirMeta,
  definirMeta
} from './db.js';
import {
  chiffrerBlocCarnet,
  dechiffrerBlocCarnet,
  obtenirCleMaitreSession
} from './crypto_compte.js';

let statutSync = 'inconnu'; // 'synchro', 'en_attente', 'hors_ligne', 'sync_en_cours'
let versionServeurConnue = 0;
let nbModifsEnAttente = 0;

/**
 * Met à jour le badge / indicateur de synchronisation dans l'interface
 */
export function notifierStatutSync(statut, details = '') {
  statutSync = statut;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('meschampis:sync-statut', {
      detail: { statut, details, nbModifs: nbModifsEnAttente, version: versionServeurConnue }
    }));
  }
}

export function obtenirStatutSync() {
  return { statut: statutSync, nbModifs: nbModifsEnAttente, version: versionServeurConnue };
}

export function incrementerModifsEnAttente() {
  nbModifsEnAttente++;
  notifierStatutSync('en_attente');
}

export function reinitialiserModifsEnAttente() {
  nbModifsEnAttente = 0;
}

/**
 * Exécute une synchronisation complète du carnet
 * @returns {Promise<{ succes: boolean, statut: string, message?: string }>}
 */
export async function synchroniserCarnet() {
  // Vérifier si connecté
  let d = null;
  try {
    d = await api.etatCompte();
  } catch {
    notifierStatutSync('hors_ligne', 'Réseau indisponible');
    return { succes: false, statut: 'hors_ligne' };
  }

  if (!d || !d.connecte) {
    notifierStatutSync('non_connecte');
    return { succes: false, statut: 'non_connecte' };
  }

  const cleMaitre = obtenirCleMaitreSession();
  if (!cleMaitre) {
    notifierStatutSync('verrouille', 'Clé maître requise');
    return { succes: false, statut: 'verrouille' };
  }

  notifierStatutSync('sync_en_cours');

  try {
    // 1. Récupérer les données locales
    const cueillettesLocales = await listerCueillettes();
    const versionLocaleStockee = (await obtenirMeta('version_carnet_serveur')) || 0;

    // Si la base locale est vide et sans version serveur enregistrée (ex: nouvel appareil ou téléphone perdu),
    // restaurer en priorité le carnet chiffré depuis le cloud
    if (cueillettesLocales.length === 0 && versionLocaleStockee === 0) {
      try {
        const rest = await restaurerDepuisServeur();
        if (rest && rest.total > 0) {
          return { succes: true, statut: 'synchro', version: rest.version };
        }
      } catch (e) {
        console.warn('[Sync] Restauration automatique sans effet :', e);
      }
    }

    const contribution_autorisee = await obtenirMeta('contribution_autorisee');

    const metas = [];
    if (contribution_autorisee !== null && contribution_autorisee !== undefined) {
      metas.push({ id: 'contribution_autorisee', valeur: contribution_autorisee });
    }

    const payloadLocal = {
      cueillettes: cueillettesLocales,
      meta: metas,
      exporte_le: new Date().toISOString()
    };

    // 2. Chiffrer le bloc carnet avec la clé maître
    const blocChiffre = await chiffrerBlocCarnet(payloadLocal, cleMaitre);

    // 3. Envoyer au serveur (Push) avec la version attendue
    let reponseEnvoi = null;
    try {
      reponseEnvoi = await api.envoyerCarnet(blocChiffre, versionLocaleStockee);
    } catch (err) {
      if (err.code === 'CONFLIT') {
        // Conflit : une version plus récente existe sur le serveur.
        // Télécharger, fusionner, puis ré-envoyer.
        return await resoudreConflitEtRenvoyer(cueillettesLocales, cleMaitre);
      }
      throw err;
    }

    // Succès
    versionServeurConnue = reponseEnvoi.version;
    await definirMeta('version_carnet_serveur', versionServeurConnue);
    await definirMeta('dernier_sync', reponseEnvoi.synchronise_le);
    nbModifsEnAttente = 0;

    notifierStatutSync('synchro', `Synchronisé à ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    return { succes: true, statut: 'synchro', version: versionServeurConnue };

  } catch (err) {
    if (err.code === 'RESEAU') {
      notifierStatutSync('hors_ligne', 'Réseau coupé');
      return { succes: false, statut: 'hors_ligne' };
    }
    console.warn('[Sync] Erreur :', err);
    notifierStatutSync('en_attente', err.message);
    return { succes: false, statut: 'en_attente', message: err.message };
  }
}

/**
 * Résout un conflit de concurrence en téléchargeant la version serveur, en fusionnant,
 * puis en renvoyant le carnet fusionné.
 */
async function resoudreConflitEtRenvoyer(cueillettesLocales, cleMaitre) {
  const carnetServeur = await api.telechargerCarnet();
  if (!carnetServeur || !carnetServeur.bloc || carnetServeur.version === 0) {
    // Le serveur n'a pas de carnet enregistré (version 0).
    // Réinitialiser la version serveur locale à 0 pour casser toute boucle de conflit.
    await definirMeta('version_carnet_serveur', 0);
    const contribution_autorisee = await obtenirMeta('contribution_autorisee');
    const metas = [];
    if (contribution_autorisee !== null && contribution_autorisee !== undefined) metas.push({ id: 'contribution_autorisee', valeur: contribution_autorisee });
    const payload = {
      cueillettes: cueillettesLocales,
      meta: metas,
      exporte_le: new Date().toISOString()
    };
    const blocChiffre = await chiffrerBlocCarnet(payload, cleMaitre);
    const reponse = await api.envoyerCarnet(blocChiffre, 0);
    versionServeurConnue = reponse.version;
    await definirMeta('version_carnet_serveur', versionServeurConnue);
    await definirMeta('dernier_sync', reponse.synchronise_le);
    nbModifsEnAttente = 0;
    notifierStatutSync('synchro', `Synchronisé à ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    return { succes: true, statut: 'synchro', version: versionServeurConnue };
  }

  // Déchiffrer le bloc serveur
  const payloadDistant = await dechiffrerBlocCarnet(carnetServeur.bloc, cleMaitre);
  const distantCueillettes = Array.isArray(payloadDistant.cueillettes) ? payloadDistant.cueillettes : [];

  // Fusionner les cueillettes distantes dans la base locale (règle modifie_le le plus récent)
  const mapLocales = new Map(cueillettesLocales.map((c) => [c.id, c]));

  for (const item of distantCueillettes) {
    if (!item.id) continue;
    const local = mapLocales.get(item.id);
    if (!local) {
      // Nouvelle entrée distante -> à ajouter en local
      await import('./db.js').then((m) => m.ajouterCueillette(item));
      mapLocales.set(item.id, item);
    } else {
      const dateDist = item.modifie_le || item.cree_le || '';
      const dateLoc = local.modifie_le || local.cree_le || '';
      if (dateDist > dateLoc) {
        // La version distante est plus récente -> écraser local
        await import('./db.js').then((m) => m.modifierCueillette(item));
        mapLocales.set(item.id, item);
      }
    }
  }

  // Préparer la liste consolidée
  const cueillettesConsolidees = Array.from(mapLocales.values());
  const contribution_autorisee = await obtenirMeta('contribution_autorisee');

  const metas = [];
  if (contribution_autorisee !== null && contribution_autorisee !== undefined) metas.push({ id: 'contribution_autorisee', valeur: contribution_autorisee });

  const payloadConsolide = {
    cueillettes: cueillettesConsolidees,
    meta: metas,
    exporte_le: new Date().toISOString()
  };

  const blocConsolide = await chiffrerBlocCarnet(payloadConsolide, cleMaitre);
  const reponse = await api.envoyerCarnet(blocConsolide, carnetServeur.version);

  versionServeurConnue = reponse.version;
  await definirMeta('version_carnet_serveur', versionServeurConnue);
  await definirMeta('dernier_sync', reponse.synchronise_le);
  nbModifsEnAttente = 0;

  notifierStatutSync('synchro', `Synchronisé (fusionné v${versionServeurConnue})`);
  return { succes: true, statut: 'synchro', version: versionServeurConnue };
}

/**
 * Récupère le carnet complet depuis le serveur (Pull complet, ex: après reconnexion ou téléphone perdu)
 */
export async function restaurerDepuisServeur() {
  const d = await api.etatCompte();
  if (!d || !d.connecte) throw new Error('Connexion requise');

  const cleMaitre = obtenirCleMaitreSession();
  if (!cleMaitre) throw new Error('Clé maître requise');

  const carnetServeur = await api.telechargerCarnet();
  if (!carnetServeur || !carnetServeur.bloc) {
    versionServeurConnue = 0;
    await definirMeta('version_carnet_serveur', 0);
    return { total: 0, version: 0 };
  }

  const payload = await dechiffrerBlocCarnet(carnetServeur.bloc, cleMaitre);
  const cueillettes = Array.isArray(payload.cueillettes) ? payload.cueillettes : [];

  const { ajouterCueillette, modifierCueillette, obtenirCueillette } = await import('./db.js');

  for (const c of cueillettes) {
    if (!c.id) continue;
    const existant = await obtenirCueillette(c.id);
    if (!existant) {
      await ajouterCueillette(c);
    } else {
      await modifierCueillette(c);
    }
  }

  versionServeurConnue = carnetServeur.version;
  await definirMeta('version_carnet_serveur', versionServeurConnue);
  await definirMeta('dernier_sync', carnetServeur.modifie_le);
  nbModifsEnAttente = 0;

  notifierStatutSync('synchro', `Restauré depuis le cloud (v${versionServeurConnue})`);
  return { total: cueillettes.length, version: carnetServeur.version };
}
