🇬🇧 English · [🇫🇷 Français](README.fr.md)

# BDE_Network

[![CI](https://github.com/edouardbautz/BDE_Network/actions/workflows/ci.yml/badge.svg)](https://github.com/edouardbautz/BDE_Network/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/edouardbautz/BDE_Network)](LICENSE)
[![Version](https://img.shields.io/github/v/release/edouardbautz/BDE_Network)](https://github.com/edouardbautz/BDE_Network/releases)

**A free, self-hosted platform to run a student association (_Bureau Des Étudiants_, BDE) at a 42 school: members sign
in with their 42 account, the board gives out roles, and the events calendar syncs with Google Calendar, Outlook and
Apple Calendar.**

![The events calendar](docs/images/en/calendar.webp)

Each BDE runs **its own instance**: its own database, its own settings, its own 42 application. Nothing is shared
between instances.

## What it does

- **Sign in with 42 only.** No password to manage. New members wait for approval; the board approves them and picks
  a role. Sign-in can be limited to some campuses.
- **Installed in the browser.** One command, then a page guides you step by step and checks your answers with 42. No
  file to edit, then a **Settings** page for the owners.
- **Custom roles and rights.** Each BDE creates its own roles (President, Treasurer…) and ticks what each may do.
  Nobody can give a right they do not hold: the server blocks it, and it is tested.
- **Events.** A month calendar and a list, colored categories, repeating events, drafts that stay private until
  confirmed, members in charge, one date of a series edited or canceled on its own.
- **Calendar sync.** A personal link for each member, and **one link for the whole BDE** to paste once into a shared
  calendar.
- **Notifications** by email, Discord or Slack: an event confirmed, a reminder the day before, an access request, an
  approval, a removal. On Discord and Slack, readable cards.
- **Audit log** of sensitive actions, **GDPR** export of one's own data, a privacy page.
- **French and English**, light and dark themes, your color and logo, usable on a phone.
- **Easy to run.** Docker only, migrations applied at start, backup and restore scripts, a health check, and a guide
  to upgrade.

|                                                 |                                                    |
| ----------------------------------------------- | -------------------------------------------------- |
| ![The dashboard](docs/images/en/dashboard.webp) | ![The installer](docs/images/en/installer.webp)    |
| ![Role management](docs/images/en/roles.webp)   | ![The Settings page](docs/images/en/settings.webp) |

<img src="docs/images/en/mobile.webp" alt="On a phone" width="260">

## Quick start

You need [Docker](https://www.docker.com/products/docker-desktop/) and Git, on Windows, Linux or macOS. No Node.js.

1. **Get the code**: `git clone https://github.com/edouardbautz/BDE_Network.git`, then `cd BDE_Network`.
2. **Start the platform**:

   ```text
   docker compose up
   ```

3. **Open** `http://localhost:3000` and enter the **setup code** shown in the terminal. Follow the steps in the
   browser.
4. **Once installed**, press `Ctrl+C`, then run `docker compose up -d`. This is the command to use from now on.

You will need a 42 application (the installer explains how) and, for a real server, a domain name and HTTPS: see the
[deployment guide](docs/en/deployment.md). **Back up the `secrets` volume** with `./scripts/backup.sh`.

## Documentation

The documentation is in English and in French, with the same pages.

| I want to…                     | Read                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Find my way                    | [The documentation index](docs/en/README.md), by type of reader                                          |
| Install the platform           | [Installation](docs/en/installation.md) · [Deployment](docs/en/deployment.md)                            |
| Upgrade to a new version       | [Upgrading](docs/en/upgrading.md)                                                                        |
| Use it, as a board member      | [User guide](docs/en/user-guide.md) · [Roles and rights](docs/en/roles.md) · [Events](docs/en/events.md) |
| Set up Discord, Slack or email | [Notifications](docs/en/notifications.md)                                                                |
| Change a setting               | [Configuration](docs/en/configuration.md)                                                                |
| Solve a problem                | [Troubleshooting](docs/en/troubleshooting.md) · [FAQ](docs/en/faq.md) · [Glossary](docs/en/glossary.md)  |
| Know how it is checked         | [Quality](docs/en/quality.md)                                                                            |
| Contribute                     | [Contributor guide](docs/en/contributing.md) · [Architecture](docs/architecture.md)                      |

## Roadmap

Planned business modules, not available yet: **Finances** (budget and expenses) and **Meetings** (agendas and
minutes). A module brings its own rights without touching the core
([how](docs/architecture.md)).

## Built with

Next.js 16 (App Router) · TypeScript (strict) · PostgreSQL · Prisma 7 · Tailwind CSS v4 · shadcn/ui · NextAuth v5
(beta, pinned version) · next-intl · Docker Compose

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). To report a vulnerability, read
[SECURITY.md](SECURITY.md): please do not open a public issue. Changes are listed in the [CHANGELOG](CHANGELOG.md).

## License

[MIT](LICENSE)
