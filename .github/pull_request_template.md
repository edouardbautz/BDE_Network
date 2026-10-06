## What and why / Quoi et pourquoi

<!-- What changes, and the need behind it. Link the issue if there is one: Closes #123 -->

## How to check / Comment vérifier

<!-- The clicks or commands that show it works. Screenshots for a visible change (light theme is enough). -->

## Checklist

- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test` and `npm run build` pass
- [ ] New text goes through `messages/fr.json` **and** `messages/en.json`
- [ ] New behaviour has tests; a rule about permissions or roles was broken on purpose to see a test fail
- [ ] A destructive action asks through `ConfirmDialog`; a new page has `loading.tsx` and a title (`pageTitle`)
- [ ] Docs and `CHANGELOG.md` (section Unreleased) updated if users are affected
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/)

<!-- Security problem? Do not describe it here: see SECURITY.md. -->
