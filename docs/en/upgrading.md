🇬🇧 English · [🇫🇷 Français](../fr/upgrading.md)

# Upgrading to a new version

Upgrading takes three moves: **back up**, **get the new code**, **restart**. The restart is `docker compose up -d`:
Docker downloads the image of the new version, which `docker-compose.yml` names. Database migrations apply by
themselves at start, after a copy that the platform makes. Allow ten minutes, a few of them waiting for the download.

This guide was tried for real, going from a platform on **version 1.0.0** (settings in `.env` and `bde.config.yml`)
to the next version, with members, roles and events, then rolling back.

Owners are told when a new version is published, by a banner on the dashboard and on the Settings page, with the two
commands (see [New versions](configuration.md#new-versions)).

## Before you start

1. **Read the [CHANGELOG](../../CHANGELOG.md)**: it says what changes and what you need to know.
2. **Note the current version**, to be able to go back to it (it is also at the top of the **Settings** page):

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

**You forked the project** (your own commits): add the original repository once, then merge it into your branch.

```text
git remote add upstream https://github.com/edouardbautz/BDE_Network.git   # only once
git fetch upstream
git merge upstream/main
```

The merge goes without conflict in most cases. If `bde.config.yml` conflicts, keep your version: the settings are in
the database, and this file is only used by the import at the first start. If you changed the platform's **code**, you
also build your own image: [Build the image yourself](deployment.md#build-the-image-yourself), and use that command
instead of the one below.

## 2. Restart

```text
docker compose up -d
```

Docker downloads the image of the new version (a minute or two), then replaces the container. At start, the platform
makes a copy of the database if there are migrations to apply (see
[Automatic copy before an update](deployment.md#automatic-copy-before-an-update)), applies them, and answers.

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

**Build the image once, on the spot.** The published image holds the template, not your `bde.config.yml`: your file only
enters an image when it is built from your folder. For the first start after the upgrade, run:

```text
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Without it, the platform starts, finds a database that has accounts but no saved settings, and does not open the
installer (it would replace your settings): its page says "Data exists, but no settings are saved". Nothing is lost,
run the command above. Once the log says the settings were copied, you update like everyone else: `git pull`, then
`docker compose up -d`.

If the files were incomplete (for example the login `votre-login-42` still among the owners), the platform keeps
reading the files and the Settings page stays read-only. Fix the files, then run the same command again. See
[Configuration](configuration.md#where-the-settings-are).

## If the update itself fails

Before it changes the database, the platform makes a copy of it, by itself (see
[Automatic copy before an update](deployment.md#automatic-copy-before-an-update)). If a step of the update fails, the
platform **puts that copy back**, checks the database is exactly as it was, stays stopped, and says so on its page. Your
data is intact: [roll back](#rolling-back) to the previous version, then report the problem.

## Rolling back

If the new version causes trouble, you can go back to the previous one with your backup. **Data entered since the
backup is lost**: the restore puts the database back in the state of the backup.

1. Restore the backup made before the upgrade (the current version's script replaces the whole database), either
   the one you made yourself, or the copy the platform made before the update:

   ```text
   ./scripts/restore.sh backups/bde-backup-YYYY-MM-DD_HH-MM-SS.tar.gz
   ./scripts/restore.sh --pre-update
   ```

   The script asks you to type `RESTAURER`. It first makes a safety copy of the current state.

2. Go back to the old version of the code (the one you noted):

   ```text
   git checkout <the version you noted>
   ```

3. Restart. The image of the version you went back to is downloaded again if it is no longer on the machine:

   ```text
   docker compose up -d
   ```

   Versions before 1.1.0 were not published as images: to go back to 1.0.0, [build the image yourself](deployment.md#build-the-image-yourself).

Do them **in this order**. To take the project's latest version again afterwards, go back to your branch
(`git switch main`).

## History: the events right is split in two

The "Manage events" right became two rights: **Propose events** and **Validate events** (see
[Roles and rights](roles.md#the-rights)). The update converts the roles by itself, and nobody loses anything:
validating includes everything managing did.

| Before                                            | After                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A role with the right to **manage events**        | the same role, with **Validate events** (which includes **Propose events** and "View") |
| A role with only **View**, or with **All rights** | unchanged                                                                              |

The roles converted are listed in an audit log entry (`role.migrate`), with their rights as they were. The update
makes its safety copy first, like any update that changes the database.

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
