🇬🇧 English · [🇫🇷 Français](../fr/upgrading.md)

# Upgrading to a new version

Upgrading takes three moves: **back up**, **get the new code**, **restart**. Database migrations apply by themselves
at start. Allow ten minutes, a few of them waiting while the image builds.

This guide was tried for real, going from a platform on **version 1.0.0** (settings in `.env` and `bde.config.yml`)
to the next version, with members, roles and events, then rolling back.

## Before you start

1. **Read the [CHANGELOG](../../CHANGELOG.md)**: it says what changes and what you need to know.
2. **Note the current version**, to be able to go back to it:

   ```text
   git describe --tags --always
   ```

3. **Make a backup**:

   ```text
   ./scripts/backup.sh
   ```

   On Windows, run it from Git Bash or WSL (see [Backups](deployment.md#backups-and-restore)). Copy the files of
   `backups/` off the server.

   > A platform on version 1.0.0 only has **one** archive (the database). The platform's keys are then in its `.env`
   > file, which the backup does not contain: **also copy `.env` and `bde.config.yml`** somewhere safe. After the
   > upgrade, a new backup will contain everything (see below).

## 1. Get the new code

**You cloned the project without changing it:**

```text
git pull
```

**You forked the project** (your own commits, for example an edited `bde.config.yml`): add the original repository
once, then merge it into your branch.

```text
git remote add upstream https://github.com/edouardbautz/BDE_Network.git   # only once
git fetch upstream
git merge upstream/main
```

The merge goes without conflict in most cases. If `bde.config.yml` conflicts, keep your version: the settings are in
the database, and this file is only used by the import at the first start.

## 2. Restart

```text
docker compose up --build -d
```

Docker rebuilds the image (a few minutes), then replaces the container. At start, the platform applies the database
migrations before answering.

## 3. Check

1. **Containers are healthy**: `docker compose ps` must show `healthy` for `app` and `postgres`.
2. **The log is clean**: `docker compose logs app` must contain `All migrations have been successfully applied` (or
   `No pending migrations to apply`), then `Ready`.
3. **The site answers**: `curl http://127.0.0.1:3000/api/health` prints `{"status":"ok"}` (change the port if you
   set `APP_PORT`).
4. **Everything is there**: open the platform, sign in, look at members, roles and events.
5. **Settings can be read**: as an owner, **Settings** must say "Settings stored in the database".

If the page shows a 503 error instead of the platform, it says what is wrong: see
[Troubleshooting](troubleshooting.md#the-site-shows-an-error-page-instead-of-the-platform).

Finally, **make a new backup**: it now contains the database **and** the keys.

## If your platform predates the installer

This is the case of a platform installed with `.env` and `bde.config.yml` (version 1.0.0). At the **first start** after
the upgrade:

- the migrations add the settings table;
- `bde.config.yml` and `.env` are **copied into the database**, secrets encrypted (the log says it: "Les réglages de
  bde.config.yml et de .env ont été copiés dans la base de données", in French);
- the Docker `secrets` volume is created: it takes the database password and the session key from your `.env`, so
  **sessions stay valid** and the database stays reachable;
- the **Settings** page becomes usable.

From then on, **the database is the source of truth**: editing `.env` or `bde.config.yml` changes nothing any more.
Keep a copy until you have checked that everything works, then change settings in **Settings**.

If the files were incomplete (for example the login `votre-login-42` still among the owners), the platform keeps
reading the files and the Settings page stays read-only. Fix the files, then `docker compose up -d --build`. See
[Configuration](configuration.md#where-the-settings-are).

## Rolling back

If the new version causes trouble, you can go back to the previous one with your backup. **Data entered since the
backup is lost**: the restore puts the database back in the state of the backup.

1. Restore the backup made before the upgrade (the current version's script replaces the whole database):

   ```text
   ./scripts/restore.sh backups/bde-backup-YYYY-MM-DD_HH-MM-SS.tar.gz
   ```

   The script asks you to type `RESTAURER`. It first makes a safety copy of the current state.

2. Go back to the old version of the code (the one you noted):

   ```text
   git checkout <the version you noted>
   ```

3. Rebuild:

   ```text
   docker compose up --build -d
   ```

Do them **in this order**. To take the project's latest version again afterwards, go back to your branch
(`git switch main`).

## History: from fixed roles to custom roles (0.x → 1.0)

Versions 0.x had the fixed roles Administrator and Member, and rights granted member by member. The migration to
version 1.0 converts them by itself.

| Before                                     | After                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Owner, pending                             | unchanged                                                                                               |
| Administrator                              | the **Admin** role (all rights)                                                                         |
| Member                                     | the **Membre** role (view events)                                                                       |
| Member with a module right (manage events) | a "Membre + Événements" role created for the occasion. Members who had the same rights share this role. |

Nothing is lost: each account's old role and its rights are kept in an audit log entry.
