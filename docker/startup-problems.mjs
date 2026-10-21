// What the container does when it cannot start: tell the problem apart, and say it in the browser.
//
// Pure functions only (no process, no network), used by start.mjs and unit-tested. Plain JavaScript on
// purpose: it runs before the application, in an image that has `node` and nothing else.
//
// Nothing a person typed ever reaches the page: it is made of fixed sentences, a problem kind from a
// closed list, a Prisma error code (P1000...) and the NAMES of the .env variables to check.

/** Exit code of the application when its configuration is unusable (EX_CONFIG): start.mjs reads
 * "report.json" to know which one, instead of restarting the container in a loop. */
export const EXIT_CONFIG = 78;

/** Values that must never be printed, in a log or on a page. */
const SECRET_VARIABLES = [
  'AUTH_SECRET',
  'SETTINGS_KEY',
  'FORTYTWO_CLIENT_SECRET',
  'POSTGRES_PASSWORD',
  'DATABASE_URL',
  'SMTP_PASSWORD',
  'DISCORD_WEBHOOK_URL',
  'SLACK_WEBHOOK_URL',
];

/** The text with every secret of the environment, and any database address, replaced by `***`. */
export function redact(text, env) {
  let result = String(text);
  for (const name of SECRET_VARIABLES) {
    const value = env[name];
    if (typeof value !== 'string' || value.length < 4) continue;
    for (const variant of new Set([value, encodeURIComponent(value)])) {
      result = result.split(variant).join('***');
    }
  }
  return result.replace(/postgres(?:ql)?:\/\/\S*/gi, 'postgresql://***');
}

/** The address of the bundled PostgreSQL, from its three settings. Each part is encoded: a password with
 * `@`, `/` or `:` used to cut the address in the wrong place (and Prisma printed bits of it in the logs). */
export function buildDatabaseUrl(env) {
  const { POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: database } = env;
  if (!user || !password || !database) return '';
  const encode = encodeURIComponent;
  return `postgresql://${encode(user)}:${encode(password)}@postgres:5432/${encode(database)}?schema=public`;
}

/**
 * Which problem a failed `prisma migrate deploy` is, from what it printed. `retry` is true when waiting
 * can fix it by itself (the database is not there yet).
 */
export function classifyMigrationFailure(output) {
  const code = /\bP\d{4}\b/.exec(output)?.[0] ?? '';
  const text = String(output);

  if (['P1000', 'P1003', 'P1010'].includes(code)) {
    return { kind: 'database-auth', code, retry: true };
  }
  if (
    ['P1001', 'P1002', 'P1008', 'P1017'].includes(code) ||
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH/.test(text)
  ) {
    return { kind: 'database-unreachable', code, retry: true };
  }
  if (
    ['P1012', 'P1013'].includes(code) ||
    /datasource\.url|DATABASE_URL|Connection url is empty/i.test(text)
  ) {
    return { kind: 'database-url', code, retry: false };
  }
  return { kind: 'migration', code, retry: false };
}

/** The report the application leaves when its configuration is unusable, checked field by field. */
export function parseReport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || !['env', 'config', 'existing-data'].includes(data.kind)) return null;
  const variables = Array.isArray(data.variables)
    ? data.variables
        .filter((name) => typeof name === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(name))
        .slice(0, 20)
    : [];
  return { kind: data.kind, code: '', retry: false, variables };
}

// ---------------------------------------------------------------------------------------------
// The terminal

const NETWORK_LINE = /^\s*-\s*Network:\s+https?:\/\/0\.0\.0\.0/;
const LOCAL_LINE = /^(\s*-\s*Local:\s+)https?:\/\/\S+\s*$/;

/**
 * A line of the application's own start-up banner, as the terminal should show it. Next.js prints the address
 * the server LISTENS on (`Network: http://0.0.0.0:3000`, which nobody can open) and the port inside the
 * container; the person at the keyboard needs the address of their browser: `http://localhost:<host port>`.
 * Returns null for a line to leave out.
 */
