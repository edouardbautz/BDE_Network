🇫🇷 Français · [🇬🇧 English](../en/upgrading.md)

# Mettre à jour vers une nouvelle version

Mettre à jour tient en trois gestes : **sauvegarder**, **récupérer le nouveau code**, **relancer**. Relancer, c'est
`docker compose up -d` : Docker télécharge l'image de la nouvelle version, que `docker-compose.yml` nomme. Les
migrations de la base de données s'appliquent toutes seules au démarrage, après une copie que la plateforme fait.
Comptez dix minutes, dont quelques-unes d'attente pendant le téléchargement.

Ce guide a été essayé pour de vrai, en passant d'une plateforme de la **version 1.0.0** (réglages dans `.env` et
`bde.config.yml`) à la version suivante, avec des membres, des rôles et des événements, puis en revenant en arrière.

Les propriétaires sont prévenus quand une nouvelle version est publiée, par un bandeau sur le tableau de bord et sur la
page Paramètres, avec les deux commandes (voir [Nouvelles versions](configuration.md#nouvelles-versions)).

## Avant de commencer

1. **Lisez le [CHANGELOG](../../CHANGELOG.md)** : il dit ce qui change et ce qu'il faut savoir.
2. **Notez la version actuelle**, pour pouvoir y revenir (elle est aussi en haut de la page **Paramètres**) :

   ```text
   git describe --tags --always
   ```

3. **Faites une sauvegarde** :

   ```text
   ./scripts/backup.sh
   ```

   Sous Windows, lancez-la depuis Git Bash ou WSL (voir [Sauvegardes](deployment.md#sauvegardes-et-restauration)).
   Copiez les fichiers de `backups/` hors du serveur.

   > Une plateforme de la version 1.0.0 n'a qu'**une** archive (la base). Les clés de la plateforme sont alors dans
   > son fichier `.env`, que la sauvegarde ne contient pas : **copiez aussi `.env` et `bde.config.yml`** à un endroit
   > sûr. Après la mise à jour, une nouvelle sauvegarde contiendra tout (voir plus bas).

## 1. Récupérer le nouveau code

**Vous avez cloné le projet sans le modifier :**

```text
git pull
```

**Vous avez forké le projet** (vos propres commits) : ajoutez une fois le dépôt d'origine, puis fusionnez-le dans votre
branche.

```text
git remote add upstream https://github.com/edouardbautz/BDE_Network.git   # une seule fois
git fetch upstream
git merge upstream/main
```

La fusion se passe sans conflit dans la plupart des cas. Si `bde.config.yml` est en conflit, gardez votre version : les
réglages sont dans la base de données, ce fichier ne sert plus qu'à l'import du premier démarrage. Si vous avez modifié
le **code** de la plateforme, vous construisez aussi votre propre image : [Construire l'image
vous-même](deployment.md#construire-limage-vous-même), et utilisez cette commande à la place de celle ci-dessous.

## 2. Relancer

```text
docker compose up -d
```

Docker télécharge l'image de la nouvelle version (une ou deux minutes), puis remplace le conteneur. Au démarrage, la
plateforme fait une copie de la base s'il y a des migrations à appliquer (voir [Copie automatique avant une mise à
jour](deployment.md#copie-automatique-avant-une-mise-à-jour)), les applique, et répond.

## 3. Vérifier

1. **Les conteneurs sont en bonne santé** : `docker compose ps` doit afficher `healthy` pour `app` et `postgres`.
2. **Le journal est propre** : `docker compose logs app` doit contenir `All migrations have been successfully
applied` (ou `No pending migrations to apply`), puis `Ready`.
3. **Le site répond** : `curl http://127.0.0.1:3000/api/health` affiche `{"status":"ok"}` (changez le port si vous
   avez réglé `APP_PORT`).
4. **Tout est là** : ouvrez la plateforme, connectez-vous, regardez les membres, les rôles et les événements.
5. **Les réglages se lisent** : en tant que propriétaire, **Paramètres** doit dire « Réglages enregistrés dans la base
   de données ».

Si la page affiche une erreur 503 au lieu de la plateforme, elle dit ce qui ne va pas : voir
[Problèmes fréquents](troubleshooting.md#le-site-affiche-une-page-derreur-au-lieu-de-la-plateforme).

Enfin, **faites une nouvelle sauvegarde** : elle contient maintenant la base **et** les clés.

## Si votre plateforme date d'avant l'installateur

C'est le cas d'une plateforme installée avec `.env` et `bde.config.yml` (version 1.0.0). Au **premier démarrage**
après la mise à jour :

- les migrations ajoutent la table des réglages ;
- `bde.config.yml` et `.env` sont **copiés dans la base de données**, les secrets chiffrés (le journal le dit :
  « Les réglages de bde.config.yml et de .env ont été copiés dans la base de données ») ;
- le volume Docker `secrets` est créé : il reprend le mot de passe de la base et la clé de session de votre
  `.env`, donc **les sessions restent valables** et la base reste accessible ;
- la page **Paramètres** devient utilisable.

À partir de là, **la base fait foi** : modifier `.env` ou `bde.config.yml` ne change plus rien. Gardez-en une copie
jusqu'à avoir vérifié que tout marche, puis changez les réglages dans **Paramètres**.

**Construisez l'image une fois, sur place.** L'image publiée contient le modèle, pas votre `bde.config.yml` : votre
fichier n'entre dans une image que quand elle est construite depuis votre dossier. Pour le premier démarrage après la
mise à jour, lancez :

```text
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Sans cela, la plateforme démarre, trouve une base qui a des comptes mais aucun réglage enregistré, et n'ouvre pas
l'installateur (il remplacerait vos réglages) : sa page dit « Des données existent, mais aucun réglage n'est
enregistré ». Rien n'est perdu, lancez la commande ci-dessus. Quand le journal dit que les réglages ont été copiés,
vous mettez à jour comme tout le monde : `git pull`, puis `docker compose up -d`.

Si les fichiers étaient incomplets (par exemple le login `votre-login-42` encore dans les propriétaires), la
plateforme continue de lire les fichiers et la page Paramètres reste en lecture seule. Corrigez les fichiers, puis
relancez la même commande. Voir [Configuration](configuration.md#où-sont-les-réglages).

## Si la mise à jour elle-même échoue

Avant de modifier la base de données, la plateforme en fait une copie, toute seule (voir
[Copie automatique avant une mise à jour](deployment.md#copie-automatique-avant-une-mise-à-jour)). Si une étape de la
mise à jour échoue, la plateforme **remet cette copie en place**, vérifie que la base est exactement comme avant,
reste arrêtée, et le dit sur sa page. Vos données sont intactes : [revenez en arrière](#revenir-en-arrière) à la version
précédente, puis signalez le problème.

## Revenir en arrière

Si la nouvelle version pose problème, vous pouvez revenir à la précédente avec votre sauvegarde. **Les données
saisies depuis la sauvegarde sont perdues** : la restauration remet la base dans l'état de la sauvegarde.

1. Restaurez la sauvegarde faite avant la mise à jour (le script de la version actuelle remplace toute la base),
   soit celle que vous avez faite vous-même, soit la copie que la plateforme a faite avant la mise à jour :

   ```text
   ./scripts/restore.sh backups/bde-backup-AAAA-MM-JJ_HH-MM-SS.tar.gz --no-start
   ./scripts/restore.sh --pre-update
   ```

   Le script vous demande de taper `RESTAURER`. Il fait d'abord une copie de sécurité de l'état actuel. **Il laisse
   l'application arrêtée** (`--no-start` ; `--pre-update` le fait toujours) : le dossier est encore à la version que vous
   quittez, et son application, lancée sur la base que vous venez de remettre, appliquerait aussitôt ses migrations de
   nouveau ; la version précédente refuserait alors la base (« la base de données est plus récente »).

2. Revenez à l'ancienne version du code (celle que vous aviez notée) :

   ```text
   git checkout <la version notée>
   ```

3. Relancez. L'image de la version à laquelle vous êtes revenu est retéléchargée si elle n'est plus sur la machine :

   ```text
   docker compose up -d
   ```

   Les versions antérieures à la 1.1.0 n'ont pas été publiées comme images : pour revenir à la 1.0.0, [construisez
   l'image vous-même](deployment.md#construire-limage-vous-même).

Faites-les **dans cet ordre**. Pour reprendre ensuite la dernière version du projet, revenez sur votre branche
(`git switch main`).

## Historique : le droit sur les événements se divise en deux

Le droit « Gérer les événements » est devenu deux droits : **Proposer des événements** et **Valider les événements**
(voir [Rôles et droits](roles.md#les-droits-disponibles)). La mise à jour convertit les rôles toute seule, et personne
ne perd rien : valider inclut tout ce que gérer permettait.

| Avant                                                        | Après                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Un rôle avec le droit de **gérer les événements**            | le même rôle, avec **Valider les événements** (qui inclut **Proposer des événements** et « Consulter ») |
| Un rôle avec seulement **Consulter**, ou **Tous les droits** | inchangé                                                                                                |

Les rôles convertis sont listés dans une entrée du journal d'audit (`role.migrate`), avec leurs droits d'avant. La mise
à jour fait d'abord sa copie de sécurité, comme toute mise à jour qui modifie la base.

## Historique : des rôles fixes aux rôles personnalisés (0.x → 1.0)

Les versions 0.x avaient les rôles fixes Administrateur et Membre, et des droits accordés membre par membre. La
migration vers la version 1.0 les convertit toute seule.

| Avant                                                 | Après                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Propriétaire, en attente                              | inchangés                                                                                                         |
| Administrateur                                        | le rôle **Admin** (tous les droits)                                                                               |
| Membre                                                | le rôle **Membre** (consulter les événements)                                                                     |
| Membre avec un droit de module (gérer les événements) | un rôle « Membre + Événements » créé pour l'occasion. Les membres qui avaient les mêmes droits partagent ce rôle. |

Rien n'est perdu : l'ancien rôle de chaque compte et ses droits sont conservés dans une entrée du journal d'audit.
