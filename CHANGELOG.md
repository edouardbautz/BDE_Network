# Changelog

Format basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage selon [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

### Added

- **README en anglais (`README.md`) et en français (`README.fr.md`)**, qui décrivent la plateforme
  telle qu'elle est : module Événements, rôles personnalisés, agenda synchronisé, notifications ;
  Finances et Réunions seulement dans une courte feuille de route. De **vraies captures d'écran**
  (tableau de bord, calendrier, événement, rôles, mobile ; thème clair, interface dans la langue du
  README) prises sur les données de démonstration, en WebP dans `docs/images/{en,fr}/`.
- **Installation en deux parcours** (`docs/installation.md`) : « Pour le bureau » (ce que le BDE décide
  et écrit dans `bde.config.yml`, sans notion technique, puis les rôles dans l'interface) et « Pour la
  personne technique » (serveur, Docker, domaine, HTTPS). Pas à pas de la création de l'application
  OAuth sur l'intra 42 (URL de redirection exacte, scope `public`, où trouver UID et secret, erreur
  `redirect_uri_mismatch`, **expiration du secret**) et section « Problèmes fréquents ».
- **`SECURITY.md`** (signalement privé par GitHub), modèles d'issues (bug, fonctionnalité) et de
  pull request, contact du Code de conduite (Discord).
- `APP_PORT` pour publier l'application sur un autre port que 3000.

- **Confirmer un événement** demande confirmation (fenêtre au style normal, non destructif) et dit
  si les membres seront prévenus : par e-mail, dans le salon Discord/Slack, ou pas du tout si aucune
  notification n'est configurée — ou qu'ils l'ont déjà été (la notification n'est envoyée qu'une fois).
- **Un titre par page** (« Membres · BDE Exemple »), un lien d'évitement « Aller au contenu », et la
  description du site traduite.
- **Page de confidentialité complétée** : e-mails et notifications (dont Discord/Slack), lien d'agenda
  personnel, cookies exacts (session, sécurité de connexion, langue). Nouvelle clé facultative
  `bde.contactEmail` pour afficher une vraie adresse de contact.
- Avertissement au démarrage quand `modules.enabled` contient un module qui n'existe pas (faute de frappe).
- `engines` (`node >= 22`) dans `package.json`.
- Sauvegarde et restauration sous Windows : mode d'emploi (Git Bash, PowerShell, WSL), testé.

- **Fenêtre de confirmation unique** (`ConfirmDialog`) pour toute action destructive ou irréversible :
  une boîte de dialogue centrée par-dessus la page, avec un titre clair, une phrase d'explication, un
  bouton d'action en style destructif et **Annuler**. Le focus démarre sur Annuler et reste piégé dans la
  fenêtre ; Échap et un clic à l'extérieur annulent ; le focus revient sur le bouton d'origine ; pendant
  l'envoi le bouton est occupé et ne peut pas être pressé deux fois. Elle remplace les blocs dépliés sous
  l'élément (qu'il fallait faire défiler pour voir) pour : refuser une demande, retirer un membre,
  supprimer un rôle, supprimer un événement ou toute sa série, annuler une date, régénérer ou désactiver
  le lien d'agenda du BDE, régénérer son lien personnel. **Changer le rôle d'un membre** demande
  désormais aussi confirmation (en indiquant l'ancien et le nouveau rôle). Documenté dans
  `docs/design.md` et `CLAUDE.md` pour les futurs modules.

- **Notifications sur les membres** (`memberPending`, `memberApproved`, `memberRemoved`), qui ne
  faisaient rien jusqu'ici : une nouvelle demande d'accès prévient les propriétaires et les rôles qui
  ont « Gérer les membres » (e-mail) ou le salon (Discord / Slack) ; une approbation prévient le
  membre par e-mail (ou le salon) ; un retrait écrit dans le salon seulement, **jamais d'e-mail à la
  personne retirée**. Envoyées après l'action : un échec d'envoi est journalisé et ne bloque rien.
  Un canal non configuré dans `.env` donne un avertissement au démarrage, pas une erreur.
- **Pages d'erreur en français et en anglais**, dans le style de la plateforme : page introuvable
  (y compris pour une adresse inconnue), erreur de page avec « Réessayer » et « Retour au tableau de
  bord » (seule la référence de l'erreur est affichée, jamais son message), et une page de dernier
  recours si la structure même du site échoue.
- **Confirmation avant « Refuser »** une demande d'accès, comme pour « Retirer du BDE ».

- **Rôles personnalisés** : chaque BDE crée ses rôles (Président, Trésorier, Secrétaire,
  Responsable événements…) depuis la nouvelle page **Rôles** et coche les droits exacts de chacun
  (gérer les membres, gérer les rôles, consulter / gérer chaque module activé, gérer l'agenda
  partagé). Un membre a **un seul rôle**, choisi dans un menu de la page _Membres_, où l'on choisit
  aussi le rôle à l'approbation d'une demande. Deux rôles modifiables existent dès l'installation :
  **Admin** (tous les droits sauf le journal d'audit, y compris ceux des futurs modules) et
  **Membre**. Le propriétaire (OWNER, défini dans `bde.config.yml`) garde tous les droits ; le
  journal d'audit reste réservé au propriétaire. Voir [docs/roles.md](docs/roles.md).
- **Règles anti-escalade de privilèges**, vérifiées côté serveur dans la transaction qui écrit :
  nul ne donne un droit qu'il n'a pas, ne modifie son propre rôle ni un rôle qui lui est supérieur,
  ne change le rôle d'un propriétaire ou d'un membre plus puissant que lui ; un rôle encore
  attribué ou par défaut ne se supprime pas. Chaque création, modification, suppression et
  attribution de rôle est inscrite au journal d'audit (`role.*`, `member.*`). Les règles sont
  vérifiées par plus de 130 tests et par mutation.
- Retrait d'un membre : confirmation avant suppression, et refus clairement expliqués (messages
  traduits) quand une action est interdite.
- CI : un job `migrations` rejoue la migration des rôles sur PostgreSQL et vérifie l'absence de
  dérive avec `schema.prisma`.

- **Vérification du `.env` au démarrage**, avec des messages en français compréhensibles par un
  non-développeur : `AUTH_SECRET` (32 caractères minimum), identifiants 42, `DATABASE_URL`, et les
  variables SMTP/webhook des notifications du module Événements réellement utilisées. Un avertissement
  clair signale le login « votre-login-42 » encore présent dans `auth.owners`, ou une `APP_URL` en
  `http://` sur une adresse publique.
- **Page « Service momentanément indisponible »** (FR/EN) quand la base de données ne répond pas :
  elle rassure, et ramène toute seule à la plateforme dès que le service revient. Nouvelle route
  `/api/health` et `HEALTHCHECK` Docker.
- **En-têtes de sécurité HTTP** : Content-Security-Policy, X-Frame-Options, nosniff, Referrer-Policy,
  Permissions-Policy, HSTS (seulement derrière un proxy HTTPS). `X-Powered-By` n'est plus envoyé.
- **Sauvegarde et restauration sans Node.js** (`scripts/backup.sh`, `scripts/restore.sh`) : une seule
  archive avec la base **et les fichiers envoyés**, rotation (`--keep`), restauration avec confirmation
  explicite, copie de sécurité automatique et retour arrière si la restauration de la base échoue.
- CI : job « docker image » (construit l'image, la démarre sur PostgreSQL, vérifie la santé et les
  en-têtes).

### Changed

- **La section `notifications` de `bde.config.yml` est facultative** : sans elle, toutes les notifications
  sont désactivées (les trois notifications de membres étaient obligatoires, ce qui faisait échouer la
  construction de l'image pour un BDE qui n'avait rien à y mettre). Trouvé en suivant le guide
  d'installation depuis un clone neuf.
- **PostgreSQL ne publie plus de port** dans `docker-compose.yml` de production : seule l'application,
  sur le réseau Docker, peut lui parler (`docker-compose.dev.yml` garde le port pour `npm run dev`).
- `AUTH_SECRET` se génère avec Docker (`docker run --rm alpine sh -c "head -c 32 /dev/urandom | base64"`),
  une commande qui marche sous Windows, Linux et macOS sans Node.js : la doc, `.env.example` et le
  message du démarrage la donnent.
- Guide utilisateur à jour (barre latérale, rôles, fenêtres de confirmation, déconnexion) et message
  vide du tableau de bord : le module Événements n'est plus présenté comme « futur ».
- En-tête des cartes (tableau de bord, membres, profil) : le titre et l'action sont enfin sur une
  même ligne (la classe `flex` manquait).

- **Moins de requêtes SQL** : la session est résolue **une seule fois par requête** (`React.cache`), au
  lieu d'une fois par composant qui la demande. Mesuré sur la base : tableau de bord 13 → 7 requêtes,
  membres 9 → 6, rôles 7 → 4, profil 7 → 4, événements 16 → 13.
- **E-mails groupés** : une seule connexion SMTP pour tous les destinataires d'un envoi (au lieu d'une
  par destinataire) ; une adresse refusée n'arrête pas les autres.
- **Rappel d'événement sans personne en charge** : il part aux propriétaires et aux membres dont le
  rôle permet de gérer les événements, au lieu de ne partir à personne.
- **Un même e-mail peut servir à deux comptes** (migration `user_email_not_unique`) : le login est
  l'identité. Avant, une adresse déjà utilisée par un autre compte empêchait de se connecter. Une
  double première connexion simultanée ne provoque plus d'erreur.
- `dashboard` et `profile` vérifient eux-mêmes que le compte est approuvé (`requireApprovedSession`).
- `bde.defaultLocale` est documentée pour ce qu'elle fait : la langue des messages envoyés.
- `@types/node` passe à la version 22 (celle du runtime).

- **Cas attendus dans les actions** : supprimer ou changer le statut d'un événement déjà supprimé,
  annuler une date qui n'existe plus, approuver une demande déjà traitée… ramènent à la liste avec un
  message clair au lieu d'une erreur 500, et la liste se met à jour.
- **Les messages Discord et Slack neutralisent les mentions** (`@everyone`, `@here`, `@channel`,
  `<!channel>`, `<@…>`, liens `<url|texte>`) : un nom ou un titre d'événement ne peut plus notifier
  tout un serveur. Le webhook Discord envoie `allowed_mentions: { parse: [] }`.
- Les valeurs par défaut des notifications de membres de `bde.config.yml` et de l'exemple sont
  `"none"`.

- **Mise à jour depuis une version antérieure** : la migration `custom_roles` convertit les comptes
  sans perte et sans dépendre de `bde.config.yml` — les ADMIN deviennent le rôle « Admin », les
  MEMBER le rôle « Membre » (qui reçoit toujours `events.view`), et un membre qui avait la
  permission d'un module reçoit un rôle « Membre + `module` » ; une entrée `role.migrate` du
  journal d'audit garde trace de l'ancien état. Un ADMIN a désormais aussi les droits de gestion des
  événements et du calendrier partagé (rôle « Admin » : tous les droits). En développement
  (`docker-compose.dev.yml`, `db push`), la base est recréée : relancez `npm run seed:demo`.
- La simulation de rôle de développement propose « En attente » et chaque rôle du BDE ; les droits
  simulés s'appliquent aussi aux actions (et le journal d'audit le mentionne).