export function terminalLine(line, hostPort) {
  if (NETWORK_LINE.test(line)) return null;
  return line.replace(LOCAL_LINE, `$1http://localhost:${hostPort}`);
}

// ---------------------------------------------------------------------------------------------
// The page

/** How long a page that waits for the database waits before it asks again. */
export const RETRY_SECONDS = 15;

const PROBLEMS = {
  env: {
    icon: 'alert',
    fr: {
      title: 'Un réglage du fichier .env est à corriger',
      description:
        "La plateforme ne peut pas démarrer : au moins une valeur du fichier .env est manquante ou invalide. Aucune donnée n'est perdue.",
      steps: [
        'Ouvrez le fichier `.env` dans le dossier du projet et corrigez les réglages indiqués ci-dessous.',
        'Relancez la plateforme : `docker compose up -d`.',
        'Le détail de chaque réglage est donné par `docker compose logs app`.',
      ],
    },
    en: {
      title: 'A setting in the .env file needs fixing',
      description:
        'The platform cannot start: at least one value in the .env file is missing or invalid. No data is lost.',
      steps: [
        'Open the `.env` file in the project folder and fix the settings listed below.',
        'Start the platform again: `docker compose up -d`.',
        'Each setting is explained by `docker compose logs app`.',
      ],
    },
  },
  config: {
    icon: 'alert',
    fr: {
      title: 'Le fichier bde.config.yml est à corriger',
      description:
        "La plateforme ne peut pas démarrer : le fichier bde.config.yml est absent, vide ou invalide. Aucune donnée n'est perdue.",
      steps: [
        'Corrigez le fichier `bde.config.yml` dans le dossier du projet.',
        'Reconstruisez et relancez : `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.',
        'La ligne à corriger est donnée par `docker compose logs app`.',
      ],
    },
    en: {
      title: 'The bde.config.yml file needs fixing',
      description:
        'The platform cannot start: the bde.config.yml file is missing, empty or invalid. No data is lost.',
      steps: [
        'Fix the `bde.config.yml` file in the project folder.',
        'Rebuild and start again: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.',
        'The line to fix is given by `docker compose logs app`.',
      ],
    },
  },
  'database-auth': {
    icon: 'database',
    fr: {
      title: 'La base de données refuse la connexion',
      description:
        "Le mot de passe (ou le nom d'utilisateur, ou le nom de la base) que la plateforme utilise n'est pas celui avec lequel la base a été créée. C'est le cas quand le volume « secrets » a été supprimé ou remplacé, ou quand `POSTGRES_PASSWORD` a été changé après coup : cela ne change pas le mot de passe d'une base qui existe déjà. Vos données sont intactes.",
      steps: [
        'Si vous avez une sauvegarde du volume « secrets », restaurez-la (`scripts/restore.sh --secrets`).',
        'Sinon, remettez dans `.env` les valeurs de départ de `POSTGRES_USER`, `POSTGRES_PASSWORD` et `POSTGRES_DB`, puis relancez : `docker compose up -d`.',
      ],
    },
    en: {
      title: 'The database refuses the connection',
      description:
        'The password (or user name, or database name) the platform uses is not the one the database was created with. This happens when the "secrets" volume was deleted or replaced, or when `POSTGRES_PASSWORD` was changed afterwards: that does not change the password of a database that already exists. Your data is intact.',
      steps: [
        'If you have a backup of the "secrets" volume, restore it (`scripts/restore.sh --secrets`).',
        'Otherwise put the original values of `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` back in `.env`, then start again: `docker compose up -d`.',
      ],
    },
  },
  'database-unreachable': {
    icon: 'database',
    fr: {
      title: 'La base de données ne répond pas',
      description:
        "La plateforme attend sa base de données. Après un redémarrage du serveur, c'est normal pendant une minute. Cette page se rafraîchit toute seule et la plateforme repart dès que la base répond. Vos données ne sont pas perdues.",
      steps: [
        'Si cela dure plus de quelques minutes : `docker compose ps`, puis `docker compose logs postgres`.',
        "Vérifiez aussi que le disque du serveur n'est pas plein.",
      ],
    },
    en: {
      title: 'The database is not answering',
      description:
        'The platform is waiting for its database. After a server restart this is normal for about a minute. This page refreshes by itself and the platform starts as soon as the database answers. Your data is not lost.',
      steps: [
        'If it lasts more than a few minutes: `docker compose ps`, then `docker compose logs postgres`.',
        "Also check that the server's disk is not full.",
      ],
    },
  },
  'database-url': {
    icon: 'database',
    fr: {
      title: "L'adresse de la base de données est invalide",
      description:
        'La plateforme ne sait pas se connecter à sa base : `DATABASE_URL` est absente ou mal écrite (un `@`, `:`, `/`, `?` ou `#` du mot de passe doit y être encodé).',
      steps: [
        "Souvent, l'image est plus ancienne que `docker-compose.yml` : téléchargez la bonne avec `docker compose pull`, puis `docker compose up -d` (image construite par vous-même : `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`).",
        'Avec le `docker-compose.yml` fourni, supprimez `DATABASE_URL` de `.env` : elle est construite à partir de `POSTGRES_USER`, `POSTGRES_PASSWORD` et `POSTGRES_DB`.',
        'Relancez la plateforme : `docker compose up -d`.',
      ],
    },
    en: {
      title: 'The database address is invalid',
      description:
        'The platform does not know how to reach its database: `DATABASE_URL` is missing or badly written (an `@`, `:`, `/`, `?` or `#` in the password must be encoded there).',
      steps: [
        'Often the image is older than `docker-compose.yml`: download the right one with `docker compose pull`, then `docker compose up -d` (image built by yourself: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`).',
        'With the provided `docker-compose.yml`, remove `DATABASE_URL` from `.env`: it is built from `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`.',
        'Start the platform again: `docker compose up -d`.',
      ],
    },
  },
  'stack-old-compose': {
    icon: 'alert',
    fr: {
      title: "docker-compose.yml est plus ancien que l'image",
      description:
        "L'image de la plateforme attend un docker-compose.yml plus récent que celui du dossier. Aucune donnée n'est touchée.",
      steps: [
        'Mettez à jour le dossier du projet : `git pull`.',
        'Relancez : `docker compose up -d`.',
        'Si vous avez modifié `docker-compose.yml` vous-même, reportez vos changements dans la nouvelle version (guide de mise à jour).',
      ],
    },
    en: {
      title: 'docker-compose.yml is older than the image',
      description:
        "The platform's image expects a newer docker-compose.yml than the one in the folder. No data is touched.",
      steps: [
        'Update the project folder: `git pull`.',
        'Start again: `docker compose up -d`.',
        'If you edited `docker-compose.yml` yourself, carry your changes over to the new version (upgrading guide).',
      ],
    },
  },
  'stack-old-image': {
    icon: 'alert',
    fr: {
      title: "L'image est plus ancienne que docker-compose.yml",
      description:
        "Le docker-compose.yml du dossier est plus récent que l'image qui tourne : l'ancienne image est restée en place (typiquement une image construite sur place, qu'un `git pull` ne remplace pas). Aucune donnée n'est touchée.",
      steps: [
        "Téléchargez l'image de ce dossier : `docker compose pull`, puis `docker compose up -d`.",
        "Si vous construisez l'image vous-même : `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.",
        'Suivez le guide de mise à jour : il décrit la bonne suite de commandes.',
      ],
    },
    en: {
      title: 'The image is older than docker-compose.yml',
      description:
        'The docker-compose.yml in the folder is newer than the image that is running: the old image stayed in place (typically an image built on the spot, which a `git pull` does not replace). No data is touched.',
      steps: [
        'Download the image of this folder: `docker compose pull`, then `docker compose up -d`.',
        'If you build the image yourself: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.',
        'Follow the upgrading guide: it gives the right sequence of commands.',
      ],
    },
  },
  'database-newer': {
    icon: 'database',
    fr: {
      title: 'La base de données est plus récente que cette version',
      description:
        "La base contient des mises à jour que cette version de la plateforme ne connaît pas : une version plus récente l'a utilisée. La plateforme reste arrêtée plutôt que de risquer d'abîmer vos données, qui sont intactes.",
      steps: [
        "Si vous êtes revenu volontairement à une ancienne version : restaurez d'abord la copie faite avant la mise à jour (`./scripts/restore.sh --pre-update`), sans quoi elle ne peut pas lire la base.",
        "Sinon, c'est l'image qui est trop ancienne : reprenez la version récente (`git pull`, puis `docker compose up -d`).",
        'Ne supprimez pas le volume de la base.',
      ],
    },
    en: {
      title: 'The database is newer than this version',
      description:
        'The database holds updates that this version of the platform does not know: a newer version has used it. The platform stays stopped rather than risk damaging your data, which is intact.',
      steps: [
        'If you went back to an older version on purpose: first restore the copy made before the update (`./scripts/restore.sh --pre-update`), otherwise it cannot read the database.',
        'Otherwise the image is too old: take the recent version again (`git pull`, then `docker compose up -d`).',
        'Do not delete the database volume.',
      ],
    },
  },
  'migration-stuck': {
    icon: 'database',
    fr: {
      title: 'Une mise à jour précédente de la base est restée inachevée',
      description:
        "Une mise à jour de la base de données a échoué auparavant et l'a laissée dans un état que la plateforme refuse de reprendre à l'aveugle.",
      steps: [
        'Ne supprimez rien. Notez les migrations indiquées ci-dessous.',
        "Restaurez la copie d'avant la mise à jour (`./scripts/restore.sh --pre-update`), puis relancez : `docker compose up -d`.",
        'Signalez le problème avec le détail de `docker compose logs app`.',
      ],
    },
    en: {
      title: 'An earlier update of the database was left unfinished',
      description:
        'An update of the database failed earlier and left it in a state the platform refuses to carry on from blindly.',
      steps: [
        'Do not delete anything. Write down the migrations listed below.',
        'Restore the copy made before the update (`./scripts/restore.sh --pre-update`), then start again: `docker compose up -d`.',
        'Report the problem with the details from `docker compose logs app`.',
      ],
    },
  },
  'migration-restored': {
    icon: 'database',
    fr: {
      title: 'La mise à jour a échoué : votre base a été remise comme avant',
      description:
        "Une étape de la mise à jour de la base de données a échoué. La plateforme a remis la base dans l'état exact où elle était juste avant, à partir de la copie indiquée ci-dessous, et reste arrêtée. Vos données sont intactes.",
      steps: [
        'Revenez à la version précédente de la plateforme (guide de mise à jour, « Revenir en arrière ») : elle redémarre avec vos données.',
        'Signalez le problème avec le code ci-dessous et le détail de `docker compose logs app`.',
        'La copie reste dans le volume « backups » (`./scripts/restore.sh --pre-update` la restaure).',
      ],
    },
    en: {
      title: 'The update failed: your database was put back as it was',
      description:
        'A step of the database update failed. The platform put the database back in the exact state it was in just before, from the copy shown below, and stays stopped. Your data is intact.',
      steps: [
        'Go back to the previous version of the platform (upgrading guide, "Rolling back"): it starts again with your data.',
        'Report the problem with the code below and the details from `docker compose logs app`.',
        'The copy stays in the "backups" volume (`./scripts/restore.sh --pre-update` restores it).',
      ],
    },
  },
  'migration-restore-failed': {
    icon: 'alert',
    fr: {
      title: "La mise à jour a échoué et la base n'a pas pu être remise comme avant",
      description:
        "Une étape de la mise à jour a échoué, puis la remise en état automatique a échoué à son tour. La copie d'avant la mise à jour est conservée : rien n'est perdu.",
      steps: [
        'Ne relancez pas la plateforme avant la restauration.',
        'Restaurez la copie indiquée ci-dessous : `./scripts/restore.sh --pre-update`.',
        'Signalez le problème avec le détail de `docker compose logs app`.',
      ],
    },
    en: {
      title: 'The update failed and the database could not be put back as it was',
      description:
        'A step of the update failed, then the automatic put-back failed in turn. The copy made before the update is kept: nothing is lost.',
      steps: [
        'Do not start the platform before the restore.',
        'Restore the copy shown below: `./scripts/restore.sh --pre-update`.',
        'Report the problem with the details from `docker compose logs app`.',
      ],
    },
  },
  'backup-failed': {
    icon: 'database',
    fr: {
      title: 'La copie de sécurité avant mise à jour a échoué',
      description:
        "Par prudence, la mise à jour de la base de données n'a pas été appliquée : la plateforme reste arrêtée et n'a rien modifié.",
      steps: [
        "Vérifiez l'espace libre du serveur (la copie est faite dans le volume « backups »), puis relancez : `docker compose up -d`.",
        "Pour appliquer la mise à jour sans cette copie (à vos risques : faites d'abord `./scripts/backup.sh`), ajoutez `BDE_SKIP_BACKUP=1` dans `.env`.",
        'Le détail est donné par `docker compose logs app`.',
      ],
    },
    en: {
      title: 'The safety copy before the update failed',
      description:
        'To be safe, the database update was not applied: the platform stays stopped and has changed nothing.',
      steps: [
        'Check the server\'s free space (the copy is made in the "backups" volume), then start again: `docker compose up -d`.',
        'To apply the update without this copy (at your own risk: run `./scripts/backup.sh` first), add `BDE_SKIP_BACKUP=1` to `.env`.',
        'The details are given by `docker compose logs app`.',
      ],
    },
  },
  'existing-data': {
    icon: 'alert',
    fr: {
      title: "Des données existent, mais aucun réglage n'est enregistré",
      description:
        "La base contient déjà des comptes, mais ni réglages enregistrés ni fichier de configuration complet n'ont été trouvés (typiquement une plateforme installée avant l'installateur, démarrée avec l'image publiée, qui ne contient pas votre bde.config.yml). L'installateur n'est pas ouvert : il remplacerait vos réglages. Aucune donnée n'est touchée.",
      steps: [
        "Placez votre `bde.config.yml` et votre `.env` d'origine dans le dossier du projet.",
        "Construisez l'image sur place : `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build` : ils sont alors importés dans la base, une seule fois.",
        "Voir « Si votre plateforme date d'avant l'installateur » dans le guide de mise à jour.",
      ],
    },
    en: {
      title: 'Data exists, but no settings are saved',
      description:
        'The database already holds accounts, but neither saved settings nor a complete configuration file were found (typically a platform installed before the installer, started with the published image, which does not contain your bde.config.yml). The installer is not opened: it would replace your settings. No data is touched.',
      steps: [
        'Put your original `bde.config.yml` and `.env` in the project folder.',
        'Build the image on the spot: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`: they are then imported into the database, once.',
        'See "If your platform predates the installer" in the upgrading guide.',
      ],
    },
  },
  migration: {
    icon: 'database',
    fr: {
      title: 'La mise à jour de la base de données a échoué',
      description:
        "La plateforme n'a pas pu préparer sa base de données. Elle reste arrêtée plutôt que de travailler sur une base dans un état incertain.",
      steps: [
        'Ne supprimez rien. Notez le code affiché ci-dessous.',
        'Lisez le détail : `docker compose logs app`.',
        'Au besoin, restaurez la dernière sauvegarde (voir docs/fr/deployment.md, « Sauvegardes et restauration »).',
      ],
    },
    en: {
      title: 'The database update failed',
      description:
        'The platform could not prepare its database. It stays stopped rather than working on a database in an uncertain state.',
      steps: [
        'Do not delete anything. Write down the code shown below.',
        'Read the details: `docker compose logs app`.',
        'If needed, restore the latest backup (see docs/en/deployment.md, "Backups and restore").',
      ],
    },
  },
};

