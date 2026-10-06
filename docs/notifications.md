# Notifications

La plateforme prévient le BDE par **email**, par un salon **Discord**, par un salon **Slack**, ou
pas du tout. Le canal se choisit **par type de notification** dans la section `notifications` de
`bde.config.yml` (voir [Configuration](configuration.md#notifications)) ; les identifiants du canal
(SMTP, URL de webhook) sont dans `.env`.

| Notification     | Quand                                             | Couleur de la carte Discord                                 |
| ---------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `memberPending`  | un nouveau membre demande l'accès                 | ambre                                                       |
| `memberApproved` | une demande est approuvée                         | vert                                                        |
| `memberRemoved`  | un membre est retiré du BDE                       | rouge                                                       |
| `eventConfirmed` | un événement est confirmé                         | celle de **la catégorie** de l'événement (`bde.config.yml`) |
| `eventReminder`  | rappel la veille (ou le jour même, voir plus bas) | celle de la catégorie                                       |

Slack et l'email gardent leur message en texte, inchangé. Tout ce qui suit ne concerne que Discord.

## Le rendu sur Discord

Sur Discord, chaque notification est une **carte** (un _embed_) :

![Une carte d'événement dans un salon Discord](images/discord-card.webp)

_Illustration dessinée à partir de la vraie carte envoyée par la plateforme ; Discord l'affiche avec
sa propre police et selon le thème de chaque lecteur._

- **Barre de couleur** : la couleur de la catégorie pour un événement ; ambre, vert ou rouge pour une
  demande, une approbation, un retrait. Ces trois teintes restent lisibles sur le thème clair comme
  sur le thème sombre de Discord.
- **Titre cliquable** vers la page concernée (l'événement, ou la page _Membres_), **sans** carte
  d'aperçu en double. Sans `APP_URL`, le titre n'est simplement pas un lien.
- **Champs en colonnes** : _Quand_ sur toute la largeur, puis _Lieu_, _Catégorie_ et _Membres en
  charge_ côte à côte. Une série récurrente ajoute une ligne _Répétition_.
- **Dates au format Discord** : chaque lecteur les voit **dans son propre fuseau horaire et sa
  propre langue**, avec un compte à rebours (« dans 3 jours ») qui se met à jour tout seul, sans que
  le message soit modifié.
- **Expéditeur** : le message arrive au nom du BDE (`bde.name`) avec son logo en avatar.
- **Membres** : la photo 42 de la personne en vignette, son rôle, et **qui** a fait l'action
  (« Approuvé par … », « Retiré par … »).
- **Pied de carte** discret : `BDE_Network`.
- **Rappel** : « Rappel · demain » en temps normal ; « Rappel · aujourd'hui » quand le rappel part le
  jour même de l'événement (serveur éteint à l'heure habituelle, voir
  [le rappel de la veille](events.md#comment-fonctionne-le-rappel-de-la-veille)).

La description d'un événement est reprise **sur 350 caractères au plus** (coupée proprement, avec
« … ») : la carte est un avis, la page de l'événement a le détail. Plus généralement, tout texte trop
long pour Discord est coupé plutôt que de faire refuser le message.

### Sécurité des textes

Un titre, un lieu ou un nom viennent de membres : `@everyone`, `@here`, `<@123…>` ou `<!channel>` y
sont rendus **inoffensifs** (ils s'affichent comme du texte, personne n'est notifié), dans la carte
comme dans le nom de l'expéditeur, et chaque envoi interdit toute mention (`allowed_mentions`).

## Le logo de l'expéditeur

Discord va **chercher lui-même** l'image à l'adresse indiquée : elle doit donc être publique et dans
un format qu'il accepte.

|                       |                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------- |
| **Formats acceptés**  | PNG, JPEG, GIF, WebP. **Pas le SVG** (c'est le format du logo par défaut de l'interface). |
| **Taille conseillée** | carré, 512 × 512 px (128 px au minimum), moins de 8 Mo                                    |
| **Forme**             | Discord l'affiche **en rond** : gardez l'essentiel au centre, loin des coins              |

La plateforme choisit l'image ainsi :

1. si `bde.logoPath` pointe vers un PNG, JPEG, GIF ou WebP, c'est lui ;
2. sinon (SVG, par exemple), le fichier **`public/logo.png`**, fourni avec la plateforme (un monogramme
   « BDE » neutre).

**Pour mettre le logo de votre BDE** : remplacez `public/logo.png` par votre image (même nom), ou
déposez-la dans `public/` sous un autre nom et réglez `logoPath` (`logoPath: '/mon-logo.png'`).
Le logo est alors aussi celui de l'interface. Reconstruisez ensuite l'image
(`docker compose up --build`, voir [Configuration](configuration.md)).

Si Discord ne peut pas récupérer l'image, **le message part quand même**, au nom du BDE et sans
avatar : jamais d'image cassée. C'est le cas quand :

- `APP_URL` n'est pas renseignée, ou n'est pas une adresse publique (`localhost`, un réseau privé :
  Discord ne les voit pas). Renseignez par exemple `APP_URL=https://bde.exemple.fr` dans `.env` ;
- le fichier est introuvable, ou le serveur ne le sert pas comme une image.

La plateforme vérifie l'image (une requête rapide, mémorisée dix minutes) avant de l'envoyer, pour ne
pas afficher d'avatar cassé.

> **Nom du BDE** : Discord refuse un nom d'expéditeur qui contient « discord » ou « clyde ». Dans ce
> cas le message part sous le nom du webhook (celui défini dans les paramètres du salon).

## Dépannage

| Constat                          | Cause probable                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Pas d'avatar, mais le nom du BDE | `APP_URL` absente ou locale, ou logo non servi comme une image (voir plus haut)               |
| Le titre n'est pas cliquable     | `APP_URL` n'est pas renseignée                                                                |
| Un message n'arrive pas          | regardez les journaux du serveur : `docker compose logs app` (lignes `[events]`, `[members]`) |
| Tous les messages échouent       | `DISCORD_WEBHOOK_URL` absente, mal copiée, ou webhook supprimé dans le salon                  |
