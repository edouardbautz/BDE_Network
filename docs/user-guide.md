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
**en attente de validation**. Un membre du bureau qui a le droit de gérer les membres (un
propriétaire, ou un rôle comme Président ou Secrétaire) doit approuver votre accès et vous donner
un rôle. Revenez un peu plus tard, ou contactez directement un responsable de votre BDE.

Vous ne pouvez rien faire d'autre tant que votre compte n'est pas approuvé — c'est normal.

## Une fois votre compte approuvé

Vous arrivez sur le **tableau de bord** : votre rôle et les prochains événements.

### Se repérer

Le menu est une **barre latérale à gauche** (sur téléphone, il s'ouvre avec le bouton « ☰ » en haut).
Il n'affiche que ce que **votre rôle** vous permet : tout membre voit le tableau de bord ;
**Événements** s'affiche si votre rôle permet de les consulter ; **Membres** et **Rôles** pour ceux
qui ont le droit de les gérer ; **Journal d'audit** pour les seuls propriétaires.

En bas de la barre latérale : votre nom et votre rôle (un clic ouvre « Mon profil » et la
déconnexion) et le bouton de thème.

### Changer de thème (clair / sombre)

Le bouton soleil/lune en bas de la barre latérale choisit entre thème clair, sombre, ou le réglage de
votre appareil.

### Changer de langue

L'interface est disponible en français et en anglais. La langue est dans l'adresse : remplacez
`/fr/` par `/en/` (ou l'inverse) dans la barre d'adresse du navigateur. Votre navigateur la
choisit tout seul la première fois.

### Quand vous supprimez ou modifiez quelque chose : la fenêtre de confirmation

Tout ce qui ne se rattrape pas (retirer un membre, refuser une demande, supprimer un rôle ou un
événement, annuler une date, remplacer un lien d'agenda) ouvre d'abord **une fenêtre au milieu de
l'écran** qui explique ce qui va se passer. Le bouton **Annuler** est sélectionné d'office : **Échap**,
un clic à côté ou **Annuler** ferment la fenêtre sans rien faire. Changer le rôle d'un membre et
confirmer un événement demandent aussi confirmation (le bouton n'est pas rouge, car c'est réversible).

## Pour celles et ceux qui gèrent le bureau

### Gérer les membres

Il faut le droit **Gérer les membres** (donné par votre rôle). Depuis **Membres**, vous voyez deux
listes :

- **En attente de validation** : nouveaux comptes à approuver ou refuser. À côté de chaque
  demande, un menu propose le **rôle à donner** (le rôle par défaut est choisi d'avance).
- **Membres actifs** : tous les membres actuels. Le menu de la colonne **Rôle** change le rôle
  d'un membre, après une confirmation qui rappelle l'ancien et le nouveau rôle.

**Approuver** donne accès à la plateforme avec le rôle choisi. **Refuser** supprime la demande, et
**Retirer du BDE** supprime le compte d'un membre : ces deux boutons **ouvrent une fenêtre de confirmation**
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

### Modifier les réglages de la plateforme (propriétaires uniquement)

**Paramètres** (dans le menu) regroupe ce que l'installateur a demandé : nom, couleur, adresse, application 42,
campus, propriétaires, modules et notifications. Chaque section a son bouton **Enregistrer** et le changement
s'applique tout de suite. Ajouter ou retirer un propriétaire demande une confirmation. En haut de la page, un
rappel vous invite à **sauvegarder le volume « secrets »** : c'est lui qui permet de relire les mots de passe et
clés enregistrés après une restauration. Le détail est dans le [guide de configuration](configuration.md#la-page-paramètres).

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

En bas de la barre latérale, cliquez sur votre nom, puis **Se déconnecter**.
