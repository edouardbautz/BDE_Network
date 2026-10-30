🇬🇧 English · [🇫🇷 Français](../fr/backups.md)

# Automatic backups

The platform backs itself up **every night at 3:00 (the time of your BDE), with nobody doing anything**. Each backup is
**one file** that holds the database **and** the keys needed to read it again, is **checked right after it is made**,
and stays on the server **outside Docker's volumes**: `docker compose down -v`, or deleting the platform's volumes by
mistake, does not remove it.

This page is about those backups. The backups you make yourself with `scripts/backup.sh`, and the copy the platform
makes before an update, are in [Deployment](deployment.md#backups-and-restore).

## Where everything is kept

Every copy the platform makes is in **one folder of the server**, `backups/auto/` (`BDE_BACKUP_DIR`), which `docker compose down -v` does not touch:

| What                                       | Where                                                                               | Survives `down -v`? |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------- |
| **The nightly backups** (this page)        | `backups/auto/` , `bde-auto-<date>.tar.gz`                                          | **Yes**             |
| The copy made **before an update**         | `backups/auto/pre-update/` , `pre-update_<date>_v<version>.sql.gz`, the five newest | **Yes**             |
| What **you** make with `scripts/backup.sh` | `backups/` next to `docker-compose.yml` (where you ran the script)                  | Yes                 |

The platform sees the folder as `/auto-backups`. `backups/` and `backups/auto/` are two different folders: the platform only reads
`backups/auto/`.

> **Updating from 1.5.0 or earlier?** The copies made before an update used to be in a Docker volume called `backups`. At the first
> start of the new version the platform **carries them into `backups/auto/pre-update/` by itself** (nothing is deleted from the volume,
> which is mounted read only). Once you see them in the folder, the old volume is no longer needed: `docker volume ls`, then
> `docker volume rm <project>_backups` (it is empty on a new installation and harmless if left).

## What happens every night

1. At 3:00 in the time zone of your BDE (`bde.timezone`), the platform dumps its database, takes the keys of the
   `secrets` volume and the logo, and writes one archive.
2. It **reads it again** (see below). Only a backup that passed is kept.
3. It deletes the backups it no longer needs (see "How many are kept").

A platform that was switched off at 3:00 makes its backup as soon as it is back, the same day. After a failure it tries
again 30 minutes later, three times at most a day, then waits for the next night.

## Where the backups are

In the **`backups/auto/` folder next to `docker-compose.yml`**, on the server itself. To keep them elsewhere (another
disk, a mounted drive), put the folder in `.env`, then `docker compose up -d`:

```text
BDE_BACKUP_DIR=/mnt/disk2/bde-backups
```

A backup is named after the moment it was made, in UTC: `bde-auto-2026-10-27_02-00-04Z.tar.gz` is the night of the 27th
of October in Paris (3:00 in winter is 02:00 UTC). It contains:

| File            | Content                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `database.sql`  | **The database**: members, events, roles, settings.                                               |
| `secrets.tar`   | **The keys**: the one that encrypts the platform's secrets, and the one that signs the sessions.  |
| `logo.tar`      | The logo uploaded from Settings (only when there is one).                                         |
| `info.txt`      | The date and the version of the platform.                                                         |
| `manifest.json` | The list of these files, with the size and the SHA-256 of each: what the check below compares to. |

The file can only be read by the platform's user (rights `600`). **It holds the keys, so treat it like a password**:
whoever has the file has everything. The password of PostgreSQL is not in it: a backup restores into any password.

> **The folder is on the same disk as the platform.** It protects against a mistake (`down -v`, a bad update, a deleted
> volume), not against the loss of the whole server or of its disk. Copy the folder somewhere else from time to time.

## From the Settings page

Owners only. The **Backups** section of the Settings page shows:

- **the last backup**: its date, its size, and how far it was checked;
- a warning when **no backup has succeeded for two days**, and the reason the last attempt failed;
- **Back up now**: the same backup as the night's (a few seconds), written in the audit log with who asked;
- **the backups kept**, each with a **Download** button.

### Downloading a backup

The backups on the server are not encrypted (they have to be made at 3:00 with nobody there to type a passphrase). A file that
leaves the server is: **Download** asks for a passphrase of your choice, twice, 12 characters at least, and encrypts the file with it.

- The file is named `bde-auto-….tar.gz.enc` and is in the format of `openssl enc` (AES-256, key derived with PBKDF2): it can be opened
  with the `restore.sh` script below, or by hand with `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256`.
- **If you lose the passphrase, nobody can open the file again, including us.** The platform does not keep it and cannot recover it. The
  backups kept on the server are not affected.
- The file still holds the database and the keys: whoever has it and the passphrase has everything. Each download is written in the
  audit log (who, which backup), never the passphrase.

## How a backup is checked

A file that was written is not a backup that works. Right after making the archive, the platform:

1. opens it and compares every file with the SHA-256 of its manifest;
2. checks that the dump is whole (PostgreSQL writes a last line when it is);
3. **loads the dump into a scratch database** (created for this, deleted right after), and checks that it holds the
   migrations and the tables;
4. **opens the encrypted settings with the keys found in the archive**, not with the ones the platform uses: it is the
   proof that the archive and its keys go together.

A backup that fails any of these is deleted, and the previous ones stay. When the database server does not let the
platform create a scratch database (a managed PostgreSQL), only steps 1 and 2 are done, and the backup is marked
"only read".

## How many are kept

**7 daily, 4 weekly, 6 monthly**, counted in the days of your BDE:

- the last backup of each of the **7 most recent days** that have one;
- the first backup of each of the **4 most recent weeks** (Monday to Sunday);
- the first backup of each of the **6 most recent months**.

One backup can be several of these at once. That makes 10 to 17 files, from a week ago to six months ago. The newest
backup is never deleted. A server that was off for a month still keeps its 7 last days: days are counted where there is
a backup, not on the calendar.

Only files named `bde-auto-…` are touched: nothing else in the folder is ever deleted, and the backups made with
`scripts/backup.sh` are not affected.

## Restoring

Everything is done with Docker alone, from the project folder. To restore the **most recent** backup:

```text
./scripts/restore.sh --auto
```

or a particular one (the list is shown if the name is wrong):

```text
./scripts/restore.sh --auto bde-auto-2026-10-25_02-00-03Z.tar.gz
```

The script explains what it is going to do and asks you to type `RESTAURER`. It makes a safety copy of the current
state first, replaces the database, puts the keys and the logo of the backup back, and starts the platform. The keys
are in the backup: no other file is needed.

**On a new server** (the old one is lost): install Docker, get the project (`git clone`), run `docker compose up -d`
(no `.env` is needed), copy the backup file into `backups/auto/` of the new server, then `./scripts/restore.sh --auto`.
The BDE is back as it was, and the people who were signed in still are.

**From a downloaded file**: put the `.enc` file anywhere on the new server and give its path. The script asks for the passphrase (nothing
is shown while you type it; `BDE_BACKUP_PASSPHRASE` in the environment does the same for a script). A wrong passphrase stops it before
anything is touched.

```text
./scripts/restore.sh ~/bde-auto-2026-10-25_02-00-03Z.tar.gz.enc
```

> If the new server has an `AUTH_SECRET` in its `.env`, it overrides the restored session key and everyone must sign in
> again. Leave it out.

## Docker without administrator rights (rootless)

The platform writes its backups as the user of the container. With a standard Docker the folder `backups/auto/` then
belongs to that user and **you can list it but not read the files** (that is what the `600` rights are for), and
`restore.sh --auto` reads them through the container, so it works the same. With a rootless Docker, the user of the
container is a number of the account's range, with the same effect: you cannot open the files from the host yourself,
and you do not need to.

**A network disk or a folder of another user.** Under a rootless Docker the folder of the server belongs to your account, and
the platform's user (a number of your account's range) is "another user" for it. The platform asks the file system to give the
folder to its user; when the file system refuses (a network disk, a share, a Windows mount), the preparation step opens the folder
to every user of the server instead, with the sticky bit (`chmod 1777`), and says so in `docker compose logs secrets`. The
archives stay private to the platform (`600`). If that is not possible either, the Settings page says exactly what it found
(see below). You can do the same yourself, as the owner of the folder: `chmod 1777 backups/auto`, then `docker compose up -d`.

