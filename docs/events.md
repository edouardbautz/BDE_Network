# Module Événements

Le calendrier **interne** du bureau : on y planifie et on y organise les événements du BDE.
L'intra 42 reste l'outil public où les étudiants s'inscrivent, donc ce module n'a ni
inscriptions, ni liste d'attente, ni pointage.

## Activer le module

Dans `bde.config.yml` (ou dans votre `bde.config.local.yml`, voir
[Configuration](configuration.md)) :

```yaml
modules:
  enabled: ['events']

events:
  categories:
    - { key: 'soiree', label: 'Soirée', color: '#db2777' }
    - { key: 'sport', label: 'Sport', color: '#16a34a' }
    - { key: 'wei', label: 'WEI', color: '#ea580c' }
    - { key: 'partenariat', label: 'Partenariat', color: '#2563eb' }
  reminderHour: 18

notifications:
  eventConfirmed: 'discord' # ou "email", "slack", "none"
  eventReminder: 'discord'
```

Puis redémarrez l'application. Tant que `events` n'est pas dans `modules.enabled`, le module
n'existe pas : aucune page (404), aucun lien dans le menu, aucun bloc sur le tableau de bord,
aucune donnée exposée, aucun rappel.

Les catégories (nom et couleur) sont **propres à votre BDE**. Ne changez pas la `key` d'une
catégorie une fois des événements créés : un événement dont la catégorie a disparu de la
configuration reste affiché, mais sans couleur.

## Qui peut faire quoi

Les droits viennent du **rôle** du membre (voir [Rôles et droits](roles.md)). Trois droits
concernent ce module :

| Action                                                     | Consulter | Gérer | Gérer l'agenda partagé | Propriétaire |
| ---------------------------------------------------------- | :-------: | :---: | :--------------------: | :----------: |
| Voir les événements **confirmés**                          |    oui    |  oui  |          oui           |     oui      |
| Voir les **brouillons**                                    |    non    |  oui  |          non           |     oui      |
| Créer, modifier, supprimer, confirmer, annuler une date    |    non    |  oui  |          non           |     oui      |
| Ajouter un événement à son agenda / s'abonner au flux .ics |    oui    |  oui  |          oui           |     oui      |
| Gérer le lien d'agenda du **BDE**                          |    non    |  non  |          oui           |     oui      |

« Gérer » inclut toujours « Consulter », et « Gérer l'agenda partagé » aussi. Les droits se
choisissent dans _Rôles_ et se donnent aux membres dans _Membres_ ; chaque création, modification
ou attribution de rôle est inscrite au journal d'audit. Le propriétaire a toujours accès à tout.
Si le module est désactivé dans `bde.config.yml`, ses droits restent dans les rôles mais ne
comptent plus.

Ces règles sont vérifiées **côté serveur** sur chaque page et chaque action : masquer un
bouton n'est jamais la seule protection. Un brouillon auquel vous n'avez pas droit n'est pas
« interdit », il est introuvable (404).

## Créer un événement

_Événements_ → **Nouvel événement**.

- **Titre, début, fin, lieu, description** : les heures sont saisies et affichées dans le fuseau
  du BDE (`bde.timezone`), quel que soit le fuseau de votre navigateur. Elles sont enregistrées
  en UTC.
- **Catégorie** : choisie parmi celles de votre configuration.
- **Membres en charge** : un ou plusieurs membres, **facultatif**. Ce sont eux qui reçoivent le
  rappel de la veille par email.

### Champs obligatoires

Six champs sont obligatoires, repérés par un astérisque discret (`*`) : **titre, début, fin,
lieu, description et catégorie**. Pour une série, la **date de fin de la série** l'est aussi. Seuls
les membres en charge (et le statut, qui vaut « brouillon » par défaut) sont facultatifs. Un
texte fait uniquement d'espaces compte comme vide.

