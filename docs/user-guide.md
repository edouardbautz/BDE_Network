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

Depuis **Membres**, vous voyez deux listes :

- **En attente de validation** : nouveaux comptes à approuver ou refuser.
- **Membres actifs** : tous les membres actuels, avec leur rôle.

**Approuver** donne accès à la plateforme (rôle Membre). **Refuser** supprime la demande.
**Retirer du BDE** supprime l'accès d'un membre actif — cette action ne peut pas être appliquée
à un propriétaire (le rôle propriétaire ne se change que dans le fichier de configuration du
serveur, jamais depuis l'interface).

### Consulter le journal d'audit (propriétaires uniquement)

**Journal d'audit** liste, en lecture seule, les actions sensibles effectuées sur la
plateforme (qui a approuvé qui, qui a été retiré...), avec la date et l'auteur de chaque action.
Ce journal ne peut pas être modifié ni supprimé depuis l'interface.

## Événements (si le module est activé)

Le menu _Événements_ donne le calendrier interne du bureau (vue calendrier ou liste, filtres par
catégorie, membre en charge et année scolaire) et permet d'ajouter un événement à votre agenda
ou de vous abonner à un flux qui se met à jour tout seul. Si un administrateur vous a accordé la
permission, vous pouvez aussi créer et modifier les événements. Tout est expliqué dans le
[guide du module Événements](events.md).

## Vos données personnelles

La page **Confidentialité** (lien en bas de la page de connexion et du tableau de bord) explique
quelles données sont collectées et pourquoi. Une fois connecté, vous pouvez y télécharger une
copie de toutes vos données au format JSON.

## Se déconnecter

Cliquez sur votre photo de profil en haut à droite, puis **Se déconnecter**.
