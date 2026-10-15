🇫🇷 Français · [🇬🇧 English](../en/faq.md)

# Foire aux questions

- [Pour commencer](#pour-commencer)
- [Les membres et les rôles](#les-membres-et-les-rôles)
- [Les événements et les agendas](#les-événements-et-les-agendas)
- [Les notifications](#les-notifications)
- [Les données et la sécurité](#les-données-et-la-sécurité)
- [L'exploitation](#lexploitation)

## Pour commencer

### À quoi sert BDE_Network ?

C'est une plateforme pour gérer un BDE d'une école 42 : les membres se connectent avec leur compte 42, le bureau leur
donne des rôles, et le calendrier des événements est partagé et synchronisable avec Google Agenda, Outlook ou Apple
Calendar. Voir le [guide utilisateur](user-guide.md).

### Faut-il savoir programmer pour l'installer ?

Non. Il faut installer Docker, lancer une commande, puis suivre une page dans le navigateur. Voir
[Installation](installation.md). Aucun fichier à modifier.

### Est-ce gratuit ?

Oui. Le projet est libre (licence MIT) et chaque BDE l'héberge lui-même : il n'y a ni abonnement, ni service à payer.
Seul l'éventuel serveur et le nom de domaine ont un coût.

### Faut-il un serveur et un nom de domaine ?

- **Pour essayer**, non : votre ordinateur suffit (`http://localhost:3000`).
- **Pour que les membres s'en servent**, oui : un serveur qui reste allumé, un nom de domaine et un proxy HTTPS. Voir
  [Déploiement](deployment.md).

### Peut-on utiliser un autre compte que 42 ?

Non. La connexion se fait uniquement avec les comptes 42, de façon à ne gérer aucun mot de passe.

### Peut-on installer plusieurs BDE sur la même plateforme ?

Non. Chaque BDE a **sa propre plateforme** : sa base de données, ses réglages, son application 42. Rien n'est
partagé entre deux BDE.

### Où sont les autres modules (finances, réunions) ?

Ils sont prévus mais n'existent pas encore. Seul le module **Événements** est disponible.

## Les membres et les rôles

### Qui peut se connecter ?

Les personnes qui ont un compte 42 dans un des **campus autorisés** (tous les campus si la liste est vide). La
première fois, leur compte est **en attente** : un membre du bureau l'approuve et choisit son rôle.

### Comment devient-on propriétaire ?

Un propriétaire ajoute le login 42 de la personne dans **Paramètres**, section Propriétaires. Un rôle, même « Tous
les droits », ne rend jamais propriétaire. Voir [Rôles et droits](roles.md).

### Quelle différence entre propriétaire et Admin ?

Le **propriétaire** a tous les droits, y compris le journal d'audit et les Paramètres, et ne dépend d'aucun rôle.
**Admin** est un rôle comme un autre, avec « Tous les droits » : il ne voit ni les Paramètres ni le journal d'audit.

### Un membre peut-il avoir plusieurs rôles ?

Non, un seul. Pour cumuler des droits, créez un rôle qui les réunit.

### Pourquoi ne puis-je pas donner ce rôle à quelqu'un ?

On ne peut donner que ce que l'on possède : pour attribuer un rôle, il faut avoir tous les droits qu'il accorde. C'est
voulu, pour que personne ne puisse s'accorder plus de droits. Voir
[les règles de sécurité](roles.md#les-règles-de-sécurité).

### Que se passe-t-il quand je retire un membre ?

Son compte est **supprimé** (pas seulement désactivé). Il peut redemander l'accès en se reconnectant. Son lien
d'agenda personnel cesse de fonctionner tout de suite. Si un lien d'agenda du BDE est actif, la plateforme vous
propose d'en générer un nouveau.

### Comment changer le nom, la couleur ou le logo du BDE ?

Dans **Paramètres** : la section **Votre BDE** pour le nom et la couleur, la section **Logo** pour le logo. C'est
immédiat.

### Comment changer la langue ?

Chaque personne choisit la langue de l'interface avec l'icône de langue, en bas de la barre latérale. La langue des
**messages envoyés** (e-mail, Discord, Slack) est la même pour tout le BDE : section **Votre BDE** de Paramètres.

## Les événements et les agendas

### Les événements sont-ils publics ?

Non. Le module est le calendrier **interne** du bureau. Les inscriptions des étudiants restent sur l'intra 42.

### Quelle différence entre un brouillon et un événement confirmé ?

Un **brouillon** n'est visible que de ceux qui peuvent gérer les événements. Un événement **confirmé** est visible de
tous les membres, et le confirmer les prévient. Voir [Module Événements](events.md).

### Pourquoi Google Agenda met-il des heures à afficher un événement ?

Un agenda auquel on s'abonne par lien n'est pas instantané : Google le rafraîchit seulement toutes les quelques
heures, parfois jusqu'à une journée. Ce n'est pas un défaut de la plateforme.

### Que faire si le lien d'agenda a fuité ?

Régénérez-le : l'ancien lien cesse de fonctionner immédiatement. Chaque membre le fait depuis **Mon profil** ; le lien
du BDE se régénère depuis **Événements** → **Agenda partagé**.

### Comment annuler un seul cours d'une série ?

Sur la page de l'événement, **Annuler cette date**. Le reste de la série n'est pas touché, et la date peut être
rétablie.

## Les notifications

### Faut-il Discord ou Slack ?

Non. Sans canal, la plateforme n'envoie rien. **Discord** est le plus simple à mettre en place : un webhook se crée en
deux clics. Voir [Notifications](notifications.md).

### Peut-on choisir un canal différent pour chaque notification ?

Pas dans la page Paramètres : elle applique un seul canal à toutes les notifications. Un canal par type est possible
avec les fichiers de configuration (voir [Configuration](configuration.md#remplacer-les-réglages-par-les-fichiers)).

### Pourquoi la personne retirée ne reçoit-elle pas d'e-mail ?

C'est voulu : un retrait n'envoie **jamais** d'e-mail à la personne retirée. Seul le salon Discord ou Slack est
prévenu.

## Les données et la sécurité

### Où sont mes données ?

Sur **votre** serveur, dans votre base de données. Elles ne quittent la plateforme que pour trois raisons : la
connexion avec 42, l'envoi des notifications que vous avez choisies (Discord, Slack, serveur e-mail), et le logo que
Discord vient chercher lui-même.

### Quelles données sont collectées ?

Pour chaque membre : son login, son nom, son e-mail, son campus et sa photo 42, resynchronisés à chaque connexion.
La page **Confidentialité** de la plateforme le détaille, et chaque membre peut y **télécharger une copie** de ses
données. Voir le [guide utilisateur](user-guide.md#vos-données-personnelles).

### Comment supprimer les données d'une personne ?

**Retirer du BDE** supprime son compte pour de bon. Le journal d'audit garde seulement son login, en texte, sans lien
vers un compte.

### Qui voit le journal d'audit ?

Les propriétaires seulement, en lecture seule. Il ne peut être ni modifié ni supprimé depuis l'interface.

### Comment signaler une faille de sécurité ?

**Pas** dans une issue publique. Utilisez le signalement privé de GitHub : voir [SECURITY.md](../../SECURITY.md).

## L'exploitation

### Comment sauvegarder ?

`./scripts/backup.sh` crée deux fichiers : la base de données et les clés (volume `secrets`). **Les deux comptent.**
Voir [Sauvegardes](deployment.md#sauvegardes-et-restauration).

### Comment mettre à jour ?

Sauvegardez, récupérez le nouveau code, puis `docker compose up --build -d`. Voir [Mettre à jour](upgrading.md).

### Que faire si la clé de l'application 42 expire ?

Un propriétaire en crée une nouvelle sur l'intra et la colle dans **Paramètres**, section Application 42. Si plus
personne ne peut se connecter, il existe un moyen de secours : voir
[Problèmes fréquents](troubleshooting.md#à-la-connexion).

### Pourquoi `localhost` et pas `127.0.0.1` ou `0.0.0.0` ?

Pour 42, une adresse est une chaîne exacte. La plateforme écrit toujours `localhost` pour votre ordinateur, et refuse
`0.0.0.0`, qui est l'adresse sur laquelle le serveur écoute et non une adresse de site. Ouvrez la plateforme à
l'adresse enregistrée.

### Peut-on la faire tourner sans Docker ?

Le déploiement documenté utilise Docker, et c'est le seul qui est testé. Pour développer, voir le
[guide contributeur](contributing.md).

### Où trouver de l'aide ?

Dans [Problèmes fréquents](troubleshooting.md), puis dans les [issues](https://github.com/edouardbautz/BDE_Network/issues).
Les mots du projet sont dans le [glossaire](glossary.md).