- **Image Docker de production réduite de 2,15 Go à 465 Mo** : build Next.js `standalone`, Prisma CLI
  installé à part et allégé, sharp et TypeScript retirés, ni npm ni yarn dans l'image finale.
- Le port 3000 n'est plus publié que sur `127.0.0.1` par défaut (`APP_BIND` pour l'ouvrir) : seul le
  reverse proxy HTTPS expose l'application. Le cas sans proxy est documenté.
- Délai de connexion à la base limité à 3 secondes (au lieu d'attendre indéfiniment).
- `bde.config.local.yml`, `.audit/` et `.env*` ne sont plus copiés dans l'image Docker.

### Removed

- **La route publique `/api/files/…` et tout le code de stockage de fichiers** (adaptateur local,
  volume `uploads`, dossier `storage/`) : rien n'y écrivait, et servir des fichiers sans authentification
  aurait été une faille dès le premier envoi. `backup.sh` ne sauvegarde plus que la base ; `restore.sh`
  lit toujours les anciennes archives (leur dossier de fichiers est ignoré). On recréera un stockage
  avec une vraie fonctionnalité d'envoi.
- Des doublons : le calcul des initiales (4 copies → 1), les métadonnées de simulation de rôle, le
  script `db:seed` (identique à `seed:demo`), le namespace de messages `common` et la clé inutilisée
  `roles.page.membersLink`.

- Le rôle fixe `ADMIN` (remplacé par un rôle personnalisé « Admin ») et la table `ModulePermission`
  (les droits d'un module sont maintenant portés par les rôles) ; les actions d'audit
  `permission.grant` / `permission.revoke` sont remplacées par `role.*` et `member.role_change`.

- `npm run db:backup` et `npm run db:restore` (remplacés par `scripts/backup.sh` et
  `scripts/restore.sh`, qui n'exigent que Docker).

### Fixed

- Un membre retiré du BDE perd immédiatement l'accès : son cookie de session encore valide ne
  donne plus aucun droit (lecture des brouillons, création ou modification d'événements, export
  de données). Les contrôles de rôle et de permission refusent désormais tout identifiant ou rôle
  manquant ou inconnu.

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
