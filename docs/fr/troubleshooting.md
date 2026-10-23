🇫🇷 Français · [🇬🇧 English](../en/troubleshooting.md)

# Problèmes fréquents

Chaque entrée dit ce que l'on voit, pourquoi, et quoi faire. Le détail complet d'un problème se lit presque
toujours dans les journaux du serveur :

```text
docker compose logs app
```

- [À l'installation](#à-linstallation)
- [À la connexion](#à-la-connexion)
- [Le site affiche une page d'erreur au lieu de la plateforme](#le-site-affiche-une-page-derreur-au-lieu-de-la-plateforme)
- [Les notifications](#les-notifications)
- [Les événements et les agendas](#les-événements-et-les-agendas)
- [Le réseau et Docker](#le-réseau-et-docker)

## À l'installation

### Pas d'encadré dans le terminal, ou la page d'installation ne s'ouvre pas

Attendez la fin du téléchargement de l'image (une ou deux minutes la première fois), puis lancez
`docker compose logs app`. Une plateforme déjà installée n'affiche pas d'encadré : c'est normal.

### « Ce code n'est pas le bon » ou « Trop d'essais »

Prenez le **dernier** code affiché : il change à chaque redémarrage (`docker compose logs app` le montre). Après
trop d'essais, attendez le temps indiqué, ou lancez `docker compose restart app` : le code change et la saisie
est débloquée.

### La page d'installation redemande le code

La session d'installation dure 2 heures, et elle prend fin quand la plateforme redémarre. Entrez le nouveau code.
Vos réponses sont à refaire.

### « 42 refuse ces identifiants »

L'UID et la clé secrète ne forment pas une paire valide. Copiez-les de nouveau depuis la page de l'application sur
l'intra : un espace en trop suffit à les rendre faux. Vérifiez aussi que la clé n'a pas expiré ni été régénérée, et
que les deux valeurs viennent de la **même** application.

### « L'API 42 est injoignable »

L'ordinateur n'a pas accès à Internet, ou l'API 42 est en panne. Vous pouvez continuer sans la vérification : les
campus se tapent alors à la main, et les identifiants ne sont pas testés.

## À la connexion

### « Connexion avec 42 momentanément impossible » sur la page de connexion

42 refuse l'UID ou la clé secrète de l'application du BDE : la clé a expiré ou a été régénérée. Un propriétaire
encore connecté voit un bandeau d'alerte et met la clé à jour dans **Paramètres**, section Application 42. La clé
actuelle est sur <https://profile.intra.42.fr/oauth/applications>.

Si plus personne n'est connecté, la personne qui gère le serveur peut remettre la clé sans être connectée :

1. Dans le fichier `.env` à la racine du projet (créez-le s'il n'existe pas), avec un éditeur de texte, ajoutez :

   ```text
   FORTYTWO_CLIENT_SECRET=la-nouvelle-clé
   BDE_REIMPORT=settings
   ```

2. Lancez `docker compose up -d`.
3. Le journal confirme (`docker compose logs app`). **Retirez ensuite ces deux lignes** de `.env` et relancez
   `docker compose up -d`.

Seules les valeurs de `.env` sont reprises dans les réglages. Rien d'autre ne change.

### La connexion avec 42 échoue (invalid_grant, redirection URI, adresse 0.0.0.0)

Vous arrivez sur `…/auth-error?error=Configuration`, et `docker compose logs app` dit _« does not match the
redirection URI used in the authorization request »_. L'adresse que la plateforme donne à 42 n'est pas celle que
l'application 42 a déclarée, ou vous n'êtes pas sur cette adresse. Vérifiez dans l'ordre.

1. **Vous ouvrez la plateforme à l'adresse enregistrée**, caractère pour caractère : `http://localhost:3000`, pas
   `http://127.0.0.1:3000`, pas `http://0.0.0.0:3000`. L'adresse `0.0.0.0` est celle sur laquelle le serveur écoute,
   pas une adresse de site : d'anciennes versions l'affichaient dans le terminal. Le navigateur garde les cookies de
   connexion par adresse : commencer la connexion sur une adresse et revenir sur une autre ne peut pas marcher.
2. **L'URL de redirection de l'application 42** est exactement l'adresse enregistrée suivie de
   `/api/auth/callback/42-school`, par exemple `http://localhost:3000/api/auth/callback/42-school`. Elle se règle sur
   <https://profile.intra.42.fr/oauth/applications>. Un propriétaire lit l'adresse enregistrée dans **Paramètres**,
   section Adresse de la plateforme.
3. **L'adresse enregistrée est la bonne.** Si elle est fausse et que plus personne ne peut se connecter pour la
   corriger, la personne qui gère le serveur la remet sans être connectée :

   1. Dans le fichier `.env` à la racine du projet (créez-le s'il n'existe pas), avec un éditeur de texte
      (Bloc-notes, VS Code…), ajoutez ces deux lignes avec **votre** adresse :

      ```text
      APP_URL=http://localhost:3000
      BDE_REIMPORT=settings
      ```

   2. Lancez `docker compose up -d`. Le journal confirme : _« Adresse du site : ancienne → nouvelle »_.
   3. **Retirez ensuite ces deux lignes** de `.env` et relancez `docker compose up -d`. Sinon la valeur de `.env`
      est reprise à chaque démarrage et écrase ce que vous changez dans Paramètres.

   L'adresse est vérifiée comme dans l'installateur : `0.0.0.0` est refusée, et `127.0.0.1` est écrite `localhost`.

Si l'intra répond « The redirect URI included is not valid », comparez l'URL de redirection de l'application avec
celle que la plateforme envoie : le message de l'intra montre l'adresse reçue. Cherchez `http` au lieu de `https`,
un `www.` en trop, un port oublié, une barre finale.

### « Connexion refusée » après avoir autorisé sur l'intra

- _« Votre campus 42 (…) n'est pas autorisé »_ : le campus de la personne n'est pas dans la liste des campus
  autorisés. Un propriétaire l'ajoute dans **Paramètres**, section Campus (une liste vide autorise tous les
  campus). Le nom s'écrit comme sur l'intra (`Nice`, `Paris`…) ; la casse n'a pas d'importance.
- _« Votre profil 42 est incomplet »_ : le compte 42 n'a pas de login, d'e-mail ou de campus visible. Cela se règle
  sur l'intra, pas ici.

### Je me connecte mais je suis « en attente » alors que je devrais être propriétaire

Votre login n'est pas dans la liste des propriétaires (une faute de frappe à l'installation ?). Un autre
propriétaire l'ajoute dans **Paramètres**, section Propriétaires. S'il n'y en a aucun, voir
[Configuration](configuration.md#remplacer-les-réglages-par-les-fichiers).

### Tout le monde est déconnecté, ou une page boucle

C'est normal après un changement de la clé de session (volume `secrets` remplacé) : les anciennes sessions ne
valent plus rien. Chacun se reconnecte. Si une page boucle, supprimer les cookies du site règle tout.

## Le site affiche une page d'erreur au lieu de la plateforme

Une page « à corriger » ou « ne répond pas » (erreur 503) est voulue : la plateforme n'a pas pu démarrer, et elle le
dit au lieu de redémarrer sans fin. La page nomme le problème et donne la commande à lancer, sans jamais montrer de
secret.

| La page dit…                                                                                              | Cause                                                                                                                                                                                                                                                               | À faire                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| « La base de données refuse la connexion »                                                                | Le volume `secrets` a été supprimé ou remplacé (par exemple par `docker compose down -v`, qui supprime aussi les données), ou `POSTGRES_PASSWORD` a changé **après** la création de la base.                                                                        | Restaurez l'archive des clés (`./scripts/restore.sh … --secrets …`). Sinon, remettez dans `.env` les valeurs de départ de `POSTGRES_*`, puis `docker compose up -d`.                                                                                 |
| « La base de données ne répond pas »                                                                      | La base n'est pas encore démarrée : normal une minute après un redémarrage du serveur. La page se rafraîchit toute seule.                                                                                                                                           | Si cela dure : `docker compose ps`, puis `docker compose logs postgres`.                                                                                                                                                                             |
| « La mise à jour de la base de données a échoué »                                                         | Une migration n'a pas pu s'appliquer. Le code affiché (`P3009`…) aide à chercher.                                                                                                                                                                                   | Ne supprimez rien. Lisez `docker compose logs app`. Au besoin, [revenez en arrière](upgrading.md#revenir-en-arrière).                                                                                                                                |
| « La mise à jour a échoué : votre base a été remise comme avant »                                         | Une étape de la mise à jour a échoué. La plateforme a remis en place la copie faite juste avant, l'a vérifiée, et reste arrêtée.                                                                                                                                    | Vos données sont intactes. [Revenez en arrière](upgrading.md#revenir-en-arrière) à la version précédente, et signalez le problème avec le code et `docker compose logs app`.                                                                         |
| « La mise à jour a échoué et la base n'a pas pu être remise comme avant »                                 | Une étape a échoué, puis la remise en état automatique a échoué aussi. La copie est conservée.                                                                                                                                                                      | Ne lancez pas la plateforme. `./scripts/restore.sh --pre-update`, puis signalez le problème.                                                                                                                                                         |
| « La copie de sécurité avant mise à jour a échoué »                                                       | La copie n'a pas pu être faite (un disque plein, le plus souvent). Rien n'a été modifié.                                                                                                                                                                            | Libérez de l'espace et `docker compose up -d`. Pour continuer sans copie (à vos risques) : `BDE_SKIP_BACKUP=1` dans `.env`.                                                                                                                          |
| « La base de données est plus récente que cette version »                                                 | Une ancienne version a été lancée sur une base qu'une version plus récente avait utilisée.                                                                                                                                                                          | Si vous êtes revenu volontairement en arrière : `./scripts/restore.sh --pre-update` d'abord. Sinon, reprenez la version récente.                                                                                                                     |
| « Une mise à jour précédente de la base est restée inachevée »                                            | Une migration a échoué auparavant et n'a été ni terminée ni annulée.                                                                                                                                                                                                | `./scripts/restore.sh --pre-update`, puis `docker compose up -d`.                                                                                                                                                                                    |
| « L'image est plus ancienne que docker-compose.yml » / « docker-compose.yml est plus ancien que l'image » | Le dossier et l'image ne sont pas à la même version (une image construite sur place n'est pas remplacée par un `git pull`).                                                                                                                                         | `docker compose pull`, puis `docker compose up -d` ; ou `git pull` si c'est le fichier qui est ancien. Une image que vous construisez vous-même : [reconstruisez-la](deployment.md#construire-limage-vous-même).                                     |
| « Des données existent, mais aucun réglage n'est enregistré »                                             | La base contient des comptes, mais la plateforme n'a trouvé ni réglages enregistrés ni `bde.config.yml` complet (une plateforme installée avant l'installateur, démarrée avec l'image publiée, qui ne contient pas votre fichier). L'installateur n'est pas ouvert. | Remettez votre `bde.config.yml` et votre `.env` dans le dossier, puis [construisez l'image une fois](upgrading.md#si-votre-plateforme-date-davant-linstallateur) : `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`. |
| « L'adresse de la base de données est invalide »                                                          | `DATABASE_URL` est absente ou mal écrite dans `.env`.                                                                                                                                                                                                               | Avec le `docker-compose.yml` fourni, supprimez `DATABASE_URL` de `.env` : elle est construite toute seule. Puis `docker compose up -d`.                                                                                                              |
| « Un réglage du fichier .env est à corriger » ou « Le fichier bde.config.yml est à corriger »             | Une installation par fichiers dont `.env` ou `bde.config.yml` est incomplet ou invalide. La page liste les **noms** des réglages, jamais leurs valeurs.                                                                                                             | Corrigez le fichier, puis `docker compose up -d` (pour `bde.config.yml` : [reconstruisez l'image](deployment.md#construire-limage-vous-même)). Voir [Configuration](configuration.md#remplacer-les-réglages-par-les-fichiers).                       |

Une page « Service momentanément indisponible » (aux visiteurs) veut dire que la base de données ne répond pas.
Elle ramène les visiteurs toute seule dès que la base répond. Rien n'est perdu.

### Installation par fichiers : « bde.config.yml est introuvable »

Ne concerne que les installations qui n'ont pas encore copié leurs réglages dans la base (voir
[Configuration](configuration.md#où-sont-les-réglages)). L'image publiée ne contient pas votre fichier : il est copié dans l'image quand vous la construisez depuis votre
dossier (`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`). S'il est absent, vide, illisible ou invalide, la plateforme affiche une page « à
corriger » et son journal nomme le cas et le chemin vérifié. Si un **dossier** `bde.config.yml` traîne dans le projet
(laissé par un ancien montage raté), supprimez-le (`rmdir bde.config.yml`), puis relancez cette même commande.

## Les notifications

| Constat                                                                 | Cause probable                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Un message n'arrive pas                                                 | Regardez `docker compose logs app` : les lignes `[events]` et `[members]` disent pourquoi. Un envoi qui échoue n'empêche jamais l'action (créer un événement, approuver un membre).                          |
| Tous les messages échouent                                              | L'adresse du webhook est absente, mal copiée, ou le webhook a été supprimé dans le salon. Renseignez-la de nouveau dans **Paramètres**, section Notifications.                                               |
| Le titre de la carte n'est pas cliquable, ou l'e-mail n'a pas de bouton | L'adresse de la plateforme n'est pas renseignée.                                                                                                                                                             |
| Pas d'avatar sur Discord, mais le nom du BDE                            | L'adresse de la plateforme est absente ou locale (`localhost`, réseau privé), ou le logo n'est pas une image que Discord peut lire. Voir [Le logo de l'expéditeur](notifications.md#le-logo-de-lexpéditeur). |
| E-mail sans logo                                                        | L'adresse de la plateforme est absente, ou le logo n'est pas servi comme une image. Le nom du BDE s'affiche à la place.                                                                                      |

## Les événements et les agendas

- **« La configuration est invalide … events »** : une installation par fichiers a activé le module sans section
  `events` ou sans catégorie. Dans une installation normale, les catégories se règlent dans **Paramètres**.
- **Un rappel n'est pas parti.** Vérifiez qu'une case est cochée pour le rappel (Paramètres, Notifications), que le serveur tournait à partir de
  l'heure du rappel, et que les membres en charge existent (pour l'e-mail). Cherchez `[events]` dans les journaux.
- **Le lien d'agenda ne se met pas à jour.** C'est le rythme de rafraîchissement de votre application d'agenda :
  Google peut mettre plusieurs heures.
- **Le lien du BDE répond « Not found ».** Il a été régénéré ou désactivé, ou le module est désactivé. Récupérez le
  lien actuel dans _Événements_ → _Agenda partagé_.

## Le réseau et Docker

### `Bind for … failed: port is already allocated`

Un autre programme utilise déjà le port 3000. Créez un fichier `.env` à la racine du projet avec `APP_PORT=3001` (ou
un autre port libre), relancez `docker compose up`, et utilisez ce port dans l'adresse de la plateforme et dans
l'URL de redirection de l'application 42.

### `Cannot connect to the Docker daemon` ou `failed to connect to the docker API`

Docker n'est pas démarré. Sous Windows et macOS, **lancez Docker Desktop** et attendez qu'il indique qu'il tourne.
Sous Linux : `sudo systemctl start docker`.

### Le site n'est pas joignable depuis un autre ordinateur

C'est voulu : la plateforme n'écoute que sur la machine elle-même (`127.0.0.1`). En production, c'est le proxy HTTPS
qui l'expose. Voir le [guide de déploiement](deployment.md).

### `pull access denied`, `manifest unknown`, `unauthorized` ou un délai dépassé en téléchargeant l'image

Docker télécharge l'image de la plateforme depuis `ghcr.io`, le registre de GitHub.

- **`manifest unknown` / `not found`** : cette version n'existe pas. Vérifiez `BDE_VERSION` dans `.env` (retirez la
  ligne pour suivre le dossier), ou la [page des versions](https://github.com/edouardbautz/BDE_Network/releases). Les
  versions antérieures à la 1.1.0 n'ont jamais été publiées comme images : [construisez l'image
  vous-même](deployment.md#construire-limage-vous-même).
- **`unauthorized` / `denied`** : un ancien `docker login ghcr.io` au jeton expiré gêne le téléchargement d'une image
  publique. Lancez `docker logout ghcr.io`, puis réessayez.
- **Un délai dépassé, ou `no such host`** : le serveur n'atteint pas `ghcr.io` (pas de réseau, un proxy, un pare-feu).
  Laissez-le passer, ou [construisez l'image vous-même](deployment.md#construire-limage-vous-même).

### Windows : le démarrage est lent

La première synchronisation de fichiers par Docker Desktop est plus lente que sous Linux. Les lancements suivants
sont rapides.

## Rien de tout cela ?

Cherchez dans la [foire aux questions](faq.md). Sinon, ouvrez une
[issue](https://github.com/edouardbautz/BDE_Network/issues) en joignant la version de la plateforme et les dernières
lignes de `docker compose logs app` (sans secret). Une faille de sécurité ne se signale **pas** en public : voir
[SECURITY.md](../../SECURITY.md).
