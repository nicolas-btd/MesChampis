# Spécification de l'API MesChampis (Contrat d'API — Étape 6)

Ce document constitue le cahier des charges officiel de l'API serveur pour l'étape 6.
Il décrit chaque point d'accès (endpoint), les structures de données attendues et renvoyées, ainsi que la gestion des erreurs.

## 1. Principes d'architecture & Sécurité Zero-Knowledge

1. **Chiffrement de bout en bout (Zero-Knowledge)** :
   Le serveur ne reçoit et ne stocke **jamais** la clé maître de l'utilisateur, ni ses données de cueillette en clair.
   Toutes les données de carnet sont transmises sous la forme d'un bloc chiffré par la clé maître du client.
2. **Authentification séparée** :
   Le mot de passe client n'est jamais transmis au serveur. Le client dérive une clé d'authentification (`cle_auth`) via PBKDF2-SHA-256 avec un sel dédié, puis en transmet l'empreinte sécurisée (`verifMdp` = SHA-256 de `cle_auth`). Le serveur compare cette empreinte ou utilise un hachage type Argon2id de cette empreinte.
3. **Double enveloppe de clé** :
   La clé maître aléatoire est stockée sous forme de deux enveloppes chiffrées en AES-GCM 256 bits :
   - `enveloppe_mdp` : chiffrée par une clé dérivée du mot de passe.
   - `enveloppe_secours` : chiffrée par une clé dérivée du code de secours (6 groupes de 4 caractères).
4. **Format des réponses JSON** :
   Toutes les réponses d'erreur respectent la structure :
   ```json
   {
     "erreur": {
       "code": "CODE_ERREUR",
       "message": "Description humaine du problème",
       "details": {}
     }
   }
   ```

---

## 2. Codes d'erreurs typées

| Code d'erreur | Description | Statut HTTP équivalent |
| :--- | :--- | :--- |
| `RESEAU` | Impossible de joindre le serveur ou coupure de connexion | 0 / 503 |
| `NON_AUTHENTIFIE` | Session expirée ou jeton manquant | 401 |
| `IDENTIFIANTS_INVALIDES` | E-mail ou empreinte d'authentification incorrecte | 401 |
| `EMAIL_DEJA_UTILISE` | Un compte existe déjà avec cette adresse | 409 |
| `EMAIL_NON_VERIFIE` | L'adresse e-mail n'a pas encore été validée | 403 |
| `JETON_EXPIRE` | Le jeton de validation ou de réinitialisation a expiré | 410 |
| `JETON_INVALIDE` | Le jeton fourni est introuvable ou malformé | 400 |
| `CONFLIT` | La version du carnet côté client ne correspond pas à la version serveur | 409 |
| `COMPTE_NON_TROUVE` | Aucun compte ne correspond à cet e-mail | 404 |
| `NON_DISPONIBLE` | Service non configuré ou non disponible | 501 |

---

## 3. Endpoints d'authentification & compte

### 3.1. Inscription
- **Méthode / Action :** `inscrire(email, verifMdp, enveloppes)`
- **Route future :** `POST /api/v1/auth/inscription`
- **Corps de la requête :**
  ```json
  {
    "email": "cueilleur@example.com",
    "verifMdp": "hash_sha256_hex_de_cle_auth",
    "enveloppes": {
      "enveloppe_mdp": {
        "algo": "AES-GCM",
        "iv": "base64...",
        "sel_kdf": "base64...",
        "iterations": 250000,
        "donnees": "base64..."
      },
      "enveloppe_secours": {
        "algo": "AES-GCM",
        "iv": "base64...",
        "sel_kdf": "base64...",
        "iterations": 250000,
        "donnees": "base64..."
      }
    }
  }
  ```
- **Réponse succès (201) :**
  ```json
  {
    "succes": true,
    "email": "cueilleur@example.com",
    "email_verifie": false,
    "message": "Un e-mail de validation a été envoyé."
  }
  ```