If the folder cannot be used at all (a disk mounted read-only, a share that refuses to give the folder to the application, a folder
the container may not write to), the platform **still starts**: the backup fails every night with the reason `folder`, the Backups
section of the Settings page shows it, and the owners are told if a channel is chosen for it (see below).

## If the Settings page says the folder cannot be used

The **Backups** section then names the folder it checked (`/auto-backups` for the platform, and its place on the server), what is
wrong with it, and what to do. The same line is in the logs when the platform starts (`docker compose logs app`).

| It says                                               | It means                                                                                    | What to do, on the server                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| the folder **does not exist**                         | Nothing at that place: the folder was not made, or the compose file is older than the image | Create `backups/auto/`, `git pull`, then `docker compose up -d`.                                                                     |
| **it is not a folder**                                | A file is where the folder should be                                                        | Replace it by an empty folder.                                                                                                       |
| the platform **cannot read it** (owner, rights shown) | The folder is private to someone else, and the file system did not let the platform take it | `docker compose up -d`; then, as the owner of the folder, `chmod 1777 backups/auto`; else choose a local disk with `BDE_BACKUP_DIR`. |
| the platform **cannot write it**                      | It can be listed, not written (rights, or a disk mounted read-only)                         | Same as above; for a read-only disk, remount it or choose another folder.                                                            |
| it is **inside the container**                        | The folder is not mounted: the backups would be lost when the container is made again       | Use the `docker-compose.yml` of this version (`git pull`), which mounts the folder on `/auto-backups`, then `docker compose up -d`.  |

## If a backup fails

The owners can be told by e-mail and in the BDE's channel, the first time it happens each day, and again when no backup has
succeeded for two days: choose a channel for these two messages in **Settings**, **Notifications** section (see
[Notifications](notifications.md#messages-about-the-backups)). Without one, the Backups section of the Settings page says it says so.

Each backup, made or failed, is written in the platform's logs:

```text
docker compose logs app | grep -i sauvegarde
```

A failure comes with a reason:

| Reason           | What it means                                                               | What to do                                                   |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `folder`         | The folder of the backups cannot be created or written.                     | See the section above: the Settings page says which and why. |
| `space`          | Less than 50 MiB free, or less than three times the last backup.            | Free some space on the disk of the backups.                  |
| `dump`           | The database could not be dumped.                                           | Is the database running? `docker compose ps`.                |
| `secrets`        | The keys could not be read.                                                 | Check the `secrets` volume.                                  |
| `archive`        | The archive could not be written.                                           | Check the disk.                                              |
| `verify-archive` | The file written is not what the manifest says (damaged disk, archive cut). | Check the disk; the previous backups are untouched.          |
| `verify-restore` | The dump does not load in a scratch database.                               | Keep the logs and ask for help: the database may be damaged. |
| `verify-secrets` | The keys of the archive do not open the encrypted settings.                 | The `secrets` volume is not the one of this database.        |
| `unexpected`     | Anything else.                                                              | Read the logs.                                               |

A failed backup never replaces a good one: the previous backups stay as they were.