La vérification se fait deux fois, avec les mêmes règles : dans le formulaire (le message
s'affiche sous chaque champ concerné, le curseur se place sur le premier à corriger, et le
message disparaît dès que le champ est corrigé), puis **côté serveur** avant tout
enregistrement (le formulaire n'est jamais cru sur parole).

Les événements créés **avant** cette règle, avec un lieu ou une description vide, s'affichent
normalement : ils ne sont bloqués qu'à leur **prochaine modification** dans le formulaire, qui
demandera de compléter ces champs. Les actions rapides (confirmer, repasser en brouillon,
annuler une date) ne passent pas par le formulaire et restent possibles.

- **Statut** : un **brouillon** n'est visible que de ceux qui ont la permission. **Confirmer**
  l'événement le rend visible de tous les membres et déclenche la notification de confirmation.

L'**année scolaire** (par exemple `2025-2026`) est calculée automatiquement : elle va de
septembre à août, d'après la date de début. Une série appartient à l'année scolaire de sa
première date.

## Événements récurrents

Choisissez _Chaque semaine_, _Toutes les 2 semaines_ ou _Chaque mois_, puis une **date de fin
obligatoire** (ce jour est inclus). Une série compte au plus 200 occurrences.

- **Modifier** une série s'applique à toute la série.
- **Annuler une seule date** : sur la page de l'événement, bouton _Annuler cette date_ dans la
  liste des occurrences. Le reste de la série n'est pas touché, et la date peut être _rétablie_.
- **Supprimer** l'événement supprime toute la série.
- L'heure locale est conservée à travers les changements d'heure : une séance « chaque mardi à
  18h » reste à 18h toute l'année.
- Mensuel : même jour du mois ; dans un mois plus court, c'est le dernier jour (un événement le
  31 tombe le 30 avril, le 28 février…).

## Les vues

- **Calendrier mensuel** (vue par défaut sur ordinateur) : chaque événement est coloré selon sa
  catégorie ; les brouillons sont en pointillés. Cliquez un jour pour le sélectionner, un
  événement pour l'ouvrir.
- **Sur mobile**, la grille ne montre que des pastilles colorées par jour ; le jour choisi est
  détaillé en dessous. Cliquer sur un jour affiche ses événements.
- **Liste** (vue par défaut sur mobile) : les événements à venir par ordre chronologique.
- **Filtres** : catégorie, membre en charge, année scolaire. Ils sont dans l'adresse de la page,
  donc partageables.
- **Page de détail** : toutes les informations, les occurrences d'une série et les actions.

## Ajouter à son agenda

- **Un événement** : bouton _Ajouter à mon agenda_ sur sa page (fichier `.ics`, lisible par tous
  les calendriers). Pour une série, l'occurrence affichée ou toute la série.
