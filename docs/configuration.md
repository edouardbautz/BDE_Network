# Configuration

Deux fichiers gouvernent la configuration : `bde.config.yml` (versionné, non-secret) et `.env`
(secrets, jamais commité). Les deux sont validés **à chaque démarrage** de l'application — une
valeur manquante ou mal formée l'empêche de démarrer, avec un message en français qui explique
quoi corriger (à lire avec `docker compose logs app`). Un simple avertissement est affiché, sans
bloquer, pour ce qui est probablement une erreur : par exemple le login « votre-login-42 » encore
présent dans `auth.owners`, ou une `APP_URL` en `http://` sur une adresse publique.

## `bde.config.yml`

### Garder sa configuration personnelle hors de Git

`bde.config.yml` est versionné : il contient des valeurs d'exemple, pas vos vraies données. Pour
travailler avec votre vraie configuration (votre login, le nom de votre BDE) sans jamais la
commiter, copiez-le vers `bde.config.local.yml` et éditez cette copie :

```
cp bde.config.yml bde.config.local.yml
```

`bde.config.local.yml` est ignoré par Git. S'il existe, l'application le charge **à la place** de
`bde.config.yml` (les deux ne sont pas fusionnés : le fichier local doit être complet). Le nom du
fichier chargé apparaît dans les logs au démarrage. Il est lu depuis le dossier du projet, y
compris avec `docker-compose.dev.yml` ; le `docker-compose.yml` de production ne monte que
`bde.config.yml` — pour un déploiement, éditez ce dernier dans votre fork.

Voir `bde.config.example.yml` à la racine pour un exemple entièrement commenté. Référence des
champs :

### `bde`

| Champ           | Type                 | Description                                                                                                                                 |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | texte                | Nom du BDE, affiché dans l'interface, le titre de l'onglet, etc.                                                                            |
| `campus`        | texte                | Campus principal du bureau (affichage uniquement).                                                                                          |
| `timezone`      | texte                | Fuseau horaire IANA, ex. `"Europe/Paris"`.                                                                                                  |
| `defaultLocale` | `"fr"` \| `"en"`     | Langue des **messages envoyés** (e-mails, Discord, Slack). La langue de l'interface se choisit par l'adresse (`/fr/…`, `/en/…`).            |
| `contactEmail`  | e-mail, optionnel    | Adresse affichée sur la page de confidentialité pour exercer ses droits. Sans elle, la page renvoie vers un administrateur ou propriétaire. |
| `accentColor`   | couleur hexadécimale | Couleur d'accent de l'interface (ex. `"#0f766e"`).                                                                                          |
| `logoPath`      | chemin               | Chemin du logo depuis `/public`, ex. `"/logo.svg"`.                                                                                         |

### `auth`

| Champ             | Type               | Description                                                                                                                                                                                                                    |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `owners`          | liste de logins 42 | Obtiennent automatiquement le statut OWNER (propriétaire : tous les droits) à la connexion. Ce statut **ne se change que via ce fichier**, jamais depuis l'interface. La comparaison ignore la casse et les espaces superflus. |
| `allowedCampuses` | liste de campus    | Seuls les logins dont le campus 42 figure dans cette liste peuvent se connecter. La comparaison ignore la casse et les espaces superflus. **Liste vide (`[]`) = aucun filtre, tous les campus sont autorisés.**                |

### `modules`

| Champ     | Type             | Description                                                                                                                                                                          |
| --------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled` | liste de chaînes | Clés des modules métier activés. Module disponible : `events` (voir ci-après). Une clé inconnue (faute de frappe) ne bloque pas le démarrage mais est signalée par un avertissement. |

Un module désactivé n'a ni route, ni lien, ni donnée visible. Un module activé s'attribue
ensuite membre par membre depuis _Membres_ (voir le [guide du module](events.md)).

### `events`

Obligatoire **uniquement** si `events` figure dans `modules.enabled` (sinon l'application refuse
de démarrer avec un message explicite). Détails d'usage : [Module Événements](events.md).

| Champ          | Type               | Description                                                                                                                                                                |
| -------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categories`   | liste (au moins 1) | Catégories proposées à la création. Chaque entrée : `key` (identifiant stable, minuscules/chiffres/tirets, unique), `label` (nom affiché tel quel), `color` (hexadécimal). |
| `reminderHour` | entier 0–23        | Heure locale (fuseau `bde.timezone`) du rappel de la veille. Défaut : `18`.                                                                                                |

```yaml
events:
  categories:
    - { key: 'soiree', label: 'Soirée', color: '#db2777' }
    - { key: 'sport', label: 'Sport', color: '#16a34a' }
  reminderHour: 18
```

Ne changez pas la `key` d'une catégorie existante : les événements déjà créés la référencent.

### `notifications`

**Section facultative** : sans elle (ou pour une clé absente), la notification est désactivée (`"none"`).
Canal utilisé pour chaque type de notification : `"email"`, `"discord"`, `"slack"` ou `"none"`.
Le canal choisi doit être configuré dans `.env` pour fonctionner (SMTP pour email, URL de
webhook pour Discord/Slack).

