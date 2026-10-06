# Rôles et permissions

Chaque BDE crée les rôles dont il a besoin (Président, Trésorier, Secrétaire, Resp. événements...)
et choisit précisément ce que chacun a le droit de faire. Chaque membre a **un seul rôle**, que l'on
choisit dans un menu déroulant de la page **Membres**.

## Les trois situations d'un compte

| Situation        | Ce que ça veut dire                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Propriétaire** | Défini uniquement dans `bde.config.yml` (`auth.owners`). A **tous les droits**, y compris le journal d'audit. Ne se change jamais depuis l'interface. |
| **Membre**       | Compte approuvé. Ses droits sont exactement ceux de son rôle.                                                                                         |
| **En attente**   | Vient de se connecter, attend qu'on l'approuve. N'a accès à rien d'autre qu'à la page d'attente.                                                      |

Le propriétaire et « en attente » ne sont pas des rôles : on ne peut ni les modifier ni les attribuer.
**Le journal d'audit est réservé aux propriétaires**, quels que soient les rôles.

## Les deux rôles créés à l'installation

| Rôle       | Droits                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| **Admin**  | « Tous les droits » (voir plus bas), sauf le journal d'audit.                                        |
| **Membre** | Consulter les événements. C'est le rôle **par défaut** : celui qui est proposé aux nouveaux membres. |

Ils sont modifiables comme n'importe quel autre rôle (par quelqu'un qui a le droit de le faire).

## La page « Rôles »

Accessible à ceux qui ont le droit **Gérer les rôles**. Pour chaque rôle : son nom, une description,
le nombre de membres qui l'ont, et des cases à cocher pour les droits, chacun expliqué en une phrase.

- **Créer** un rôle : nom (40 caractères au plus, unique), description facultative, droits.
- **Modifier** : nom, description, droits. Tout est enregistré dans le journal d'audit, avec ce qui a changé.
- **Supprimer** : possible seulement si **plus aucun membre** n'a ce rôle. Réattribuez d'abord ses membres
  depuis la page Membres. Le rôle par défaut ne peut pas être supprimé : définissez-en un autre d'abord.
- **Rôle par défaut** : celui qui est présélectionné quand on approuve une demande d'accès. Bouton
  **Définir par défaut** sur la ligne d'un autre rôle.

### « Tous les droits »

La case **Tous les droits** donne au rôle absolument tous les droits, **y compris ceux des modules que vous
activerez plus tard** (Finance, Réunions...). C'est le cas du rôle Admin. Pour **réserver un module à
certains rôles seulement**, décochez cette option et choisissez les droits un par un : un nouveau module
n'apparaîtra alors dans ce rôle que si vous le cochez.

## Les droits disponibles

| Droit                 | Ce qu'il permet                                                                         |
| --------------------- | --------------------------------------------------------------------------------------- |
| **Gérer les membres** | Valider ou refuser les demandes d'accès, retirer des membres et leur attribuer un rôle. |
| **Gérer les rôles**   | Créer, modifier et supprimer des rôles, et choisir les droits de chacun.                |

Et, **pour chaque module activé** dans `bde.config.yml` (`modules.enabled`) :

| Droit                   | Ce qu'il permet                                                    |
| ----------------------- | ------------------------------------------------------------------ |
| **Consulter** le module | Voir son contenu.                                                  |
| **Gérer** le module     | Créer, modifier et supprimer dans le module. Inclut « consulter ». |

Le module **Événements** a en plus : **Gérer l'agenda partagé** (créer, renouveler ou désactiver le lien
d'agenda commun du BDE).

Cocher « gérer » coche automatiquement « consulter ». Un droit d'un module **désactivé** est conservé dans
le rôle mais n'a aucun effet ; il reprend effet si vous réactivez le module.

## Les règles de sécurité

Elles sont appliquées par le serveur à chaque action, quelle que soit l'interface utilisée.

1. **On ne peut accorder que ce que l'on possède.** Pour créer un rôle, le modifier ou l'attribuer, il faut
   avoir soi-même chacun des droits qu'il donne. Un rôle « Tous les droits » ne peut être créé, modifié ou
   attribué que par quelqu'un qui a « Tous les droits » (ou par un propriétaire).
2. **Personne ne modifie son propre rôle**, ni le rôle qu'il détient (renommer, retirer un droit, supprimer,
   le définir par défaut) : un autre membre ou un propriétaire doit s'en charger.
3. **Personne ne change son propre rôle**, ni ne se retire du BDE.
4. **On ne touche pas à un rôle qui donne plus de droits que soi.** Impossible d'en retirer des droits (pour
   affaiblir un supérieur), de le supprimer ou de le définir par défaut.
