🇬🇧 English · [🇫🇷 Français](../fr/troubleshooting.md)

# Troubleshooting

Each entry says what you see, why, and what to do. The full detail of a problem can almost always be read in the
server's logs:

```text
docker compose logs app
```

- [During installation](#during-installation)
- [When signing in](#when-signing-in)
- [The site shows an error page instead of the platform](#the-site-shows-an-error-page-instead-of-the-platform)
- [Notifications](#notifications)
- [Events and calendars](#events-and-calendars)
- [Network and Docker](#network-and-docker)

## During installation

### No box in the terminal, or the installer does not open

Wait for the image to finish downloading (a minute or two the first time), then run `docker compose logs app`. A
platform that is already installed shows no box: that is normal.

### "This code is not the right one" or "Too many tries"

Use the **latest** code shown: it changes at every restart (`docker compose logs app` shows it). After too many
tries, wait the time shown, or run `docker compose restart app`: the code changes and the entry is unlocked.

### The installer asks for the code again

The setup session lasts 2 hours, and it ends when the platform restarts. Enter the new code. Your answers have to be
entered again.

### "42 refuses these credentials"

The UID and the secret are not a valid pair. Copy them again from the application's page on the intra: an extra
space is enough to make them wrong. Also check that the secret has not expired or been regenerated, and that both
values come from the **same** application.

### "42 is unreachable"

The computer has no access to the Internet, or the 42 API is down. You can go on without the check: the campuses are
then typed by hand, and the credentials are not tested.

## When signing in

### "Signing in with 42 is temporarily impossible" on the sign-in page

42 refuses the BDE application's UID or secret: the secret has expired or been regenerated. A signed-in owner sees
an alert banner and updates the key in **Settings**, 42 application section. The current key is at
<https://profile.intra.42.fr/oauth/applications>.

If nobody can sign in, the person who runs the server can put the key back without being signed in:

1. In the `.env` file at the root of the project (create it if it does not exist), with a text editor, add:

   ```text
   FORTYTWO_CLIENT_SECRET=the-new-secret
   BDE_REIMPORT=settings
   ```

2. Run `docker compose up -d`.
3. The log confirms it (`docker compose logs app`). **Then remove these two lines** from `.env` and run
   `docker compose up -d` again.

Only the values of `.env` are taken into the settings. Nothing else changes.

### Sign-in fails (invalid_grant, redirection URI, address 0.0.0.0)

You land on `…/auth-error?error=Configuration`, and `docker compose logs app` says _"does not match the redirection
URI used in the authorization request"_. The address the platform gives to 42 is not the one the 42 application has
registered, or you are not on that address. Check in this order.

1. **You open the platform at the registered address**, character for character: `http://localhost:3000`, not
   `http://127.0.0.1:3000`, not `http://0.0.0.0:3000`. `0.0.0.0` is the address the server listens on, not a site
   address: older versions showed it in the terminal. The browser keeps the sign-in cookies per address: starting
   to sign in on one address and coming back on another cannot work.
2. **The 42 application's redirect URL** is exactly the registered address followed by
   `/api/auth/callback/42-school`, for example `http://localhost:3000/api/auth/callback/42-school`. It is set at
   <https://profile.intra.42.fr/oauth/applications>. An owner reads the registered address in **Settings**, Address
   of the platform section.
3. **The registered address is the right one.** If it is wrong and nobody can sign in to fix it, the person who runs
   the server can put it back without being signed in:

   1. In the `.env` file at the root of the project (create it if it does not exist), with a text editor (Notepad,
      VS Code…), add these two lines with **your** address:

      ```text
      APP_URL=http://localhost:3000
      BDE_REIMPORT=settings
      ```

   2. Run `docker compose up -d`. The log confirms it: _"Adresse du site : old → new"_ (the log is in French).
   3. **Then remove these two lines** from `.env` and run `docker compose up -d` again. Otherwise the value in
      `.env` is taken again at every start and overwrites what you change in Settings.

   The address is checked as in the installer: `0.0.0.0` is refused, and `127.0.0.1` is written `localhost`.

If the intra answers "The redirect URI included is not valid", compare the application's redirect URL with the one
the platform sends: the intra's message shows the address it received. Look for `http` instead of `https`, an extra
`www.`, a forgotten port, a trailing slash.

### "Sign-in denied" after authorizing on the intra

- _"Your 42 campus (…) isn't allowed to access this platform"_: the person's campus is not in the allowed campuses.
  An owner adds it in **Settings**, Campuses section (an empty list allows every campus). The name is written as on
  the intra (`Nice`, `Paris`…); case does not matter.
- _"Your 42 profile is incomplete"_: the 42 account has no visible login, email or campus. It is fixed on the intra,
  not here.

### I sign in but I am "pending" although I should be an owner

Your login is not in the owners' list (a typo during installation?). Another owner adds it in **Settings**, Owners
section. If there is none, see [Configuration](configuration.md#replace-the-settings-with-files).

### Everyone is signed out, or a page loops

This is normal after the session key changes (the `secrets` volume was replaced): old sessions are worth nothing.
Everyone signs in again. If a page loops, deleting the site's cookies fixes it.

## The site shows an error page instead of the platform

A "needs fixing" or "is not answering" page (error 503) is intended: the platform could not start, and it says so
instead of restarting endlessly. The page names the problem and gives the command to run, and never shows a secret.

| The page says…                                                                              | Cause                                                                                                                                                                                                                                                | What to do                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The database refuses the connection"                                                       | The `secrets` volume was deleted or replaced (for example by `docker compose down -v`, which also deletes the data), or `POSTGRES_PASSWORD` changed **after** the database was created.                                                              | Restore the keys archive (`./scripts/restore.sh … --secrets …`). Otherwise, put the original values of `POSTGRES_*` back in `.env`, then `docker compose up -d`.                                                              |
| "The database is not answering"                                                             | The database is not started yet: normal for a minute after the server restarts. The page refreshes by itself.                                                                                                                                        | If it lasts: `docker compose ps`, then `docker compose logs postgres`.                                                                                                                                                        |
| "The database update failed"                                                                | A migration could not be applied. The code shown (`P3009`…) helps to search.                                                                                                                                                                         | Delete nothing. Read `docker compose logs app`. If needed, [roll back](upgrading.md#rolling-back).                                                                                                                            |
| "The update failed: your database was put back as it was"                                   | A step of the update failed. The platform put back the copy it had made just before, checked it, and stays stopped.                                                                                                                                  | Your data is intact. [Roll back](upgrading.md#rolling-back) to the previous version, and report the problem with the code and `docker compose logs app`.                                                                      |
| "The update failed and the database could not be put back as it was"                        | A step failed, then the automatic put-back failed too. The copy is kept.                                                                                                                                                                             | Do not start the platform. `./scripts/restore.sh --pre-update`, then report the problem.                                                                                                                                      |
| "The safety copy before the update failed"                                                  | The copy could not be made (a full disk, usually). Nothing was changed.                                                                                                                                                                              | Free some space and `docker compose up -d`. To go on without a copy (at your own risk): `BDE_SKIP_BACKUP=1` in `.env`.                                                                                                        |
| "The database is newer than this version"                                                   | An older version was started on a database a newer one had used.                                                                                                                                                                                     | If you went back on purpose: `./scripts/restore.sh --pre-update` first. Otherwise take the recent version again.                                                                                                              |
| "An earlier update of the database was left unfinished"                                     | A migration failed earlier and was neither finished nor undone.                                                                                                                                                                                      | `./scripts/restore.sh --pre-update`, then `docker compose up -d`.                                                                                                                                                             |
| "The image is older than docker-compose.yml" / "docker-compose.yml is older than the image" | The folder and the image are not at the same version (an image built on the spot is not replaced by a `git pull`).                                                                                                                                   | `docker compose pull`, then `docker compose up -d`; or `git pull` if the file is the old one. An image you build yourself: [build it again](deployment.md#build-the-image-yourself).                                          |
| "Data exists, but no settings are saved"                                                    | The database holds accounts but the platform found neither saved settings nor a complete `bde.config.yml` (a platform installed before the installer, started with the published image, which does not hold your file). The installer is not opened. | Put your `bde.config.yml` and `.env` back in the folder, then [build the image once](upgrading.md#if-your-platform-predates-the-installer): `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`. |
| "The database address is invalid"                                                           | `DATABASE_URL` is missing or badly written in `.env`.                                                                                                                                                                                                | With the provided `docker-compose.yml`, remove `DATABASE_URL` from `.env`: it is built by itself. Then `docker compose up -d`.                                                                                                |
| "A setting in the .env file needs fixing" or "The bde.config.yml file needs fixing"         | A files-driven installation whose `.env` or `bde.config.yml` is incomplete or invalid. The page lists the **names** of the settings, never their values.                                                                                             | Fix the file, then `docker compose up -d` (for `bde.config.yml`: [build the image again](deployment.md#build-the-image-yourself)). See [Configuration](configuration.md#replace-the-settings-with-files).                     |

A "Service temporarily unavailable" page (shown to visitors) means the database is not answering. It brings visitors
back by itself as soon as the database answers. Nothing is lost.

### Files-driven installation: "bde.config.yml not found"

This only concerns installations that have not copied their settings into the database yet (see
[Configuration](configuration.md#where-the-settings-are)). The published image does not hold your file: it is copied into the image when you build it from your folder
(`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`). If it is missing, empty, unreadable or invalid, the platform shows a "needs fixing"
page and its log names the case and the path it checked. If a **folder** named `bde.config.yml` lies in the project
(left by an old failed mount), delete it (`rmdir bde.config.yml`), then run that same command again.

## Notifications

| What you see                                                  | Likely cause                                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A message does not arrive                                     | Look at `docker compose logs app`: the `[events]` and `[members]` lines say why. A failing send never blocks the action (creating an event, approving a member).                            |
| Every message fails                                           | The webhook address is missing, badly copied, or the webhook was deleted in the channel. Enter it again in **Settings**, Notifications section.                                             |
| The card's title is not clickable, or the email has no button | The address of the platform is not set.                                                                                                                                                     |
| No avatar on Discord, but the BDE's name                      | The address of the platform is missing or local (`localhost`, a private network), or the logo is not an image Discord can read. See [The sender's logo](notifications.md#the-senders-logo). |
| Email without a logo                                          | The address of the platform is missing, or the logo is not served as an image. The BDE's name is shown instead.                                                                             |

## Events and calendars

- **"The configuration is invalid … events"**: a files-driven installation turned the module on without an `events`
  section or without a category. In a normal installation, categories are set in **Settings**.
- **A reminder did not go out.** Check that the channel is not "none", that the server was running from the reminder
  hour on, and that the members in charge exist (for email). Look for `[events]` in the logs.
- **The calendar link does not update.** That is the refresh rhythm of your calendar app: Google can take several
  hours.
- **The BDE link answers "Not found".** It was regenerated or turned off, or the module is turned off. Get the
  current link under _Events_ → _Shared calendar_.

## Network and Docker

### `Bind for … failed: port is already allocated`

Another program already uses port 3000. Create a `.env` file at the root of the project with `APP_PORT=3001` (or
another free port), run `docker compose up` again, and use that port in the platform's address and in the 42
application's redirect URL.

### `Cannot connect to the Docker daemon` or `failed to connect to the docker API`

Docker is not running. On Windows and macOS, **start Docker Desktop** and wait until it says it is running. On Linux:
`sudo systemctl start docker`.

### The site is not reachable from another computer

This is intended: the platform only listens on the machine itself (`127.0.0.1`). In production, the HTTPS proxy
exposes it. See the [deployment guide](deployment.md).

### `pull access denied`, `manifest unknown`, `unauthorized` or a timeout while downloading the image

Docker downloads the platform's image from `ghcr.io`, GitHub's registry.

- **`manifest unknown` / `not found`**: that version does not exist. Check `BDE_VERSION` in `.env` (remove the line to
  follow the folder), or the [Releases page](https://github.com/edouardbautz/BDE_Network/releases). Versions before 1.1.0
  were never published as images: [build the image yourself](deployment.md#build-the-image-yourself).
- **`unauthorized` / `denied`**: an old `docker login ghcr.io` with an expired token gets in the way of a public image.
  Run `docker logout ghcr.io`, then try again.
- **A timeout, or `no such host`**: the server cannot reach `ghcr.io` (no network, a proxy, a firewall). Let it through,
  or [build the image yourself](deployment.md#build-the-image-yourself).

### Windows: starting is slow

Docker Desktop's first file synchronization is slower than on Linux. Later starts are fast.

## None of this?

Look in the [FAQ](faq.md). Otherwise, open an [issue](https://github.com/edouardbautz/BDE_Network/issues) with the
platform's version and the last lines of `docker compose logs app` (with no secret). A security flaw is **not**
reported in public: see [SECURITY.md](../../SECURITY.md).
