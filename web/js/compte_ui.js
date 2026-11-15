/**
 * MesChampis — Interface Utilisateur du parcours utilisateur & gestion de compte (Étape 3 / 6)
 * Gère l'ensemble des modales : Accueil non connecté, Inscription, Connexion,
 * Code de secours, Mot de passe oublié (3 cas), Paiement Stripe factice, Réglages et Milieux favorables.
 */

import * as api from './api.js';
import { estModeDemo, serveurSimuleControl } from './api.js';
import { rafraichirDroits, droits, peutVoirRecommandations } from './droits.js';
import {
  genererCodeSecours,
  creerTrousseauInscription,
  ouvrirEnveloppeMdp,
  ouvrirEnveloppeSecours,
  reenvelopperCleMaitre,
  definirCleMaitreSession,
  obtenirCleMaitreSession,
  purgerCleMaitreSession
} from './crypto_compte.js';
import { synchroniserCarnet, restaurerDepuisServeur, notifierStatutSync } from './sync_carnet.js';
import { listerCueillettes, viderBase, ouvrirBase, obtenirMeta, definirMeta } from './db.js';
import { ouvrirModale, fermerModale, fermerToutesModales } from './modales.js';

export class GestionnaireCompteUI {
  constructor(gestionnaireCarnet, gestionnaireGrille) {
    this.carnet = gestionnaireCarnet;
    this.grille = gestionnaireGrille;

    this.codeSecoursEnCours = null;
    this.groupeAConfirmer = 2; // 0-indexed (ex: 3e groupe)

    this.initialiserElementsDOM();
    this.attacherEvenements();
  }

  initialiserElementsDOM() {
    // Bandeau permanent démo
    this.bannerDemo = document.getElementById('demo-permanent-banner');

    // Hero accueil non-connecté
    this.heroAccueil = document.getElementById('hero-accueil-non-connecte');
    this.mapContainer = document.getElementById('map');

    // Modales de compte
    this.modalAuth = document.getElementById('modal-auth');
    this.modalCodeSecours = document.getElementById('modal-code-secours');
    this.modalMdpOublie = document.getElementById('modal-mdp-oublie');
    this.modalPaiement = document.getElementById('modal-paiement-stripe');
    this.modalReglages = document.getElementById('modal-reglages-compte');
    this.modalMilieux = document.getElementById('modal-milieux-favorables');
    this.modalOffres = document.getElementById('modal-offres-abonnement');

    // Boutons de navigation header
    this.btnNavCompte = document.getElementById('btn-nav-compte');
    this.badgeSync = document.getElementById('badge-sync-statut');
  }

