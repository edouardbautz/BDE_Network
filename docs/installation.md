# Installation

Mettre en route la plateforme se fait en **deux temps**, par deux personnes différentes (ce peut
être la même) :

|                                                                    | Qui                                 | Ce que c'est                                                                          | Compétence                        |
| ------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------- |
| [**1. Pour le bureau**](#1-pour-le-bureau)                         | Le bureau (président, trésorier…)   | Décider du nom, des campus, des propriétaires, des catégories d'événements, des rôles | Aucune : on remplit un formulaire |
| [**2. Pour la personne technique**](#2-pour-la-personne-technique) | Un membre à l'aise avec un terminal | Un serveur, Docker, une application OAuth 42, le nom de domaine, le HTTPS             | Technique, mais tout est détaillé |

Lisez la partie 1 même si vous êtes la personne technique : c'est elle qui dit **quelles valeurs
mettre** dans les fichiers de la partie 2.

---

## 1. Pour le bureau

Vous n'avez rien à installer. Vous avez à **décider** quelques points, puis à les écrire dans un
fichier texte, `bde.config.yml`, que la personne technique mettra sur le serveur. Les rôles, eux,
se règlent ensuite directement dans la plateforme, sans fichier.

### Ce qu'il faut décider

| Question                                         | Où ça va               | Exemple                                   |
| ------------------------------------------------ | ---------------------- | ----------------------------------------- |
| Comment s'appelle le bureau ?                    | `bde.name`             | `BDE Les Lynx`                            |
| Sur quel campus 42 est-il ?                      | `bde.campus`           | `Nice`                                    |
| Quels campus peuvent se connecter ?              | `auth.allowedCampuses` | `Nice` (liste vide = tous les campus)     |
| Qui est **propriétaire** de la plateforme ?      | `auth.owners`          | votre **login 42**, par exemple `jdupont` |
| Quelle couleur pour l'interface ?                | `bde.accentColor`      | `#0f766e`                                 |
| Quelles catégories d'événements ?                | `events.categories`    | Soirée, Sport, Réunion                    |
| Une adresse pour les questions sur les données ? | `bde.contactEmail`     | `bureau@exemple.fr` (facultatif)          |

Un **propriétaire** a tous les droits et ne peut être défini que dans ce fichier : choisissez-en
au moins un, de confiance, et **donnez son vrai login 42** (celui de l'intra, en minuscules). Si
vous laissez `votre-login-42`, personne n'aura accès à l'administration.

### Remplir le fichier

Ouvrez `bde.config.yml` avec n'importe quel éditeur de texte (le Bloc-notes suffit). Voici un
exemple complet :

```yaml
bde:
  name: 'BDE Les Lynx'
  campus: 'Nice'
  timezone: 'Europe/Paris'
  defaultLocale: 'fr'
  accentColor: '#0f766e'
  logoPath: '/logo.svg'
  contactEmail: 'bureau@exemple.fr'

auth:
  owners:
    - 'jdupont'
  allowedCampuses:
    - 'Nice'

modules:
  enabled:
    - events

events:
  categories:
    - key: soiree
      label: 'Soirée'
      color: '#db2777'
    - key: sport
      label: 'Sport'
      color: '#16a34a'
    - key: reunion
      label: 'Réunion'
      color: '#2563eb'
```

Quelques règles pour ne pas casser le fichier :

- **Gardez les espaces au début des lignes** (ils servent à ranger les informations) et les
  apostrophes `'` autour des textes.
- Une liste s'écrit avec un tiret par ligne (`- 'jdupont'`) ; pour plusieurs propriétaires, ajoutez
  une ligne.
- La `key` d'une catégorie (`soiree`) ne s'écrit qu'en minuscules, chiffres et tirets, et **ne se
  change plus** une fois des événements créés ; le `label` (« Soirée ») se change quand on veut.
- Si une valeur est fausse, l'application **refuse de démarrer et dit laquelle corriger** : rien
  n'est cassé, corrigez et relancez.

Les notifications (e-mail, Discord, Slack) sont **désactivées tant que vous ne les réglez pas** : le
fichier ci-dessus n'a pas besoin d'en parler. La liste complète des réglages, notifications comprises,
est dans [la référence](configuration.md).

### Après la mise en route : les rôles

La personne technique vous donne l'adresse du site. Connectez-vous avec 42 : comme votre login est
dans `owners`, vous êtes propriétaire. Ensuite, **sans toucher à un fichier** :

1. **Rôles** (menu de gauche) : deux rôles existent déjà, _Admin_ (tous les droits) et _Membre_
   (consulter les événements). Créez les vôtres : Président, Trésorier, Responsable événements… en
   cochant ce que chacun peut faire ([détails](roles.md)).
2. **Membres** : chaque personne qui se connecte pour la première fois arrive « en attente » ; vous
   l'approuvez et choisissez son rôle.
3. **Événements** : créez le premier événement, et proposez à chacun de [synchroniser son
   agenda](events.md).

À transmettre à la personne technique : le **fichier `bde.config.yml` rempli** et le **nom du
site** voulu (par exemple `bde.exemple.fr`).

---

## 2. Pour la personne technique

### Prérequis

Le projet se lance à l'identique sur Windows, Linux et macOS via Docker Compose. Vous n'avez
besoin d'installer Node.js que si vous contribuez au code (voir
[le guide contributeur](contributing-guide.md)).

| Outil                                                 | Windows                                                                                        | Linux                                                        | macOS                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Docker Desktop (ou Docker Engine + Compose sur Linux) | [Docker Desktop](https://www.docker.com/products/docker-desktop/), avec le backend WSL2 activé | `docker` + `docker compose` (paquet `docker-compose-plugin`) | [Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| Git                                                   | [git-scm.com](https://git-scm.com/) ou `winget install Git.Git`                                | gestionnaire de paquets de votre distribution                | `brew install git` ou Xcode Command Line Tools                    |

Sur Windows, activez WSL2 si Docker Desktop vous le demande (`wsl --install` dans PowerShell
administrateur, puis redémarrez) et **lancez Docker Desktop** avant de continuer. Vérifiez :

```
git --version
docker --version
docker compose version
```

### Étape 1 : récupérer le code

```
git clone https://github.com/<votre-fork>/BDE_Network.git
cd BDE_Network
```

### Étape 2 : créer l'application OAuth sur l'intra 42

La connexion se fait uniquement avec les comptes 42 : la plateforme a besoin d'une « application »
déclarée sur l'intra, qui donne deux valeurs (un **UID** et un **secret**).

1. Connectez-vous à l'intra 42, puis ouvrez <https://profile.intra.42.fr/oauth/applications/new>.
2. Remplissez le formulaire :

   | Champ        | Valeur                                                                                             |
   | ------------ | -------------------------------------------------------------------------------------------------- |
   | Name         | Le nom de votre BDE (il est montré aux membres au moment d'autoriser la connexion)                 |
   | Type         | **Campus Tool**                                                                                    |
   | Description  | Une phrase, par exemple « Plateforme de gestion du BDE »                                           |
   | Website      | L'adresse de votre plateforme (`https://bde.exemple.fr`, ou `http://localhost:3000` pour un essai) |
   | Redirect URI | **`https://bde.exemple.fr/api/auth/callback/42-school`** — voir ci-dessous                         |
   | Scopes       | **`public`** seulement (c'est le défaut)                                                           |

3. **L'URL de redirection doit être exacte**, au caractère près : l'adresse du site (même
   `http`/`https`, même nom de domaine, même port) **suivie de** `/api/auth/callback/42-school`.
   Sans barre oblique finale. Pour un essai sur votre ordinateur :
   `http://localhost:3000/api/auth/callback/42-school`. Vous pouvez en déclarer plusieurs (une par
   ligne) pour garder l'essai local en plus de la production.
4. Validez. Sur la page de l'application, notez :
   - **UID** → `FORTYTWO_CLIENT_ID`
   - **SECRET** → `FORTYTWO_CLIENT_SECRET` (cliquez sur l'œil pour l'afficher).

> **Le secret expire.** Sa date d'expiration est affichée sur la page de l'application. Le jour
> où il expire, **plus personne ne peut se connecter** (erreur `invalid_client`). Notez cette date
> dans un agenda ; avant, générez un nouveau secret sur la même page, remplacez
> `FORTYTWO_CLIENT_SECRET` dans `.env`, puis relancez : `docker compose up -d`.

Si en cliquant sur « Se connecter avec 42 » l'intra répond **« The redirect URI included is not
valid »** (ou `redirect_uri_mismatch`) : l'URL de redirection de l'application ne correspond pas
exactement à celle que la plateforme envoie. Comparez-les : le message d'erreur de l'intra montre
l'adresse reçue, et c'est celle-ci qu'il faut déclarer (http au lieu de https ? `www.` en trop ?
port oublié ? barre finale ?).

### Étape 3 : les secrets (`.env`)

Copiez le modèle :

```
# Windows (PowerShell)
Copy-Item .env.example .env

# Linux / macOS / Git Bash
cp .env.example .env
```

Ouvrez `.env` et remplissez :

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` : les identifiants de la base. Mettez **un mot
  de passe à vous** (les valeurs d'exemple ne conviennent qu'à un essai local). Ne touchez pas à
  `DATABASE_URL` : Docker la remplace tout seul (elle ne sert qu'aux développeurs, hors Docker).
- `AUTH_SECRET` : une clé secrète d'au moins 32 caractères. Cette commande en génère une, **sans
  Node.js, sous Windows, Linux et macOS** (Docker suffit) :

  ```
  docker run --rm alpine sh -c "head -c 32 /dev/urandom | base64"
  ```

  Collez le résultat après `AUTH_SECRET=`. Ne la partagez pas et ne la changez pas sans raison
  (voir « Problèmes fréquents »).

- `FORTYTWO_CLIENT_ID` et `FORTYTWO_CLIENT_SECRET` : l'UID et le secret de l'étape 2.
- `APP_URL` : l'adresse publique du site (`https://bde.exemple.fr`). Facultatif pour un essai.

Les autres variables (e-mail, Discord, Slack) sont facultatives : voir
[la configuration](configuration.md).

### Étape 4 : la configuration du BDE

Remplacez le fichier `bde.config.yml` du dépôt par celui que le bureau vous a donné (ou éditez-le
avec lui : [partie 1](#1-pour-le-bureau)). Vérifiez surtout que **`auth.owners` contient un vrai
login 42**.

### Étape 5 : lancer

```
docker compose up --build -d
docker compose logs -f app
```

Premier lancement : construction de l'image (quelques minutes), migrations de la base appliquées
toutes seules, puis démarrage. Quand les logs affichent `Ready`, tout est prêt (`Ctrl+C` quitte
l'affichage des logs, pas l'application). Si `.env` ou `bde.config.yml` est incomplet, l'application
**le dit en français** dans ces logs, avec quoi corriger. Les lancements suivants sont quasi
instantanés (`docker compose up -d`).

(Les logs écrivent `http://localhost:3000` : c'est le port _à l'intérieur_ du conteneur. Le site
est sur le port publié, 3000 par défaut.)

Un autre programme utilise déjà le port 3000 (`port is already allocated`) ? Ajoutez `APP_PORT=3001` (ou un autre port libre) dans
`.env` — et utilisez ce port dans l'adresse et dans l'URL de redirection de l'étape 2.

### Étape 6 : se connecter

Ouvrez <http://localhost:3000>, cliquez sur « Se connecter avec 42 ». Si votre login est dans
`auth.owners`, vous êtes propriétaire dès la première connexion. Sinon votre compte est « en
attente » : un propriétaire doit l'approuver depuis la page Membres.

### Mise en production

Pour que les membres y accèdent : un serveur, un nom de domaine et un proxy HTTPS (Caddy,
nginx…). La plateforme n'écoute volontairement que sur la machine elle-même ; le proxy la montre
au monde en HTTPS. Tout est dans [le guide de déploiement](deployment.md), sauvegardes comprises.

### Arrêter / réinitialiser

```
docker compose down          # arrête les conteneurs, conserve les données
docker compose down -v       # arrête et supprime aussi les données (la base)
```

---

## Problèmes fréquents

**« Connexion refusée » après avoir autorisé sur l'intra**

- _« Votre campus 42 (…) n'est pas autorisé »_ : le campus de la personne n'est pas dans
  `auth.allowedCampuses`. Ajoutez-le (ou mettez la liste vide `[]` pour accepter tous les
  campus), puis `docker compose restart app`. Le nom doit être écrit comme sur l'intra (`Nice`,
  `Paris`…), la casse est sans importance.
- _« Profil 42 incomplet »_ : le compte 42 n'a pas d'e-mail, de campus ou de login visible. Cela
  se règle sur l'intra, pas ici.

**Je me connecte mais je suis « en attente » alors que je suis le propriétaire**

Votre login n'est pas dans `auth.owners` (faute de frappe, ou `votre-login-42` encore en place :
l'application l'avertit au démarrage, voir `docker compose logs app`). Corrigez, puis
`docker compose restart app`, puis reconnectez-vous.

**L'intra répond « redirect URI not valid » / `redirect_uri_mismatch`**

L'URL de redirection de l'application 42 n'est pas exactement
`<adresse du site>/api/auth/callback/42-school` : voir l'étape 2.

**Tout le monde est déconnecté, ou une page boucle, après un changement de `AUTH_SECRET`**

C'est normal : les sessions sont signées avec cette clé, les anciennes ne valent plus rien.
Chacun se reconnecte (si la page boucle, supprimer les cookies du site règle tout). Ne changez
`AUTH_SECRET` que si la clé a fuité.

**Plus personne ne peut se connecter du jour au lendemain**

Le secret de l'application 42 a sans doute expiré (étape 2) : générez-en un nouveau.

**`Cannot connect to the Docker daemon` / `failed to connect to the docker API`**

Docker n'est pas démarré. Sous Windows et macOS, **lancez Docker Desktop** et attendez que son
icône indique qu'il tourne ; sous Linux, `sudo systemctl start docker`.

**Le conteneur `app` redémarre en boucle**

`.env` ou `bde.config.yml` est incomplet ou faux. L'application refuse de démarrer et explique,
en français, quoi corriger : `docker compose logs app`.

**Port 3000 déjà utilisé** (`port is already allocated`)

Un autre programme tourne dessus. Mettez `APP_PORT=3001` dans `.env` (puis adaptez l'URL de
redirection), ou arrêtez l'autre programme.

**Le site n'est pas joignable depuis un autre ordinateur**

C'est voulu : l'application n'écoute que sur la machine elle-même (`127.0.0.1`). En production c'est le
proxy HTTPS qui l'expose ([déploiement](deployment.md)).

**Windows : lenteur au démarrage**

La première synchronisation de fichiers par Docker Desktop est plus lente que sous Linux ;
les lancements suivants sont rapides.

Pour un environnement de contribution avec rechargement à chaud, voir
[le guide contributeur](contributing-guide.md).
