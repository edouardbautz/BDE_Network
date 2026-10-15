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

**Événements** → **Nouvel événement**, ou, plus vite, **depuis le calendrier** :

- **Sur ordinateur**, un **+** apparaît dans le coin d'un jour quand vous le survolez (et quand le clavier l'atteint :
  Tab, juste après le jour lui-même ; sur un écran tactile, il est toujours là). Il ouvre le formulaire **sur ce
  jour-là**.
- **Sur téléphone**, touchez un jour, puis **Ajouter ce jour-là** sous le calendrier.

Le formulaire démarre alors de **18 h à 20 h** ce jour-là (fuseau du BDE), que vous ajustez comme n'importe quelle
date. Sans jour (le bouton **Nouvel événement**), il démarre de demain, 18 h à 20 h. Un jour passé est accepté, pour
enregistrer un événement après coup. **Annuler** ramène à ce jour du calendrier. Ces raccourcis n'existent que pour
ceux qui peuvent gérer les événements : les autres ne les voient pas, et le formulaire leur est refusé s'ils en tapent
l'adresse.

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
est inclus). Une série compte au plus 200 dates (une série coupée en deux, voir plus bas, compte chaque partie
séparément).

- L'heure locale est conservée à travers les changements d'heure : une séance « chaque mardi à 18 h » reste à 18 h
  toute l'année.
- Pour une série mensuelle, c'est le même jour du mois. Dans un mois plus court, c'est le dernier jour : un
  événement le 31 tombe le 30 avril, le 28 février… Une série coupée un de ces jours garde son jour : les dates
  suivantes retombent le 31.

### Une date, ou cette date et les suivantes

Sur la page d'une série, choisissez une date dans la liste des dates (celle qui est affichée est en gras). Ensuite,
**chaque action demande quelles dates elle concerne**, dans une fenêtre, avec deux choix :

- **Seulement celui-ci** : cette date change, les autres non. C'est le choix déjà sélectionné.
- **Celui-ci et les suivants** : cette date et toutes celles qui viennent après. **Sur la première date, c'est toute
  la série.** La fenêtre dit combien de dates cela représente.

C'est la même fenêtre pour **modifier** (heure, lieu, description, catégorie, membres en charge…), **confirmer**,
**repasser en brouillon** et **supprimer**. Un événement qui ne se répète pas n'a pas cette question.

![La fenêtre qui demande quelles dates une modification concerne : seulement celle-ci, ou celle-ci et les suivantes](../images/fr/series-dialog.webp)

| Action                    | Seulement celui-ci                                                                                                                                                                                                                       | Celui-ci et les suivants                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modifier**              | La date reçoit **ses propres valeurs** : seulement ce que vous avez changé, le reste continue de suivre la série. Vous pouvez la déplacer à une autre heure ou un autre jour. La fréquence et la date de fin restent celles de la série. | La série est **coupée en deux** à cette date : les dates d'avant restent comme elles étaient, cette date et les suivantes reçoivent vos changements, et vous pouvez changer aussi la fréquence et la date de fin. |
| **Confirmer**             | Cette date est confirmée toute seule et annoncée aux membres, une fois.                                                                                                                                                                  | Cette date et les suivantes sont confirmées, **y compris celles qui étaient repassées en brouillon** (la fenêtre dit combien), et annoncées en **un seul message**.                                               |
| **Repasser en brouillon** | Cette date disparaît pour les membres et du lien d'agenda du BDE. Les autres restent.                                                                                                                                                    | Cette date et les suivantes repassent en brouillon.                                                                                                                                                               |
| **Supprimer**             | La date est **annulée** : elle reste dans la liste, barrée, et vous pouvez la **rétablir**.                                                                                                                                              | La série **s'arrête à la date d'avant**. C'est définitif : les dates suivantes, avec ce qui avait été modifié dessus, sont supprimées. Sur la première date, tout l'événement est supprimé.                       |

Dans la liste, une date qui a ses propres valeurs porte **Modifiée**, une date en brouillon porte **Brouillon**, une
date annulée est barrée.

### Ce que deviennent les dates modifiées toutes seules

Vous modifiez « celui-ci et les suivants » alors que certaines des dates suivantes avaient été modifiées seules. La
règle est celle de Google Agenda : **ce que vous changez remplace ce que ces dates avaient pour ce champ, ce que vous
ne touchez pas reste.**

- Vous changez le lieu : toutes les dates suivantes prennent le nouveau lieu, même celles qui avaient le leur. Une
  date qui avait aussi son propre titre garde son titre.
