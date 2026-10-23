🇫🇷 Français · [🇬🇧 English](../en/roles.md)

# Rôles et droits

Chaque BDE crée les rôles dont il a besoin (Président, Trésorier, Secrétaire, Responsable événements…) et choisit
précisément ce que chacun a le droit de faire. Chaque membre a **un seul rôle**, que l'on change dans un menu de
la page **Membres**.

![La page Rôles](../images/fr/roles.webp)

## Les trois situations d'un compte

| Situation        | Ce que cela veut dire                                                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Propriétaire** | A **tous les droits**, y compris le journal d'audit et les Paramètres. Se définit uniquement dans **Paramètres**, section Propriétaires, par un autre propriétaire. Ne se change jamais depuis les pages Membres ou Rôles. |
| **Membre**       | Compte approuvé. Ses droits sont exactement ceux de son rôle.                                                                                                                                                              |
| **En attente**   | Vient de se connecter et attend d'être approuvé. N'a accès qu'à la page d'attente.                                                                                                                                         |

« Propriétaire » et « En attente » ne sont pas des rôles : on ne peut ni les modifier ni les donner.
**Le journal d'audit et les Paramètres sont réservés aux propriétaires**, quels que soient les rôles : un droit
qu'un rôle pourrait avoir permettrait à son titulaire de se nommer propriétaire.

## Les deux rôles créés à l'installation

| Rôle       | Droits                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| **Admin**  | « Tous les droits » (voir plus bas).                                                                 |
| **Membre** | Consulter les événements. C'est le rôle **par défaut** : celui qui est proposé aux nouveaux membres. |

Ils portent ces noms, en français, dans toutes les langues. On peut les modifier et les renommer comme n'importe
quel autre rôle.

## La page Rôles

Elle est accessible à ceux qui ont le droit **Gérer les rôles**. Pour chaque rôle, elle montre son nom, une
description, le nombre de membres qui l'ont et ses droits.

- **Créer un rôle** : un nom (40 caractères au plus, unique), une description facultative (200 caractères au plus) et
  des droits, chacun expliqué en une phrase.
- **Modifier** : le nom, la description, les droits. Les changements s'appliquent tout de suite à tous les membres
  qui ont ce rôle, et sont inscrits au journal d'audit avec ce qui a changé.
- **Supprimer** : seulement si **plus aucun membre** n'a ce rôle. Donnez d'abord un autre rôle à ses membres, depuis la
  page Membres. Le rôle par défaut ne peut pas être supprimé : définissez-en un autre avant.
- **Rôle par défaut** : celui qui est présélectionné quand on approuve une demande. Le bouton **Définir par défaut**
  est sur la ligne d'un autre rôle.

### « Tous les droits »

La case **Tous les droits** donne au rôle absolument tous les droits, **y compris ceux des modules ajoutés plus
tard**. C'est le cas du rôle Admin. Pour réserver un module à certains rôles, décochez l'option et choisissez les
droits un par un : un nouveau module n'apparaîtra alors dans ce rôle que si vous le cochez.

## Les droits disponibles

| Droit                               | Ce qu'il permet                                                                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gérer les membres**               | Approuver ou refuser les demandes d'accès, retirer des membres et leur donner un rôle.                                                                                                                                                    |
| **Gérer les rôles**                 | Créer, modifier et supprimer des rôles, et choisir les droits de chacun.                                                                                                                                                                  |
| **Personnaliser les notifications** | Changer ce que disent les cartes Discord, les messages Slack et les e-mails et leur apparence (page **Notifications**), et choisir qui ils mentionnent. Les canaux eux-mêmes (webhooks, serveur de messagerie) restent aux propriétaires. |

Et, **pour chaque module activé** :

| Droit                   | Ce qu'il permet                                                    |
| ----------------------- | ------------------------------------------------------------------ |
| **Consulter** le module | Voir son contenu.                                                  |
| **Gérer** le module     | Créer, modifier et supprimer dans le module. Inclut « consulter ». |

Le module **Événements** a ses propres droits, à la place de « Gérer » :

