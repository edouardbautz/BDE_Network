# Système de design

Ce document décrit le système visuel de BDE_Network : typographie, couleurs, espacement,
composants, navigation, états d'interface et accessibilité. Il sert de référence unique pour que
les futurs modules (événements, finances, réunions…) restent cohérents avec l'existant sans
qu'il faille le redemander.

Direction générale : sobre et fonctionnel, dans l'esprit de Linear, Vercel ou Notion. Pas
d'effets visuels superflus (dégradés décoratifs, ombres marquées, glassmorphism prononcé,
animations gratuites). La hiérarchie vient de la typographie, de l'espacement et d'un usage
discipliné de la couleur d'accent — jamais d'artifices.

## Typographie

Une seule famille de police, sans empattement : **Geist** (`next/font/google`), chargée dans
`src/app/[locale]/layout.tsx` et exposée via la variable CSS `--font-geist-sans`. `--font-sans`
dans `src/app/globals.css` pointe explicitement dessus (`var(--font-geist-sans), ui-sans-serif,
system-ui, sans-serif`) — **ne jamais la laisser s'auto-référencer** (`--font-sans: var(--font-
sans)`), ce bug silencieux fait retomber tout le site sur la police serif par défaut du
navigateur sans qu'aucune erreur ne soit levée. `--font-heading` réutilise `--font-sans` : il n'y
a qu'une seule famille de police dans toute l'application, y compris pour les titres.

Échelle utilisée (classes Tailwind, pas de valeurs ad hoc) :

| Usage                                               | Classe                                             | Taille / interligne |
| --------------------------------------------------- | -------------------------------------------------- | ------------------- |
| Titre de page (`h1`)                                | `text-2xl font-semibold tracking-tight`            | 24px / 32px         |
| Titre de carte (`CardTitle`, `h2` de section)       | `text-base font-medium` ou `text-sm font-semibold` | 16px ou 14px        |
| Corps de texte                                      | `text-sm`                                          | 14px / 20px         |
| Texte secondaire (`text-muted-foreground`)          | `text-sm` ou `text-xs`                             | 14px ou 12px        |
| Code / valeurs machine (clé d'action d'audit, etc.) | `<code>` + `text-xs`                               | 12px                |

Un `h1` par page, dans un `<div>` qui porte aussi le sous-titre (`text-muted-foreground text-sm
mt-1`). Ne pas sauter de niveaux de titre.

## Couleurs

Palette neutre en OKLCH, teinte `258` (un bleu très discret), chroma quasi nulle. **Jamais de
noir ou blanc pur** en thème sombre — voir `:root` et `.dark` dans `src/app/globals.css`. La
teinte 258 est appliquée uniformément à tous les tokens neutres (fond, surface, bordure, texte)
pour que l'ensemble reste cohérent optiquement, y compris quand une carte se superpose à une
autre surface.

Trois niveaux d'élévation en thème sombre, du plus profond au plus clair : `--background` (0.16)
< `--card`/`--sidebar` (~0.19–0.21) < `--popover` (0.225). En thème clair : `--background`
(0.985, légèrement grisé) < `--card`/`--popover` (blanc pur, 1.0) — le blanc pur n'apparaît que
pour les surfaces flottantes, jamais pour le fond de page.

Tous les composants `src/components/ui/*` consomment ces tokens via les classes Tailwind
générées (`bg-background`, `text-foreground`, `border-border`, `bg-sidebar`, etc.) — **ne jamais
coder une couleur en dur** (`bg-black`, `#fff`, `zinc-800`…) dans un composant ou une page.
Changer la palette se fait à un seul endroit : `src/app/globals.css`.

### Couleur d'accent

`bde.config.yml`'s `bde.accentColor` pilote `--primary`, `--ring`, `--sidebar-primary` et
`--sidebar-ring` via `buildAccentStyle()` (`src/lib/color.ts`), injecté comme style inline sur
`<body>`. Cette couleur est arbitraire (choisie par chaque BDE) : **elle ne doit jamais porter du
texte directement sur une grande surface ou comme seule couleur de texte** — son contraste n'est
garanti que pour du texte blanc/noir sur un remplissage plein (c'est ce que fait
`getContrastingTextColor`), pas pour un texte de couleur accent posé sur un fond neutre
quelconque.

Règle : l'accent sert aux **actions principales** (bouton `default`) et aux **états actifs**
(lien de nav actif, item sélectionné), jamais aux grandes surfaces (pas de fond de page ni de
carte teinté accent). Pour un état actif, préférer :

- un fond translucide (`bg-primary/10`) — le texte reste `text-foreground`/`text-sidebar-
foreground`, jamais `text-primary` directement (un accent sombre sur fond sombre peut tomber
  sous 4.5:1 — vérifié pour le teal par défaut : 3.4:1 en thème sombre, insuffisant) ;
- une icône colorée en accent (rôle décoratif/redondant, pas seule porteuse de sens) ;
- une barre verticale de 2px en accent (voir la nav active dans `app-shell.tsx`).

### Contraste (WCAG AA)

Chaque paire de tokens a été vérifiée en convertissant OKLCH → sRGB linéaire → luminance
relative WCAG avant d'être choisie (script jetable, valeurs ci-dessous) :

| Paire                                  | Clair | Sombre |
| -------------------------------------- | ----- | ------ |
| `foreground` / `background`            | 17.7  | 17.3   |
| `foreground` / `card`                  | 18.5  | 16.0   |
| `muted-foreground` / `background`      | 6.3   | 6.7    |
| `muted-foreground` / `card` ou `muted` | 5.8   | 6.2    |
| `destructive` (texte) / `background`   | 4.6   | 6.7    |

Minimum requis : 4.5:1 pour du texte normal, 3:1 pour du grand texte/UI. Toute nouvelle paire
texte/fond doit être vérifiée de la même façon avant d'être ajoutée — en particulier si un futur
module introduit une nouvelle couleur sémantique (succès, avertissement…).

Les bordures (`--border`, `--input`) sont **volontairement subtiles** (~1.3–1.7:1, sous le seuil
3:1 de la 1.4.11 pour les limites de composants) — choix délibéré pour l'esthétique "bordures
discrètes" demandée. En contrepartie, tous les éléments interactifs ont un anneau de focus net
(`focus-visible:ring-3 focus-visible:ring-ring/50`) et une différence de fond suffisante
(carte/surface vs. page) pour rester repérables sans dépendre de la bordure seule.

## Espacement

Grille stricte de 4px (l'espacement par défaut de Tailwind : `spacing(1) = 4px`). Ne pas
introduire de valeurs arbitraires (`px-[13px]`) — composer avec l'échelle existante (`1, 1.5, 2,
2.5, 3, 4, 6, 8…`). Repères utilisés dans l'app :

- `gap-0.5`/`gap-1` : éléments très rapprochés (icône + label dans un item de nav).
- `gap-2`/`gap-2.5` : intérieur d'un composant (icône + texte, avatar + nom).
- `gap-4`/`gap-6` : entre blocs d'une même section (`flex flex-col gap-6` = layout standard
  d'une page).
- `gap-8` : entre grandes sections d'une page (tableau de bord).
- `p-3`/`p-4` : padding interne des cartes/panneaux (`--card-spacing` vaut `--spacing(4)` par
  défaut, `--spacing(3)` en variante `sm`).
- `px-4 py-6 sm:px-6 md:px-8 md:py-8` : padding du conteneur `<main>` (`app-shell.tsx`).

## Rayons

`--radius: 0.5rem` (8px) dans `globals.css`, décliné en `--radius-sm` (≈5px) jusqu'à
`--radius-4xl` (≈21px). Cartes et panneaux utilisent `rounded-xl` (`--radius-lg`, 8px), les
contrôles (bouton, input, badge) des rayons plus petits. Ne pas mélanger des rayons hors échelle.

## Composants

- **Cartes** (`src/components/ui/card.tsx`) : bordure subtile via `ring-1 ring-foreground/10`
  (s'adapte automatiquement à la surface sous-jacente, clair comme sombre), pas d'ombre portée
  marquée. C'est le conteneur par défaut pour tout bloc de contenu structuré.
- **États vides** : icône dans un cercle `bg-muted text-muted-foreground` (taille `size-10`,
  icône `size-5`), puis un titre (`text-sm font-medium`) et une description
  (`text-muted-foreground text-sm`), et une action optionnelle. Voir le bloc "aucun module activé"
  du tableau de bord (`dashboard/page.tsx`) ou l'état vide du journal d'audit
  (`audit-log/page.tsx`). Une carte sans donnée ne doit **jamais** rester silencieuse — elle
  explique ce qui manque et, si pertinent, quoi faire ensuite.
- **Chargement** : un fichier `loading.tsx` par route qui affiche des `Skeleton` reproduisant la
  forme réelle du contenu (mêmes cartes, mêmes proportions de lignes de tableau) — jamais un
  simple spinner générique. Voir `dashboard/loading.tsx`, `members/loading.tsx`,
  `audit-log/loading.tsx`.
- **Tableaux** : colonnes secondaires (login, campus, date) en `text-muted-foreground` pour
  hiérarchiser visuellement la colonne principale (nom, acteur).
- **Confirmations** (`src/components/confirm-dialog.tsx`, sur la primitive `ui/dialog.tsx`) :
  **toute action destructive ou irréversible** (retirer, refuser, supprimer, annuler une
  occurrence, régénérer ou désactiver un lien, changer le rôle d'un membre…) demande d'abord
  confirmation dans **une fenêtre de dialogue centrée par-dessus la page**, jamais dans un bloc
  déplié sous l'élément (il se retrouve hors de l'écran et change la mise en page). Un seul
  composant, `ConfirmDialog` : ne pas réécrire de `<details>` ni de popover maison.
  - Contenu : un **titre** qui nomme l'action et la cible (« Retirer Jean du BDE ? »), **une
    phrase** qui dit ce qui se passe et ce qui ne peut pas être annulé (sans répéter le titre),
    un bouton d'action en style **destructif** dont le libellé est un verbe précis (« Retirer
    définitivement », jamais « OK » ni « Oui »), et **Annuler**. `tone="default"` pour un
    changement réversible (changer un rôle).
  - Comportement garanti par le composant : le focus démarre sur **Annuler** (jamais sur le
    bouton destructif), il est **piégé** dans la fenêtre, **Échap** et le clic à l'extérieur
    annulent, et le focus **retourne** sur le bouton d'origine (ou sur le menu, avec
    `returnFocusRef`). Pendant l'envoi, le bouton d'action est occupé (icône qui tourne,
    `aria-busy`), ne peut pas être pressé deux fois, et la fenêtre ne peut plus être fermée.
  - Usage : `<ConfirmDialog title description confirmLabel onConfirm>Libellé du bouton</ConfirmDialog>`.
    Depuis un Server Component, `onConfirm` est une action serveur (`async () => { 'use server'; … }`) ;
    elle peut rediriger, la fenêtre reste occupée jusqu'à la navigation. Sans bouton (menu
    déroulant, raccourci), passer `open`, `onOpenChange` et `returnFocusRef`.
  - Ne demandent **pas** de confirmation : les actions réversibles en un clic (rétablir une
    date, définir le rôle par défaut, copier un lien). Un refus qui n'a rien à confirmer
    (supprimer un rôle encore attribué) s'explique par un message, pas par une fenêtre.

## Navigation

Barre latérale fixe sur desktop (`md:` et plus, 240px, `aside` dans `app-shell.tsx`), tiroir
(`Sheet` shadcn/Base UI, côté gauche) sur mobile, ouvert depuis une barre supérieure compacte
(56px) contenant le déclencheur, le logo et le nom du BDE. Le contenu de la nav (liens, menu
utilisateur, bascule de thème) est identique dans les deux — seul le conteneur change.

- L'item actif : fond `bg-primary/10`, texte `text-sidebar-foreground` (jamais `text-primary`
  directement, voir la note sur le contraste ci-dessus), icône `text-primary`, barre verticale
  de 2px en accent à gauche (`before:bg-primary`).
- Chaque item associe un `id` (`NavItem['id']`) à une icône Lucide via `NAV_ICONS` dans
  `app-shell.tsx` — un nouveau module qui ajoute une entrée de nav de premier niveau doit étendre
  ce type et cette table, pas ajouter une icône en dur dans le JSX.
- Menu utilisateur et bascule de thème vivent en bas de la nav (desktop et mobile), jamais dans
  le contenu de page.

## États d'interaction

- **Survol** : `hover:bg-muted`/`hover:bg-accent`/`hover:bg-sidebar-accent` selon le contexte —
  jamais de changement de couleur de texte seul, toujours un fond qui bouge.
- **Focus clavier** : `focus-visible:ring-3 focus-visible:ring-ring/50` sur tout élément
  interactif custom (liens de nav, liens de bas de page, `BrandMark`) ; les composants shadcn/
  Base UI (`Button`, `Input`, `Select`…) l'ont déjà intégré, ne pas le retirer.
- **Lien d'évitement** : `app-shell.tsx` inclut un lien "aller au contenu" (`sr-only` sauf au
  focus) ciblant `#main-content`. À conserver sur toute future refonte de layout.
- **Chargement** et **vide** : voir la section Composants ci-dessus.

## Accessibilité

- Contraste AA vérifié pour tout le texte (voir tableau plus haut) ; à revérifier pour toute
  nouvelle couleur sémantique.
- Un seul `h1` par page, hiérarchie de titres sans saut de niveau.
- Navigation clavier complète : tous les contrôles interactifs sont des éléments natifs
  (`button`, `a`) ou des primitives Base UI qui gèrent focus trap / `Escape` (menus, tiroir
  mobile, fenêtres de confirmation) sans code additionnel.
- `lang` posé sur `<html>` selon la locale active (`[locale]/layout.tsx`).
- Toute image décorative (logo) a un `alt=""` explicite ; tout bouton icône seul a un
  `aria-label` traduit (voir `ThemeToggle`, le déclencheur du tiroir mobile).

## Pour les futurs modules

1. Ne jamais coder une couleur en dur — utiliser les tokens sémantiques existants
   (`background`, `card`, `muted`, `border`, `primary`…). Si un token manque (ex. "succès",
   "avertissement"), l'ajouter dans `globals.css` avec la même teinte 258 et vérifier son
   contraste avant de l'utiliser.
2. Respecter la grille d'espacement 4px et l'échelle de rayons existante.
3. Toute nouvelle route sous `(app)/` ajoute son propre `loading.tsx` avec des `Skeleton`
   fidèles à sa mise en page réelle.
4. Toute liste/tableau qui peut être vide implémente le motif "état vide" (icône + titre +
   description [+ action]), jamais une page blanche.
5. Un nouveau module visible dans la nav principale étend `NavItem['id']` et `NAV_ICONS` dans
   `app-shell.tsx`.
6. La couleur d'accent (`bde.accentColor`) reste réservée aux actions principales et aux états
   actifs — jamais aux grandes surfaces, jamais comme seule couleur de texte sur un fond neutre.
7. Toute action destructive ou irréversible passe par `ConfirmDialog` (voir « Confirmations »).
