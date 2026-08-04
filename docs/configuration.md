# Configuration

Deux fichiers gouvernent la configuration : `bde.config.yml` (versionné, non-secret) et `.env`
(secrets, jamais commité). Les deux sont validés au démarrage — une valeur manquante ou mal
formée empêche l'application de démarrer, avec un message expliquant quoi corriger.

## `bde.config.yml`

Voir `bde.config.example.yml` à la racine pour un exemple entièrement commenté. Référence des
champs :

### `bde`

| Champ           | Type                 | Description                                                      |
| --------------- | -------------------- | ---------------------------------------------------------------- |
| `name`          | texte                | Nom du BDE, affiché dans l'interface, le titre de l'onglet, etc. |
| `campus`        | texte                | Campus principal du bureau (affichage uniquement).               |
| `timezone`      | texte                | Fuseau horaire IANA, ex. `"Europe/Paris"`.                       |
| `defaultLocale` | `"fr"` \| `"en"`     | Langue initiale de l'interface.                                  |
| `accentColor`   | couleur hexadécimale | Couleur d'accent de l'interface (ex. `"#0f766e"`).               |
| `logoPath`      | chemin               | Chemin du logo depuis `/public`, ex. `"/logo.svg"`.              |

### `auth`

| Champ             | Type               | Description                                                                                                                            |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `owners`          | liste de logins 42 | Obtiennent automatiquement le rôle OWNER à la connexion. Le rôle OWNER **ne se change que via ce fichier**, jamais depuis l'interface. |
| `allowedCampuses` | liste de campus    | Seuls les logins dont le campus 42 figure dans cette liste peuvent se connecter.                                                       |

### `modules`

| Champ     | Type             | Description                                                                         |
| --------- | ---------------- | ----------------------------------------------------------------------------------- |
| `enabled` | liste de chaînes | Clés des modules métier activés. Vide pour l'instant, aucun module n'existe encore. |

### `notifications`

Canal utilisé pour chaque type de notification : `"email"`, `"discord"`, `"slack"` ou `"none"`.
Le canal choisi doit être configuré dans `.env` pour fonctionner (SMTP pour email, URL de
webhook pour Discord/Slack).

| Événement        | Déclenché quand                   |
| ---------------- | --------------------------------- |
| `memberPending`  | un nouveau membre demande l'accès |
| `memberApproved` | un membre est approuvé            |
| `memberRemoved`  | un membre est retiré du BDE       |

Cette couche de notification est prête (adaptateurs email/Discord/Slack fonctionnels) mais
n'est pas encore branchée à ces événements — ce sera fait avec les premiers modules métier.

## `.env`

Copié depuis `.env.example`. Ne jamais committer ce fichier.

| Variable                                                            | Obligatoire                     | Description                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`                 | oui                             | Identifiants PostgreSQL.                                                                                                                              |
| `DATABASE_URL`                                                      | oui                             | Chaîne de connexion Prisma. Utilisée par `npm run dev` en local ; ignorée (remplacée) par `docker-compose.yml` qui pointe vers le service `postgres`. |
| `AUTH_SECRET`                                                       | oui                             | Secret NextAuth. Générez-en un avec `npx auth secret`.                                                                                                |
| `FORTYTWO_CLIENT_ID`, `FORTYTWO_CLIENT_SECRET`                      | oui                             | Identifiants de votre application OAuth 42 (<https://profile.intra.42.fr/oauth/applications>).                                                        |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | si `notifications.*: "email"`   | Serveur SMTP pour l'envoi d'emails.                                                                                                                   |
| `DISCORD_WEBHOOK_URL`                                               | si `notifications.*: "discord"` | URL de webhook d'un salon Discord.                                                                                                                    |
| `SLACK_WEBHOOK_URL`                                                 | si `notifications.*: "slack"`   | URL de webhook Slack entrant.                                                                                                                         |

## Modifier la configuration sans reconstruire l'image

Avec `docker compose up` (fichier de production), `bde.config.yml` est monté en lecture seule
dans le conteneur. Éditez-le, puis :

```
docker compose restart app
```

Le changement prend effet immédiatement, sans reconstruction de l'image. Pour changer le logo ou
une variable de `.env`, une reconstruction est nécessaire (`docker compose up --build`).
