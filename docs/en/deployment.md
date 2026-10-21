🇬🇧 English · [🇫🇷 Français](../fr/deployment.md)

# Deployment

Each BDE hosts its own platform, however it likes. This guide describes a typical deployment on a server (a VPS)
with Docker Compose and an HTTPS proxy. Adapt it to your infrastructure.

The server only needs **Docker** (with the `docker compose` command) and **Git**. Node.js is needed nowhere: neither
to run the platform, nor for backups.

## Prerequisites

- A server (a VPS or a dedicated machine) with Docker and Docker Compose installed.
- A domain name that points to this server (see [Without an HTTPS proxy](#without-an-https-proxy) if you have none).
- An account on the 42 intra to create the OAuth application. The installer guides you, but the redirect URL must
  point to your final domain: `https://your-domain.example/api/auth/callback/42-school`. The installer gives it to you
  ready to copy, at the address step.

## 1. Prepare the server

```text
git clone https://github.com/edouardbautz/BDE_Network.git
cd BDE_Network
```

Clone your fork if you have one. That is all: **no file to create or fill in**. The platform makes its own keys
(the Docker `secrets` volume) and is configured in the browser. A `.env` is only useful for two Docker settings:
`APP_BIND` and `APP_PORT`.

Install the HTTPS proxy first ([section 3](#3-https-reverse-proxy)): that way you open the installer at the final
address. Without a proxy, use an SSH tunnel (see below).

## 2. Start the platform and install it

```text
docker compose up
```

**Without `-d` the first time**: the terminal stays open and the platform writes in it, in a box, the address and the
**setup code** (also in `docker compose logs app`). The first time, Docker downloads the platform's image (a minute or two).

Open the site's address in a browser, enter the code, and follow the eight steps (see
[Installation](installation.md)). If the server has no proxy yet, open a tunnel from your computer, then go to
`http://localhost:3000`:

```text
ssh -L 3000:localhost:3000 user@your-server
```

At the address step, enter the **public** address all the same (`https://your-domain.example`), not `localhost`. The
page warns you that it is not the address of your browser: here, that is normal, carry on. But **signing in with 42
will only work at the public address**: once the platform is installed, open it there. When the "Platform installed"
page appears, press **Ctrl+C** in the terminal, then:

```text
docker compose up -d
docker compose ps
```

The platform now runs in the background and restarts by itself with the server. The installer is gone for good:
settings are then changed from **Settings** (owners).

At start, the platform checks its configuration, then its database. If something is wrong (a missing or invalid
value, a refused database password, a database that does not answer, a failing database update), the container
**does not loop**: it stays alive and shows, at the site's address, a **page that explains the problem and what to
do** (in French or English depending on the browser, never showing a secret). `docker compose ps` then shows `app` as
"unhealthy". The full detail is read with:

```text
docker compose logs app
```

Fix the cause, then `docker compose up -d`. The most common cases are in
[Troubleshooting](troubleshooting.md#the-site-shows-an-error-page-instead-of-the-platform). To replace the saved
settings with the content of files (a files-driven deployment), see
[Configuration](configuration.md#replace-the-settings-with-files).

By default, the platform is reachable **only from the server itself** (`127.0.0.1`, port 3000, changeable with
`APP_PORT`): the reverse proxy below is what exposes it to the public, over HTTPS. Nobody can therefore reach the
platform over plain HTTP by going around the proxy. **The database has no published port**: only the platform, in the
same Docker network, can talk to it. To take a look from the server: `docker compose exec postgres psql -U bde
bde_network` (these are the default values).

## 3. HTTPS reverse proxy

Put a reverse proxy in front of port `3000` to handle TLS. Two common options:

### Caddy (automatic certificates, minimal configuration)

```text
# /etc/caddy/Caddyfile
your-domain.example {
    reverse_proxy localhost:3000
}
```

```text
sudo systemctl reload caddy
```

Caddy gets and renews a Let's Encrypt certificate by itself.

### Nginx + Certbot

```text
# /etc/nginx/sites-available/bde-network
server {
    listen 80;
    server_name your-domain.example;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```text
sudo ln -s /etc/nginx/sites-available/bde-network /etc/nginx/sites-enabled/
sudo certbot --nginx -d your-domain.example
```

The `X-Forwarded-Proto` header matters: it tells the platform that the connection is HTTPS (secure cookies, the
`Strict-Transport-Security` header).

## Without an HTTPS proxy

**The simplest is still to install Caddy**: three lines of configuration and a domain name are enough, even for a
small BDE. If you have no domain, a tunnel service (for example Cloudflare Tunnel or Tailscale) can give you an HTTPS
address without opening anything on the server.

If you still choose to run the platform **without HTTPS**, understand what that means: connections are not
encrypted, so members' session (and what they see) can be intercepted by anyone on the same network. Keep this mode
for:

- a try-out on your own machine;
- a trusted private network (the BDE's local network), **never the Internet**.

For this, in `.env`:

```text
APP_BIND=0.0.0.0
```

then `docker compose up -d`, and give `http://server-address-or-ip:3000` as the address of the platform (at
installation, or in **Settings**). The 42 OAuth application's redirect URL must then be
`http://server-address-or-ip:3000/api/auth/callback/42-school`. Nothing else changes: the platform works over HTTP
(it does not force HTTPS on browsers).

> ⚠️ On a public server, `APP_BIND=0.0.0.0` opens port 3000 to the whole Internet, in clear. If that is the case,
> close it with the server's firewall, or install the HTTPS proxy. At start, the platform shows a warning if the
> address of the platform is a public `http://` address.

## Monitoring

```text
docker compose ps                       # the state must be "healthy"
curl http://127.0.0.1:3000/api/health    # {"status":"ok"}
docker compose logs --tail 50 app
```

`/api/health` answers `503` when the database is unreachable, and `docker compose ps` then shows "unhealthy".
Meanwhile, visitors see a "Service temporarily unavailable" page that brings them back to the platform by itself as
soon as the database answers again: they have nothing to do, and no data is lost. To find the cause:
`docker compose logs postgres`.

## Reminders of the Events module

If the Events module is on, the `app` container must **run continuously**: it is what sends the day-before reminders
(an internal loop, no cron to set up). If it is stopped at the reminder hour, the reminder goes out when it restarts,
as long as the event has not started. Set the address of the platform (installer or **Settings**) so that
notifications contain a link. Details: [Events module](events.md#how-the-day-before-reminder-works).

## Upgrading

Two commands, once you have made a backup: `git pull`, then `docker compose up -d`. Docker downloads the image of the
new version, and the platform makes its own copy of the database before changing it. The complete step by step, with
the check and the way back, is in [Upgrading](upgrading.md).

### Which version runs

`docker-compose.yml` names the image of **one precise version** (`ghcr.io/edouardbautz/bde_network:1.2.0`), never
"latest": what runs is what the folder was written for, and going back to an older version of the folder goes back to
its image. The version is also shown at the top of the **Settings** page. The versions are listed on the project's
[Releases page](https://github.com/edouardbautz/BDE_Network/releases).

To stay on a version while you `git pull` newer files, or to try another one, write `BDE_VERSION=1.2.0` in `.env`.
Remove the line to follow the folder again. The image is downloaded from `ghcr.io` (GitHub's registry): the server must
be allowed to reach it.

### Build the image yourself

The published image is the normal way. Building it from the folder is for contributors, for a fork whose code you
changed, and for a platform driven by files (`bde.config.yml` and `.env`, before the installer) that has not been
copied into its database yet: only a build puts your `bde.config.yml` in the image. The extra file
`docker-compose.build.yml` does it:

```text
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The image takes a few minutes to build, and is named `bde-network:local`, so that it is never taken for a published
one. To avoid typing both files in every command (`scripts/backup.sh` and `scripts/restore.sh` run `docker compose`
too), write these two lines in `.env`:

```text
COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml
COMPOSE_PATH_SEPARATOR=:
```

Then `docker compose up -d --build` is enough.

## Backups and restore

A backup is made of **two archives**, created together by `scripts/backup.sh`:

| Archive                                          | Content                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `backups/bde-backup-YYYY-MM-DD_HH-MM-SS.tar.gz`  | **The database**: members, events, roles, settings. The logo uploaded from Settings is in it too.       |
| `backups/bde-secrets-YYYY-MM-DD_HH-MM-SS.tar.gz` | **The keys of the `secrets` volume**: the session key and the key that encrypts the platform's secrets. |

> **Back up the `secrets` volume, it is essential.** The platform's secrets (the 42 application's key, the SMTP
> password, webhook addresses) are saved **encrypted** in the database; the key that decrypts them is only in the
> `secrets` volume. If you restore the database on another server without that key, those secrets can no longer be
> read: you have to enter them again. This is intended (a leak of the database alone does not give them away), but it
> means that **the keys archive matters as much as the database one**. Keep both files, but **in two different
> places**: together they give access to everything.
>
> Never run `docker compose down -v`: the `-v` option **deletes the volumes**, so the database AND the keys.

This is done with Docker alone, without Node.js (on Windows, from Git Bash or WSL).

```text
./scripts/backup.sh                 # one backup (two archives)
./scripts/backup.sh --keep 14       # ... keeping only the 14 most recent of each
```

**On Windows**, these scripts are written in `sh`: run them from **Git Bash** (installed with
[Git for Windows](https://git-scm.com/download/win)) or from **WSL** (Ubuntu), with Docker Desktop running.
Neither PowerShell nor the Command Prompt runs them directly.

```text
# Git Bash: right-click in the project folder → "Open Git Bash here", then
./scripts/backup.sh

# PowerShell, without opening Git Bash:
& "C:\Program Files\Git\bin\bash.exe" ./scripts/backup.sh

# WSL (in the project folder, seen from WSL under /mnt/c/...):
wsl ./scripts/backup.sh
```

`restore.sh` is used the same way. On Windows, archives inherit the folder's rights (the "readable by you only"
protection does not apply on an NTFS disk): keep the `backups/` folder somewhere private. Tested with Git Bash and
with WSL (Ubuntu); on macOS and Linux, nothing special.

To schedule it every day at 3 am (on Linux or macOS):

```text
# crontab -e
0 3 * * * cd /path/to/BDE_Network && ./scripts/backup.sh --keep 14 >> backups/backup.log 2>&1
```

**Copy backups off the server** (`scp`, `rsync`, `rclone`…): a backup that stays on the server does not protect it
from the server failing. The database archive holds personal data (members, emails): it is only readable by its
owner, keep it that way. A `.env`, if there is one, is not backed up: it is no longer needed once the platform is
installed (see [Configuration](configuration.md)).

### Automatic copy before an update

When a new version has to change the database (a "migration"), the platform makes **a copy of it by itself, first**,
before applying anything. The copy is kept in the `backups` Docker volume, as `pre-update_<date>_v<version>.sql.gz`.

- **Retention**: the 5 most recent are kept, and any older than 90 days is deleted; the most recent one is never
  deleted. Nothing is made when an update changes nothing in the database, so a simple restart makes no copy.
- **It holds the database only.** The keys of the `secrets` volume do not change in an update. It does **not** replace
  the scheduled backups above, which you copy off the server.
- **If a migration fails**, the platform puts that copy back **by itself**, checks that the database is exactly as it was
  (same migrations, same tables), stays stopped, and its page says so, with the name of the copy. Your data is
  intact; go back to the previous version ([Upgrading](upgrading.md#rolling-back)).
- **To restore one by hand**: `./scripts/restore.sh --pre-update` (the most recent, or name one:
  `./scripts/restore.sh --pre-update pre-update_20261015T101530Z_v1.1.0.sql.gz`). To list them:
  `docker compose run --rm --no-deps --entrypoint ls app -1 /backups`.
- **If the copy cannot be made** (a full disk, for example), the update is **not applied** and the page says so. Free
  some space, then `docker compose up -d`. To apply the update without a copy, knowing the risk (run
  `./scripts/backup.sh` first), add `BDE_SKIP_BACKUP=1` to `.env`.

`docker compose down -v` deletes this volume too.

### Restoring

On **the same server** (the `secrets` volume is intact):

```text
./scripts/restore.sh backups/bde-backup-2026-10-05_03-00-01.tar.gz
```

On **another server**, or if the `secrets` volume was lost, give the keys archive too:

```text
./scripts/restore.sh backups/bde-backup-2026-10-05_03-00-01.tar.gz --secrets backups/bde-secrets-2026-10-05_03-00-01.tar.gz
```

The restore **replaces all current data** with that of the backup. The script explains it and asks you to type
`RESTAURER` to confirm; any other text cancels without changing anything. Just before, it makes a safety copy of the
current state (`backups/bde-backup-…-avant-restauration.tar.gz`), stops the platform, restores, then starts it again.
If the database restore fails, the database stays exactly as before. (`--yes` removes the question, for a script; use
it knowingly. `--no-start` leaves the platform stopped: it is what going back to an earlier version needs, see
[Rolling back](upgrading.md#rolling-back); `--pre-update` always does.)

**On a new server**: install Docker, clone the repository, run `docker compose up -d` (no `.env` is needed),
copy both archives into `backups/`, then restore with `--secrets` as above. If you no longer have the keys archive,
the platform still starts and says in its logs (`docker compose logs app`) that the secrets cannot be decrypted; you
then have to enter them again in **Settings**.

## A problem?

See [Troubleshooting](troubleshooting.md). For development commands, see the [contributor guide](contributing.md),
and for the reference of every setting, [Configuration](configuration.md).
