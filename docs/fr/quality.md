🇫🇷 Français · [🇬🇧 English](../en/quality.md)

# Qualité : ce qui est vérifié, comment, et ce que cela a trouvé

Un BDE confie à cette plateforme ses membres, son calendrier et sa connexion. Cette page dit ce qui est fait pour le mériter :
ce qui est vérifié, à quelle fréquence, ce que les contrôles ont trouvé et, tout aussi important, **ce qu'ils ne couvrent pas**.
Chaque phrase s'appuie sur un test ou un workflow du dépôt ; le détail technique est dans l'
[architecture](../architecture.md#quality-campaign-qa-githubworkflowsqayml) (en anglais).

Elle décrit le projet à la version 1.3.0 (voir le [CHANGELOG](../../CHANGELOG.md), en anglais).

## Ce qui est vérifié, et quand

| Quand                                      | Quoi                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Chaque pull request** (quelques minutes) | Types, lint, mise en forme ; plus de 3 000 tests unitaires, avec une **couverture minimale** qui ne fait que monter (au moins 91 % des instructions pour chaque zone qui décide qui peut faire quoi ou ce qui est écrit dans la base) ; chaque migration sur un vrai PostgreSQL ; la documentation (liens, ancres, jumeaux FR/EN) ; l'image construite, démarrée et mise à jour ; la sécurité statique (plus bas). |
| **Chaque nuit**, et à la demande           | Les suites lourdes ci-dessous, sur l'image réelle, un vrai PostgreSQL et un jeu de données d'environ 300 membres et 600 événements sur deux années scolaires.                                                                                                                                                                                                                                                      |
| **Avant une version**                      | La dernière exécution de nuit sur le commit à étiqueter doit être verte ; le workflow de publication teste l'image qu'il s'apprête à publier, sur les deux architectures, avant de la nommer.                                                                                                                                                                                                                      |

Personne ne se connecte par 42 dans ces tests : le cookie de session de chaque profil est forgé avec le secret de la plateforme,
comme la plateforme l'écrit. Les profils sont neuf : visiteur, compte en attente d'approbation, membre, membre qui propose des
événements, membre qui les valide, membre avec un rôle personnalisé, membre avec le rôle Admin, propriétaire, et un membre retiré
dont le cookie est encore valide.

## Ce que font les suites de nuit

- **Qui peut faire quoi.** Chaque page, chaque route de l'API et chaque action serveur, pour chacun des neuf profils, avec le
  module Événements activé et désactivé. Un refus ne doit rien changer dans la base et ne rien montrer de personne ; ce qui est
  permis doit vraiment passer et écrire ce qu'il faut (une porte qui refuse tout le monde paraîtrait « sûre » sinon). Une nouvelle
  page ou action fait échouer les tests de la pull request qui l'ajoute tant qu'elle n'est pas dans la liste.
- **Attaques.** En-têtes et règles de cache de chaque sorte de réponse ; cookies de session forgés, expirés ou coupés ; une action
  appelée depuis un autre site ; 300 essais de lien de calendrier ; du texte hostile saisi dans chaque champ et relu comme le ferait
  un navigateur ; envois de logo piégés ; déluges de mauvaises requêtes ; et les journaux, fouillés pour tout secret rencontré
  pendant l'exécution. OWASP ZAP analyse la plateforme en marche, connecté comme propriétaire. À la demande, les attaques sont
  elles-mêmes vérifiées en cassant une protection exprès et en construisant l'image, pour voir qu'elles s'en aperçoivent.
- **Navigateurs.** Les parcours de la plateforme (une proposition approuvée, un refus avec son commentaire, le calendrier, les
  réglages, le clavier) dans **Chromium, Firefox et WebKit** (le moteur de Safari). Un parcours échoue si ses pages lèvent une
  exception, écrivent une erreur dans la console, enfreignent leur propre politique de sécurité du contenu ou reçoivent une erreur
  serveur.
- **Accessibilité.** Chaque page vérifiée selon WCAG 2.2 niveau AA (axe), avec deux profils chacune, dans deux combinaisons
  (anglais, clair, ordinateur ; français, sombre, téléphone) ; et le clavier seul : le lien d'évitement, les menus, le tiroir du
  téléphone, un formulaire qui dit ce qui ne va pas, et un focus visible sur tout ce que Tab atteint.
- **Apparence.** 80 images des pages sont comparées à des images de référence, pour qu'un changement d'apparence que personne n'a
  voulu soit vu.
- **Vitesse et charge.** Lighthouse juge sept pages selon des budgets écrits (poids, requêtes, décalage de mise en page, notes) ;
  20 personnes à la fois parcourent la plateforme avec une limite par page et un contrôle de la mémoire ensuite.
- **Résilience.** La base arrêtée, gelée et tuée en pleine écriture ; l'application arrêtée et tuée en pleine écriture ; un
  webhook qui accepte la connexion et ne répond jamais. La plateforme doit dire qu'elle ne peut pas, vite, revenir seule, garder
  les gens connectés, et ne laisser **aucune écriture à moitié faite**.
- **Mises à jour.** Une plateforme en **1.0.0, 1.1.0, 1.2.0, 1.3.0 ou 1.4.0**, garnie des données d'une ancienne installation
  (rôles, membres, séries d'événements de chaque répétition, une date annulée et une déplacée ; à partir de la 1.3.0, des rôles qui
  proposent, valident et gèrent l'agenda partagé, des séries à règles avancées, des propositions, un refus avec son commentaire), est mise à jour comme le dit le
  [guide de mise à jour](upgrading.md). Ce que l'ancienne version disait de ses propres données (chaque date de ses fichiers de
  calendrier, ses rôles, ses lignes) est ce à quoi la nouvelle est tenue ; puis une sauvegarde, sa restauration, et le retour à
  l'ancienne version.
- **Long terme.** Un an et demi de la boucle de rappels, joué sur une vraie base et comparé à un calcul qui n'utilise pas son
  code : chaque rappel envoyé exactement une fois, à l'heure, aux deux changements d'heure ; et l'année scolaire à chaque
  1er septembre jusqu'en 2032.
- **Une promenade dans l'interface.** Pour chaque profil, sur ordinateur et sur téléphone, chaque lien est suivi et chaque menu et
  dialogue ouvert, à la recherche d'un lien mort, d'une page sans titre, d'une page qui défile en largeur, d'une image qui ne se
  charge pas, d'un menu qui casse la page.
- **Vie privée.** Chaque colonne de la base qui peut contenir une personne est lue dans le schéma et classée : où l'export de ses
  données la trouve, et le fait qu'un compte peut toujours être supprimé. Sur une vraie base avec le jeu de données QA, retirer un
  compte ne doit laisser **aucune adresse e-mail, aucun nom complet, aucune photo ni aucun lien de calendrier personnel nulle part**, et
  le login seulement là où la page de politique de confidentialité de la plateforme (`/privacy`) le dit (le journal d'audit, les
  événements écrits, les responsables) ; les lignes de cet historique sont conservées. Cela tourne à chaque pull request, pas
  seulement la nuit.
- **Les tests des règles sont testés.** Un testeur de mutation change le code des règles qui décident qui peut faire quoi
  (permissions, rôles, circuit de proposition, ce que porte une session, qui devient propriétaire, ce que le logo peut être) un
  opérateur à la fois, et les tests doivent échouer à chaque changement ; le job échoue sous 95 % (97,6 % à la dernière mesure).

Chaque pull request est aussi lue par l'analyse statique : les règles propres au projet (Semgrep : aucun réglage lu en
contournant les réglages, aucun SQL brut construit à partir d'un texte, aucun lien qui évite le routeur de langue…), une recherche de
secrets dans tout l'historique (gitleaks), CodeQL sur le code et sur les workflows, Trivy sur les dépendances, les fichiers et
l'image, et une revue des dépendances qu'elle ajoute. Les actions des workflows sont épinglées à un commit.

## Ce que cela a trouvé

Depuis la version 1.2.0, la campagne a trouvé et corrigé **23 défauts**, chacun dans une pull request à part avec un test qui l'aurait
détecté. Le détail est dans le [CHANGELOG](../../CHANGELOG.md) (rubriques « Fixed » et « Security » des changements non publiés).

| Sorte                  | Nombre | Exemples                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ne marche pas          | 1      | **Le menu de la personne connectée (profil, déconnexion) plantait à l'ouverture**, dans toutes les versions publiées : aucun test ne l'avait jamais ouvert.                                                                                                                                                                                                                                                                                                                                                                                            |
| Exploitation           | 3      | Revenir à la version précédente avec `restore.sh` ne marchait pas dans l'ordre du guide ; une base gelée bloquait chaque page tant qu'elle l'était ; un webhook ou un serveur de mail qui ne répond jamais gardait une connexion des minutes.                                                                                                                                                                                                                                                                                                          |
| Sécurité et vie privée | 10     | L'export de ses propres données pouvait être gardé par un cache, et il oubliait quatre sortes de données que la plateforme détient sur la personne (dates dont elle est responsable, dates annulées, propositions refusées, ce qui a été fait sur son compte) ; la politique stricte du logo était remplacée par celle des pages ; une adresse mal formée ou un `callbackUrl` illisible donnait une erreur serveur ; chaque page enfreignait la politique de sécurité du contenu de la plateforme ; les actions des workflows n'étaient pas épinglées. |
| Accessibilité et usage | 7      | Menus et tableaux inaccessibles ou illisibles au clavier ou avec un lecteur d'écran, texte trop pâle sur les boutons rouges, événements du calendrier trop petits pour être touchés, une liste sans focus visible dans Safari, trois pages sans titre.                                                                                                                                                                                                                                                                                                 |
| Vitesse                | 2      | Le calendrier faisait dessiner d'avance par le serveur la page de chaque événement du mois (110 requêtes, contre 13 à 18 pour les autres pages) ; une longue page sautait sur le côté en finissant de se charger.                                                                                                                                                                                                                                                                                                                                      |

Rien n'est affirmé au-delà. En particulier, **les suites ont cherché sans trouver** : un chemin où un profil pourrait faire ce qu'il
ne doit pas (la matrice d'accès et les attaques), une écriture laissée à moitié faite quand la base ou l'application est tuée, une adresse e-mail, un nom, une photo ou un lien de calendrier laissés par la suppression d'un compte, une
session perdue par une panne, une date, une heure, un droit ou une ligne changés par une mise à jour depuis la 1.0.0, la 1.1.0, la
1.2.0, la 1.3.0 ou la 1.4.0, un rappel envoyé deux fois ou pas du tout sur un an et demi, et un lien mort dans l'interface.

## Vitesse et ressources : les chiffres

Un BDE héberge souvent la plateforme sur un petit serveur que personne ne surveille. Une campagne d'optimisation part
donc de **mesures**, prises de la même façon avant et après chaque changement, et un changement qui n'apporte pas de gain
mesuré n'est pas fait. `qa/optim` les prend sur l'image de production et le jeu de données de qualité
(`npx tsx qa/optim/measure.ts`) ; le workflow `measures` le fait chaque nuit sur la machine de la CI (4 CPU, 16 Go, plus
grosse qu'un serveur d'école), sur trois jeux de données : deux années scolaires avec 300 membres, un BDE tel qu'il est
(150 comptes) et cinq ans avec 1 500 membres. Les chiffres en octets et en requêtes ne dépendent pas de la machine ; les
durées ne se comparent qu'à d'autres mesures prises sur la même. Les mesures brutes du point de départ sont dans
`qa/optim/baselines/`.

| Ce qui est mesuré                                                       | Avant (2026-10-27)           | Objectif                                | Maintenant         |
| ----------------------------------------------------------------------- | ---------------------------- | --------------------------------------- | ------------------ |
| Image Docker                                                            | 318 Mo                       | 250 Mo ou moins                         |                    |
| Scripts chargés d'emblée : connexion, tableau de bord, un événement     | 211, 217 et 242 Ko           | 200 Ko ou moins                         | 175, 181 et 205 Ko |
| Plus grand affichage (LCP) sur téléphone, réseau lent : tableau de bord | 4,2 s (un événement : 4,3 s) | 3,5 s ou moins                          |                    |
| Requêtes envoyées à la base : tableau de bord, calendrier, événement    | 10, 12 et 10                 | 8 ou moins                              | 2, 4 et 2          |
| Mémoire de l'application sous la charge de 20 personnes                 | 1 105 Mo (103 Mo au repos)   | 450 Mo ou moins, même débit             |                    |
| 95 % des réponses sous cette charge                                     | 1,56 s                       | 30 % de moins                           |                    |
| Redémarrage jusqu'à ce que la plateforme réponde                        | 2,6 s                        | 1,6 s ou moins                          |                    |
| Le plus petit serveur qui tient la charge                               | pas essayé                   | 1 CPU et 1 Go, aucune requête en échec  |                    |
| Journaux Docker                                                         | sans limite                  | 30 Mo au plus                           |                    |
| Durée des vérifications d'une pull request                              | 12 à 17 minutes              | 9 minutes ou moins, mêmes vérifications | 5,4 minutes        |

**Étapes faites.** (La première lecture des scripts comptait les polyfills de la balise `nomodule`, environ 39 Ko, qu'aucun navigateur qui compte ne télécharge : les chiffres ci-dessus sont recomptés.) La connexion, le tableau de bord et un événement chargent d'abord 175, 181 et 205 Ko de scripts : Zod, que deux lignes du code des langues amenaient dans toutes les pages, n'y est plus, et le code qui dessine les toasts est chargé une fois la page interactive. Le temps de blocage du tableau de bord sur téléphone passe de 236 à 165 ms et son plus grand affichage de 4,1 à 3,9 s (même machine, cinq passes chacun). Cet affichage est borné par le processeur, qui exécute les scripts quatre fois plus lentement dans ce test : seul moins de script le fait baisser ; 3,5 s demanderait une autre façon de construire les pages, et n'est pas atteint. Les vérifications d'une pull request tournent en jobs parallèles sur une image construite une seule fois (5,4
minutes, mesurées sur la pull request elle-même). Une page lit ses relations avec une jointure et la session avec une seule
requête, ce qui ramène les requêtes du tableau de bord, du calendrier et d'un événement à 2, 4 et 2 ; sur 1 CPU et 1 Go avec la
charge de 20 personnes, la plateforme répond à 7,3 à 7,4 requêtes par seconde au lieu de 6,3 à 6,6, et 95 % des réponses arrivent
en 2,9 à 3,2 s au lieu de 3,3 à 3,8 s.

Ce que disent les mesures, et qui décide où va l'effort : la base de données n'est pas le goulot (aucune page n'envoie une
requête cinq fois ou plus, aucune n'en envoie plus de 12, et une page passe 0,1 à 7 ms en base même avec cinq ans de
données) ; le processus Node.js l'est, en mémoire et en processeur. Les données grossissent lentement : le journal d'audit
écrit environ 300 octets par ligne et en compte 1 319 après deux années scolaires, et toute la base pèse 10 Mo (12,6 Mo
avec cinq ans et 1 500 membres) ; aucune purge n'est donc prévue.

**Une limite connue.** La page des membres liste tous les comptes d'un coup, sans pagination : un BDE compte quelques
dizaines de comptes (le bureau et le staff), et la page est faite pour cela. Avec 150 comptes, plus que n'en a un BDE, elle met 109 ms à se construire et pèse 64 Ko de
HTML, avec 7 requêtes et 0,6 ms en base. Avec 1 511 comptes, elle met 628 ms à se
construire et pèse 272 Ko de HTML (89 Ko avec 311 comptes, où le plus grand affichage sur téléphone est déjà de 4,6 s). Au-delà
de quelques centaines de comptes, paginez-la avant de vous y fier.

## Ce qui n'est pas couvert

Être clair là-dessus compte autant que le reste.

- **La plateforme ne limite pas le débit**, sauf sur le code de l'installateur. La connexion passe par 42 (il n'y a pas de mot de
  passe à deviner), mais rien n'empêche quelqu'un d'inonder le site : si cela vous importe, limitez-le dans votre reverse proxy
  ([Déploiement](deployment.md#3-reverse-proxy-https)). Les tests notent ce que la plateforme accepte.
- **42 et les services de messagerie sont remplacés par des doublures.** La connexion par le vrai 42 et la livraison vers un vrai
  Discord, Slack ou serveur de mail ne sont pas testées ; une doublure joue leur rôle, y compris une qui ne répond jamais.
- **Le serveur de mail** est testé contre un serveur silencieux et par des tests unitaires, pas par une plateforme qui envoie de
  vrais mails.
- **Une mise à jour depuis une plateforme installée avec l'installateur web** n'est pas jouée (il faut un navigateur) ; la suite de
  mise à jour part des fichiers de réglages de la 1.0.0 à la 1.4.0, puis les importe. Une mise à jour qui échoue
  en cours de route est couverte par le script de [mise à jour sûre](deployment.md#copie-automatique-avant-une-mise-à-jour), pas
  par cette suite.
- **La charge** est de 20 personnes à la fois, c'est-à-dire un BDE, pas tout l'intranet d'une école.
- **Les contrôles d'apparence et d'accessibilité** tournent dans Chromium (le clavier et les parcours tournent dans les trois
  moteurs) ; un lecteur d'écran ne fait pas partie des tests : axe trouve une partie de ce qui ne va pas, une personne trouve le
  reste.
- **Les formulaires sont regardés, pas remplis** par la promenade dans l'interface ; les parcours et la matrice d'accès les soumettent.

Si vous trouvez quelque chose que ces contrôles ont manqué, signalez-le (voir [Sécurité](../../SECURITY.md) pour une faille, une
issue sinon) : un défaut trouvé, c'est un test écrit.

## Le lancer vous-même

Avec Docker et Node, depuis le dossier du projet (voir aussi le [guide du contributeur](contributing.md#la-campagne-qualité)) :

```text
docker build -t bde-network .
sh qa/platform.sh up
eval "$(sh qa/platform.sh env)"
npx tsx qa/smoke.ts                 # est-elle en marche, les profils diffèrent-ils, la base tient-elle ses invariants
npx tsx qa/access/run.ts --variant events-enabled   # qui peut ouvrir quoi
npx tsx qa/security/run.ts          # les attaques
sh qa/platform.sh down
```

Les autres suites ont leurs propres commandes, écrites avec chacune dans l'architecture. Les lourdes sont faites pour l'exécution de
nuit : les chiffres qui comptent sont ceux de la CI, pas ceux d'un ordinateur.