  attacherEvenements() {
    // 1. Bouton compte / réglages dans l'en-tête
    this.btnNavCompte?.addEventListener('click', () => {
      const d = droits();
      if (d.connecte) {
        this.ouvrirReglages();
      } else {
        this.ouvrirConnexion();
      }
    });

    // 2. Boutons Hero accueil
    document.getElementById('btn-hero-inscription')?.addEventListener('click', () => this.ouvrirInscription());
    document.getElementById('btn-hero-connexion')?.addEventListener('click', () => this.ouvrirConnexion());

    // 3. Fermetures de modales
    document.querySelectorAll('.btn-close-compte-modal').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-backdrop');
        if (modal) fermerModale(modal);
      });
    });

    // 4. Formulaire d'inscription
    document.getElementById('btn-submit-inscription')?.addEventListener('click', () => this.lancerInscription());
    document.getElementById('btn-switch-vers-connexion')?.addEventListener('click', () => this.ouvrirConnexion());

    // 5. Formulaire de connexion
    document.getElementById('btn-submit-connexion')?.addEventListener('click', () => this.lancerConnexion());
    document.getElementById('btn-switch-vers-inscription')?.addEventListener('click', () => this.ouvrirInscription());
    document.getElementById('btn-vers-mdp-oublie')?.addEventListener('click', () => this.ouvrirMdpOublie());

    // 6. Validation du code de secours & Avertissement sanitaire
    document.getElementById('btn-confirmer-code-secours')?.addEventListener('click', () => this.validerCodeSecours());
    document.getElementById('btn-copier-code-secours')?.addEventListener('click', () => this.copierCodeSecours());
    document.getElementById('btn-accepter-avertissement-sanitaire')?.addEventListener('click', () => {
      fermerModale('modal-avertissement-sanitaire');
      this.afficherEcranNonConnecte(false);
      this.carnet?.afficherToast('Compte configuré et sécurisé. Bienvenue sur MesChampis !');
    });

    // 7. Mot de passe oublié
    document.getElementById('btn-submit-mdp-oublie')?.addEventListener('click', () => this.lancerRecuperationMdp());

    // 8. Paiement factice Stripe
    document.getElementById('btn-pay-stripe-success')?.addEventListener('click', () => this.simulerPaiement(true));
    document.getElementById('btn-pay-stripe-fail')?.addEventListener('click', () => this.simulerPaiement(false));

    // 9. Réglages
    document.getElementById('btn-reglages-deconnexion')?.addEventListener('click', () => this.deconnecter());
    document.getElementById('btn-reglages-supprimer-compte')?.addEventListener('click', () => this.confirmerSupprimerCompte());
    document.getElementById('btn-reglages-abonnement')?.addEventListener('click', () => this.ouvrirOffres());

    // 10. Boutons d'offre / essai
    document.getElementById('btn-demarrer-essai-7j')?.addEventListener('click', () => this.lancerDemarrageEssai());
    document.getElementById('btn-souscrire-pass-saison')?.addEventListener('click', () => this.ouvrirPaiement('pass_saison'));
    document.getElementById('btn-souscrire-annuel')?.addEventListener('click', () => this.ouvrirPaiement('annuel'));

    // 11. Liens milieux favorables (observations naturalistes)
    document.addEventListener('click', (e) => {
      if (e.target.closest('.btn-lien-milieux-favorables')) {
        e.preventDefault();
        this.ouvrirMilieuxFavorables();
      }
    });

    // Écouter les événements de synchronisation
    window.addEventListener('meschampis:sync-statut', (e) => {
      this.mettreAJourBadgeSync(e.detail);
    });

    // Écouter les modifications de droits depuis le panneau démo ou webhook
    window.addEventListener('meschampis:droits-actualises', (e) => {
      this.mettreAJourInterfaceDroits(e.detail);
    });
  }

  /**
   * Initialise l'état au démarrage de l'application
   */
  async demarrer() {
    if (estModeDemo()) {
      if (this.bannerDemo) this.bannerDemo.classList.remove('hidden');

      // Vérifier les droits du serveur simulé
      const d = await rafraichirDroits();
      if (!d.connecte) {
        this.afficherEcranNonConnecte(true);
      } else {
        this.afficherEcranNonConnecte(false);
        // Si connecté et qu'on a la clé maître, tenter une synchro
        if (obtenirCleMaitreSession()) {
          synchroniserCarnet().catch(() => {});
        }
      }
    } else {
      // Mode standard / production
      if (this.bannerDemo) this.bannerDemo.classList.add('hidden');
      this.afficherEcranNonConnecte(false);
    }
  }

  afficherEcranNonConnecte(visible) {
    if (visible) {
      this.heroAccueil?.classList.remove('hidden');
      this.mapContainer?.classList.add('blurred-map');
    } else {
      this.heroAccueil?.classList.add('hidden');
      this.mapContainer?.classList.remove('blurred-map');
    }
  }

  // ---------------------------------------------------------------------------
  // Flux Inscription & Code de secours
  // ---------------------------------------------------------------------------
  ouvrirInscription() {
    this.afficherEcranNonConnecte(false);
    document.getElementById('auth-title').textContent = 'Créer mon compte';
    document.getElementById('form-inscription').classList.remove('hidden');
    document.getElementById('form-connexion').classList.add('hidden');
    document.getElementById('auth-error-msg').textContent = '';
    ouvrirModale(this.modalAuth);
  }

  ouvrirConnexion() {
    this.afficherEcranNonConnecte(false);
    document.getElementById('auth-title').textContent = 'Connexion à MesChampis';
    document.getElementById('form-inscription').classList.add('hidden');
    document.getElementById('form-connexion').classList.remove('hidden');
    document.getElementById('auth-error-msg').textContent = '';
    ouvrirModale(this.modalAuth);
  }

  async lancerInscription() {
    const email = document.getElementById('inscription-email')?.value.trim();
    const pass1 = document.getElementById('inscription-pass-1')?.value;
    const pass2 = document.getElementById('inscription-pass-2')?.value;
    const errBox = document.getElementById('auth-error-msg');

    if (!email || !email.includes('@')) {
      errBox.textContent = 'Veuillez saisir une adresse e-mail valide.';
      return;
    }
    if (!pass1 || pass1.trim().length === 0) {
      errBox.textContent = 'Veuillez saisir un mot de passe.';
      return;
    }
    if (pass1 !== pass2) {
      errBox.textContent = 'Les deux mots de passe ne correspondent pas.';
      return;
    }

    try {
      errBox.textContent = '⏳ Génération de la clé maître et des enveloppes chiffrées...';

      // 1. Génération du code de secours
      const codeSecours = genererCodeSecours();
      this.codeSecoursEnCours = codeSecours;

      // 2. Création du trousseau client Zero-Knowledge
      const trousseau = await creerTrousseauInscription(pass1, codeSecours);

      // 3. Envoi au serveur simulé (uniquement empreinte auth et enveloppes)
      await api.inscrire(email, trousseau.empreinteAuth, trousseau.enveloppes);

      this.emailEnCoursInscription = email;
      this.motDePasseEnCours = pass1;

      // 4. Afficher l'écran de code de secours
      fermerModale(this.modalAuth);
      this.afficherEcranCodeSecours(codeSecours);

    } catch (err) {
      errBox.textContent = err.message || 'Erreur lors de l\'inscription.';
    }
  }

  afficherEcranCodeSecours(codeSecours) {
    const displayBox = document.getElementById('code-secours-display');
    const groupes = codeSecours.split('-');
    displayBox.innerHTML = groupes.map((g) => `<span class="secours-group">${g}</span>`).join(' ');

    // Choisir un groupe à confirmer aléatoirement (ex: groupe 3)
    this.groupeAConfirmer = 2; // index 2 = 3e groupe
    const labelGroup = document.getElementById('label-confirmer-groupe');
    if (labelGroup) {
      labelGroup.textContent = `Pour confirmer que vous avez noté ce code, retapez le 3e groupe (${groupes[this.groupeAConfirmer].length} lettres/chiffres) :`;
    }

    document.getElementById('input-confirmer-groupe').value = '';
    document.getElementById('code-secours-error').textContent = '';
    ouvrirModale(this.modalCodeSecours);
  }

  copierCodeSecours() {
    if (!this.codeSecoursEnCours) return;
    navigator.clipboard.writeText(this.codeSecoursEnCours).then(() => {
      this.carnet?.afficherToast('Code de secours copié dans le presse-papiers');
    });
  }

  async validerCodeSecours() {
    const input = document.getElementById('input-confirmer-groupe')?.value.trim().toUpperCase();
    const errBox = document.getElementById('code-secours-error');
    const groupes = this.codeSecoursEnCours.split('-');

    if (input !== groupes[this.groupeAConfirmer]) {
      errBox.textContent = `Groupe incorrect. Le 3e groupe attendu est : ${groupes[this.groupeAConfirmer]}`;
      return;
    }

    fermerModale(this.modalCodeSecours);
    this.carnet?.afficherToast('Code de secours validé et mémorisé.');

    // Afficher l'avertissement sanitaire obligatoire (D4.2)
    const modalSanitaire = document.getElementById('modal-avertissement-sanitaire');
    if (modalSanitaire) {
      ouvrirModale(modalSanitaire);
    } else {
      this.afficherEcranNonConnecte(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Connexion
  // ---------------------------------------------------------------------------
  async lancerConnexion() {
    const email = document.getElementById('connexion-email')?.value.trim();
    const pass = document.getElementById('connexion-pass')?.value;
    const errBox = document.getElementById('auth-error-msg');

    if (!email || !pass) {
      errBox.textContent = 'Veuillez saisir votre e-mail et votre mot de passe.';
      return;
    }

    try {
      errBox.textContent = '⏳ Connexion et dérivation de l\'empreinte d\'authentification...';

      // 1. Lire les enveloppes pour récupérer le sel d'authentification
      // En mode démo, connecter va comparer l'empreinte
      const selAuth = null; // calculerEmpreinteAuth va dériver le sel
      const { empreinteAuth } = await import('./crypto_compte.js').then((m) => m.calculerEmpreinteAuth(pass));

      // 2. Appel connexion
      const reponse = await api.connecter(email, empreinteAuth);

      // 3. Déchiffrer l'enveloppe maître avec le mot de passe
      if (reponse.enveloppes?.enveloppe_mdp) {
        await ouvrirEnveloppeMdp(reponse.enveloppes.enveloppe_mdp, pass);
      }

      fermerModale(this.modalAuth);
      this.afficherEcranNonConnecte(false);
      await rafraichirDroits();

      this.carnet?.afficherToast(`Bienvenue, ${email} !`);

      // 4. Synchronisation initiale du carnet
      await synchroniserCarnet();
      if (this.carnet) this.carnet.chargerCueillettes();

    } catch (err) {
      errBox.textContent = err.message || 'Échec de connexion.';
    }
  }

  async deconnecter() {
    await api.deconnecter();
    purgerCleMaitreSession();
    this.fermerToutesModales();
    await rafraichirDroits();
    this.afficherEcranNonConnecte(true);
    this.carnet?.afficherToast('Vous êtes maintenant déconnecté.');
  }

  async connecterUtilisateur(email, pass) {
    const elEmail = document.getElementById('connexion-email');
    const elPass = document.getElementById('connexion-pass');
    if (elEmail) elEmail.value = email;
    if (elPass) elPass.value = pass;
    return this.lancerConnexion();
  }

  async traiterLienActionEmail(url) {
    const clean = url.replace('?demo=1&', '').replace('?demo=1', '');
    const params = new URLSearchParams(clean);
    const action = params.get('action');
    const jeton = params.get('jeton');
    if (action === 'verifier-email' && jeton) {
      await api.verifierEmail(jeton);
      this.carnet?.afficherToast('E-mail vérifié avec succès ! Compte activé.');
      await rafraichirDroits();
      this.afficherEcranNonConnecte(false);
    }
  }

  async lancerSync() {
    return synchroniserCarnet();
  }

  // ---------------------------------------------------------------------------
  // Mot de passe oublié (3 cas)
  // ---------------------------------------------------------------------------
  ouvrirMdpOublie() {
    document.getElementById('mdp-oublie-error').textContent = '';
    document.getElementById('mdp-oublie-success').textContent = '';

    // Déterminer quel cas est possible :
    const cleEnMemoire = obtenirCleMaitreSession();
    const blocCasA = document.getElementById('bloc-mdp-cas-a');
    const blocCasB = document.getElementById('bloc-mdp-cas-b');
    const blocCasC = document.getElementById('bloc-mdp-cas-c');

    if (cleEnMemoire) {
      blocCasA?.classList.remove('hidden');
      blocCasB?.classList.add('hidden');
      blocCasC?.classList.add('hidden');
    } else {
      blocCasA?.classList.add('hidden');
      blocCasB?.classList.remove('hidden');
      blocCasC?.classList.remove('hidden');
    }

    ouvrirModale(this.modalMdpOublie);
  }

  async lancerRecuperationMdp() {
    const errBox = document.getElementById('mdp-oublie-error');
    const succBox = document.getElementById('mdp-oublie-success');
    errBox.textContent = '';
    succBox.textContent = '';

    const cleEnMemoire = obtenirCleMaitreSession();
    const nouveauMdp = document.getElementById('recup-nouveau-mdp')?.value;
    const confirmMdp = document.getElementById('recup-confirm-mdp')?.value;

    if (!nouveauMdp || nouveauMdp.trim().length === 0) {
      errBox.textContent = 'Veuillez saisir un nouveau mot de passe.';
      return;
    }
    if (nouveauMdp !== confirmMdp) {
      errBox.textContent = 'Les deux mots de passe ne correspondent pas.';
      return;
    }

    try {
      let cleMaitreAReenvelopper = null;

      // Cas (a) : clé maître présente en mémoire
      if (cleEnMemoire) {
        cleMaitreAReenvelopper = cleEnMemoire;
      } else {
        // Cas (b) : code de secours fourni
        const codeSaisi = document.getElementById('recup-code-secours')?.value.trim();
        if (!codeSaisi) {
          // Cas (c) : ni clé en mémoire ni code de secours
          errBox.textContent = 'Données irrécupérables : sans code de secours et sans clé maître sur cet appareil, le chiffrement de bout en bout empêche toute récupération.';
          return;
        }

        const enveloppes = await api.lireEnveloppes();
        cleMaitreAReenvelopper = await ouvrirEnveloppeSecours(enveloppes.enveloppe_secours, codeSaisi);
      }

      // Re-chiffrement de l'enveloppe maître avec le nouveau mot de passe
      const { enveloppe_mdp, nouvelleEmpreinteAuth } = await reenvelopperCleMaitre(cleMaitreAReenvelopper, nouveauMdp);

      // Mise à jour sur le serveur simulé
      await api.reinitialiser('jeton_reinit_actif', nouvelleEmpreinteAuth, enveloppe_mdp);

      succBox.textContent = 'Mot de passe réinitialisé avec succès ! Vous pouvez vous reconnecter.';
      setTimeout(() => {
        this.ouvrirConnexion();
      }, 1500);

    } catch (err) {
      errBox.textContent = err.message || 'Erreur lors de la réinitialisation.';
    }
  }

  // ---------------------------------------------------------------------------
  // Essai de 7 jours & Offres
  // ---------------------------------------------------------------------------
  async lancerDemarrageEssai() {
    try {
      const res = await api.demarrerEssai();
      await rafraichirDroits();
      await definirMeta('essai_utilise', true);

      this.fermerToutesModales();
      this.carnet?.afficherToast('Essai gratuit de 7 jours activé avec succès !');

      // Déverrouiller la vue recommandations et activer la carte de chaleur
      if (window.activerCarteChaleurDemo) {
        window.activerCarteChaleurDemo();
      }
    } catch (err) {
      alert(err.message || 'Impossible de démarrer l\'essai.');
    }
  }

  ouvrirOffres() {
    ouvrirModale(this.modalOffres);
  }

  // ---------------------------------------------------------------------------
  // Paiement factice Stripe (Imitation)
  // ---------------------------------------------------------------------------
  ouvrirPaiement(offre = 'pass_saison') {
    const d = droits();
    if (!d.connecte) {
      this.ouvrirConnexion();
      return;
    }

    const titleElem = document.getElementById('stripe-recap-titre');
    const priceElem = document.getElementById('stripe-recap-prix');

    if (offre === 'pass_saison') {
      if (titleElem) titleElem.textContent = 'Pass Saison Automne 2026';
      if (priceElem) priceElem.textContent = '29,00 € TTC';
    } else {
      if (titleElem) titleElem.textContent = 'Abonnement Annuel MesChampis';
      if (priceElem) priceElem.textContent = '49,00 € TTC / an';
    }

    ouvrirModale(this.modalPaiement);
  }

  async simulerPaiement(succes = true) {
    const errBox = document.getElementById('stripe-payment-error');
    if (errBox) errBox.textContent = '';

    const d = droits();
    if (!d.email) return;

    if (succes) {
      // Déclencher le webhook simulé succès
      await serveurSimuleControl.simulerWebhookPaiement(d.email, 'succes', 12);
      await rafraichirDroits();

      fermerModale(this.modalPaiement);
      this.carnet?.afficherToast('Paiement confirmé ! Votre accès Premium est actif pour 12 mois.');

      if (window.activerCarteChaleurDemo) {
        window.activerCarteChaleurDemo();
      }
    } else {
      // Déclencher le webhook simulé échec
      await serveurSimuleControl.simulerWebhookPaiement(d.email, 'refuse');
      await rafraichirDroits();
      if (errBox) {
        errBox.textContent = 'Votre carte a été refusée par la banque émettrice (fonds insuffisants ou simulation de refus).';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Réglages du compte
  // ---------------------------------------------------------------------------
  async ouvrirReglages() {
    const d = await rafraichirDroits();
    document.getElementById('reglages-email-val').textContent = d.email || 'Non connecté';

    let statutTexte = 'Compte gratuit';
    if (d.premium) {
      statutTexte = 'Abonné Premium (accès illimité)';
    } else if (d.essai_actif) {
      statutTexte = `Essai gratuit 7 jours en cours (fin le ${new Date(d.essai_fin).toLocaleDateString()})`;
    } else if (d.essai_utilise) {
      statutTexte = 'Essai gratuit terminé';
    }

    document.getElementById('reglages-statut-abonnement').textContent = statutTexte;
    ouvrirModale(this.modalReglages);
  }

  async confirmerSupprimerCompte() {
    const confirmation1 = confirm('ATTENTION : Supprimer votre compte effacera définitivement toutes vos données sauvegardées sur le serveur simulé. Continuer ?');
    if (!confirmation1) return;

    const confirmation2 = prompt('Tapez "SUPPRIMER" pour confirmer la destruction irréversible de votre compte :');
    if (confirmation2 !== 'SUPPRIMER') {
      alert('Suppression annulée.');
      return;
    }

    await api.supprimerCompte();
    purgerCleMaitreSession();
    await viderBase(); // vider meschampis_db_demo
    this.fermerToutesModales();
    await rafraichirDroits();
    this.afficherEcranNonConnecte(true);
    this.carnet?.afficherToast('Compte et données locales purgés avec succès.');
    if (this.carnet) this.carnet.chargerCueillettes();
  }

  ouvrirMilieuxFavorables() {
    ouvrirModale(this.modalMilieux);
  }

  fermerToutesModales() {
    fermerToutesModales();
  }

  mettreAJourBadgeSync({ statut, details, nbModifs }) {
    if (!this.badgeSync) return;

    if (statut === 'synchro') {
      this.badgeSync.className = 'sync-badge sync-ok';
      this.badgeSync.innerHTML = '<span class="sync-dot"></span><span class="sync-label-text">Synchronisé</span>';
      this.badgeSync.title = details || 'Données synchronisées avec le serveur (Zero-Knowledge)';
    } else if (statut === 'en_attente') {
      this.badgeSync.className = 'sync-badge sync-pending';
      this.badgeSync.innerHTML = `<span class="sync-dot sync-pending"></span><span class="sync-label-text">En attente (${nbModifs || 1})</span>`;
      this.badgeSync.title = 'Modifications locales en attente d\'envoi';
    } else if (statut === 'hors_ligne') {
      this.badgeSync.className = 'sync-badge sync-offline';
      this.badgeSync.innerHTML = '<span class="sync-dot sync-offline"></span><span class="sync-label-text">Hors ligne</span>';
      this.badgeSync.title = 'Réseau coupé : les modifications sont conservées en local';
    } else if (statut === 'sync_en_cours') {
      this.badgeSync.className = 'sync-badge sync-active';
      this.badgeSync.innerHTML = '<span class="sync-dot sync-pulsing"></span><span class="sync-label-text">Synchronisation...</span>';
    }
  }

  mettreAJourInterfaceDroits(droits) {
    // Si abonné ou essai actif, déverrouiller la vue recommandations
    const aDroit = peutVoirRecommandations();
    const lockOverlay = document.getElementById('recommandations-lock-overlay');
    if (lockOverlay) {
      if (aDroit) {
        lockOverlay.classList.add('hidden');
      } else {
        lockOverlay.classList.remove('hidden');
      }
    }
  }
}
