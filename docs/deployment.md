# Déploiement

Chaque BDE héberge sa propre instance, comme il le souhaite. Ce guide décrit un déploiement
type sur un VPS avec Docker Compose et un reverse proxy HTTPS ; adaptez-le à votre
infrastructure (autre hébergeur, Kubernetes, PaaS...).

Le serveur n'a besoin que de **Docker** (avec la commande `docker compose`) et de **Git**. Node.js
n'est nécessaire nulle part : ni pour lancer l'application, ni pour les sauvegardes.

## Prérequis

- Un serveur (VPS ou machine dédiée) avec Docker et Docker Compose installés.
- Un nom de domaine pointant vers ce serveur (voir plus bas si vous n'en avez pas).
- Une application OAuth 42 dont l'URL de redirection pointe vers votre domaine final :
  `https://votre-domaine.example/api/auth/callback/42-school`.

## 1. Préparer le serveur

```
git clone https://github.com/<votre-fork>/BDE_Network.git
cd BDE_Network
cp .env.example .env
```

Remplissez `.env` avec des valeurs de production :

- un mot de passe de base de données robuste (`POSTGRES_PASSWORD`) ;
- `AUTH_SECRET`, généré avec `docker run --rm alpine sh -c "head -c 32 /dev/urandom | base64"` ;
- les identifiants de votre application OAuth 42 ;
- `APP_URL` : l'adresse publique du site, par exemple `https://votre-domaine.example`.

Éditez `bde.config.yml` avec les informations réelles de votre BDE. **Mettez votre propre login 42
dans `auth.owners`** : tant que « votre-login-42 » y figure, personne n'est propriétaire et aucune
demande d'accès ne peut être validée (l'application l'indique au démarrage).

## 2. Lancer l'application

```
docker compose up --build -d
docker compose ps
```

Au démarrage, l'application vérifie `.env` et `bde.config.yml`, puis la base de données. Si quelque chose
ne va pas (valeur manquante ou invalide, mot de passe de la base refusé, base qui ne répond pas, mise à jour
de la base qui échoue), le conteneur **ne tourne pas en boucle** : il reste en vie et affiche, à l'adresse
du site, une **page qui explique le problème et quoi faire** (en français ou en anglais selon le navigateur,
sans jamais montrer de secret). `docker compose ps` montre alors `app` en « unhealthy ». Le détail complet
se lit avec :

```
docker compose logs app
```

Corrigez le fichier concerné, puis `docker compose up -d` (après une modification de `bde.config.yml` :
`docker compose up -d --build`, car il est copié dans l'image à la construction).

Par défaut, l'application n'est accessible **que depuis le serveur lui-même** (`127.0.0.1`,
port 3000, modifiable avec `APP_PORT`) : c'est le reverse proxy ci-dessous qui l'expose au public,
en HTTPS. Personne ne peut donc se connecter à l'application en HTTP clair en passant devant le
proxy. **La base de données n'a aucun port publié** : seule l'application, dans le même réseau
Docker, peut lui parler. Pour y jeter un œil depuis le serveur :
`docker compose exec postgres psql -U <POSTGRES_USER> <POSTGRES_DB>`.

## 3. Reverse proxy HTTPS

Placez un reverse proxy devant le port `3000` pour gérer le TLS. Deux options courantes :

### Caddy (certificats automatiques, configuration minimale)

```
# /etc/caddy/Caddyfile
votre-domaine.example {
    reverse_proxy localhost:3000
}
```

```
sudo systemctl reload caddy
```

Caddy obtient et renouvelle automatiquement un certificat Let's Encrypt.

### Nginx + Certbot

```
# /etc/nginx/sites-available/bde-network
server {
    listen 80;
    server_name votre-domaine.example;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```
sudo ln -s /etc/nginx/sites-available/bde-network /etc/nginx/sites-enabled/
sudo certbot --nginx -d votre-domaine.example
```

L'en-tête `X-Forwarded-Proto` est important : c'est lui qui indique à l'application que la
connexion est en HTTPS (cookies sécurisés, en-tête `Strict-Transport-Security`).

## Sans proxy HTTPS

**Le plus simple reste d'installer Caddy** : trois lignes de configuration et un nom de domaine
suffisent, même pour un petit BDE. Si vous n'avez pas de domaine, un service de tunnel (par exemple
Cloudflare Tunnel ou Tailscale) peut fournir une adresse HTTPS sans rien ouvrir sur le serveur.

Si vous choisissez malgré tout de faire tourner l'application **sans HTTPS**, comprenez ce que cela
implique : les connexions ne sont pas chiffrées, donc la session des membres (et ce qu'ils voient)
peut être interceptée par n'importe qui sur le même réseau. Réservez ce mode à :

- un essai sur votre propre machine ;
- un réseau privé de confiance (le réseau local du BDE), **jamais Internet**.

Pour cela, dans `.env` :

```
APP_BIND=0.0.0.0
APP_URL=http://adresse-ou-ip-du-serveur:3000
```

puis `docker compose up -d`. L'URL de redirection de l'application OAuth 42 doit alors être
`http://adresse-ou-ip-du-serveur:3000/api/auth/callback/42-school`. Rien d'autre ne change :
l'application fonctionne en HTTP (elle n'impose pas HTTPS aux navigateurs).

> ⚠️ Sur un serveur public, `APP_BIND=0.0.0.0` ouvre le port 3000 à tout Internet, en clair.
> Si c'est le cas, fermez-le avec le pare-feu du serveur, ou installez le proxy HTTPS. Au démarrage,
> l'application affiche un avertissement si `APP_URL` est une adresse `http://` publique.

## Surveiller l'application

```
docker compose ps                       # l'état doit être « healthy »
curl http://127.0.0.1:3000/api/health    # {"status":"ok"}
docker compose logs --tail 50 app
```

`/api/health` répond `503` quand la base de données est injoignable, et `docker compose ps`
affiche alors « unhealthy ». Pendant ce temps, les visiteurs voient une page « Service
momentanément indisponible » qui les ramène toute seule à la plateforme dès que la base répond de
nouveau : ils n'ont rien à faire, et aucune donnée n'est perdue. Pour trouver la cause :
`docker compose logs postgres`.

## Rappels du module Événements

Si le module Événements est activé, le conteneur `app` doit **tourner en continu** : c'est lui
qui envoie les rappels de la veille (une boucle interne, aucun cron à configurer). S'il est
arrêté à l'heure du rappel, celui-ci part au redémarrage tant que l'événement n'a pas commencé.
Renseignez `APP_URL` dans `.env` pour que les notifications contiennent un lien. Détails :
[Module Événements](events.md#comment-fonctionne-le-rappel-de-la-veille).

## Mettre à jour l'application

Faites une sauvegarde d'abord (voir ci-dessous), puis :

```
git pull
docker compose up --build -d
```

Les migrations de base de données s'appliquent automatiquement au démarrage du conteneur.

## Sauvegardes et restauration

Une sauvegarde contient **la base de données** dans une seule archive,
`backups/bde-backup-AAAA-MM-JJ_HH-MM-SS.tar.gz`. Elle se fait avec Docker seul, sans Node.js
(sous Windows, depuis Git Bash ou WSL).

```
./scripts/backup.sh                 # une sauvegarde
./scripts/backup.sh --keep 14       # ... en ne gardant que les 14 plus récentes
```

**Sous Windows**, ces scripts sont écrits en `sh` : ils se lancent depuis **Git Bash** (installé avec
[Git pour Windows](https://git-scm.com/download/win)) ou depuis **WSL** (Ubuntu), avec Docker
Desktop démarré. Ni PowerShell ni l'Invite de commandes ne les exécutent directement.

```
# Git Bash : clic droit dans le dossier du projet → « Open Git Bash here », puis
./scripts/backup.sh

# PowerShell, sans ouvrir Git Bash :
& "C:\Program Files\Git\bin\bash.exe" ./scripts/backup.sh

# WSL (dans le dossier du projet, vu de WSL sous /mnt/c/...) :
wsl ./scripts/backup.sh
```

`restore.sh` s'utilise de la même façon. Sous Windows, l'archive hérite des droits du dossier
(la protection « lisible par vous seul » ne s'applique pas sur un disque NTFS) : gardez le dossier
`backups/` dans un endroit privé. Testé avec Git Bash et avec WSL (Ubuntu) ; sous macOS et Linux,
rien de particulier.

Pour la planifier tous les jours à 3 h du matin (sous Linux ou macOS) :

```
# crontab -e
0 3 * * * cd /chemin/vers/BDE_Network && ./scripts/backup.sh --keep 14 >> backups/backup.log 2>&1
```

**Copiez les sauvegardes hors du serveur** (`scp`, `rsync`, `rclone`...) : une sauvegarde qui reste
sur le serveur ne le protège pas d'une panne du serveur. L'archive contient des données
personnelles (membres, e-mails) : elle n'est lisible que par son propriétaire, gardez-la ainsi.
Elle **ne contient pas** `.env` (les clés secrètes) : conservez ce fichier à part, dans un endroit
sûr (gestionnaire de mots de passe). `bde.config.yml` est dans votre dépôt Git.

### Restaurer

```
./scripts/restore.sh backups/bde-backup-2026-10-05_03-00-01.tar.gz
```

La restauration **remplace toutes les données actuelles** par celles de la sauvegarde. Le script
vous l'explique et vous demande de taper `RESTAURER` pour confirmer ; tout autre texte annule sans
rien modifier. Juste avant, il fait une copie de sécurité de l'état actuel
(`backups/bde-backup-…-avant-restauration.tar.gz`), arrête l'application, restaure, puis la
relance. Si la restauration de la base échoue, la base reste exactement comme avant.
(`--yes` supprime la question, pour un script ; à n'utiliser qu'en connaissance de cause.)

**Sur un nouveau serveur** : installez Docker, clonez le dépôt, recréez `.env` et `bde.config.yml`,
lancez `docker compose up --build -d`, copiez l'archive dans `backups/`, puis restaurez-la comme
ci-dessus.

Essayez une restauration **avant d'en avoir besoin**, par exemple sur une machine de test.

## Dépannage rapide

| Symptôme                                            | Cause probable                                     | Que faire                                                                        |
| --------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Le site affiche une page « à corriger » (503)       | `.env`, mot de passe de la base, migration         | La page dit quoi faire ; le détail : `docker compose logs app`                   |
| `docker compose up` : « env file … not found »      | Le fichier `.env` n'existe pas                     | Lancez l'assistant d'installation, ou copiez `.env.example` en `.env`            |
| `docker compose up` : « port is already allocated » | Un autre programme utilise le port 3000            | Mettez `APP_PORT=3001` dans `.env` (et l'URL de redirection 42), puis `up -d`    |
| La connexion 42 est « momentanément impossible »    | 42 refuse l'identifiant ou la clé secrète          | Vérifiez la clé sur l'intra, mettez-la dans `.env`, puis `docker compose up -d`  |
| Page « Service momentanément indisponible »         | La base de données ne répond pas                   | `docker compose ps` puis `docker compose logs postgres`                          |
| Personne ne peut valider les comptes                | Le login placeholder est encore dans `auth.owners` | Mettez votre login 42 dans `bde.config.yml`, puis `docker compose up -d --build` |
| Le site ne répond pas depuis un autre ordinateur    | L'application n'écoute que sur le serveur (voulu)  | Passez par le reverse proxy HTTPS (ou lisez « Sans proxy HTTPS »)                |

Voir aussi [docs/contributing-guide.md](contributing-guide.md) pour les commandes de
développement, et [docs/configuration.md](configuration.md) pour la référence complète des
variables de configuration.
