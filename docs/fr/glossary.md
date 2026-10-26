🇫🇷 Français · [🇬🇧 English](../en/glossary.md)

# Glossaire

Les mots de la plateforme, tels qu'ils apparaissent dans l'interface. Un même mot désigne toujours la même
chose dans cette documentation.

## Les personnes

| Mot                 | Sens                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BDE**             | Bureau Des Étudiants : l'association étudiante d'une école. « Le bureau » désigne les membres qui la dirigent.                                                   |
| **Plateforme**      | Le site que fait tourner un BDE avec BDE_Network. Une plateforme appartient à un seul BDE (une _instance_).                                                      |
| **Propriétaire**    | Compte qui a **tous les droits**, y compris le journal d'audit et les Paramètres. La liste des propriétaires se gère dans **Paramètres**, section Propriétaires. |
| **Membre**          | Compte approuvé. Ses droits sont ceux de son **rôle**.                                                                                                           |
| **En attente**      | Compte qui vient de se connecter et que personne n'a encore approuvé. Il n'a accès qu'à la page d'attente.                                                       |
| **Rôle**            | Un ensemble de droits, avec un nom (Président, Trésorier…). Chaque membre a **un seul** rôle.                                                                    |
| **Rôle par défaut** | Le rôle proposé en premier quand on approuve une demande d'accès. Il y en a toujours un.                                                                         |
| **Droit**           | Ce qu'un rôle permet de faire (« Gérer les membres », « Consulter les événements »…). Dans le code, on parle de _permission_.                                    |
| **Tous les droits** | Option d'un rôle : il reçoit tous les droits, y compris ceux des modules ajoutés plus tard.                                                                      |

## Se connecter

| Mot                          | Sens                                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Intra 42**                 | Le site des étudiants 42, où l'on crée l'application OAuth du BDE.                                                                                                         |
| **Application 42**           | L'« application » que le BDE déclare sur l'intra pour que ses membres puissent se connecter avec leur compte 42. Elle donne un **UID** et une **clé secrète** (le SECRET). |
| **URL de redirection**       | L'adresse où 42 renvoie la personne après la connexion : l'adresse de la plateforme suivie de `/api/auth/callback/42-school`. Elle doit être **exacte**.                   |
| **Campus autorisés**         | Les campus 42 dont les membres ont le droit de se connecter. Liste vide : tous les campus.                                                                                 |
| **Adresse de la plateforme** | L'adresse que vos membres tapent (`https://bde.exemple.fr`). Elle sert à la connexion avec 42 et aux liens des messages. Jamais `0.0.0.0`.                                 |

## Les événements

| Mot                         | Sens                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module**                  | Une fonction que l'on active : pour l'instant, le module **Événements**.                                                                                                   |
| **Événement**               | Une activité du BDE, avec un titre, un début, une fin, un lieu, une description et une catégorie.                                                                          |
| **Brouillon**               | Un événement pas encore publié : seuls son auteur et ceux qui valident les événements le voient.                                                                           |
| **Proposition**             | Un événement proposé par quelqu'un qui ne peut pas le publier, **en attente de validation** jusqu'à la réponse d'un validateur.                                            |
| **Validateur**              | Quelqu'un dont le rôle a le droit de valider les événements : il approuve ou refuse les propositions.                                                                      |
| **Confirmé**                | Un événement visible de tous les membres. Le confirmer prévient les membres.                                                                                               |
| **Série**                   | Un événement qui se répète (chaque jour, semaine, mois ou année, aux jours choisis) jusqu'à une date ou un nombre de fois.                                                 |
| **Occurrence**              | Une date d'une série. On peut la modifier, la confirmer, l'annuler seule, ou agir sur elle et les suivantes.                                                               |
| **Catégorie**               | Un type d'événement, avec un nom et une couleur (Soirée, Sport…). Chaque BDE a les siennes.                                                                                |
| **Année scolaire**          | De septembre à août (`2025-2026`), calculée d'après la date de début.                                                                                                      |
| **Lien d'agenda personnel** | Le lien secret d'un membre, à ajouter à Google Agenda, Outlook ou Apple Calendar. Voir **Mon profil**.                                                                     |
| **Staff**                   | Le staff de l'école, qui publie les événements du BDE sur l'intra 42. Il a un compte comme tout membre, avec un rôle qui l'y autorise.                                     |
| **Demande de publication**  | Ce que la plateforme envoie au staff pour un événement confirmé : les champs à copier dans le formulaire de l'intra. Une par événement, une série étant un seul événement. |
| **À mettre à jour**         | Un événement publié qui a changé depuis : le staff doit le modifier aussi sur l'intra, puis confirmer.                                                                     |
| **Lien d'agenda du BDE**    | Un seul lien pour tout le BDE, à coller une fois dans un agenda partagé. Il se gère dans **Agenda partagé**.                                                               |

## Les messages

| Mot              | Sens                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Notification** | Un message envoyé par la plateforme : événement confirmé, rappel, demande d'accès, membre approuvé ou retiré.                            |
| **Canal**        | Où part la notification : e-mail, Discord ou Slack (aucun, un ou plusieurs, **pour chaque type**).                                       |
| **Webhook**      | L'adresse secrète d'un salon Discord ou Slack, qui permet à la plateforme d'y écrire.                                                    |
| **Carte**        | Le message mis en forme que la plateforme poste sur Discord ou Slack.                                                                    |
| **Modèle**       | Ce qu'un BDE a changé des mots, de l'apparence et des informations d'une notification : seul ce qui est changé est gardé.                |
| **Variable**     | Un mot entre accolades, comme `{titre}`, qu'un modèle remplace par ce qui est propre à un message.                                       |
| **Mention**      | Un `@everyone`, `@here`, un rôle, un groupe ou une personne écrit dans un modèle : la seule façon pour un message de prévenir quelqu'un. |
| **Rappel**       | La notification envoyée la veille d'un événement, à l'**heure du rappel** réglée dans Paramètres.                                        |

## L'exploitation

| Mot                     | Sens                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Installateur**        | La page qui guide l'installation dans le navigateur. Elle disparaît définitivement une fois la plateforme installée.                   |
| **Code d'installation** | Le code à 8 caractères (`K7QM-4XPD`) affiché dans le terminal, qui empêche une autre personne d'installer la plateforme à votre place. |
| **Paramètres**          | La page où les propriétaires modifient les réglages, section par section.                                                              |
| **Journal d'audit**     | La liste en lecture seule des actions sensibles (qui a fait quoi, quand). Réservé aux propriétaires.                                   |
| **Volume « secrets »**  | Le volume Docker qui garde les clés de la plateforme. Il faut le **sauvegarder** avec la base de données.                              |
| **Sauvegarde**          | Deux fichiers créés par `./scripts/backup.sh` : la base de données et les clés.                                                        |
| **Proxy HTTPS**         | Le programme (Caddy, Nginx…) qui reçoit les visiteurs en HTTPS et les envoie à la plateforme.                                          |
| **Mise à jour**         | Passer à une nouvelle version du code : voir [Mettre à jour](upgrading.md).                                                            |