| Droit                       | Ce qu'il permet                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Proposer des événements** | Créer des événements qui attendent un validateur, et modifier ou supprimer les siens tant qu'ils ne sont pas publiés. Inclut « consulter ».                       |
| **Valider les événements**  | Approuver ou refuser les propositions, créer, modifier, confirmer et supprimer tous les événements, et voir les brouillons. Inclut « proposer » et « consulter ». |
| **Gérer l'agenda partagé**  | Créer, renouveler ou désactiver le lien d'agenda commun du BDE. Inclut « consulter ».                                                                             |

Une équipe qui organise des événements sans avoir le droit de les publier reçoit **Proposer des événements** ; le
bureau, qui décide, reçoit **Valider les événements**. Voir
[Module Événements](events.md#proposer-et-valider-des-événements).

Cocher « gérer », « valider » ou « proposer » coche ce que ce droit inclut. Un droit d'un module **désactivé** reste dans le rôle sans effet, et reprend
effet si vous réactivez le module.

## Les règles de sécurité

Le serveur les applique à chaque action, quelle que soit l'interface utilisée. L'idée est simple : **on ne peut
donner, modifier ou retirer que ce que l'on possède.**

1. **On ne peut accorder que ce que l'on possède.** Pour créer, modifier ou donner un rôle, il faut avoir soi-même
   chacun des droits qu'il accorde. Un rôle « Tous les droits » ne peut être créé, modifié ou donné que par une
   personne qui a elle-même tous les droits (ou par un propriétaire).
2. **Personne ne modifie son propre rôle** (le renommer, lui retirer un droit, le supprimer, le définir par défaut) :
   quelqu'un d'autre, ou un propriétaire, doit le faire.
3. **Personne ne change son propre rôle, ni ne se retire du BDE.**
4. **On ne touche pas à un rôle qui donne plus de droits que soi** : impossible d'en retirer des droits (pour affaiblir
   un supérieur), de le supprimer ou de le définir par défaut.
5. **On ne déplace pas un membre dont le rôle dépasse le sien.** Un secrétaire ne peut ni rétrograder la présidente,
   ni la retirer du BDE. Il peut en revanche déplacer ou retirer un collègue qui a exactement les mêmes droits que
   lui : tout est dans le journal d'audit.
6. **Un propriétaire ne peut être ni modifié ni retiré** depuis les pages Membres et Rôles. Seul un propriétaire peut
   en ajouter ou en retirer un, dans Paramètres (avec confirmation, journal d'audit, jamais lui-même, et en gardant
   toujours au moins un propriétaire).
7. **Un rôle encore donné ne peut pas être supprimé.**
8. Les droits sont **relus dans la base à chaque action** : retirer un droit à un rôle prend effet tout de suite,
   même pour quelqu'un dont la page était déjà ouverte.

Chaque création, modification, suppression ou attribution de rôle est **journalisée** dans le journal d'audit,
réservé aux propriétaires.

> Si plus personne n'a le droit de gérer les rôles, un propriétaire le peut toujours : il y en a au moins un.

## Exemple d'organisation

| Rôle                   | Droits                                                         |
| ---------------------- | -------------------------------------------------------------- |
| Président              | Gérer les membres, gérer les rôles, tous les droits Événements |
| Secrétaire             | Gérer les membres, valider les événements                      |
| Responsable événements | Valider les événements et gérer l'agenda partagé               |
| Pôle Events            | Proposer des événements                                        |
| Membre                 | Consulter les événements                                       |

Avec ces règles, le secrétaire peut approuver une demande et lui donner « Membre », mais pas « Responsable
événements » : il n'a pas le droit de gérer l'agenda partagé, et on ne peut donner que ce que l'on a. De la même façon,
le responsable événements peut donner « Pôle Events », qu'il a, mais un membre du pôle Events ne pourra jamais donner le
droit de valider.

## Tester les droits d'un rôle

En développement (`ENABLE_DEV_IMPERSONATION=true`, voir le [guide contributeur](contributing.md)), le propriétaire
peut **simuler n'importe quel rôle** depuis un bandeau en haut de page, et vérifier ce que ce rôle voit et peut
faire. La simulation respecte les limites du rôle choisi, et les actions restent inscrites au nom du propriétaire
réel, avec le rôle simulé. Cette fonction n'existe pas en production.

## Pour les développeurs

La liste des droits est dans le code, pas dans la base : un rôle garde de simples clés (`events.validate`). Pour
ajouter les droits d'un module, voir l'[architecture](../architecture.md).
