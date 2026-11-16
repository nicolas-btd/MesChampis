/**
 * MesChampis — Panneau de Démonstration Interactif (Étape 3 / Démo D6)
 * Accessible uniquement lorsque l'URL contient '?demo=1'.
 * Permet de manipuler la date virtuelle, simuler la perte de réseau, inspecter
 * la boîte de réception des e-mails, injecter des données fictives et tester le scénario "Téléphone perdu".
 */

import { estModeDemo, serveurSimuleControl } from './api.js';
import { rafraichirDroits, definirDroitsMemoire } from './droits.js';
import { ajouterCueillette, viderBase, listerCueillettes } from './db.js';
import { purgerCleMaitreSession } from './crypto_compte.js';
import { synchroniserCarnet, restaurerDepuisServeur } from './sync_carnet.js';
import { fermerToutesModales } from './modales.js';

export class PanneauDemo {
  constructor(gestionnaireCarnet, gestionnaireCompteUI, gestionnaireCarteChaleur) {
    this.carnet = gestionnaireCarnet;
    this.compteUI = gestionnaireCompteUI;
    this.chaleur = gestionnaireCarteChaleur;

    this.panneauElem = null;
    this.boutonFlottant = null;

    if (estModeDemo()) {
      this.construirePanneau();
      this.attacherEvenements();
      this.rafraichirBoiteEmails();
    }
  }

