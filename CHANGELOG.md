# Changelog

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage selon [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

### Added

- Initialisation du projet : Next.js 15, TypeScript strict, Tailwind CSS v4, shadcn/ui, Prisma 7.
- Authentification OAuth 42 (NextAuth v5), sans mot de passe.
- Modèle de données : `User`, `Role`, `ModulePermission`, `AuditLog`.
- Rôles OWNER / ADMIN / MEMBER / PENDING, permissions par module, journal d'audit en lecture
  seule (OWNER uniquement).
- Configuration versionnée (`bde.config.yml`, validée avec Zod) et secrets (`.env`) séparés.
- Internationalisation (next-intl), français par défaut, anglais disponible.
- Tableau de bord, page de connexion, page d'attente, gestion des membres, journal d'audit,
  politique de confidentialité, export de ses propres données (RGPD).
- Abstraction de notifications (email, Discord, Slack) — pas encore branchée à un cas d'usage.
- Abstraction de stockage de fichiers (adaptateur local, interface prête pour S3).
- Scripts de sauvegarde/restauration PostgreSQL, seed de démonstration.
- Docker Compose (production et développement avec rechargement à chaud), Dockerfile.
- CI GitHub Actions (lint, format, typecheck, build, test) sur ubuntu-latest et windows-latest.
- Module **Événements** (`modules.enabled: [events]`) : calendrier interne du bureau, catégories
  configurables, séries récurrentes (hebdomadaire, bimensuelle, mensuelle) avec annulation d'une
  date, brouillons, vues calendrier/liste, filtres, export `.ics` et flux d'abonnement personnel,
  notification de confirmation et rappel de la veille (planificateur interne, jamais envoyé deux
  fois), journal d'audit, données de démonstration. Voir `docs/events.md`.
- Lien d'abonnement agenda au niveau du BDE (`/api/calendar/bde/<jeton>.ics`) : un seul lien pour
  l'agenda partagé du bureau, événements confirmés uniquement, géré par OWNER/ADMIN (afficher,
  copier, régénérer, désactiver, tout journalisé), avec une proposition de régénération quand un
  membre est retiré. Voir `docs/events.md`.
- Attribution de la permission d'un module à un membre depuis le panel _Membres_.
- Page _Mon profil_.
- Configuration personnelle non versionnée : `bde.config.local.yml` (ignoré par Git) remplace
  `bde.config.yml` s'il existe.
