# Installation

Mettre en route la plateforme se fait avec un **assistant interactif** : il pose quelques questions, vérifie
les réponses, écrit la configuration à votre place et démarre la plateforme. **Vous n'ouvrez aucun fichier.**
Le seul prérequis est **Docker** ; la commande est la même sous Windows, Linux et macOS.

Pour qui ? Pour tout le monde : le bureau peut le lancer lui-même sur son ordinateur pour essayer, et la
personne technique s'en sert sur le serveur. Les personnes à l'aise avec un terminal qui préfèrent éditer les
fichiers à la main trouvent l'ancienne méthode en [annexe](#annexe--installation-manuelle).

---

## L'assistant d'installation

### 1. Installer Docker et Git

| Outil                                                 | Windows                                                                                        | Linux                                                        | macOS                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Docker Desktop (ou Docker Engine + Compose sur Linux) | [Docker Desktop](https://www.docker.com/products/docker-desktop/), avec le backend WSL2 activé | `docker` + `docker compose` (paquet `docker-compose-plugin`) | [Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| Git                                                   | [git-scm.com](https://git-scm.com/) ou `winget install Git.Git`                                | gestionnaire de paquets de votre distribution                | `brew install git` ou Xcode Command Line Tools                    |

Sous Windows et macOS, **lancez Docker Desktop** et attendez qu'il indique qu'il tourne. Vérifiez :

```
git --version
docker compose version
```

Pas besoin de Node.js.

### 2. Récupérer le code

```
git clone https://github.com/<votre-fork>/BDE_Network.git
cd BDE_Network
```

### 3. Lancer l'assistant

Depuis le dossier `BDE_Network` (PowerShell, Terminal macOS ou Linux, c'est identique) :

```
docker compose -f docker-compose.setup.yml run --rm --build setup
```

La première fois, Docker prépare l'assistant (une minute). Choisissez ensuite le français ou l'anglais, puis
répondez. **Entrée** accepte la valeur proposée entre crochets ; **Ctrl+C** quitte à tout moment **sans rien
modifier**.

### Ce que l'assistant demande

| Étape | Question                    | Ce que fait l'assistant                                                                                                                                   |
| ----- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Nom du BDE, couleur, langue | Vérifie chaque réponse tout de suite (couleur hexadécimale, etc.).                                                                                        |
| 2     | Adresse de la plateforme    | `localhost` pour un essai, ou votre nom de domaine. Il en déduit `APP_URL` et **l'URL de redirection exacte** à déclarer sur l'intra 42.                  |
| 3     | Application OAuth 42        | Affiche le pas à pas et l'URL à copier, demande l'**UID** et le **secret**, et les **vérifie auprès de l'API 42** (il explique l'erreur s'ils sont faux). |
| 4     | Campus autorisés            | Propose la **liste des campus 42** (recherche par nom, choix par numéro) au lieu de la taper, et en déduit le fuseau horaire.                             |
| 5     | Propriétaires               | Demande les logins 42 et **vérifie qu'ils existent** sur l'intra.                                                                                         |
| 6     | Module Événements           | Oui par défaut (calendrier, agenda synchronisé, rappels).                                                                                                 |
| 7     | Notifications (facultatif)  | Discord, Slack, e-mail ou rien. Avec un webhook ou un serveur SMTP, il **envoie un message de test** et demande si vous l'avez bien reçu.                 |
| 8     | Récapitulatif               | Montre tout (sans les secrets) et demande confirmation avant d'écrire.                                                                                    |
| 9     | Démarrage                   | Construit et démarre la plateforme, attend qu'elle réponde et **donne l'adresse à ouvrir**.                                                               |

Le **secret de session** (`AUTH_SECRET`) et le **mot de passe de la base de données** sont **générés
automatiquement** : vous ne les voyez ni ne les tapez jamais.

**À préparer avant** (l'assistant vous guide, mais c'est plus rapide si c'est prêt) :

- un compte sur l'**intra 42**, pour créer l'application OAuth (l'assistant affiche exactement quoi remplir) ;
- les **logins 42** des propriétaires ;
- si vous voulez des notifications : une **URL de webhook** Discord ou Slack, ou les réglages SMTP.
  Discord est l'option la plus simple ; pour Slack, un lien pré-rempli est fourni
  ([détails](notifications.md#slack)).

### Ce qu'il écrit

Deux fichiers, à la racine du projet : **`.env`** (les secrets, jamais commité) et **`bde.config.yml`**
(les réglages du BDE, versionné avec le code). Les deux sont vérifiés avec les règles mêmes de la plateforme
avant d'être écrits, et **rien n'est écrit tant que vous n'avez pas confirmé le récapitulatif** ; un Ctrl+C
n'écrit jamais rien de partiel.

### Le modifier plus tard

Relancez **la même commande**. L'assistant reprend les valeurs actuelles comme valeurs par défaut (Entrée
partout ne change rien), puis ne réécrit que ce qui change. **Avant d'écraser un fichier, il en garde une
copie** dans `.setup-backups/<date>/` (ces copies contiennent des secrets : elles ne sont jamais commitées).
Il **conserve** l'`AUTH_SECRET` et le mot de passe de la base (les changer casserait la base existante), ainsi
que ce qu'il ne demande pas (logo, catégories d'événements, autres réglages de `.env`).

### Comment il démarre la plateforme

L'assistant tourne dans son propre conteneur Docker. Pour démarrer la plateforme à votre place, il utilise le
**socket Docker** de votre machine (`docker-compose.setup.yml` le monte pour cela) : il peut donc commander
Docker, comme vous le feriez. Si ce n'est pas possible chez vous, il le dit et vous donne la commande à lancer
vous-même (`docker compose up --build -d`) ; la configuration, elle, est déjà écrite. Si vous préférez ne pas
lui donner cet accès, retirez la ligne du socket dans `docker-compose.setup.yml`.

### Ensuite

Ouvrez l'adresse donnée (`http://localhost:3000` pour un essai) et cliquez sur « Se connecter avec 42 » :
comme votre login est dans la liste des propriétaires, vous avez directement tous les droits.

### Après la mise en route : les rôles

Connectez-vous avec 42 à l'adresse que l'assistant a donnée : comme votre login est dans la liste des
propriétaires, vous êtes propriétaire. Ensuite, **sans toucher à un fichier** :

1. **Rôles** (menu de gauche) : deux rôles existent déjà, _Admin_ (tous les droits) et _Membre_
   (consulter les événements). Créez les vôtres : Président, Trésorier, Responsable événements… en
   cochant ce que chacun peut faire ([détails](roles.md)).
2. **Membres** : chaque personne qui se connecte pour la première fois arrive « en attente » ; vous
   l'approuvez et choisissez son rôle.
3. **Événements** : créez le premier événement, et proposez à chacun de [synchroniser son
   agenda](events.md).

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

## Annexe : installation manuelle

Pour les personnes à l'aise avec un terminal qui préfèrent tout faire à la main : c'est exactement ce que fait
l'assistant. Elle sert aussi à comprendre ce qui est écrit dans les fichiers.

### Décider des valeurs et remplir `bde.config.yml`

#### Ce qu'il faut décider

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

#### Remplir le fichier

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

### Mise en route à la main, pas à pas

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

---

## Problèmes fréquents

**L'assistant dit « L'API 42 refuse ces identifiants (invalid_client) »**

L'UID et le secret ne forment pas une paire valide : copiez-les à nouveau depuis la page de l'application sur
l'intra (un espace en trop ou un caractère manquant suffit), vérifiez que le secret n'a pas expiré ni été
régénéré, et qu'ils viennent de la **même** application.

**L'assistant dit « Je ne peux pas démarrer la plateforme depuis ici »**

Docker n'est pas joignable depuis l'assistant (socket Docker absent ou refusé). La configuration est écrite :
lancez simplement `docker compose up --build -d` depuis le dossier du projet.

**L'application redémarre en boucle avec « bde.config.yml est introuvable », alors que le fichier est bien dans le dossier**

Avant ce correctif, Docker « montait » `bde.config.yml` dans le conteneur. Ce montage est fait par le démon Docker,
avec les droits d'un utilisateur du conteneur qui n'est pas vous. Sur un poste où Docker tourne **sans droits
administrateur** (« rootless ») ou dont le dossier personnel est sur un **partage réseau**, le fichier est monté mais
l'application n'a pas le droit de le lire (un `chmod 644` n'y change rien), ou le démon ne voit pas votre dossier. Et
l'ancien message disait « introuvable » dans tous les cas.

Il n'y a plus de montage : le fichier est copié dans l'image pendant la construction, par le client Docker, avec vos
propres droits. Pour l'appliquer :

```
git pull
docker compose up --build -d
```

Si `bde.config.yml` est absent, vide, illisible ou invalide, la plateforme (tant que ses réglages ne sont pas
encore dans sa base de données) n'est plus en boucle : elle affiche une page « à corriger » et son journal
(`docker compose logs app`) nomme le cas, le chemin vérifié et ce qu'il faut faire. Si un **dossier**
`bde.config.yml` traîne dans le projet (laissé par un ancien montage raté), supprimez-le avec
`rmdir bde.config.yml`, puis relancez l'assistant d'installation ou faites
`cp bde.config.example.yml bde.config.yml`, puis `docker compose up -d --build`. Pour **changer un réglage** d'une
plateforme déjà démarrée, voir [modifier un réglage](configuration.md#modifier-un-réglage-en-attendant).

Pour voir ce que le conteneur voit réellement (et ce que le démon Docker voit de votre dossier), depuis le
dossier du projet, sous Linux ou macOS :

```
docker compose run --rm --no-deps -v "$PWD":/hote:ro --entrypoint sh app -c 'echo "== conteneur =="; id; ls -ld /app/bde.config.yml; head -n 3 /app/bde.config.yml 2>&1; echo "== dossier du projet vu par le démon Docker =="; ls -la /hote'; echo "== Docker =="; docker info --format 'securite={{.SecurityOptions}} hote={{.Name}}'; echo "DOCKER_HOST=$DOCKER_HOST"; echo "== machine =="; ls -ld bde.config.yml; pwd
```

Lecture du résultat :

| Ce que vous voyez                                                          | Signification                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `head: /app/bde.config.yml: Permission denied`                             | Le fichier est là mais l'application (`uid=1001`) n'a pas le droit de le lire : la panne décrite. |
| `drwx… /app/bde.config.yml` et `Is a directory`                            | Le montage a laissé un dossier à la place du fichier.                                             |
| `-rw… nextjs … /app/bde.config.yml` et les premières lignes du fichier     | Le conteneur lit sa configuration : tout va bien.                                                 |
| La liste sous « vu par le démon Docker » est vide ou sans `bde.config.yml` | Le démon ne voit pas votre dossier : aucun montage ne pouvait marcher.                            |
| `securite=[… name=rootless …]`                                             | Docker tourne sans droits administrateur.                                                         |

**Le site affiche une page « … à corriger » ou « … ne répond pas » (erreur 503) au lieu de la plateforme**

C'est voulu : la plateforme n'a pas pu démarrer, et elle le dit au lieu de redémarrer sans fin. La page nomme le
problème et donne les commandes à lancer ; le détail complet est dans `docker compose logs app`. Les cas :

| La page dit…                                      | Cause                                                                                                                                                                                        | À faire                                                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| « Un réglage du fichier .env est à corriger »     | Une valeur manque ou est invalide (la page liste les **noms** des réglages, jamais leurs valeurs).                                                                                           | Corrigez `.env`, puis `docker compose up -d`.                                                                                                                      |
| « Le fichier bde.config.yml est à corriger »      | Le fichier est absent, vide ou invalide.                                                                                                                                                     | Corrigez-le, puis `docker compose up -d --build`.                                                                                                                  |
| « La base de données refuse la connexion »        | Le volume `secrets` a été supprimé ou remplacé (par exemple par `docker compose down -v`, qui supprime aussi les données), ou `POSTGRES_PASSWORD` a changé **après** la création de la base. | Restaurez l'archive des clés (`scripts/restore.sh … --secrets …`). Sinon, remettez dans `.env` les valeurs de départ de `POSTGRES_*`, puis `docker compose up -d`. |
| « La base de données ne répond pas »              | La base n'est pas (encore) démarrée : normal une minute après un redémarrage du serveur. La page se rafraîchit seule.                                                                        | Si cela dure : `docker compose ps`, puis `docker compose logs postgres`.                                                                                           |
| « La mise à jour de la base de données a échoué » | Une migration n'a pas pu s'appliquer. Le code affiché (`P3009`…) aide à chercher.                                                                                                            | Ne supprimez rien ; lisez `docker compose logs app` ; au besoin restaurez la dernière sauvegarde (voir [le guide de déploiement](deployment.md)).                  |

**« Connexion avec 42 momentanément impossible » sur la page de connexion**

42 refuse l'identifiant (UID) ou la clé secrète de l'application du BDE : la clé a expiré ou a été régénérée sur
l'intra. Allez sur <https://profile.intra.42.fr/oauth/applications>, ouvrez votre application, copiez la clé
actuelle dans `FORTYTWO_CLIENT_SECRET` (fichier `.env`), puis `docker compose up -d`. L'avertissement est aussi
dans `docker compose logs app`.

**`docker compose up` s'arrête avec « env file … .env not found »**

Le fichier `.env` n'existe pas dans le dossier du projet : lancez l'assistant d'installation (il l'écrit), ou
copiez `.env.example` vers `.env` et remplissez-le.

**`docker compose up` s'arrête avec « Bind for … failed: port is already allocated »**

Un autre programme de l'ordinateur utilise déjà le port 3000. Ajoutez `APP_PORT=3001` (ou un autre port libre) dans
`.env`, mettez le même port dans l'URL de redirection de l'application 42, puis `docker compose up -d`.

**« L'API 42 est injoignable »**

L'ordinateur n'a pas accès à Internet (ou l'API 42 est en panne). Vous pouvez continuer sans la vérification :
les campus se tapent alors à la main, et les identifiants ne sont pas testés.

**L'assistant ne trouve pas le dossier du projet**

Lancez-le depuis le dossier `BDE_Network` (celui qui contient `docker-compose.yml`).

**« Connexion refusée » après avoir autorisé sur l'intra**

- _« Votre campus 42 (…) n'est pas autorisé »_ : le campus de la personne n'est pas dans
  `auth.allowedCampuses`. Ajoutez-le (ou mettez la liste vide `[]` pour accepter tous les
  campus), puis [appliquez le changement](configuration.md#modifier-un-réglage-en-attendant). Le nom doit être écrit comme sur l'intra (`Nice`,
  `Paris`…), la casse est sans importance.
- _« Profil 42 incomplet »_ : le compte 42 n'a pas d'e-mail, de campus ou de login visible. Cela
  se règle sur l'intra, pas ici.

**Je me connecte mais je suis « en attente » alors que je suis le propriétaire**

Votre login n'est pas dans `auth.owners` (faute de frappe, ou `votre-login-42` encore en place :
l'application l'avertit au démarrage, voir `docker compose logs app`). Corrigez, puis
[appliquez le changement](configuration.md#modifier-un-réglage-en-attendant), puis reconnectez-vous.

**L'intra répond « redirect URI not valid » / `redirect_uri_mismatch`**

L'URL de redirection de l'application 42 n'est pas exactement
`<adresse du site>/api/auth/callback/42-school` : voir l'[annexe](#étape-2--créer-lapplication-oauth-sur-lintra-42).

**Tout le monde est déconnecté, ou une page boucle, après un changement de `AUTH_SECRET`**

C'est normal : les sessions sont signées avec cette clé, les anciennes ne valent plus rien.
Chacun se reconnecte (si la page boucle, supprimer les cookies du site règle tout). Ne changez
`AUTH_SECRET` que si la clé a fuité.

**Plus personne ne peut se connecter du jour au lendemain**

Le secret de l'application 42 a sans doute expiré ([annexe](#étape-2--créer-lapplication-oauth-sur-lintra-42)) : générez-en un nouveau sur la page de l'application, puis **relancez l'assistant** et collez-le (il vérifie qu'il est bon, et garde tout le reste).

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