- **Erreurs possibles :** `EMAIL_DEJA_UTILISE`, `PARAMETRES_INVALIDES`.

---

### 3.2. Vérification de l'adresse e-mail
- **Méthode / Action :** `verifierEmail(jeton)`
- **Route future :** `POST /api/v1/auth/verifier-email`
- **Corps de la requête :**
  ```json
  {
    "jeton": "token_uuid_ou_chiffre"
  }
  ```
- **Réponse succès (200) :**
  ```json
  {
    "succes": true,
    "email": "cueilleur@example.com",
    "email_verifie": true
  }
  ```
- **Erreurs possibles :** `JETON_EXPIRE`, `JETON_INVALIDE`.

---

### 3.3. Connexion
- **Méthode / Action :** `connecter(email, verifMdp)`
- **Route future :** `POST /api/v1/auth/connexion`
- **Corps de la requête :**
  ```json
  {
    "email": "cueilleur@example.com",
    "verifMdp": "hash_sha256_hex_de_cle_auth"
  }
  ```
- **Réponse succès (200) :**
  ```json
  {
    "succes": true,
    "session": {
      "email": "cueilleur@example.com",
      "jeton_session": "jwt_ou_cookie_http_only",
      "expire_le": "2026-12-02T10:00:00.000Z"
    },
    "enveloppes": {
      "enveloppe_mdp": { ... },
      "enveloppe_secours": { ... }
    }
  }
  ```
- **Erreurs possibles :** `IDENTIFIANTS_INVALIDES`, `EMAIL_NON_VERIFIE`, `COMPTE_NON_TROUVE`.

---

### 3.4. Déconnexion
- **Méthode / Action :** `deconnecter()`
- **Route future :** `POST /api/v1/auth/deconnexion`
- **En-têtes :** `Authorization: Bearer <jeton_session>`
- **Réponse succès (200) :**
  ```json
  {
    "succes": true
  }
  ```

---

### 3.5. Demande de réinitialisation de mot de passe (oubli)
- **Méthode / Action :** `demanderReinitialisation(email)`
- **Route future :** `POST /api/v1/auth/demande-reinitialisation`
- **Corps de la requête :**
  ```json
  {
    "email": "cueilleur@example.com"
  }
  ```
- **Réponse succès (200) :**
  ```json
  {
    "succes": true,
    "message": "Si cette adresse existe, un lien de réinitialisation y a été expédié."
  }
  ```

---

### 3.6. Réinitialisation effective
- **Méthode / Action :** `reinitialiser(jeton, nouvelleVerif, nouvelleEnveloppeMdp)`
- **Route future :** `POST /api/v1/auth/reinitialiser`
- **Corps de la requête :**
  ```json
  {
    "jeton": "token_reinitialisation",
    "nouvelleVerif": "nouveau_hash_cle_auth",
    "nouvelleEnveloppeMdp": { ... }
  }
  ```
- **Réponse succès (200) :**
  ```json
  {
    "succes": true
  }
  ```
- **Erreurs possibles :** `JETON_EXPIRE`, `JETON_INVALIDE`.

---

### 3.7. Lecture des enveloppes
- **Méthode / Action :** `lireEnveloppes()`
- **Route future :** `GET /api/v1/compte/enveloppes`
- **En-têtes :** `Authorization: Bearer <jeton_session>`
- **Réponse succès (200) :**
  ```json
  {
    "enveloppe_mdp": { ... },
    "enveloppe_secours": { ... }
  }
  ```

---

### 3.8. Suppression définitive du compte
- **Méthode / Action :** `supprimerCompte()`
- **Route future :** `DELETE /api/v1/compte`
- **En-têtes :** `Authorization: Bearer <jeton_session>`
- **Réponse succès (200) :**
  ```json
  {
    "succes": true,
    "message": "Compte et données chiffrées purgés définitivement."
  }
  ```

---

## 4. Endpoints de synchronisation du carnet