- Vous confirmez la suite : les dates qui étaient en brouillon sont confirmées aussi.
- Vous ne changez que l'**heure** : les dates modifiées seules, les dates annulées et les rappels déjà envoyés suivent
  la nouvelle heure, jour par jour.
- Vous changez le **jour** ou la **fréquence** (chaque mardi au lieu de chaque lundi, toutes les 2 semaines au lieu de
  chaque semaine) : les dates ne sont plus les mêmes, donc ce qui avait été modifié dessus, et les dates annulées, ne
  peuvent pas suivre et sont abandonnés.

La fenêtre indique combien de dates seront remises en accord.

### Une série coupée en deux

« Celui-ci et les suivants » sur une date qui n'est pas la première **coupe la série en deux parties**. La première
s'arrête à la date d'avant ; la seconde commence à cette date, avec sa propre page. Pour les membres et pour les
agendas, c'est toujours **une seule série** : chaque date garde son identifiant, donc un agenda qui a déjà les dates
les met à jour, sans doublon.

La seconde partie garde l'auteur, les membres en charge et le fait que la série a été annoncée (elle n'est pas
annoncée une seconde fois parce qu'on l'a coupée). Son année scolaire est celle de sa première date.

## Supprimer un événement

Le bouton **Supprimer** d'une page qui n'est pas une série supprime l'événement, définitivement. Pour une série, il
demande quelles dates (voir plus haut) : supprimer « celui-ci et les suivants » depuis la première date supprime toute
la série.

## Les vues

- **Calendrier mensuel** : la vue par défaut sur ordinateur. Chaque événement est coloré selon sa catégorie, les
  brouillons sont en pointillés. Cliquez sur un jour pour le sélectionner, sur un événement pour l'ouvrir.
- **Liste** : la vue par défaut sur téléphone. Les événements à venir, dans l'ordre.
- **Sur téléphone**, si vous choisissez la vue **Calendrier**, la grille montre des pastilles de couleur par jour, et
  le jour choisi est détaillé en dessous.
- **Filtres** : catégorie, membre en charge, année scolaire. Ils sont dans l'adresse de la page, donc partageables.
- **Page de détail** : toutes les informations de la date affichée, les dates d'une série et les actions.

## Ajouter à son agenda

- **Un événement** : le bouton **Ajouter à mon agenda** de sa page télécharge un fichier `.ics`, lisible par tous les
  calendriers. Pour une série : la date affichée, ou toute la série. Une date modifiée ou déplacée reste la même
  entrée, mise à jour ; une date annulée, ou repassée en brouillon pour le lien du BDE, disparaît.
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
- **Ce qu'il contient** : uniquement les dates **confirmées** et **non annulées**. Jamais de brouillon : une date
  repassée en brouillon en disparaît.
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

| Notification                        | Quand                                                                                                                                                         | Qui la reçoit                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Confirmation** (`eventConfirmed`) | un événement passe de brouillon à **confirmé**, une seule fois ; pour une série, une fois pour la partie confirmée, ou une fois pour une date confirmée seule | tous les membres approuvés (e-mail : un message par personne), ou le salon Discord ou Slack |
| **Rappel** (`eventReminder`)        | la veille de chaque occurrence confirmée, à l'**heure du rappel** (18 h par défaut, heure du BDE)                                                             | les **membres en charge** (e-mail), sinon ceux qui gèrent les événements ; ou le salon      |

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

Les événements qui se répètent sont rappelés date par date, **une seule fois par date**, quoi qu'il arrive à la
série : une date déplacée après l'envoi de son rappel n'est pas rappelée une seconde fois, et une série coupée en deux
garde les rappels déjà envoyés. Le rappel montre l'heure, le lieu et les membres en charge de cette date.

## Journal d'audit

Les propriétaires y voient la création, la modification (avec la liste des champs changés), la suppression, le
changement de statut, l'annulation et le rétablissement d'une date, et les actions sur le lien du BDE (jamais le
lien lui-même). Pour une série, chaque entrée dit si l'action portait sur **une date** ou sur **cette date et les
suivantes**, et laquelle (pour la première date : que c'était toute la série). L'auteur est le compte réel, écrit en texte : il reste lisible même si le membre est retiré ensuite.

## Un problème ?

Un rappel n'est pas parti, un agenda ne se met pas à jour, le lien du BDE répond « Not found » : voir
[Problèmes fréquents](troubleshooting.md#les-événements-et-les-agendas).
