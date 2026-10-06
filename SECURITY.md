# Security policy · Politique de sécurité

## Reporting a vulnerability

**Please do not open a public issue** for a security problem.

Use GitHub's private reporting: on the repository, open **Security → Report a vulnerability**
(<https://github.com/edouardbautz/BDE_Network/security/advisories/new>). Only the maintainer sees
the report, and we can work on a fix together before anything is public.

Please include what you found, how to reproduce it (a request, a URL, a role that can do what it
should not…), and which version or commit you tested. Do not include real personal data.

If you cannot use GitHub's form, message `meteore_1` on Discord to ask for a private channel. Do
not put the details in that first message.

What to expect: this is a volunteer-run project. We aim to acknowledge a report within a week,
to tell you whether we consider it a vulnerability, and to credit you in the release notes if you
wish. Please give us reasonable time to publish a fix before disclosing publicly.

## Supported versions

Security fixes go to the **latest release** and to `main`. Each BDE runs its own instance from
its own fork: after a fix, update your fork and redeploy (`git pull`, then
`docker compose up --build -d`; backups first, see [docs/deployment.md](docs/deployment.md)).

## What is in scope

The platform itself: authentication and sessions, permissions and role management (privilege
escalation is taken very seriously: see [docs/roles.md](docs/roles.md)), the calendar feeds, data
exposure, injection and XSS, the Docker image and its default configuration.

Out of scope: a BDE's own server (operating system, reverse proxy, firewall), a leaked `.env`
or an expired 42 secret, social engineering, denial of service by volume.

## Signaler une faille

**N'ouvrez pas d'issue publique** pour un problème de sécurité.

Utilisez le signalement privé de GitHub : sur le dépôt, **Security → Report a vulnerability**
(<https://github.com/edouardbautz/BDE_Network/security/advisories/new>). Seul le responsable du
projet voit le signalement, et nous pouvons préparer un correctif avant toute publication.

Indiquez ce que vous avez trouvé, comment le reproduire (une requête, une adresse, un rôle qui peut
faire ce qu'il ne devrait pas…) et la version ou le commit testé. N'incluez pas de vraies données
personnelles.

Si vous ne pouvez pas utiliser le formulaire GitHub, écrivez à `meteore_1` sur Discord pour
demander un canal privé, sans mettre les détails dans ce premier message.

À quoi vous attendre : le projet est mené bénévolement. Nous visons un accusé de réception sous une
semaine, une réponse sur la nature du problème, et la mention de votre nom dans les notes de
version si vous le souhaitez. Merci de nous laisser un délai raisonnable pour publier un correctif
avant toute divulgation publique.

## Versions prises en charge

Les correctifs de sécurité vont dans la **dernière version publiée** et dans `main`. Chaque BDE
fait tourner sa propre instance depuis son fork : après un correctif, mettez votre fork à jour et
redéployez (`git pull`, puis `docker compose up --build -d` ; sauvegarde d'abord, voir
[docs/deployment.md](docs/deployment.md)).
