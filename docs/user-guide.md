# Guide utilisateur

Ce guide s'adresse aux membres du bureau qui utilisent la plateforme — aucune connaissance
technique n'est nécessaire.

## Se connecter

Rendez-vous sur l'adresse de votre plateforme (fournie par votre bureau) et cliquez sur
**Se connecter avec 42**. Vous êtes redirigé vers l'intra 42, autorisez l'accès, puis revenez
automatiquement sur la plateforme.

Il n'y a pas de mot de passe à retenir : la connexion se fait uniquement via votre compte 42.

## Première connexion : la page d'attente

Si c'est votre première connexion, vous arrivez sur une page indiquant que votre compte est
**en attente de validation**. Un membre du bureau (administrateur ou propriétaire) doit
approuver votre accès. Revenez un peu plus tard, ou contactez directement un responsable de
votre BDE.

Vous ne pouvez rien faire d'autre tant que votre compte n'est pas approuvé — c'est normal.

## Une fois votre compte approuvé

Vous arrivez sur le **tableau de bord**. La barre de navigation en haut n'affiche que les
sections auxquelles vous avez droit : tout membre voit le tableau de bord ; les administrateurs
et propriétaires voient en plus **Membres** ; seuls les propriétaires voient le **Journal
d'audit**.

### Changer de thème (clair / sombre)

Cliquez sur l'icône soleil/lune en haut à droite pour choisir entre thème clair, sombre, ou
suivre le réglage de votre appareil.

### Changer de langue

L'interface est disponible en français et en anglais. Changez de langue via l'URL
(`/fr/...` ou `/en/...`) — un sélecteur dans l'interface arrivera avec une prochaine version.

## Pour les administrateurs et propriétaires

### Gérer les membres

Il faut le droit **Gérer les membres** (donné par votre rôle). Depuis **Membres**, vous voyez deux
listes :

- **En attente de validation** : nouveaux comptes à approuver ou refuser. À côté de chaque
  demande, un menu propose le **rôle à donner** (le rôle par défaut est choisi d'avance).
- **Membres actifs** : tous les membres actuels. Le menu de la colonne **Rôle** change le rôle
  d'un membre, tout de suite.

**Approuver** donne accès à la plateforme avec le rôle choisi. **Refuser** supprime la demande, et
**Retirer du BDE** supprime le compte d'un membre : ces deux boutons **demandent une confirmation**
avant d'agir. Si quelqu'un d'autre a déjà traité la demande ou retiré le membre, un message vous
l'explique et la liste se met à jour toute seule. Le propriétaire n'a pas de
menu : il se définit uniquement dans le fichier de configuration du serveur.

Vous ne pouvez agir que dans la limite de vos propres droits : les rôles qui donnent un droit
que vous n'avez pas sont grisés, et vous ne pouvez pas changer votre propre rôle ni celui d'un
membre qui en a plus que vous. Le message affiché vous explique pourquoi.

### Gérer les rôles

Il faut le droit **Gérer les rôles**. **Rôles** liste les rôles du BDE. **Créer un rôle** : donnez-lui
un nom (Trésorier, Secrétaire…) et cochez ce que ses membres pourront faire — chaque case a une
phrase d'explication. Deux rôles existent dès l'installation, modifiables : **Admin** (tous les
droits sauf le journal d'audit) et **Membre** (consulter les événements).

Un rôle encore attribué à des membres ne peut pas être supprimé : donnez d'abord un autre rôle à
ces membres. Le détail des règles est dans [Rôles et droits](roles.md).

### Être prévenu des nouvelles demandes

Le BDE peut recevoir une alerte quand quelqu'un demande l'accès, quand une demande est approuvée
(le membre reçoit alors un e-mail) ou quand un membre est retiré (message dans le salon Discord ou
Slack uniquement). Cela se règle dans `bde.config.yml` : voir
[la configuration](configuration.md#notifications).

### Consulter le journal d'audit (propriétaires uniquement)

**Journal d'audit** liste, en lecture seule, les actions sensibles effectuées sur la
plateforme (qui a approuvé qui, qui a été retiré...), avec la date et l'auteur de chaque action.
Ce journal ne peut pas être modifié ni supprimé depuis l'interface.

## Événements (si le module est activé)

Le menu _Événements_ donne le calendrier interne du bureau (vue calendrier ou liste, filtres par
catégorie, membre en charge et année scolaire) et permet d'ajouter un événement à votre agenda
ou de vous abonner à un flux qui se met à jour tout seul. Si votre rôle le permet (droit « Gérer
les événements »), vous pouvez aussi créer et modifier les événements. Tout est expliqué dans le
[guide du module Événements](events.md).

## Si quelque chose ne marche pas

- **« Page introuvable »** : l'adresse n'existe pas, ou l'élément a été supprimé entre-temps. Le
  bouton _Retour au tableau de bord_ vous ramène à l'accueil.
- **« Quelque chose s'est mal passé »** : une erreur est survenue côté serveur. Vos données ne sont
  pas perdues. Essayez _Réessayer_ ; si cela continue, donnez à l'administrateur la _référence de
  l'erreur_ affichée sous le message, elle permet de retrouver la cause dans les journaux.

## Vos données personnelles

La page **Confidentialité** (lien en bas de la page de connexion et du tableau de bord) explique
quelles données sont collectées et pourquoi. Une fois connecté, vous pouvez y télécharger une
copie de toutes vos données au format JSON.

## Se déconnecter

Cliquez sur votre photo de profil en haut à droite, puis **Se déconnecter**.