- **Synchronisation automatique** : _menu utilisateur_ → _Mon profil_ → _Synchroniser avec mon
  agenda_. Copiez le lien personnel et ajoutez-le à Google Agenda, Outlook ou Apple Calendar (voir
  le [pas à pas](#ajouter-un-lien-à-son-agenda-pas-à-pas)). Les changements apparaissent ensuite
  automatiquement, au rythme de rafraîchissement de votre application d'agenda.
- **Un lien pour tout le BDE** : voir [le lien du BDE](#le-lien-du-bde-agenda-partagé).

Le lien contient un **jeton secret propre à chaque membre** :

- il n'expose que ce que vous avez le droit de voir (jamais de brouillon sans la permission,
  évalué à chaque requête, donc un retrait de permission s'applique immédiatement) ;
- il cesse de fonctionner **immédiatement** si vous êtes retiré du BDE ;
- vous pouvez le **régénérer** depuis votre profil (l'ancien lien est alors invalide) ;
- ne le partagez pas : quiconque le possède lit votre agenda.

## Le lien du BDE (agenda partagé)

Les liens personnels demandent à chaque membre du bureau de s'abonner lui-même. Pour alléger
cela, un membre qui a le droit **Gérer l'agenda partagé** (ou le propriétaire) peut créer **un seul lien pour tout le BDE**, à
coller **une seule fois** dans l'agenda partagé du bureau. Il se met ensuite à jour tout seul.
Les liens personnels existent toujours et ne changent pas.

- **Où :** _Événements_ → bouton **Agenda partagé** (visible des seuls comptes qui ont le
  droit « Gérer l'agenda partagé », et du propriétaire — même sans le droit « Gérer les événements »).
- **Ce qu'il contient :** uniquement les événements **confirmés** et **non annulés**. Jamais de
  brouillon, quoi qu'il arrive.
- **Ce que vous pouvez faire :** afficher le lien, le copier, le **régénérer** (l'ancien lien
  cesse de fonctionner immédiatement), le **désactiver** (idem). Chaque action est inscrite au
  journal d'audit (`calendar_feed.enable`, `calendar_feed.regenerate`, `calendar_feed.disable`).
  Le lien lui-même n'est jamais écrit dans le journal d'audit ni dans les logs.
- **Si le lien est régénéré ou désactivé**, l'agenda abonné ne se met plus à jour : il faut coller
  le nouveau lien (et supprimer l'ancien abonnement).

### Quand un membre quitte le BDE

Le lien est un secret partagé : quiconque l'a copié peut lire l'agenda. Quand vous retirez un
membre alors qu'un lien du BDE est actif, la page _Membres_ vous propose aussitôt de **générer un
nouveau lien**, avec une phrase qui explique pourquoi. Ce n'est **pas automatique**, car régénérer
oblige à recoller le lien dans l'agenda partagé : c'est à vous de choisir le bon moment.

> **Limite à connaître.** Le lien sert à _alimenter_ un agenda ; il ne décide pas de **qui peut
> consulter cet agenda**. Si vous le collez dans un agenda partagé (par exemple un Google Agenda
> du BDE), l'accès des anciens membres à **cet agenda** se gère **dans Google** (ou Outlook,
> Apple), pas dans la plateforme : retirez-les du partage, ou changez le mot de passe du compte
> commun. Régénérer le lien empêche seulement l'ancien lien de continuer à fonctionner. Ce qui a
> déjà été copié dans l'agenda abonné n'est pas effacé par la plateforme.

## Ajouter un lien à son agenda, pas à pas

Valable pour **le lien du BDE** comme pour **votre lien personnel** (_Mon profil_). Copiez le
lien d'abord. Il se termine par `.ics`.

> **Patience.** Un agenda abonné n'est pas instantané. **Google peut mettre plusieurs heures** à
> rafraîchir un agenda abonné (parfois jusqu'à une journée) ; Outlook aussi peut prendre plusieurs
> heures. C'est normal : un événement créé ou modifié n'apparaît pas tout de suite.

### Google Agenda

Faites-le **sur ordinateur** : l'application mobile ne propose pas cette option.

1. Ouvrez Google Agenda sur ordinateur, avec le compte Google concerné.
2. À gauche, à côté de « Autres agendas », cliquez sur le **+**.
3. Cliquez sur **À partir de l'URL**.
4. Collez le lien.
5. Cliquez sur **Ajouter l'agenda**.

L'agenda apparaît dans « Autres agendas ». Il est visible dans le compte qui l'a ajouté : pour
un agenda commun du bureau, utilisez un compte Google partagé du BDE, ou faites ajouter le lien
par chaque personne concernée. Selon votre compte, Google peut ne pas permettre de partager un
agenda ajouté par URL : vérifiez dans les paramètres de l'agenda.

### Outlook

Sur Outlook.com ou le nouvel Outlook :

1. Ouvrez **Calendrier**.
2. Cliquez sur **Ajouter un calendrier**.
3. Choisissez **S'abonner à partir du web**.
4. Collez le lien, donnez un nom (par exemple « BDE »), puis cliquez sur **Importer**.

Sur Outlook classique pour Windows : **Fichier** → **Paramètres du compte** → **Paramètres du
compte…** → onglet **Calendriers Internet** → **Nouveau…**, puis collez le lien.

### Apple Calendar

Sur Mac :

1. Ouvrez **Calendrier**.
2. Menu **Fichier** → **Nouvel abonnement à un calendrier…**
3. Collez le lien, puis cliquez sur **S'abonner**.
4. Choisissez la fréquence de mise à jour automatique, puis **OK**.

Sur iPhone ou iPad : **Réglages** → **Calendrier** → **Comptes** → **Ajouter un compte** →
**Autre** → **Ajouter un calendrier avec abonnement**, puis collez le lien.

## Notifications

Le canal (email, Discord, Slack ou aucun) se règle dans `notifications` de la configuration. Les
variables correspondantes (`SMTP_*`, `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`) sont dans
`.env`. Pour que les messages contiennent un lien vers l'événement, renseignez `APP_URL` dans
`.env` (par exemple `https://bde.exemple.fr`) ; sans lui, les messages sont envoyés sans lien.

| Notification                    | Quand                                                                                            | Destinataires                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `eventConfirmed` (confirmation) | un événement passe de brouillon à **confirmé** (une seule fois par événement)                    | tous les membres approuvés (email : un message par personne) ; ou le salon (Discord/Slack) |
| `eventReminder` (rappel)        | la veille de chaque occurrence confirmée, à `events.reminderHour` (18h par défaut, heure du BDE) | les **membres en charge** (email) ; ou le salon (Discord/Slack)                            |

Un échec d'envoi n'empêche jamais d'enregistrer un événement : l'envoi se fait après la réponse.
Par email, l'échec pour un destinataire (adresse refusée, erreur SMTP) n'empêche pas l'envoi
aux autres ; il est écrit dans les logs du serveur (`[events] …`).

### Comment fonctionne le rappel de la veille

Il n'y a rien à installer : ni cron, ni tâche planifiée Windows, ni service externe. Au
démarrage, le serveur de l'application lance une petite boucle interne
(`src/instrumentation.ts` → `src/lib/events/scheduler.ts`) qui vérifie **toutes les 5 minutes**
si un rappel est dû. Cela fonctionne de la même façon sous Windows, Linux, macOS et Docker.

Un rappel est **dû** à partir de `reminderHour` (heure du BDE) la veille de l'occurrence, et
reste envoyable tant que l'événement n'a pas commencé.

**Il n'est jamais envoyé deux fois**, même après un redémarrage ou avec deux instances : avant
d'envoyer, le serveur inscrit en base une ligne « rappel réclamé » pour cette occurrence précise
(`EventReminder`, unique par événement et par date). Seul celui dont l'inscription réussit
envoie ; les autres passent leur chemin. Conséquences :

- si le serveur était éteint à 18h, le rappel part dès qu'il redémarre, tant que l'événement n'a
  pas commencé (rattrapage) ;
- si le serveur plante _exactement_ entre l'inscription et l'envoi, ce rappel est perdu plutôt
  que doublé (on préfère un oubli rare à un doublon) ;
- aucun rappel pour un brouillon, une date annulée, ni pour un événement confirmé _après_
  l'heure du rappel (les membres viennent d'être prévenus) ;
- si le serveur est éteint toute la journée jusqu'après le début de l'événement, le rappel est
  perdu : l'application doit tourner en continu, comme pour tout le reste.

Les événements récurrents sont rappelés occurrence par occurrence.

## Journal d'audit

Visible des propriétaires : `event.create`, `event.update` (avec la liste des champs modifiés),
`event.delete`, `event.status_change` (de → vers), `event.occurrence_cancel`,
`event.occurrence_restore`, et `calendar_feed.enable` / `calendar_feed.regenerate` / `calendar_feed.disable` pour le
lien du BDE (sans jamais le lien lui-même). L'auteur est toujours le compte réel, en texte (il survit au retrait du membre).

## Données de démonstration

`docker compose -f docker-compose.dev.yml up` (ou `npm run seed:demo`) crée une dizaine
d'événements relatifs à la date du jour (passé, semaine en cours, séries hebdomadaire / toutes
les 2 semaines / mensuelle avec une date annulée, week-end sur plusieurs jours, deux brouillons)
si le module est activé dans votre configuration. Chacun a un lieu et une description, comme
l'exige le formulaire. Relancer le seed les réécrit, sans doublon.

## Dépannage

- **« La configuration est invalide … events »** : le module est activé sans section `events` ou
  sans catégorie. Voir l'exemple ci-dessus.
- **Un rappel n'est pas parti** : vérifiez que le canal n'est pas `none`, que le serveur tournait
  à partir de `reminderHour`, que les membres en charge existent (email), et cherchez `[events]`
  dans les logs.
- **Le lien d'agenda ne se met pas à jour** : c'est le rythme de rafraîchissement de votre
  application d'agenda (Google peut prendre plusieurs heures).
- **Le lien du BDE répond « Not found »** : il a été régénéré ou désactivé, ou le module est
  désactivé. Récupérez le lien actuel dans _Événements_ → _Agenda partagé_.
