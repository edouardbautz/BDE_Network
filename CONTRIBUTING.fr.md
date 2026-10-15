🇫🇷 Français · [🇬🇧 English](CONTRIBUTING.md)

# Contribuer à BDE_Network

Merci de votre intérêt pour ce projet ! Ce document résume les règles générales. Pour la mise en place détaillée d'un
environnement de développement, voir le [guide contributeur](docs/fr/contributing.md). Pour l'architecture et les
conventions techniques, voir [docs/architecture.md](docs/architecture.md) (en anglais).

## Code de conduite

Ce projet suit un [code de conduite](CODE_OF_CONDUCT.fr.md). En participant, vous acceptez de le respecter.

## Signaler un bug ou proposer une fonctionnalité

Ouvrez une issue GitHub (des modèles vous guident : bug ou demande de fonctionnalité). Pour un bug, précisez les
étapes pour le reproduire, le comportement attendu et observé, et votre environnement (système, version de Docker…).
Pour une fonctionnalité, décrivez le besoin avant la solution technique.

## La branche `main` est protégée

Personne ne pousse directement sur `main`, le responsable du projet compris, et aucun push forcé n'est possible. Toute
modification passe par **une branche et une pull request**, et ne se fusionne que lorsque les vérifications
obligatoires de l'intégration continue sont vertes : `ci (ubuntu-latest)`, `ci (windows-latest)`, `docker image`,
`migrations` et `docs`.

## Proposer une modification

1. Forkez le dépôt et créez une branche depuis `main`.
2. Mettez en place l'environnement de développement (voir le [guide contributeur](docs/fr/contributing.md)).
3. Faites vos modifications. Gardez les commits atomiques et suivez
   [Conventional Commits](https://www.conventionalcommits.org/fr/) (`feat:`, `fix:`, `docs:`, `chore:`,
   `refactor:`, `test:`…).
4. Avant d'ouvrir la pull request, vérifiez en local :

   ```text
   npm run lint
   npm run format:check
   npm run typecheck
   npm run test
   npm run build
   ```

   Si vous avez modifié la documentation, lancez aussi `npm run lint:md` et `npm run docs:check`.

5. Ouvrez la pull request avec une description claire de ce qui change et pourquoi, puis attendez que l'intégration
   continue soit verte : la pull request ne peut pas être fusionnée avant.

## Style de code

- TypeScript strict, aucun `any`.
- Aucun texte visible en dur : tout passe par next-intl (`messages/fr.json` et `messages/en.json`).
- Aucun script npm qui dépende d'un shell propre à Unix ou à Windows (voir docs/architecture.md).
- Les composants `src/components/ui/` sont générés par shadcn/ui : ne les modifiez pas à la main.

## Documentation

La documentation est écrite en français et en anglais, avec les mêmes pages dans `docs/fr/` et `docs/en/` : modifier
l'une, c'est modifier l'autre. Voir la section « La documentation » du [guide contributeur](docs/fr/contributing.md).

## Questions

Ouvrez une issue ou une discussion GitHub. Pour un contact plus direct (une question avant de se lancer, un
signalement relevant du [code de conduite](CODE_OF_CONDUCT.fr.md)), le responsable du projet est joignable sur
Discord : `meteore_1`. Une faille de sécurité ne se signale **pas** en public : voir [SECURITY.md](SECURITY.md).