/** The title of a problem, for the logs. */
export function problemTitle(kind, lang) {
  const text = PROBLEMS[kind] ?? PROBLEMS.migration;
  return (text[lang] ?? text.fr).title;
}

const LABELS = {
  fr: {
    operator: 'Pour la personne qui gère le serveur',
    visitor:
      "Si ce n'est pas vous, prévenez-la : la plateforme sera de nouveau disponible dès que ce sera corrigé.",
    variables: 'Réglages à vérifier',
    code: "Code d'erreur",
    backup: 'Copie de sécurité',
    migrations: 'Migrations concernées',
    version: 'Version de la plateforme',
    waiting: 'Nouvelle tentative automatique dans quelques secondes.',
    switchTo: 'English',
    switchLang: 'en',
  },
  en: {
    operator: 'For the person who runs the server',
    visitor:
      'If that is not you, let them know: the platform will be available again as soon as this is fixed.',
    variables: 'Settings to check',
    code: 'Error code',
    backup: 'Safety copy',
    migrations: 'Migrations involved',
    version: 'Platform version',
    waiting: 'Trying again automatically in a few seconds.',
    switchTo: 'Français',
    switchLang: 'fr',
  },
};

const ICONS = {
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
};

/** The tokens of src/app/globals.css (a test keeps them equal), so that this page looks like the app. */
export const PAGE_STYLE = `
:root{color-scheme:light dark;--background:oklch(0.985 0.002 258);--foreground:oklch(0.19 0.012 258);--card:oklch(1 0 0);--muted:oklch(0.96 0.003 258);--muted-foreground:oklch(0.48 0.012 258);--border:oklch(0.84 0.006 258);--destructive:oklch(0.505 0.213 27.518);--radius:0.5rem}
@media (prefers-color-scheme:dark){:root{--background:oklch(0.16 0.014 258);--foreground:oklch(0.96 0.006 258);--card:oklch(0.205 0.014 258);--muted:oklch(0.225 0.013 258);--muted-foreground:oklch(0.68 0.014 258);--border:oklch(0.34 0.015 258);--destructive:oklch(0.704 0.191 22.216)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:var(--background);color:var(--foreground);font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:32rem;background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius)*1.4);padding:1.5rem}
.icon{display:flex;width:2.5rem;height:2.5rem;margin:0 auto .75rem;align-items:center;justify-content:center;border-radius:9999px;background:var(--muted);color:var(--muted-foreground)}
.icon.alert{color:var(--destructive)}
h1{margin:0;text-align:center;font-size:1.25rem;font-weight:600;letter-spacing:-.025em}
.lead{margin:.5rem 0 0;text-align:center;font-size:.875rem;color:var(--muted-foreground)}
h2{margin:1.5rem 0 .5rem;font-size:.875rem;font-weight:600}
ol{margin:0;padding-left:1.25rem;font-size:.875rem}
li{margin:.25rem 0}
code{padding:.1rem .35rem;border-radius:calc(var(--radius)*.6);background:var(--muted);font-family:ui-monospace,monospace;font-size:.8125rem}
.meta{margin:.75rem 0 0;font-size:.875rem}
.small{margin:1rem 0 0;font-size:.75rem;color:var(--muted-foreground)}
.wait{margin:1rem 0 0;text-align:center;font-size:.875rem;color:var(--muted-foreground)}
a{color:var(--muted-foreground);text-underline-offset:4px}
a:hover,a:focus-visible{color:var(--foreground)}
a:focus-visible{outline:2px solid var(--muted-foreground);outline-offset:2px;border-radius:2px}
footer{margin-top:1rem;text-align:center;font-size:.75rem}
`.trim();

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** A sentence with `code` spans, escaped. */
const inline = (text) =>
  escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);

