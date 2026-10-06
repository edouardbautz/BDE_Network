# Contribuer à BDE_Network

Merci de votre intérêt pour ce projet ! Ce document résume les règles générales. Pour la mise en
place détaillée d'un environnement de développement, voir
[docs/contributing-guide.md](docs/contributing-guide.md). Pour l'architecture et les
conventions techniques, voir [CLAUDE.md](CLAUDE.md).

## Code de conduite

Ce projet suit un [Code de conduite](CODE_OF_CONDUCT.md). En participant, vous acceptez de le
respecter.

## Signaler un bug ou proposer une fonctionnalité

Ouvrez une issue GitHub (des modèles vous guident : bug ou demande de fonctionnalité). Pour un bug, précisez les étapes de reproduction, le comportement
attendu et observé, et votre environnement (OS, version de Docker...). Pour une fonctionnalité,
décrivez le besoin avant la solution technique.

## La branche `main` est protégée

Personne ne pousse directement sur `main`, mainteneur compris, et aucun push forcé n'est possible. Toute
modification passe par **une branche et une pull request**, et ne se fusionne que lorsque les quatre
vérifications de l'intégration continue sont vertes : `ci (ubuntu-latest)`, `ci (windows-latest)`,
`docker image` et `migrations`.

## Proposer une modification

1. Forkez le dépôt et créez une branche depuis `main`.
2. Mettez en place l'environnement de développement (voir
   [docs/contributing-guide.md](docs/contributing-guide.md)).
3. Faites vos modifications. Gardez les commits atomiques et suivez
   [Conventional Commits](https://www.conventionalcommits.org/fr/) (`feat:`, `fix:`, `docs:`,
   `chore:`, `refactor:`, `test:`...).
4. Avant d'ouvrir la pull request, vérifiez localement :
   ```
   npm run lint
   npm run format:check
   npm run typecheck
   npm run test
   npm run build
   ```
5. Ouvrez la pull request avec une description claire de ce qui change et pourquoi, puis attendez que
   l'intégration continue soit verte : la pull request ne peut pas être fusionnée avant.

## Style de code

- TypeScript strict, aucun `any`.
- Aucun texte en dur visible par l'utilisateur — tout passe par next-intl
  (`messages/fr.json` / `en.json`).
- Pas de script npm dépendant d'un shell Unix ou Windows spécifique (voir CLAUDE.md).
- Les composants `src/components/ui/` sont générés par shadcn/ui, ne pas les éditer à la main.

## Questions

Ouvrez une issue ou une discussion GitHub. Pour un contact plus direct (une question avant de
se lancer, un signalement relevant du [Code de conduite](CODE_OF_CONDUCT.md)), le responsable du
projet est joignable sur Discord : `meteore_1`. Une faille de sécurité ne se signale **pas** en
public : voir [SECURITY.md](SECURITY.md).
