🇫🇷 Français · [🇬🇧 English](../en/events.md)

# Module Événements

Le calendrier **interne** du bureau : on y planifie et on y organise les événements du BDE. L'intra 42 reste l'outil
public où les étudiants s'inscrivent : ce module n'a donc ni inscriptions, ni liste d'attente, ni pointage.

![Le calendrier des événements](../images/fr/calendar.webp)

## Activer le module

Le module est activé par défaut à l'installation. Pour l'activer ou le désactiver ensuite : **Paramètres**, section
**Modules**. Pour régler ses catégories et l'heure du rappel : section **Événements**
([détails](configuration.md#les-événements)).

Tant que le module est désactivé, il n'existe pas : aucune page, aucun lien dans le menu, aucun bloc sur le tableau
de bord, aucun rappel.

## Qui peut faire quoi

Les droits viennent du **rôle** du membre (voir [Rôles et droits](roles.md)). Trois droits concernent ce module.

| Action                                                  | Consulter | Gérer | Gérer l'agenda partagé | Propriétaire |
| ------------------------------------------------------- | :-------: | :---: | :--------------------: | :----------: |
| Voir les événements **confirmés**                       |    oui    |  oui  |          oui           |     oui      |
| Voir les **brouillons**                                 |    non    |  oui  |          non           |     oui      |
| Créer, modifier, supprimer, confirmer, annuler une date |    non    |  oui  |          non           |     oui      |
| Ajouter un événement à son agenda, s'abonner au flux    |    oui    |  oui  |          oui           |     oui      |
| Gérer le lien d'agenda du **BDE**                       |    non    |  non  |          oui           |     oui      |

« Gérer » inclut « Consulter ». Le propriétaire a toujours accès à tout. Chaque création, modification ou attribution
de rôle est inscrite au journal d'audit.

Ces règles sont vérifiées **côté serveur**, sur chaque page et chaque action : masquer un bouton n'est jamais la
seule protection. Un brouillon auquel vous n'avez pas droit n'est pas « interdit » : il est introuvable.

## Créer un événement

**Événements** → **Nouvel événement**.

![Un événement qui se répète chaque semaine](../images/fr/event.webp)

- **Titre, début, fin, lieu, description** : les heures sont saisies et affichées dans le fuseau du BDE, quel que
  soit celui de votre navigateur.
- **Catégorie** : une de celles que le BDE a définies dans Paramètres.
- **Membres en charge** : un ou plusieurs membres, **facultatif**. Ce sont eux qui reçoivent le rappel de la veille
  par e-mail. Sans personne en charge, le rappel part aux **propriétaires et aux membres dont le rôle permet de
  gérer les événements** : il n'est jamais envoyé à personne.
- **Statut** : un **brouillon** n'est visible que de ceux qui peuvent gérer les événements. **Confirmer** l'événement
  le rend visible de tous les membres et déclenche la notification de confirmation.

### Les champs obligatoires

Six champs sont obligatoires, repérés par un `*` : **titre, début, fin, lieu, description et catégorie**. Pour une
série, la **date de fin de la série** l'est aussi. Seuls les membres en charge sont facultatifs. Un texte fait
uniquement d'espaces compte comme vide.

La vérification se fait deux fois, avec les mêmes règles : dans le formulaire (le message s'affiche sous le champ
concerné) puis sur le serveur, avant tout enregistrement.

Les événements créés **avant** cette règle, avec un lieu ou une description vide, s'affichent normalement. Ils ne
sont bloqués qu'à leur **prochaine modification** dans le formulaire, qui demandera de remplir ces champs.
Confirmer, repasser en brouillon et annuler une date restent possibles.

L'**année scolaire** (par exemple `2025-2026`) est calculée toute seule : de septembre à août, d'après la date de
début. Une série appartient à l'année scolaire de sa première date.

## Les événements qui se répètent

Choisissez _Chaque semaine_, _Toutes les 2 semaines_ ou _Chaque mois_, puis une **date de fin** obligatoire (ce jour
est inclus). Une série compte au plus 200 occurrences.

- **Modifier** une série modifie toute la série.
- **Annuler une seule date** : sur la page de l'événement, bouton **Annuler cette date** dans la liste des
  occurrences. Le reste de la série n'est pas touché, et la date peut être **rétablie**.
- **Supprimer** l'événement supprime toute la série.
- L'heure locale est conservée à travers les changements d'heure : une séance « chaque mardi à 18 h » reste à 18 h
  toute l'année.
- Pour une série mensuelle, c'est le même jour du mois. Dans un mois plus court, c'est le dernier jour : un
  événement le 31 tombe le 30 avril, le 28 février…

## Les vues

- **Calendrier mensuel** : la vue par défaut sur ordinateur. Chaque événement est coloré selon sa catégorie, les
  brouillons sont en pointillés. Cliquez sur un jour pour le sélectionner, sur un événement pour l'ouvrir.
- **Liste** : la vue par défaut sur téléphone. Les événements à venir, dans l'ordre.
- **Sur téléphone**, si vous choisissez la vue **Calendrier**, la grille montre des pastilles de couleur par jour, et
  le jour choisi est détaillé en dessous.
- **Filtres** : catégorie, membre en charge, année scolaire. Ils sont dans l'adresse de la page, donc partageables.
- **Page de détail** : toutes les informations, les occurrences d'une série et les actions.

## Ajouter à son agenda

- **Un événement** : le bouton **Ajouter à mon agenda** de sa page télécharge un fichier `.ics`, lisible par tous les
  calendriers. Pour une série : l'occurrence affichée, ou toute la série.
- **La synchronisation automatique** : menu de votre nom → **Mon profil** → **Synchroniser avec mon agenda**. Copiez
  le lien personnel et ajoutez-le à Google Agenda, Outlook ou Apple Calendar (voir
  [pas à pas](#ajouter-un-lien-à-son-agenda-pas-à-pas)). Les changements apparaissent ensuite tout seuls, au rythme
  de rafraîchissement de votre application d'agenda.
- **Un lien pour tout le BDE** : voir [plus bas](#le-lien-du-bde-agenda-partagé).

Le lien contient un **jeton secret propre à chaque membre** :

- il n'expose que ce que vous avez le droit de voir (jamais un brouillon sans le droit), vérifié à chaque requête :
  un droit retiré s'applique tout de suite ;
- il cesse de fonctionner **immédiatement** si vous êtes retiré du BDE ;
- vous pouvez le **régénérer** depuis votre profil (l'ancien lien ne marche plus) ;
- ne le partagez pas : quiconque l'a peut lire votre agenda.

## Le lien du BDE (agenda partagé)

Les liens personnels demandent à chaque membre de s'abonner lui-même. Pour simplifier, un membre qui a le droit
**Gérer l'agenda partagé** (ou un propriétaire) peut créer **un seul lien pour tout le BDE**, à coller **une seule
fois** dans l'agenda partagé du bureau. Il se met ensuite à jour tout seul. Les liens personnels ne changent pas.

- **Où** : **Événements** → bouton **Agenda partagé**. Il n'est visible que de ceux qui ont le droit « Gérer l'agenda
  partagé » et des propriétaires, même sans le droit « Gérer les événements ».
- **Ce qu'il contient** : uniquement les événements **confirmés** et **non annulés**. Jamais de brouillon.
- **Ce que vous pouvez faire** : afficher le lien, le copier, le **régénérer** (l'ancien lien cesse de fonctionner
  immédiatement), le **désactiver**. Chaque action est inscrite au journal d'audit. Le lien lui-même n'y figure
  jamais, ni dans les journaux du serveur.
- **Si le lien est régénéré ou désactivé**, l'agenda abonné ne se met plus à jour : collez le nouveau lien et
  supprimez l'ancien abonnement.

### Quand un membre quitte le BDE

Le lien est un secret partagé : quiconque l'a copié peut lire l'agenda. Quand vous retirez un membre alors qu'un lien
du BDE est actif, la page **Membres** vous propose aussitôt de **générer un nouveau lien**, avec une phrase qui
explique pourquoi. Ce n'est **pas automatique** : régénérer oblige à recoller le lien dans l'agenda partagé, et
c'est à vous de choisir le bon moment.

> **Une limite à connaître.** Le lien sert à _alimenter_ un agenda ; il ne décide pas de **qui peut consulter cet
> agenda**. Si vous le collez dans un agenda partagé (un Google Agenda du BDE, par exemple), l'accès des anciens
> membres à **cet agenda** se gère **dans Google** (ou Outlook, Apple), pas dans la plateforme : retirez-les du
> partage. Régénérer le lien empêche seulement l'ancien lien de fonctionner. Ce qui a déjà été copié dans l'agenda
> abonné n'est pas effacé par la plateforme.

## Ajouter un lien à son agenda, pas à pas

C'est valable pour **le lien du BDE** comme pour **votre lien personnel**. Copiez d'abord le lien : il se termine par
`.ics`.

> **Patience.** Un agenda abonné n'est pas instantané. **Google peut mettre plusieurs heures** à le rafraîchir,
> parfois jusqu'à une journée, et Outlook aussi. C'est normal : un événement créé ou modifié n'apparaît pas tout
> de suite.

### Google Agenda

Faites-le **sur ordinateur** : l'application mobile ne propose pas cette option.

1. Ouvrez Google Agenda sur ordinateur, avec le compte Google concerné.
2. À gauche, à côté de « Autres agendas », cliquez sur le **+**.
3. Cliquez sur **À partir de l'URL**.
4. Collez le lien.
5. Cliquez sur **Ajouter l'agenda**.

L'agenda apparaît dans « Autres agendas », visible dans le compte qui l'a ajouté. Pour un agenda commun du bureau,
utilisez un compte Google partagé du BDE, ou faites ajouter le lien par chaque personne.

### Outlook

Sur Outlook.com ou le nouvel Outlook :

1. Ouvrez **Calendrier**.
2. Cliquez sur **Ajouter un calendrier**.
3. Choisissez **S'abonner à partir du web**.
4. Collez le lien, donnez un nom (par exemple « BDE »), puis cliquez sur **Importer**.

Sur Outlook classique pour Windows : **Fichier** → **Paramètres du compte** → **Paramètres du compte…** → onglet
**Calendriers Internet** → **Nouveau…**, puis collez le lien.

### Apple Calendar

Sur Mac :

1. Ouvrez **Calendrier**.
2. Menu **Fichier** → **Nouvel abonnement à un calendrier…**
3. Collez le lien, puis cliquez sur **S'abonner**.
4. Choisissez la fréquence de mise à jour, puis **OK**.

Sur iPhone ou iPad : **Réglages** → **Calendrier** → **Comptes** → **Ajouter un compte** → **Autre** → **Ajouter un
calendrier avec abonnement**, puis collez le lien.

## Notifications

Le canal (e-mail, Discord, Slack ou aucun) et ses réglages se choisissent dans **Paramètres**, section
**Notifications**, avec un message de test. Pour que les messages contiennent un lien vers l'événement,
renseignez l'adresse de la plateforme (section **Adresse de la plateforme**) : sans elle, les messages partent sans lien.

| Notification                        | Quand                                                                                             | Qui la reçoit                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Confirmation** (`eventConfirmed`) | un événement passe de brouillon à **confirmé**, une seule fois                                    | tous les membres approuvés (e-mail : un message par personne), ou le salon Discord ou Slack |
| **Rappel** (`eventReminder`)        | la veille de chaque occurrence confirmée, à l'**heure du rappel** (18 h par défaut, heure du BDE) | les **membres en charge** (e-mail), sinon ceux qui gèrent les événements ; ou le salon      |

Le rendu sur Discord, Slack et par e-mail est décrit dans [Notifications](notifications.md).

L'envoi se fait **après** la réponse : un échec d'envoi n'empêche jamais d'enregistrer un événement. Par e-mail,
l'échec pour un destinataire n'empêche pas l'envoi aux autres. Il est écrit dans les journaux du serveur
(`[events] …`).

### Comment fonctionne le rappel de la veille

Il n'y a rien à installer : ni cron, ni tâche planifiée, ni service externe. Au démarrage, le serveur lance une
petite boucle interne qui vérifie **toutes les 5 minutes** si un rappel est dû. Cela fonctionne de la même façon
sous Windows, Linux, macOS et Docker.

Un rappel est **dû** à partir de l'heure du rappel, la veille de l'occurrence, et reste envoyable tant que
l'événement n'a pas commencé. Le message dit « demain ». Quand il part le jour même (rattrapage après une panne), il
dit « aujourd'hui ».

**Il n'est jamais envoyé deux fois**, même après un redémarrage ou avec deux instances : avant d'envoyer, le serveur
inscrit en base que ce rappel est « réclamé » pour cette occurrence précise. Seul celui dont l'inscription réussit
envoie. Conséquences :

- si le serveur était éteint à l'heure du rappel, le rappel part dès qu'il redémarre, tant que l'événement n'a pas
  commencé ;
- si le serveur plante _exactement_ entre l'inscription et l'envoi, ce rappel est perdu plutôt que doublé : on
  préfère un oubli rare à un doublon ;
- aucun rappel pour un brouillon, pour une date annulée, ni pour un événement confirmé _après_ l'heure du rappel (les
  membres viennent d'être prévenus) ;
- si le serveur reste éteint toute la journée jusqu'après le début de l'événement, le rappel est perdu : la
  plateforme doit tourner en continu.

Les événements qui se répètent sont rappelés occurrence par occurrence.

## Journal d'audit

Les propriétaires y voient la création, la modification (avec la liste des champs changés), la suppression, le
changement de statut, l'annulation et le rétablissement d'une date, et les actions sur le lien du BDE (jamais le
lien lui-même). L'auteur est le compte réel, écrit en texte : il reste lisible même si le membre est retiré ensuite.

## Un problème ?

Un rappel n'est pas parti, un agenda ne se met pas à jour, le lien du BDE répond « Not found » : voir
[Problèmes fréquents](troubleshooting.md#les-événements-et-les-agendas).
