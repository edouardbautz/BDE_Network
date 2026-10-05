# Changelog

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage selon [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

## [0.2.0] - 2026-10-05

Premier module métier : **Événements**.

### Added

- Module **Événements** (`modules.enabled: [events]`, désactivé par défaut) : calendrier interne
  du bureau pour planifier et organiser les événements du BDE. Voir `docs/events.md`.
  - Titre, début, fin, lieu, description, catégorie et membres en charge ; **titre, dates, lieu,
    description et catégorie sont obligatoires** (validation Zod côté serveur et dans le
    formulaire, messages FR/EN sous chaque champ). Les événements incomplets créés avant cette
    règle restent affichables et ne sont bloqués qu'à leur prochaine modification.
  - Catégories et couleurs définies par chaque BDE dans `bde.config.yml` (section `events`).
  - Statut brouillon (visible uniquement des membres ayant la permission) ou confirmé (visible de
    tous les membres) ; stockage en UTC, affichage dans le fuseau du BDE ; année scolaire
    (septembre–août) calculée automatiquement.
  - Séries récurrentes (chaque semaine, toutes les 2 semaines, chaque mois) avec date de fin
    obligatoire, modification de toute la série, annulation d'une seule date.
  - Vue calendrier mensuel (pastilles colorées sur mobile avec détail du jour), vue liste (par
    défaut sur mobile), page de détail, filtres (catégorie, membre en charge, année scolaire),
    états vides et squelettes de chargement.
  - Bloc « Prochains événements » sur le tableau de bord.
  - Export `.ics` d'un événement et **lien d'abonnement personnel** (jeton secret par membre,
    régénérable depuis _Mon profil_, visibilité recalculée à chaque requête).
  - **Lien d'abonnement au niveau du BDE** (`/api/calendar/bde/<jeton>.ics`) : un seul lien à coller
    dans l'agenda partagé du bureau, événements confirmés uniquement (jamais de brouillon), géré
    par OWNER/ADMIN (afficher, copier, régénérer, désactiver, tout journalisé sans jamais écrire
    le jeton), avec une proposition de régénération quand un membre est retiré.
  - Notification de confirmation (une seule fois par événement) et **rappel la veille** via un
    planificateur interne (aucun cron, aucun service externe ; Windows, Linux, macOS ; jamais
    envoyé deux fois, même après redémarrage). Un échec d'envoi ne bloque jamais l'enregistrement
    ni les autres destinataires.
  - Journal d'audit (`event.*`, `calendar_feed.*`), données de démonstration, tests (récurrence,
    fuseaux, `.ics`, droits, rappels, rendu).
- Attribution de la permission d'un module à un membre depuis le panel _Membres_ (audit
  `permission.grant` / `permission.revoke`).
- Page _Mon profil_.
- Clés de notification `eventConfirmed` et `eventReminder` (optionnelles, `"none"` par défaut) et
  variable optionnelle `APP_URL` pour les liens dans les notifications.
- Configuration personnelle non versionnée : `bde.config.local.yml` (ignoré par Git) remplace
  `bde.config.yml` s'il existe.
- Barre latérale de navigation (tiroir sur mobile), page de refus de connexion `/auth-error`,
  et simulation de rôles pour les tests en local (`ENABLE_DEV_IMPERSONATION`, développement
  uniquement). Spécification du design system dans `docs/design.md`.

### Changed

- `auth.allowedCampuses` peut être vide (aucun filtre sur le campus).
- L'export des données personnelles (RGPD) inclut les événements créés ou dont le membre a la
  charge (jamais le jeton d'agenda) ; la politique de confidentialité les mentionne.
- Environnement de développement Docker : le schéma est appliqué avec
  `prisma db push --accept-data-loss` et les comptes et événements de démo sont créés au démarrage.
- `Button` déduit `nativeButton` de sa prop `render` (plus d'avertissement Base UI pour un lien).

## [0.1.0] - 2026-08-05

Version initiale (jamais étiquetée) : socle de la plateforme.

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

[Unreleased]: https://github.com/edouardbautz/BDE_Network/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/edouardbautz/BDE_Network/releases/tag/v0.2.0
