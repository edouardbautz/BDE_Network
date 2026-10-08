# Déploiement

Chaque BDE héberge sa propre instance, comme il le souhaite. Ce guide décrit un déploiement
type sur un VPS avec Docker Compose et un reverse proxy HTTPS ; adaptez-le à votre
infrastructure (autre hébergeur, Kubernetes, PaaS...).

Le serveur n'a besoin que de **Docker** (avec la commande `docker compose`) et de **Git**. Node.js
n'est nécessaire nulle part : ni pour lancer l'application, ni pour les sauvegardes.

## Prérequis

- Un serveur (VPS ou machine dédiée) avec Docker et Docker Compose installés.
- Un nom de domaine pointant vers ce serveur (voir plus bas si vous n'en avez pas).
- Un compte sur l'intra 42 pour créer l'application OAuth : l'installateur vous guide, mais l'URL de
  redirection doit pointer vers votre domaine final, `https://votre-domaine.example/api/auth/callback/42-school`
  (la page d'installation vous la donne toute prête, à l'étape de l'adresse).

## 1. Préparer le serveur

```
git clone https://github.com/<votre-fork>/BDE_Network.git
cd BDE_Network
```

C'est tout : **aucun fichier à créer ni à remplir**. La plateforme fabrique elle-même ses clés (volume Docker
`secrets`) et se configure dans le navigateur. Un `.env` n'est utile que pour deux réglages de Docker :
`APP_BIND` et `APP_PORT` (voir plus bas).

Installez d'abord le reverse proxy HTTPS ([section 3](#3-reverse-proxy-https)) : ainsi vous ouvrirez
l'installateur sur l'adresse définitive. Sans proxy, passez par un tunnel SSH (voir ci-dessous).

## 2. Lancer l'application et l'installer

```
docker compose up
```

**Sans `-d` la première fois** : le terminal reste ouvert et la plateforme y écrit, dans un encadré, l'adresse et
le **code d'installation** (aussi dans `docker compose logs app`). La première fois, Docker construit l'image
(quelques minutes).

Ouvrez l'adresse du site dans un navigateur, entrez le code, et suivez les huit étapes (voir
[Installation](installation.md)). Si le serveur n'a pas encore de proxy, ouvrez un tunnel depuis votre
ordinateur, puis allez sur `http://localhost:3000` :

```
ssh -L 3000:localhost:3000 utilisateur@votre-serveur
```

À l'étape de l'adresse, indiquez quand même l'adresse **publique** (`https://votre-domaine.example`), pas
`localhost`. Quand la page « Plateforme installée » s'affiche, faites **Ctrl+C** dans le terminal, puis :

```
docker compose up -d
docker compose ps
```

La plateforme tourne alors en arrière-plan et redémarre toute seule avec le serveur. La page d'installation
a disparu pour de bon : les réglages se modifient ensuite depuis **Paramètres** (propriétaires).

Au démarrage, l'application vérifie sa configuration, puis la base de données. Si quelque chose
ne va pas (valeur manquante ou invalide, mot de passe de la base refusé, base qui ne répond pas, mise à jour
de la base qui échoue), le conteneur **ne tourne pas en boucle** : il reste en vie et affiche, à l'adresse
du site, une **page qui explique le problème et quoi faire** (en français ou en anglais selon le navigateur,
sans jamais montrer de secret). `docker compose ps` montre alors `app` en « unhealthy ». Le détail complet
se lit avec :

```
docker compose logs app
```