  construirePanneau() {
    // 1. Bouton flottant sobre & élégant
    const btn = document.createElement('button');
    btn.id = 'btn-toggle-panneau-demo';
    btn.className = 'btn-flottant-demo';
    btn.innerHTML = '<span class="demo-pill-indicator"></span><span>Atelier Démo</span>';
    btn.title = 'Contrôles de simulation environnementale & serveur';
    document.body.appendChild(btn);
    this.boutonFlottant = btn;

    // 2. Panneau latéral rétractable
    const panel = document.createElement('div');
    panel.id = 'panneau-demo-drawer';
    panel.className = 'panneau-demo-drawer hidden';
    panel.innerHTML = `
      <div class="demo-panel-header">
        <h3>Simulateur Démo & Environnement</h3>
        <button id="btn-fermer-panneau-demo" class="btn-modal-close" type="button" aria-label="Fermer (Échap)" title="Fermer (Échap)">✕</button>
      </div>
      <div class="demo-panel-content">
        <!-- 1. Réseau -->
        <div class="demo-section">
          <h4>📶 Simulation Réseau (Zone Blanche)</h4>
          <label class="demo-toggle-label">
            <input type="checkbox" id="demo-toggle-reseau">
            <span id="demo-reseau-status-text">Connecté au réseau (4G/5G)</span>
          </label>
        </div>

        <!-- 2. Date Virtuelle -->
        <div class="demo-section">
          <h4>📅 Date Virtuelle</h4>
          <div class="demo-buttons-grid">
            <button class="btn-demo-action" id="btn-date-actuelle">Aujourd'hui</button>
            <button class="btn-demo-action" id="btn-date-mars">Printemps (Mars)</button>
            <button class="btn-demo-action" id="btn-date-sept">Automne (Sept.)</button>
            <button class="btn-demo-action btn-highlight" id="btn-date-plus-7j">⏩ Avancer de +7 jours</button>
          </div>
          <div id="demo-date-affichee" class="demo-date-badge"></div>
        </div>

        <!-- 3. État du Compte / Droits -->
        <div class="demo-section">
          <h4>👤 Forcer l'État du Compte</h4>
          <div class="demo-buttons-grid">
            <button class="btn-demo-action" id="btn-statut-gratuit">Gratuit</button>
            <button class="btn-demo-action" id="btn-statut-essai">Essai 7j actif</button>
            <button class="btn-demo-action" id="btn-statut-essai-fini">Essai expiré</button>
            <button class="btn-demo-action" id="btn-statut-abonne">⭐ Abonné</button>
            <button class="btn-demo-action" id="btn-statut-refuse">❌ Paiement refusé</button>
          </div>
        </div>

        <!-- 4. Boîte de réception e-mails simulée -->
        <div class="demo-section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <h4>📬 Boîte E-mails simulée (<span id="demo-emails-count">0</span>)</h4>
            <button id="btn-purger-emails" class="btn-xs" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer;">Vider</button>
          </div>
          <div id="demo-emails-list" class="demo-emails-list">
            <div class="demo-empty-msg">Aucun e-mail reçu pour l'instant.</div>
          </div>
        </div>

        <!-- 5. Jeu de Données Carnet -->
        <div class="demo-section">
          <h4>🍄 Données du Carnet</h4>
          <div class="demo-buttons-grid">
            <button class="btn-demo-action" id="btn-remplir-carnet-10">➕ Injecter 10 cueillettes fictives</button>
            <button class="btn-demo-action" id="btn-vider-carnet-demo">🗑️ Vider le carnet local</button>
          </div>
        </div>

        <!-- 6. Scénarios Avancés -->
        <div class="demo-section">
          <h4>🧪 Scénarios de Test</h4>
          <div class="demo-buttons-grid">
            <button class="btn-demo-action btn-danger" id="btn-scenario-tel-perdu">📱 Téléphone perdu (Purger local & Déconnecter)</button>
            <button class="btn-demo-action btn-danger" id="btn-scenario-reset-tout">💥 Tout réinitialiser (Serveur + Local)</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    this.panneauElem = panel;
  }

  attacherEvenements() {
    this.boutonFlottant?.addEventListener('click', () => {
      this.basculer();
    });

    document.getElementById('btn-fermer-panneau-demo')?.addEventListener('click', () => {
      this.basculer(false);
    });

    // 1. Toggle Réseau
    const toggleReseau = document.getElementById('demo-toggle-reseau');
    const labelReseau = document.getElementById('demo-reseau-status-text');
    toggleReseau?.addEventListener('change', (e) => {
      const coupe = e.target.checked;
      serveurSimuleControl.definirReseauCoupe(coupe);
      if (coupe) {
        labelReseau.textContent = '❌ Réseau coupé (Zone blanche)';
        labelReseau.style.color = '#ef4444';
        this.carnet?.afficherToast('📶 Réseau coupé (simulation zone blanche)');
      } else {
        labelReseau.textContent = '✅ Connecté au réseau (4G/5G)';
        labelReseau.style.color = '#34d399';
        this.carnet?.afficherToast('📶 Connexion réseau rétablie');
      }
    });

    // 2. Dates Virtuelles
    document.getElementById('btn-date-actuelle')?.addEventListener('click', () => {
      serveurSimuleControl.definirDecalageDateVirtuelle(0);
      this.actualiserAffichageDate();
      this.carnet?.afficherToast('📅 Date réinitialisée à aujourd\'hui');
    });

    document.getElementById('btn-date-mars')?.addEventListener('click', () => {
      // Mars de l'année courante
      const d = new Date();
      d.setMonth(2); // Mars
      d.setDate(15);
      const decalage = d.getTime() - Date.now();
      serveurSimuleControl.definirDecalageDateVirtuelle(decalage);
      this.actualiserAffichageDate();
      this.carnet?.afficherToast('🌱 Date simulée : 15 Mars (Printemps / Morilles)');
    });

    document.getElementById('btn-date-sept')?.addEventListener('click', () => {
      // Septembre de l'année courante
      const d = new Date();
      d.setMonth(8); // Septembre
      d.setDate(25);
      const decalage = d.getTime() - Date.now();
      serveurSimuleControl.definirDecalageDateVirtuelle(decalage);
      this.actualiserAffichageDate();
      this.carnet?.afficherToast('🍂 Date simulée : 25 Septembre (Pleine pousse des Cèpes)');
    });

    document.getElementById('btn-date-plus-7j')?.addEventListener('click', async () => {
      const cur = serveurSimuleControl.dateVirtuelle();
      const decalage = (cur.getTime() + 7.5 * 86400000) - Date.now();
      serveurSimuleControl.definirDecalageDateVirtuelle(decalage);
      this.actualiserAffichageDate();
      await rafraichirDroits();
      this.carnet?.afficherToast('⏩ Date avancée de +7 jours (l\'essai de 7j est maintenant expiré)');
    });

    // 3. Forcer statut de compte
    document.getElementById('btn-statut-gratuit')?.addEventListener('click', () => {
      definirDroitsMemoire({ premium: false, essai_debut: null, essai_fin: null, essai_actif: false, essai_utilise: false, statut_abonnement: 'aucun' });
      this.carnet?.afficherToast('👤 Droits : Compte Gratuit');
    });

    document.getElementById('btn-statut-essai')?.addEventListener('click', () => {
      const debut = serveurSimuleControl.dateVirtuelle();
      const fin = new Date(debut.getTime() + 7 * 86400000);
      definirDroitsMemoire({ premium: false, essai_debut: debut.toISOString(), essai_fin: fin.toISOString(), essai_actif: true, essai_utilise: true, statut_abonnement: 'essai' });
      this.carnet?.afficherToast('🚀 Droits : Essai 7 jours activé');
    });

    document.getElementById('btn-statut-essai-fini')?.addEventListener('click', () => {
      const debut = new Date(Date.now() - 10 * 86400000);
      const fin = new Date(Date.now() - 3 * 86400000);
      definirDroitsMemoire({ premium: false, essai_debut: debut.toISOString(), essai_fin: fin.toISOString(), essai_actif: false, essai_utilise: true, statut_abonnement: 'essai_expire' });
      this.carnet?.afficherToast('⌛ Droits : Essai expiré (Offres affichées)');
    });

    document.getElementById('btn-statut-abonne')?.addEventListener('click', () => {
      const fin = new Date(Date.now() + 365 * 86400000);
      definirDroitsMemoire({ premium: true, premium_fin: fin.toISOString(), statut_abonnement: 'actif' });
      this.carnet?.afficherToast('⭐ Droits : Abonné Premium (Annuel)');
    });

    document.getElementById('btn-statut-refuse')?.addEventListener('click', () => {
      definirDroitsMemoire({ premium: false, statut_abonnement: 'paiement_refuse' });
      this.carnet?.afficherToast('❌ Droits : Paiement refusé');
    });

    // 4. E-mails
    document.getElementById('btn-purger-emails')?.addEventListener('click', async () => {
      await serveurSimuleControl.purgerEmailsSimules();
      this.rafraichirBoiteEmails();
    });

    window.addEventListener('meschampis:email-recu', () => {
      this.rafraichirBoiteEmails();
    });

    // 5. Données carnet
    document.getElementById('btn-remplir-carnet-10')?.addEventListener('click', () => this.injecter10Cueillettes());
    document.getElementById('btn-vider-carnet-demo')?.addEventListener('click', async () => {
      await viderBase();
      this.carnet?.chargerCueillettes();
      this.carnet?.afficherToast('🗑️ Carnet local vidé.');
    });

    // 6. Scénarios
    document.getElementById('btn-scenario-tel-perdu')?.addEventListener('click', () => this.executerScenarioTelephonePerdu());
    document.getElementById('btn-scenario-reset-tout')?.addEventListener('click', () => this.executerResetTotal());
  }

  actualiserAffichageDate() {
    const elem = document.getElementById('demo-date-affichee');
    if (!elem) return;
    const d = serveurSimuleControl.dateVirtuelle();
    elem.textContent = `Date active : ${d.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
  }

  async rafraichirBoiteEmails() {
    const listElem = document.getElementById('demo-emails-list');
    const countElem = document.getElementById('demo-emails-count');
    if (!listElem) return;

    const emails = await serveurSimuleControl.listerEmailsSimules();
    if (countElem) countElem.textContent = emails.length;

    if (emails.length === 0) {
      listElem.innerHTML = '<div class="demo-empty-msg">Aucun e-mail reçu pour l\'instant.</div>';
      return;
    }

    listElem.innerHTML = emails.map((em) => `
      <div class="demo-email-card">
        <div class="demo-email-header">
          <strong>${em.sujet}</strong>
          <span class="demo-email-date">${new Date(em.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="demo-email-dest">À : ${em.email}</div>
        <div class="demo-email-body">${em.corps}</div>
        ${em.url_action ? `
          <button class="btn-demo-email-action" data-url="${em.url_action}">
            🔗 Ouvrir le lien d'action
          </button>
        ` : ''}
      </div>
    `).reverse().join('');

    listElem.querySelectorAll('.btn-demo-email-action').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const url = e.target.getAttribute('data-url');
        if (!url) return;

        // Traiter l'action directement
        const params = new URLSearchParams(url.replace('?demo=1&', ''));
        const action = params.get('action');
        const jeton = params.get('jeton');

        if (action === 'verifier-email' && jeton) {
          try {
            await import('./api.js').then((m) => m.verifierEmail(jeton));
            this.carnet?.afficherToast('✅ E-mail vérifié avec succès ! Compte activé.');
            this.panneauElem?.classList.add('hidden');
            await rafraichirDroits();
            if (this.compteUI) this.compteUI.afficherEcranNonConnecte(false);
          } catch (err) {
            alert('Erreur vérification : ' + err.message);
          }
        } else if (action === 'reinitialiser' && jeton) {
          this.panneauElem?.classList.add('hidden');
          if (this.compteUI) this.compteUI.ouvrirMdpOublie();
        }
      });
    });
  }

  async injecter10Cueillettes() {
    const echantillons = [
      { type: 'trouve', nom: 'Cèpe de Bordeaux', latin: 'Boletus edulis', lat: 45.7725, lon: 2.9632, quantite: '5-20', date: '2026-09-24', notes: 'Sous grands hêtres et épicéas' },
      { type: 'trouve', nom: 'Girolle commune', latin: 'Cantharellus cibarius', lat: 45.7680, lon: 2.9710, quantite: '20+', date: '2026-09-22', notes: 'Talus moussus bien humides' },
      { type: 'trouve', nom: 'Pied-de-mouton', latin: 'Hydnum repandum', lat: 45.7810, lon: 2.9550, quantite: '1-5', date: '2026-09-20', notes: 'Cercle de sorcières sous conifères' },
      { type: 'trouve', nom: 'Trompette des morts', latin: 'Craterellus cornucopioides', lat: 45.7550, lon: 2.9800, quantite: '20+', date: '2026-09-18', notes: 'Litière de feuilles de chênes' },
      { type: 'rien', nom: 'Chanterelle en tube', latin: 'Craterellus tubaeformis', lat: 45.7900, lon: 2.9400, quantite: '0', date: '2026-09-15', notes: 'Secteur trop sec ce jour-là' },
      { type: 'trouve', nom: 'Bolet bai', latin: 'Imleria badia', lat: 45.7620, lon: 2.9680, quantite: '5-20', date: '2026-09-12', notes: 'Vieilles souches de pins' },
      { type: 'trouve', nom: 'Amanite des Césars', latin: 'Amanita caesarea', lat: 45.7480, lon: 2.9850, quantite: '1-5', date: '2026-09-10', notes: 'Versant Sud sous châtaigniers' },
      { type: 'rien', nom: 'Cèpe d\'été', latin: 'Boletus reticulatus', lat: 45.7750, lon: 2.9300, quantite: '0', date: '2026-09-08', notes: 'Parcelle exploitée récemment' },
      { type: 'trouve', nom: 'Lactaire délicieux', latin: 'Lactarius deliciosus', lat: 45.7850, lon: 2.9900, quantite: '5-20', date: '2026-09-05', notes: 'Jeune plantation de pins sylvestres' },
      { type: 'rien', nom: 'Morille commune', latin: 'Morchella esculenta', lat: 45.7600, lon: 2.9500, quantite: '0', date: '2026-09-02', notes: 'Rien trouvé sur cette zone de frênes' }
    ];

    for (const item of echantillons) {
      const snap = this.carnet.grille ? this.carnet.grille.valeursAuPoint(item.lon, item.lat) : null;
      await ajouterCueillette({
        id: crypto.randomUUID(),
        type: item.type,
        espece: { nom: item.nom, latin: item.latin },
        quantite: item.quantite,
        date: item.date,
        source_position: 'gps',
        coordonnees: { lat: item.lat, lon: item.lon, precision_m: 6.5 },
        arbres: ['hetre', 'sapin_pectine'],
        milieu: ['sous_bois', 'mousse'],
        notes: item.notes,
        cellule: snap || {}
      });
    }

    if (this.carnet) await this.carnet.chargerCueillettes();
    this.carnet?.afficherToast('10 cueillettes fictives ajoutées au carnet !');

    // Déclencher la synchronisation
    synchroniserCarnet().catch(() => {});
  }

  basculer(force) {
    if (!this.panneauElem) return;
    const ouvrant = typeof force === 'boolean' ? force : this.panneauElem.classList.contains('hidden');
    if (ouvrant) {
      fermerToutesModales();
      this.panneauElem.classList.remove('hidden');
    } else {
      this.panneauElem.classList.add('hidden');
    }
    this.actualiserAffichageDate();
    this.rafraichirBoiteEmails();
  }

  async avancerDate7Jours() {
    const cur = serveurSimuleControl.dateVirtuelle();
    const decalage = (cur.getTime() + 7.5 * 86400000) - Date.now();
    serveurSimuleControl.definirDecalageDateVirtuelle(decalage);
    this.actualiserAffichageDate();
    await rafraichirDroits();
    this.carnet?.afficherToast('Date avancée de +7 jours (essai expiré)');
  }

  /**
   * Scénario "Téléphone perdu" :
   * Efface complètement meschampis_db_demo et déconnecte la session locale.
   */
  async executerScenarioTelephonePerdu() {
    const confirmPerte = confirm('📱 Scénario "Téléphone perdu" : Vos données locales vont être effacées et la session déconnectée, comme si vous aviez un nouvel appareil. Continuer ?');
    if (!confirmPerte) return;
    await this.simulerTelephonePerdu();
  }

  async simulerTelephonePerdu() {
    await viderBase();
    purgerCleMaitreSession();
    await import('./api.js').then((m) => m.deconnecter());
    await rafraichirDroits();

    if (this.carnet) await this.carnet.chargerCueillettes();
    if (this.compteUI) this.compteUI.afficherEcranNonConnecte(true);

    this.panneauElem?.classList.add('hidden');
    this.carnet?.afficherToast('📱 Téléphone perdu simulé : carnet local vidé et session déconnectée. Reconnectez-vous pour restaurer vos données !');
  }

  /**
   * Scénario Reset total :
   * Purge meschampis_serveur_simule ET meschampis_db_demo.
   */
  async executerResetTotal() {
    const ok = confirm('💥 Réinitialiser TOUT (serveur simulé + carnet démo) ?');
    if (!ok) return;
    await this.simulerResetTotal();
  }

  async simulerResetTotal() {
    await serveurSimuleControl.purgerServeurSimule();
    await viderBase();
    purgerCleMaitreSession();
    serveurSimuleControl.definirDecalageDateVirtuelle(0);
    serveurSimuleControl.definirReseauCoupe(false);
    await rafraichirDroits();

    if (this.carnet) await this.carnet.chargerCueillettes();
    if (this.compteUI) this.compteUI.afficherEcranNonConnecte(true);

    this.panneauElem?.classList.add('hidden');
    this.carnet?.afficherToast('💥 Environnement démo remis à zéro.');
  }
}
