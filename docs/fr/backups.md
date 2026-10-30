🇫🇷 Français · [🇬🇧 English](../en/backups.md)

# Sauvegardes automatiques

La plateforme se sauvegarde **toute seule chaque nuit à 3 h (l'heure de votre BDE), sans que personne n'ait rien à
faire**. Chaque sauvegarde est **un seul fichier** qui contient la base de données **et** les clés pour la relire, est
**vérifiée juste après avoir été faite**, et reste sur le serveur **hors des volumes de Docker** : `docker compose
down -v`, ou la suppression par erreur des volumes de la plateforme, ne l'efface pas.

Cette page parle de ces sauvegardes. Celles que vous faites vous-même avec `scripts/backup.sh`, et la copie que la
plateforme fait avant une mise à jour, sont dans [Déploiement](deployment.md#sauvegardes-et-restauration).

## Où est gardé quoi

Toutes les copies que fait la plateforme sont dans **un seul dossier du serveur**, `backups/auto/` (`BDE_BACKUP_DIR`), que `docker compose down -v` ne touche pas :

| Quoi | Où | Survit à `down -v` ? |
| --- | --- | --- |
| **Les sauvegardes de la nuit** (cette page) | `backups/auto/` , `bde-auto-<date>.tar.gz` | **Oui** |
| La copie faite **avant une mise à jour** | `backups/auto/pre-update/` , `pre-update_<date>_v<version>.sql.gz`, les cinq dernières | **Oui** |
| Ce que **vous** faites avec `scripts/backup.sh` | `backups/` à côté de `docker-compose.yml` (là où vous avez lancé le script) | Oui |

La plateforme voit le dossier comme `/auto-backups`. `backups/` et `backups/auto/` sont deux dossiers différents : la plateforme ne lit
que `backups/auto/`.

> **Mise à jour depuis la 1.5.0 ou une version antérieure ?** Les copies d'avant mise à jour étaient dans un volume Docker nommé `backups`. Au
> premier démarrage de la nouvelle version, la plateforme **les reprend toute seule dans `backups/auto/pre-update/`** (rien n'est
> supprimé du volume, monté en lecture seule). Quand vous les voyez dans le dossier, l'ancien volume ne sert plus : `docker volume ls`,
> puis `docker volume rm <projet>_backups` (il est vide sur une nouvelle installation, et sans danger si vous le laissez).
## Ce qui se passe chaque nuit

1. À 3 h dans le fuseau horaire de votre BDE (`bde.timezone`), la plateforme exporte sa base de données, prend les clés
   du volume `secrets` et le logo, et écrit une archive.
2. Elle **la relit** (voir plus bas). Seule une sauvegarde qui a réussi est gardée.
3. Elle supprime les sauvegardes dont elle n'a plus besoin (voir « Combien sont gardées »).

Une plateforme éteinte à 3 h fait sa sauvegarde dès qu'elle est rallumée, le même jour. Après un échec, elle réessaie
30 minutes plus tard, trois fois au plus par jour, puis attend la nuit suivante.

## Où sont les sauvegardes

Dans le **dossier `backups/auto/` à côté de `docker-compose.yml`**, sur le serveur lui-même. Pour les garder ailleurs
(un autre disque, un lecteur monté), indiquez le dossier dans `.env`, puis `docker compose up -d` :

```text
BDE_BACKUP_DIR=/mnt/disk2/bde-backups
```

Une sauvegarde porte le nom du moment où elle a été faite, en UTC : `bde-auto-2026-10-27_02-00-04Z.tar.gz` est la nuit du
27 octobre à Paris (3 h en hiver, c'est 02 h UTC). Elle contient :

| Fichier         | Contenu                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `database.sql`  | **La base de données** : membres, événements, rôles, réglages.                                                   |
| `secrets.tar`   | **Les clés** : celle qui chiffre les secrets de la plateforme, et celle qui signe les sessions.                  |
| `logo.tar`      | Le logo envoyé depuis Paramètres (seulement s'il y en a un).                                                     |
| `info.txt`      | La date et la version de la plateforme.                                                                          |
| `manifest.json` | La liste de ces fichiers, avec la taille et le SHA-256 de chacun : ce à quoi la vérification ci-dessous compare. |

Le fichier n'est lisible que par l'utilisateur de la plateforme (droits `600`). **Il contient les clés : traitez-le
comme un mot de passe**, car qui a le fichier a tout. Le mot de passe de PostgreSQL n'y est pas : une sauvegarde se
restaure sous n'importe quel mot de passe.

> **Le dossier est sur le même disque que la plateforme.** Il protège d'une erreur (`down -v`, une mauvaise mise à
> jour, un volume supprimé), pas de la perte du serveur entier ou de son disque. Copiez le dossier ailleurs de temps en
> temps.

## Depuis la page Paramètres

Réservée aux propriétaires. La section **Sauvegardes** de la page Paramètres montre :

- **la dernière sauvegarde** : sa date, sa taille, et jusqu'où elle a été vérifiée ;
- un avertissement quand **aucune sauvegarde n'a réussi depuis deux jours**, et la raison de l'échec de la dernière tentative ;
- **Sauvegarder maintenant** : la même sauvegarde que celle de la nuit (quelques secondes), écrite dans le journal d'audit avec le nom de qui l'a demandée ;
- **les sauvegardes gardées**, chacune avec un bouton **Télécharger**.

### Télécharger une sauvegarde

Les sauvegardes du serveur ne sont pas chiffrées (elles doivent être faites à 3 h sans personne pour taper une phrase de passe). Un fichier
qui quitte le serveur l'est : **Télécharger** demande une phrase de passe de votre choix, deux fois, de 12 caractères au moins, et chiffre le
fichier avec elle.

- Le fichier s'appelle `bde-auto-….tar.gz.enc` et est au format de `openssl enc` (AES-256, clé dérivée par PBKDF2) : il s'ouvre avec le
  script `restore.sh` ci-dessous, ou à la main avec `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256`.
- **Si vous perdez la phrase de passe, personne ne peut plus ouvrir le fichier, nous non plus.** La plateforme ne la garde pas et ne peut pas
  la retrouver. Les sauvegardes gardées sur le serveur ne sont pas concernées.
- Le fichier contient toujours la base de données et les clés : qui l'a avec la phrase de passe a tout. Chaque téléchargement est écrit dans le
  journal d'audit (qui, quelle sauvegarde), jamais la phrase de passe.

## Comment une sauvegarde est vérifiée

Un fichier écrit n'est pas une sauvegarde qui marche. Juste après avoir fait l'archive, la plateforme :

1. l'ouvre et compare chaque fichier au SHA-256 de son manifeste ;
2. vérifie que l'export est entier (PostgreSQL écrit une dernière ligne quand il l'est) ;
3. **charge l'export dans une base de contrôle** (créée pour cela, supprimée juste après) et vérifie qu'elle contient
   les migrations et les tables ;
4. **ouvre les réglages chiffrés avec les clés trouvées dans l'archive**, et non avec celles que la plateforme utilise :
   c'est la preuve que l'archive et ses clés vont ensemble.

Une sauvegarde qui échoue à l'une de ces étapes est supprimée, et les précédentes restent. Quand le serveur de base de
données ne laisse pas la plateforme créer une base de contrôle (un PostgreSQL géré), seules les étapes 1 et 2 sont
faites, et la sauvegarde est marquée « relue seulement ».

## Combien sont gardées

**7 quotidiennes, 4 hebdomadaires, 6 mensuelles**, comptées en jours de votre BDE :

- la dernière sauvegarde de chacun des **7 jours les plus récents** qui en ont une ;
- la première sauvegarde de chacune des **4 semaines les plus récentes** (du lundi au dimanche) ;
- la première sauvegarde de chacun des **6 mois les plus récents**.

Une même sauvegarde peut être plusieurs de ces choses à la fois. Cela fait 10 à 17 fichiers, d'il y a une semaine à il y
a six mois. La plus récente n'est jamais supprimée. Un serveur resté éteint un mois garde tout de même ses 7 derniers
jours : on compte les jours qui ont une sauvegarde, pas ceux du calendrier.

Seuls les fichiers nommés `bde-auto-…` sont touchés : rien d'autre dans le dossier n'est jamais supprimé, et les
sauvegardes faites avec `scripts/backup.sh` ne sont pas concernées.

## Restaurer

Tout se fait avec Docker seul, depuis le dossier du projet. Pour restaurer la **plus récente** :

```text
./scripts/restore.sh --auto
```

ou une en particulier (la liste est affichée si le nom est faux) :

```text
./scripts/restore.sh --auto bde-auto-2026-10-25_02-00-03Z.tar.gz
```

Le script explique ce qu'il va faire et demande de taper `RESTAURER`. Il fait d'abord une copie de sécurité de l'état
actuel, remplace la base, remet les clés et le logo de la sauvegarde, et redémarre la plateforme. Les clés sont dans la
sauvegarde : aucun autre fichier n'est nécessaire.

**Sur un serveur neuf** (l'ancien est perdu) : installez Docker, récupérez le projet (`git clone`), lancez `docker
compose up -d` (aucun `.env` n'est nécessaire), copiez le fichier de sauvegarde dans `backups/auto/` du nouveau
serveur, puis `./scripts/restore.sh --auto`. Le BDE est de retour tel qu'il était, et les personnes qui étaient
connectées le sont toujours.

**Depuis un fichier téléchargé** : mettez le fichier `.enc` où vous voulez sur le nouveau serveur et donnez son chemin. Le script demande la
phrase de passe (rien ne s'affiche pendant la saisie ; `BDE_BACKUP_PASSPHRASE` dans l'environnement fait de même pour un script). Une
mauvaise phrase de passe l'arrête avant que quoi que ce soit soit touché.

```text
./scripts/restore.sh ~/bde-auto-2026-10-25_02-00-03Z.tar.gz.enc
```

> Si le nouveau serveur a un `AUTH_SECRET` dans son `.env`, il l'emporte sur la clé de session restaurée et tout le
> monde doit se reconnecter. Ne le mettez pas.

## Docker sans droits d'administrateur (rootless)

La plateforme écrit ses sauvegardes sous l'identité de l'utilisateur du conteneur. Avec un Docker ordinaire, le dossier
`backups/auto/` appartient alors à cet utilisateur et **vous pouvez le lister mais pas lire les fichiers** (c'est à cela
que servent les droits `600`), et `restore.sh --auto` les lit par le conteneur, donc cela marche pareil. Avec un Docker
rootless, l'utilisateur du conteneur est un numéro de la plage du compte, avec le même effet : vous ne pouvez pas ouvrir
vous-même les fichiers depuis l'hôte, et vous n'en avez pas besoin.

**Un disque réseau ou un dossier d'un autre utilisateur.** Avec un Docker rootless, le dossier du serveur appartient à votre
compte, et l'utilisateur de la plateforme (un numéro de la plage de votre compte) est « un autre utilisateur » pour lui. La
plateforme demande au système de fichiers de lui donner le dossier ; quand il refuse (un disque réseau, un partage, un montage
Windows), l'étape de préparation ouvre le dossier à tous les utilisateurs du serveur à la place, avec le bit collant
(`chmod 1777`), et le dit dans `docker compose logs secrets`. Les archives restent privées pour la plateforme (`600`). Si ce
n'est pas possible non plus, la page Paramètres dit exactement ce qu'elle a trouvé (voir plus bas). Vous pouvez le faire vous-même,
en tant que propriétaire du dossier : `chmod 1777 backups/auto`, puis `docker compose up -d`.

Si le dossier ne peut pas servir du tout (un disque monté en lecture seule, un partage qui refuse de donner le dossier à
l'application, un dossier où le conteneur n'a pas le droit d'écrire), la plateforme **démarre quand même** : la sauvegarde échoue
chaque nuit avec la raison `folder`, la section Sauvegardes de la page Paramètres le montre, et les propriétaires sont prévenus si un
canal est choisi pour cela (voir plus bas).

## Si la page Paramètres dit que le dossier n'est pas utilisable

La section **Sauvegardes** nomme alors le dossier vérifié (`/auto-backups` pour la plateforme, et sa place sur le serveur), ce qui
ne va pas, et ce qu'il faut faire. La même ligne est dans les journaux au démarrage de la plateforme (`docker compose logs app`).

| Elle dit                                                     | Cela veut dire                                                                                              | Que faire, sur le serveur                                                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| le dossier **n'existe pas**                                  | Rien à cet endroit : le dossier n'a pas été créé, ou le fichier compose est plus ancien que l'image         | Créez `backups/auto/`, `git pull`, puis `docker compose up -d`.                                                                                          |
| **ce n'est pas un dossier**                                  | Un fichier est là où le dossier devrait être                                                                | Remplacez-le par un dossier vide.                                                                                                                        |
| la plateforme **ne peut pas le lire** (propriétaire, droits) | Le dossier est privé à quelqu'un d'autre, et le système de fichiers n'a pas laissé la plateforme le prendre | `docker compose up -d` ; puis, en tant que propriétaire du dossier, `chmod 1777 backups/auto` ; sinon, choisissez un disque local avec `BDE_BACKUP_DIR`. |
| la plateforme **ne peut pas l'écrire**                       | Il peut être listé, pas écrit (droits, ou disque monté en lecture seule)                                    | Pareil ; pour un disque en lecture seule, remontez-le ou choisissez un autre dossier.                                                                    |
| il est **dans le conteneur**                                 | Le dossier n'est pas monté : les sauvegardes seraient perdues à la recréation du conteneur                  | Utilisez le `docker-compose.yml` de cette version (`git pull`), qui monte le dossier sur `/auto-backups`, puis `docker compose up -d`.                   |

## Si une sauvegarde échoue

Les propriétaires peuvent en être prévenus par e-mail et dans le salon du BDE, la première fois chaque jour, et de nouveau quand aucune
sauvegarde n'a réussi depuis deux jours : choisissez un canal pour ces deux messages dans **Paramètres**, section **Notifications** (voir
[Notifications](notifications.md#messages-sur-les-sauvegardes)). Sans canal, la section Sauvegardes de la page Paramètres le dit.

Chaque sauvegarde, faite ou échouée, est écrite dans les journaux de la plateforme :

```text
docker compose logs app | grep -i sauvegarde
```

Un échec vient avec une raison :

| Raison           | Ce que cela veut dire                                                              | Que faire                                                                 |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `folder`         | Le dossier des sauvegardes ne peut pas être créé ou écrit.                         | Voir la section ci-dessus : la page Paramètres dit lequel et pourquoi.    |
| `space`          | Moins de 50 Mio de libres, ou moins de trois fois la dernière sauvegarde.          | Libérez de la place sur le disque des sauvegardes.                        |
| `dump`           | La base de données n'a pas pu être exportée.                                       | La base tourne-t-elle ? `docker compose ps`.                              |
| `secrets`        | Les clés n'ont pas pu être lues.                                                   | Vérifiez le volume `secrets`.                                             |
| `archive`        | L'archive n'a pas pu être écrite.                                                  | Vérifiez le disque.                                                       |
| `verify-archive` | Le fichier écrit n'est pas ce que dit le manifeste (disque abîmé, archive coupée). | Vérifiez le disque ; les sauvegardes précédentes sont intactes.           |
| `verify-restore` | L'export ne se charge pas dans une base de contrôle.                               | Gardez les journaux et demandez de l'aide : la base est peut-être abîmée. |
| `verify-secrets` | Les clés de l'archive n'ouvrent pas les réglages chiffrés.                         | Le volume `secrets` n'est pas celui de cette base.                        |
| `unexpected`     | Tout le reste.                                                                     | Lisez les journaux.                                                       |

Une sauvegarde échouée ne remplace jamais une bonne : les sauvegardes précédentes restent telles qu'elles étaient.