| Événement        | Déclenché quand                   | Qui est prévenu                                                                                                  |
| ---------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `memberPending`  | un nouveau membre demande l'accès | `email` : les propriétaires et les rôles qui ont le droit « Gérer les membres ». `discord` / `slack` : le salon. |
| `memberApproved` | une demande est approuvée         | `email` : **le membre approuvé** (rôle obtenu, lien de connexion). `discord` / `slack` : le salon.               |
| `memberRemoved`  | un membre est retiré du BDE       | `discord` / `slack` : le salon. **Jamais d'e-mail** : la personne retirée ne reçoit rien, `email` n'envoie rien. |
| `eventConfirmed` | un événement est confirmé         | voir le [guide du module](events.md#notifications)                                                               |
| `eventReminder`  | rappel la veille d'un événement   | voir le [guide du module](events.md#notifications)                                                               |

`eventConfirmed` et `eventReminder` (module Événements) sont optionnels et valent `"none"` par
défaut, ce qui garde valide une configuration écrite avant ce module. Ils sont décrits dans le
[guide du module](events.md#notifications).

Les trois notifications de membres (`memberPending`, `memberApproved`, `memberRemoved`) sont
envoyées **après** l'action : un envoi qui échoue (webhook indisponible, serveur SMTP en panne)
est seulement écrit dans les journaux du serveur, il ne bloque jamais l'approbation ni le retrait.
Un lien vers la page _Membres_ ou la plateforme est ajouté si `APP_URL` est renseigné.

Si le canal choisi n'est pas configuré dans `.env` (par exemple `email` sans `SMTP_HOST`), la
plateforme **démarre quand même** et affiche un avertissement au démarrage : l'alerte ne partira
pas. C'est volontaire : ces trois clés existaient avant d'envoyer quoi que ce soit, une
configuration plus ancienne ne doit pas devenir invalide après une mise à jour. Les valeurs par défaut
de `bde.config.yml` sont `"none"`.

**Sécurité des messages Discord et Slack.** Les messages contiennent des textes saisis par des
membres (nom du profil 42, titre d'un événement…). Ils sont neutralisés avant l'envoi :
`@everyone`, `@here`, `@channel`, `<!channel>`, `<!here>`, les mentions `<@…>` et les liens
`<url|texte>` s'affichent comme du texte et ne notifient personne. Sur Discord, le webhook envoie en
plus `allowed_mentions: { parse: [] }`, qui interdit toute mention.

## `.env`

Copié depuis `.env.example`. Ne jamais committer ce fichier.

| Variable                                                            | Obligatoire                                                                                                                  | Description                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`                 | oui                                                                                                                          | Identifiants PostgreSQL.                                                                                                                                                                                                                                                |
| `DATABASE_URL`                                                      | oui                                                                                                                          | Chaîne de connexion Prisma. Utilisée par `npm run dev` en local ; ignorée (remplacée) par `docker-compose.yml` qui pointe vers le service `postgres`.                                                                                                                   |
| `AUTH_SECRET`                                                       | oui                                                                                                                          | Secret NextAuth, 32 caractères minimum. Générez-en un, sans Node.js, avec `docker run --rm alpine sh -c "head -c 32 /dev/urandom                                                                                                                                        | base64"`. |
| `FORTYTWO_CLIENT_ID`, `FORTYTWO_CLIENT_SECRET`                      | oui                                                                                                                          | Identifiants de votre application OAuth 42 (<https://profile.intra.42.fr/oauth/applications>).                                                                                                                                                                          |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | si une notification du module Événements est sur `"email"` (`SMTP_HOST`, `SMTP_PORT` et `SMTP_FROM` sont alors obligatoires) | Serveur SMTP pour l'envoi d'emails.                                                                                                                                                                                                                                     |
| `APP_URL`                                                           | non                                                                                                                          | URL publique de l'instance (ex. `https://bde.exemple.fr`), utilisée pour mettre un lien vers l'événement dans les notifications ; et pour le lien d'abonnement agenda si le serveur est derrière un proxy qui ne transmet pas l'hôte.                                   |
| `APP_BIND`                                                          | non                                                                                                                          | Adresse sur laquelle le port 3000 est publié par `docker compose`. Défaut : `127.0.0.1` (le serveur uniquement, derrière un proxy HTTPS). `0.0.0.0` l'ouvre à tout le réseau, en HTTP clair : lisez « Sans proxy HTTPS » dans [le guide de déploiement](deployment.md). |
| `APP_PORT`                                                          | non                                                                                                                          | Port publié sur la machine (défaut `3000`). À changer seulement si un autre programme l'utilise ; l'URL de redirection 42 doit alors porter le même port.                                                                                                               |
| `DISCORD_WEBHOOK_URL`                                               | si une notification du module Événements est sur `"discord"`                                                                 | URL de webhook d'un salon Discord.                                                                                                                                                                                                                                      |
| `SLACK_WEBHOOK_URL`                                                 | si une notification du module Événements est sur `"slack"`                                                                   | URL de webhook Slack entrant.                                                                                                                                                                                                                                           |

## Modifier la configuration sans reconstruire l'image

Avec `docker compose up` (fichier de production), `bde.config.yml` est monté en lecture seule
dans le conteneur. Éditez-le, puis :

```
docker compose restart app
```

Le changement prend effet immédiatement, sans reconstruction de l'image. Pour changer le logo ou
une variable de `.env`, une reconstruction est nécessaire (`docker compose up --build`).
