# Guide contributeur

Ce guide détaille la mise en place d'un environnement de développement. Pour les règles
générales (style de commit, code de conduite), voir [CONTRIBUTING.md](../CONTRIBUTING.md) à la
racine du dépôt.

## Deux façons de développer

### Option A — tout dans Docker (recommandée si vous ne voulez rien installer)

```
cp .env.example .env      # cp -> Copy-Item sous PowerShell
docker compose -f docker-compose.dev.yml up
```

Ceci lance PostgreSQL et l'application en mode développement (`next dev`) dans des conteneurs,
avec le code source monté en volume : vos modifications sont reprises à chaud (hot reload), sans
reconstruction. `node_modules` et `.next` restent dans des volumes Docker nommés (jamais montés
depuis l'hôte) pour éviter tout problème de binaires natifs incompatibles entre votre OS et le
conteneur Linux. Le schéma Prisma et les comptes de démo (`npm run seed:demo`) sont appliqués
automatiquement à chaque démarrage — une seule commande suffit, y compris pour tester les rôles
(voir [README](../README.md#tester-les-rôles-en-local)).

Sous Windows, si le rechargement à chaud semble ne pas réagir à vos modifications, vérifiez que
`WATCHPACK_POLLING=true` est bien actif (c'est la valeur par défaut dans
`docker-compose.dev.yml`) — Docker Desktop ne propage pas toujours fidèlement les événements de
système de fichiers natifs à travers un montage bind.

### Option B — Node.js en local, PostgreSQL dans Docker

Prérequis : Node.js 22+, npm.

```
cp .env.example .env
docker compose up postgres -d   # seulement la base de données
npm install
npm run db:migrate
npm run dev
```

L'application est disponible sur <http://localhost:3000>.

## Commandes utiles

| Commande                                                 | Effet                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                            | Serveur de développement Next.js                                                                          |
| `npm run build`                                          | Build de production                                                                                       |
| `npm run lint` / `npm run lint:fix`                      | ESLint                                                                                                    |
| `npm run format` / `npm run format:check`                | Prettier                                                                                                  |
| `npm run typecheck`                                      | Vérification TypeScript sans émission                                                                     |
| `npm run test` / `npm run test:watch`                    | Tests Vitest                                                                                              |
| `npm run db:migrate`                                     | Crée et applique une migration Prisma (dev)                                                               |
| `npm run db:studio`                                      | Interface graphique Prisma Studio                                                                         |
| `npm run seed:demo`                                      | Peuple la base avec des rôles et des utilisateurs fictifs (propriétaire, admin, président, membres)       |
| `./scripts/backup.sh` / `./scripts/restore.sh <archive>` | Sauvegarde/restauration (base + fichiers envoyés), Docker seul requis (voir [déploiement](deployment.md)) |

Toutes les commandes sont des scripts npm portables (aucun opérateur shell spécifique à Unix ou
Windows) — elles fonctionnent à l'identique dans PowerShell, cmd, bash ou zsh.

## Avant d'ouvrir une pull request

```
npm run lint
npm run format:check
npm run typecheck
npm run test
npm run build
```

Ce sont exactement les étapes vérifiées par la CI (`.github/workflows/ci.yml`), sur une matrice
`ubuntu-latest` / `windows-latest`.

## Conventions de code

Voir [CLAUDE.md](../CLAUDE.md) à la racine — c'est la référence technique complète du projet
(arborescence, modèle de données, conventions, permissions, pièges connus). Lisez-le avant toute
modification structurelle.

En résumé :

- TypeScript strict, aucun `any`.
- Commits [Conventional Commits](https://www.conventionalcommits.org/), atomiques.
- Tout texte visible par l'utilisateur passe par next-intl (`messages/fr.json` + `en.json`),
  jamais de texte en dur dans les composants.
- Les composants `src/components/ui/` sont générés par shadcn/ui — ne pas les modifier à la
  main, régénérer via `npx shadcn add <composant>`.

## Dépendances

- **NextAuth v5 est en beta, et c'est assumé.** La v5 n'existe que sous le tag `beta` de npm
  (le tag `latest` est la v4) ; elle apporte l'helper universel `auth()` sur lequel repose toute
  l'authentification du projet. La version est **épinglée à l'exacte** (`5.0.0-beta.32`) : aucune
  mise à jour ne passe sans qu'on l'ait choisie. Pour la changer, lisez les notes de version, lancez
  `npm test` (en particulier `src/lib/auth/removed-account.test.ts`, qui vérifie qu'un membre
  retiré est bien déconnecté), puis changez **ensemble** `next-auth` et `@auth/core` (ce dernier
  est épinglé à la version qu'utilise `next-auth`).
- **`next` et `eslint-config-next`** sont épinglés à la même version exacte et se mettent à jour
  ensemble.
- **`nodemailer`** : NextAuth déclare une dépendance optionnelle sur nodemailer 7 ou 8 (pour son
  fournisseur d'e-mails, que ce projet n'utilise pas). Le champ `overrides` de `package.json` l'aligne
  sur notre version.
- **Audit de sécurité** : `npm run audit:prod` (lancé par la CI) échoue si une alerte de
  gravité haute ou critique apparaît dans les dépendances de production. Les rares alertes sans
  correctif applicable sont listées avec leur raison dans `scripts/audit-allowlist.json` ; retirez
  une entrée dès que sa dépendance est corrigée.
- **Dependabot** propose chaque lundi un seul lot de mises à jour mineures et correctifs ; les
  versions majeures arrivent séparément, à examiner une par une.

## Base de données : migrations

```
npm run db:migrate       # crée et applique une migration à partir des changements de schema.prisma
npm run db:push          # applique le schema sans créer de migration (prototypage rapide)
npm run db:studio        # explorateur de données
```

Committez toujours le dossier `prisma/migrations/` généré.