/** "fr" or "en": `?lang=` first, then the browser's preference, French by default. */
export function pickLanguage(url, acceptLanguage) {
  const asked = /[?&]lang=(fr|en)\b/.exec(url ?? '')?.[1];
  if (asked) return asked;
  const header = String(acceptLanguage ?? '').toLowerCase();
  const fr = header.indexOf('fr');
  const en = header.indexOf('en');
  return en !== -1 && (fr === -1 || en < fr) ? 'en' : 'fr';
}

const BACKUP_FILE = /^pre-update_\d{8}T\d{6}Z_v[0-9A-Za-z.+-]{1,40}\.sql\.gz$/;
const MIGRATION_NAME = /^[0-9]{14}_[A-Za-z0-9_]{1,80}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,40}$/;

/** The page for a problem: `{ kind, code, variables }`, in `lang`. `retry` makes it ask again by itself. */
export function renderProblemPage(problem, lang, retry) {
  const text = PROBLEMS[problem.kind] ?? PROBLEMS.migration;
  const copy = text[lang] ?? text.fr;
  const labels = LABELS[lang] ?? LABELS.fr;
  const variables = (problem.variables ?? []).filter((name) => /^[A-Z][A-Z0-9_]{1,63}$/.test(name));
  const code = /^P\d{4}$/.test(problem.code ?? '') ? problem.code : '';

  const refresh = retry ? `<meta http-equiv="refresh" content="${RETRY_SECONDS}">` : '';
  const variablesBlock =
    variables.length > 0
      ? `<p class="meta"><strong>${escapeHtml(labels.variables)}</strong> : ${variables
          .map((name) => `<code>${escapeHtml(name)}</code>`)
          .join(', ')}</p>`
      : '';
  const codeBlock = code
    ? `<p class="meta"><strong>${escapeHtml(labels.code)}</strong> : <code>${code}</code></p>`
    : '';
  // Only what looks like what the supervisor writes goes on the page: a file name of ours, migration names, a version.
  const backup = BACKUP_FILE.test(problem.backup ?? '') ? problem.backup : '';
  const migrations = (problem.migrations ?? [])
    .filter((name) => MIGRATION_NAME.test(name))
    .slice(0, 5);
  const version = VERSION.test(problem.version ?? '') ? problem.version : '';
  const facts = [
    backup &&
      `<p class="meta"><strong>${escapeHtml(labels.backup)}</strong> : <code>${escapeHtml(backup)}</code></p>`,
    migrations.length > 0 &&
      `<p class="meta"><strong>${escapeHtml(labels.migrations)}</strong> : ${migrations.map((name) => `<code>${escapeHtml(name)}</code>`).join(', ')}</p>`,
    version &&
      `<p class="meta"><strong>${escapeHtml(labels.version)}</strong> : <code>${escapeHtml(version)}</code></p>`,
  ]
    .filter(Boolean)
    .join('\n');

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${refresh}
<title>${escapeHtml(copy.title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<div class="icon ${text.icon === 'alert' ? 'alert' : ''}"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[text.icon]}</svg></div>
<h1>${inline(copy.title)}</h1>
<p class="lead">${inline(copy.description)}</p>
<h2>${escapeHtml(labels.operator)}</h2>
<ol>${copy.steps.map((step) => `<li>${inline(step)}</li>`).join('')}</ol>
${variablesBlock}
${facts}
${codeBlock}
<p class="small">${escapeHtml(labels.visitor)}</p>
${retry ? `<p class="wait" role="status">${escapeHtml(labels.waiting)}</p>` : ''}
<footer><a href="?lang=${labels.switchLang}" lang="${labels.switchLang}">${escapeHtml(labels.switchTo)}</a></footer>
</main>
</body>
</html>
`;
}
