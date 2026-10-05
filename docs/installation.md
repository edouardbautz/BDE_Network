# Installation

## Prérequis

Le projet se lance à l'identique sur Windows, Linux et macOS via Docker Compose. Vous n'avez
besoin d'installer Node.js localement que si vous contribuez au code (voir
[le guide contributeur](contributing-guide.md)).

| Outil                                                 | Version | Windows                                                                                        | Linux                                                        | macOS                                                             |
| ----------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Docker Desktop (ou Docker Engine + Compose sur Linux) | récente | [Docker Desktop](https://www.docker.com/products/docker-desktop/), avec le backend WSL2 activé | `docker` + `docker compose` (paquet `docker-compose-plugin`) | [Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| Git                                                   | récente | [git-scm.com](https://git-scm.com/) ou via `winget install Git.Git`                            | via le gestionnaire de paquets de votre distribution         | via `brew install git` ou Xcode Command Line Tools                |

Sur Windows, activez WSL2 si Docker Desktop vous le demande à la première installation
(`wsl --install` dans un terminal PowerShell administrateur, puis redémarrez).

Vérifiez que tout est en place :

```
git --version
docker --version
docker compose version
```

## 1. Cloner le dépôt

```
git clone https://github.com/<votre-fork>/BDE_Network.git
cd BDE_Network
```

## 2. Configurer les secrets (`.env`)

Copiez `.env.example` vers `.env` :

```
# Windows (PowerShell)
Copy-Item .env.example .env

# Linux / macOS
cp .env.example .env
```

Remplissez au minimum :

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` — identifiants de la base de données
  (des valeurs par défaut fonctionnent pour un premier essai local).
- `AUTH_SECRET` — une clé secrète d'au moins 32 caractères. Générez-la avec `openssl rand -base64 32`
  (ou `npx auth secret` si Node.js est installé).
- `FORTYTWO_CLIENT_ID` / `FORTYTWO_CLIENT_SECRET` — créez une application OAuth sur
  <https://profile.intra.42.fr/oauth/applications>. URL de redirection à renseigner :
  `http://localhost:3000/api/auth/callback/42-school` (adaptez le domaine en production).

Les autres variables (SMTP, webhooks Discord/Slack) sont optionnelles — voir
[docs/configuration.md](configuration.md).

## 3. Configurer votre BDE (`bde.config.yml`)

Le fichier `bde.config.yml` est déjà présent avec des valeurs d'exemple. Éditez-le : nom du BDE,
campus, votre propre login 42 dans `auth.owners` (c'est ce qui vous donne le rôle propriétaire
à la première connexion), campus autorisés à se connecter, couleur d'accent, logo.

Référence complète des champs : [docs/configuration.md](configuration.md).

## 4. Lancer l'application

```
docker compose up --build
```

Premier lancement : construction de l'image (quelques minutes), puis application des migrations
de base de données automatiquement, puis démarrage. Les lancements suivants sont quasi
instantanés (`docker compose up`, sans `--build`, sauf si vous avez modifié le code).

## 5. Se connecter

Ouvrez <http://localhost:3000>, cliquez sur « Se connecter avec 42 ». Si votre login est dans
`auth.owners` de `bde.config.yml`, vous obtenez immédiatement le rôle propriétaire. Sinon, votre
compte est en attente — un propriétaire ou administrateur doit l'approuver depuis la page
Membres.

## Arrêter / réinitialiser

```
docker compose down          # arrête les conteneurs, conserve les données
docker compose down -v       # arrête et supprime aussi les données (base + fichiers uploadés)
```

## Problèmes fréquents

- **Le build échoue avec une erreur de configuration** : `bde.config.yml` est invalide — le
  message d'erreur affiché dans les logs (`docker compose logs app`) indique quel champ corriger.
- **Le conteneur `app` redémarre en boucle** : `.env` ou `bde.config.yml` est incomplet. L'application
  refuse de démarrer et explique, en français, quoi corriger : `docker compose logs app`.
- **Port 3000 ou 5432 déjà utilisé** : un autre service tourne dessus. Changez le port publié
  dans `docker-compose.yml` (partie gauche de `"${APP_BIND:-127.0.0.1}:3000:3000"`), ou arrêtez l'autre service.
- **Le site n'est pas joignable depuis un autre ordinateur** : c'est voulu, l'application n'écoute que
  sur la machine elle-même (`127.0.0.1`) ; en production, c'est le reverse proxy HTTPS qui l'expose
  (voir [le guide de déploiement](deployment.md)).
- **Windows : lenteur au démarrage** : la première synchronisation de fichiers via Docker
  Desktop peut être plus lente que sous Linux/macOS natif ; c'est normal, les lancements suivants
  sont rapides.

Pour un environnement de contribution avec rechargement à chaud, voir
[docs/contributing-guide.md](contributing-guide.md).