### 4.1. Envoi du carnet chiffré (Push)
- **Méthode / Action :** `envoyerCarnet(bloc, version_attendue)`
- **Route future :** `PUT /api/v1/carnet`
- **En-têtes :** `Authorization: Bearer <jeton_session>`
- **Corps de la requête :**
  ```json
  {
    "version_attendue": 1,
    "bloc": {
      "algo": "AES-GCM",
      "iv": "base64...",
      "donnees": "base64..."
    }
  }
  ```
- **Réponse succès (200) :**
  ```json
  {
    "succes": true,
    "version": 2,
    "synchronise_le": "2026-11-02T10:15:00.000Z"
  }
  ```
- **Erreur de conflit (409 CONFLIT) :**
  Si le serveur possède une version plus récente (`version_actuelle > version_attendue`), le serveur rejette l'écriture :
  ```json
  {
    "erreur": {
      "code": "CONFLIT",
      "message": "Une version plus récente du carnet existe sur le serveur.",
      "details": {
        "version_actuelle": 3
      }
    }
  }
  ```
  *Comportement client obligatoire :* Le client télécharge la version actuelle, la déchiffre avec sa clé maître, fusionne avec ses données locales (`modifie_le` le plus récent), incrémente la version attendue et renvoie le carnet.

---

### 4.2. Téléchargement du carnet chiffré (Pull)
- **Méthode / Action :** `telechargerCarnet()`
- **Route future :** `GET /api/v1/carnet`
- **En-têtes :** `Authorization: Bearer <jeton_session>`
- **Réponse succès (200) :**
  ```json
  {
    "version": 2,
    "bloc": {
      "algo": "AES-GCM",
      "iv": "base64...",
      "donnees": "base64..."
    },
    "modifie_le": "2026-11-02T10:15:00.000Z"
  }
  ```
  *(Si le carnet serveur est vide : `version: 0`, `bloc: null`)*.

---

## 5. Endpoints des droits, essai gratuit et abonnement

### 5.1. Consultation des droits
- **Méthode / Action :** `droits()`
- **Route future :** `GET /api/v1/compte/droits`
- **En-têtes :** Optionnel (`Authorization: Bearer <jeton_session>`)
- **Réponse succès (200) :**
  ```json
  {
    "connecte": true,
    "email": "cueilleur@example.com",
    "premium": false,
    "essai_debut": null,
    "essai_fin": null,
    "essai_utilise": false,
    "statut_abonnement": "aucun"
  }
  ```

---

### 5.2. Démarrage de l'essai de 7 jours
- **Méthode / Action :** `demarrerEssai()`
- **Route future :** `POST /api/v1/compte/demarrer-essai`
- **En-têtes :** `Authorization: Bearer <jeton_session>`
- **Réponse succès (200) :**
  ```json
  {
    "succes": true,
    "essai_debut": "2026-11-02T10:30:00.000Z",
    "essai_fin": "2026-11-09T10:30:00.000Z"
  }
  ```
- **Erreurs possibles :** `ESSAI_DEJA_UTILISE` (l'essai gratuit est strictement unique par compte).

---

### 5.3. Création de session de paiement (Stripe Checkout)
- **Méthode / Action :** `creerSessionPaiement(offre)`
- **Route future :** `POST /api/v1/paiement/creer-session`
- **Corps de la requête :**
  ```json
  {
    "offre": "pass_saison"
  }
  ```
  *(Offres valides : `"pass_saison"` à 29€, `"annuel"` à 49€)*.
- **Réponse succès (200) :**
  ```json
  {
    "session_url": "https://checkout.stripe.com/c/pay/cs_live_...",
    "session_id": "cs_live_..."
  }
  ```

---

### 5.4. Accès au portail client Stripe (Gestion d'abonnement / Résiliation)
- **Méthode / Action :** `portailClient()`
- **Route future :** `POST /api/v1/paiement/portail-client`
- **En-têtes :** `Authorization: Bearer <jeton_session>`
- **Réponse succès (200) :**
  ```json
  {
    "url": "https://billing.stripe.com/p/session/..."
  }
  ```