Corrigez la cause, puis `docker compose up -d`. Pour remplacer les réglages enregistrés par le contenu des
fichiers `bde.config.yml` et `.env` (déploiement piloté par fichiers), voir
[Configuration](configuration.md#remplacer-les-réglages-par-les-fichiers).

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
```

puis `docker compose up -d`, et donnez `http://adresse-ou-ip-du-serveur:3000` comme adresse de la plateforme
(à l'installation, ou dans **Paramètres**). L'URL de redirection de l'application OAuth 42 doit alors être
`http://adresse-ou-ip-du-serveur:3000/api/auth/callback/42-school`. Rien d'autre ne change :
l'application fonctionne en HTTP (elle n'impose pas HTTPS aux navigateurs).

> ⚠️ Sur un serveur public, `APP_BIND=0.0.0.0` ouvre le port 3000 à tout Internet, en clair.
> Si c'est le cas, fermez-le avec le pare-feu du serveur, ou installez le proxy HTTPS. Au démarrage,
> l'application affiche un avertissement si l'adresse de la plateforme est une adresse `http://` publique.

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
Renseignez l'adresse publique de la plateforme (installateur ou **Paramètres**) pour que les notifications contiennent un lien. Détails :
[Module Événements](events.md#comment-fonctionne-le-rappel-de-la-veille).

## Mettre à jour l'application

Faites une sauvegarde d'abord (voir ci-dessous), puis :

```
git pull
docker compose up --build -d
```

Les migrations de base de données s'appliquent automatiquement au démarrage du conteneur.

## Sauvegardes et restauration

Une sauvegarde est faite de **deux archives**, créées ensemble par `scripts/backup.sh` :

| Archive                                          | Contenu                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `backups/bde-backup-AAAA-MM-JJ_HH-MM-SS.tar.gz`  | **La base de données** : membres, événements, rôles, réglages.                                             |
| `backups/bde-secrets-AAAA-MM-JJ_HH-MM-SS.tar.gz` | **Les clés du volume `secrets`** : la clé des sessions et la clé qui chiffre les secrets de la plateforme. |

> **Sauvegardez le volume `secrets`, c'est indispensable.** Les secrets de la plateforme (clé de
> l'application 42, mot de passe SMTP, adresses de webhooks) sont enregistrés **chiffrés** dans la base
> de données ; la clé qui les déchiffre n'est que dans le volume `secrets`. Si vous restaurez la base sur un
> autre serveur sans cette clé, ces secrets ne sont plus lisibles : il faut les ressaisir. C'est
> volontaire (une fuite de la seule base ne les donne pas), mais cela veut dire que **l'archive des clés
> compte autant que celle de la base**. Gardez les deux fichiers, mais **à deux endroits différents** : leur
> réunion donne accès à tout.
>
> Ne lancez jamais `docker compose down -v` : l'option `-v` **supprime les volumes**, donc la base de
> données ET les clés.

Cela se fait avec Docker seul, sans Node.js (sous Windows, depuis Git Bash ou WSL).

```
./scripts/backup.sh                 # une sauvegarde (deux archives)
./scripts/backup.sh --keep 14       # ... en ne gardant que les 14 plus récentes de chaque
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

`restore.sh` s'utilise de la même façon. Sous Windows, les archives héritent des droits du dossier
(la protection « lisible par vous seul » ne s'applique pas sur un disque NTFS) : gardez le dossier
`backups/` dans un endroit privé. Testé avec Git Bash et avec WSL (Ubuntu) ; sous macOS et Linux,
rien de particulier.

Pour la planifier tous les jours à 3 h du matin (sous Linux ou macOS) :

```
# crontab -e
0 3 * * * cd /chemin/vers/BDE_Network && ./scripts/backup.sh --keep 14 >> backups/backup.log 2>&1
```

**Copiez les sauvegardes hors du serveur** (`scp`, `rsync`, `rclone`...) : une sauvegarde qui reste
sur le serveur ne le protège pas d'une panne du serveur. L'archive de la base contient des données
personnelles (membres, e-mails) : elle n'est lisible que par son propriétaire, gardez-la ainsi.
Un `.env`, s'il existe, n'est pas sauvegardé : il n'est plus nécessaire une fois la plateforme installée
(voir [Configuration](configuration.md)).

### Restaurer

Sur **le même serveur** (le volume `secrets` est intact) :

```
./scripts/restore.sh backups/bde-backup-2026-10-05_03-00-01.tar.gz
```

Sur **un autre serveur**, ou si le volume `secrets` a été perdu, donnez aussi l'archive des clés :

```
./scripts/restore.sh backups/bde-backup-2026-10-05_03-00-01.tar.gz --secrets backups/bde-secrets-2026-10-05_03-00-01.tar.gz
```

La restauration **remplace toutes les données actuelles** par celles de la sauvegarde. Le script
vous l'explique et vous demande de taper `RESTAURER` pour confirmer ; tout autre texte annule sans
rien modifier. Juste avant, il fait une copie de sécurité de l'état actuel
(`backups/bde-backup-…-avant-restauration.tar.gz`), arrête l'application, restaure, puis la
relance. Si la restauration de la base échoue, la base reste exactement comme avant.
(`--yes` supprime la question, pour un script ; à n'utiliser qu'en connaissance de cause.)

**Sur un nouveau serveur** : installez Docker, clonez le dépôt, lancez `docker compose up --build -d`
(aucun `.env` n'est nécessaire), copiez les deux archives dans `backups/`, puis restaurez avec `--secrets`
comme ci-dessus. Si vous n'avez plus l'archive des clés : la plateforme démarre quand même et dit dans
ses journaux (`docker compose logs app`) que les secrets ne sont pas déchiffrables ; il faut alors les
ressaisir dans **Paramètres**.

## Dépannage rapide

| Symptôme                                                      | Cause probable                                           | Que faire                                                                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le site affiche une page « à corriger » (503)                 | `.env`, mot de passe de la base, migration               | La page dit quoi faire ; le détail : `docker compose logs app`                                                                                                                  |
| `docker compose up` : « port is already allocated »           | Un autre programme utilise le port 3000                  | Mettez `APP_PORT=3001` dans `.env` (et l'URL de redirection 42), puis `up -d`                                                                                                   |
| La connexion 42 est « momentanément impossible »              | 42 refuse l'identifiant ou la clé secrète                | Un propriétaire met la clé à jour dans **Paramètres**, section Application 42 ([détails](configuration.md#la-page-paramètres))                                                  |
| Page « Service momentanément indisponible »                   | La base de données ne répond pas                         | `docker compose ps` puis `docker compose logs postgres`                                                                                                                         |
| Je suis « en attente » alors que je devrais être propriétaire | Votre login 42 n'est pas dans la liste des propriétaires | Un propriétaire l'ajoute dans **Paramètres**, section Propriétaires ; sinon [remplacez les réglages par les fichiers](configuration.md#remplacer-les-réglages-par-les-fichiers) |
| Le site ne répond pas depuis un autre ordinateur              | L'application n'écoute que sur le serveur (voulu)        | Passez par le reverse proxy HTTPS (ou lisez « Sans proxy HTTPS »)                                                                                                               |

Voir aussi [docs/contributing-guide.md](contributing-guide.md) pour les commandes de
développement, et [docs/configuration.md](configuration.md) pour la référence complète des
variables de configuration.