5. **On ne déplace pas un membre dont le rôle dépasse le sien.** Un secrétaire ne peut pas rétrograder la
   présidente, ni la retirer du BDE. Il peut en revanche déplacer ou retirer un collègue qui a exactement
   les mêmes droits que lui : tout est dans le journal d'audit.
6. **Un propriétaire ne peut être ni modifié ni retiré** depuis l'interface (son statut vient de la config).
7. **Un rôle encore attribué ne peut pas être supprimé.**
8. Les droits sont **relus en base à chaque action** : retirer un droit à un rôle prend effet tout de suite, même
   pour quelqu'un dont la page était déjà ouverte.

Toute création, modification, suppression ou attribution de rôle est **journalisée** (journal d'audit,
réservé aux propriétaires) : `role.create`, `role.update`, `role.delete`, `role.set_default`,
`member.role_change`, `member.approve`, `member.reject`, `member.remove`.

> Si plus personne n'a le droit de gérer les rôles, un propriétaire le peut toujours : il y en a au moins un,
> la configuration l'exige.

## Exemple d'organisation

| Rôle             | Droits                                                         |
| ---------------- | -------------------------------------------------------------- |
| Président        | Gérer les membres, gérer les rôles, tous les droits Événements |
| Secrétaire       | Gérer les membres, gérer les événements                        |
| Resp. événements | Gérer les événements et l'agenda partagé                       |
| Membre           | Consulter les événements                                       |

Avec ces règles, le secrétaire peut approuver une demande et lui donner « Membre », mais pas « Resp.
événements » : il n'a pas le droit de gérer l'agenda partagé, et on ne peut donner que ce que l'on a.

## Tester les droits d'un rôle

En développement (`ENABLE_DEV_IMPERSONATION=true`, voir le [README](../README.md)), le propriétaire peut
**simuler n'importe quel rôle** depuis le bandeau en haut de page, et vérifier ce que ce rôle voit et peut
faire. La simulation respecte les limites du rôle choisi ; les actions restent enregistrées au nom du
propriétaire réel, avec la mention du rôle simulé.

## Mise à jour depuis une version précédente

Les versions antérieures avaient les rôles fixes Administrateur / Membre et des permissions accordées
membre par membre. La migration (automatique au démarrage, ne dépend pas de `bde.config.yml`) les convertit :

| Avant                                                           | Après                                                                                                                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Propriétaire, en attente                                        | inchangés                                                                                                                                                                                |
| Administrateur                                                  | rôle **Admin** (tous les droits)                                                                                                                                                         |
| Membre                                                          | rôle **Membre** (consulter les événements)                                                                                                                                               |
| Membre avec une permission de module (ex. gérer les événements) | un rôle **« Membre + Événements »** créé pour l'occasion, avec les droits de « Membre » plus la gestion du module. Les membres qui avaient les mêmes permissions partagent le même rôle. |

Rien n'est perdu : l'ancien rôle de chaque compte et ses permissions (avec qui les avait accordées et quand)
sont conservés dans **une entrée du journal d'audit** (`role.migrate`, auteur « system »).

Les administrateurs actuels gagnent « gérer les événements » : le rôle Admin a tous les droits, et ils
pouvaient déjà se l'accorder eux-mêmes.

**Faites une sauvegarde avant de mettre à jour** (`./scripts/backup.sh`, voir le
[guide de déploiement](deployment.md)). Pour revenir en arrière, restaurez-la : la migration modifie le schéma
de la base.

En développement, `docker-compose.dev.yml` applique le schéma avec `prisma db push` : les comptes existants
de la base de développement perdent leur ancien rôle (le propriétaire le retrouve à sa connexion, les comptes de
démonstration sont recréés). C'est une base jetable.

## Pour les développeurs : ajouter les droits d'un module

La liste des droits est dans le code (`src/lib/permissions/registry.ts`), pas en base : un rôle stocke de
simples clés (`events.manage`). Tout module activé reçoit automatiquement `<module>.view` et `<module>.manage`.
Pour en ajouter d'autres (ex. `finance.export`), ajoutez une ligne à `MODULE_EXTRA_PERMISSIONS`. Pour les
vérifier, utilisez `can(session.user, 'finance.export')` côté serveur (jamais `auth()` directement), et ajoutez
leurs libellés dans `messages/fr.json` et `en.json` (`permissions.items.<module>.<nom>`). Aucun changement du
cœur ni de migration n'est nécessaire. Détails dans [CLAUDE.md](../CLAUDE.md).
