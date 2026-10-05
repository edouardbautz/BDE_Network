# Déploiement

Chaque BDE héberge sa propre instance, comme il le souhaite. Ce guide décrit un déploiement
type sur un VPS avec Docker Compose et un reverse proxy HTTPS ; adaptez-le à votre
infrastructure (autre hébergeur, Kubernetes, PaaS...).

## Prérequis

- Un serveur (VPS ou machine dédiée) avec Docker et Docker Compose installés.
- Un nom de domaine pointant vers ce serveur.
- Une application OAuth 42 dont l'URL de redirection pointe vers votre domaine final :
  `https://votre-domaine.example/api/auth/callback/42-school`.

## 1. Préparer le serveur

```
git clone https://github.com/<votre-fork>/BDE_Network.git
cd BDE_Network
cp .env.example .env
```

Remplissez `.env` avec des valeurs de production (mot de passe de base de données robuste,
`AUTH_SECRET` généré aléatoirement, identifiants OAuth 42 de production). Éditez
`bde.config.yml` avec les informations réelles de votre BDE.

## 2. Lancer l'application

```
docker compose up --build -d
```

Le service `postgres` publie son port uniquement sur `127.0.0.1` (voir `docker-compose.yml`) —
la base de données n'est jamais exposée publiquement, même sans pare-feu configuré.
L'application écoute sur le port `3000` de la machine.

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

## Rappels du module Événements

Si le module Événements est activé, le conteneur `app` doit **tourner en continu** : c'est lui
qui envoie les rappels de la veille (une boucle interne, aucun cron à configurer). S'il est
arrêté à l'heure du rappel, celui-ci part au redémarrage tant que l'événement n'a pas commencé.
Renseignez `APP_URL` dans `.env` pour que les notifications contiennent un lien. Détails :
[Module Événements](events.md#comment-fonctionne-le-rappel-de-la-veille).

## Mettre à jour l'application

```
git pull
docker compose up --build -d
```

Les migrations de base de données s'appliquent automatiquement au démarrage du conteneur
(`prisma migrate deploy`, voir `Dockerfile`).

## Sauvegardes

```
npm run db:backup
```

Sauvegarde la base dans `backups/<horodatage>.sql` en exécutant `pg_dump` à l'intérieur du
conteneur `postgres` via `docker compose exec` — aucun outil PostgreSQL à installer sur l'hôte.
Planifiez cette commande avec une tâche cron pour des sauvegardes régulières :

```
# crontab -e — sauvegarde quotidienne à 3h du matin
0 3 * * * cd /chemin/vers/BDE_Network && npm run db:backup
```

Restauration :

```
npm run db:restore backups/<fichier>.sql
```

Voir aussi [docs/contributing-guide.md](contributing-guide.md) pour les commandes de
développement, et [docs/configuration.md](configuration.md) pour la référence complète des
variables de configuration.
