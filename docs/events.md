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

| Action                                                     | Membre approuvé | Membre avec la permission « Événements » | Propriétaire |
| ---------------------------------------------------------- | :-------------: | :--------------------------------------: | :----------: |
| Voir les événements **confirmés**                          |       oui       |                   oui                    |     oui      |
| Voir les **brouillons**                                    |       non       |                   oui                    |     oui      |
| Créer, modifier, supprimer, confirmer, annuler une date    |       non       |                   oui                    |     oui      |
| Ajouter un événement à son agenda / s'abonner au flux .ics |       oui       |                   oui                    |     oui      |

La permission est attribuée par un **administrateur** dans _Membres_ → colonne _Modules_ (bouton
« Événements » de chaque membre actif). Chaque attribution ou retrait est inscrit au journal
d'audit. Le propriétaire a toujours accès à tout.

Ces règles sont vérifiées **côté serveur** sur chaque page et chaque action : masquer un
bouton n'est jamais la seule protection. Un brouillon auquel vous n'avez pas droit n'est pas
« interdit », il est introuvable (404).

## Créer un événement

_Événements_ → **Nouvel événement**.

- **Titre, début, fin, lieu, description** : les heures sont saisies et affichées dans le fuseau
  du BDE (`bde.timezone`), quel que soit le fuseau de votre navigateur. Elles sont enregistrées
  en UTC.
- **Catégorie** : choisie parmi celles de votre configuration.
- **Membres en charge** : un ou plusieurs membres. Ce sont eux qui reçoivent le rappel de la
  veille par email.
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
  agenda_. Copiez le lien personnel et ajoutez-le à Google Agenda, Outlook ou Apple Calendar
  (« S'abonner à un calendrier par URL »). Les changements apparaissent ensuite
  automatiquement (selon la fréquence de rafraîchissement de votre application d'agenda, de
  quelques minutes à quelques heures).

Le lien contient un **jeton secret propre à chaque membre** :

- il n'expose que ce que vous avez le droit de voir (jamais de brouillon sans la permission,
  évalué à chaque requête, donc un retrait de permission s'applique immédiatement) ;
- il cesse de fonctionner **immédiatement** si vous êtes retiré du BDE ;
- vous pouvez le **régénérer** depuis votre profil (l'ancien lien est alors invalide) ;
- ne le partagez pas : quiconque le possède lit votre agenda.

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
`event.occurrence_restore`, et `permission.grant` / `permission.revoke` pour la permission du
module. L'auteur est toujours le compte réel, en texte (il survit au retrait du membre).

## Données de démonstration

`docker compose -f docker-compose.dev.yml up` (ou `npm run seed:demo`) crée une dizaine
d'événements relatifs à la date du jour (passé, semaine en cours, séries hebdomadaire / toutes
les 2 semaines / mensuelle avec une date annulée, week-end sur plusieurs jours, deux brouillons)
si le module est activé dans votre configuration. Relancer le seed les réécrit, sans doublon.

## Dépannage

- **« La configuration est invalide … events »** : le module est activé sans section `events` ou
  sans catégorie. Voir l'exemple ci-dessus.
- **Un rappel n'est pas parti** : vérifiez que le canal n'est pas `none`, que le serveur tournait
  à partir de `reminderHour`, que les membres en charge existent (email), et cherchez `[events]`
  dans les logs.
- **Le lien d'agenda ne se met pas à jour** : c'est le rythme de rafraîchissement de votre
  application d'agenda (Google peut prendre plusieurs heures).
