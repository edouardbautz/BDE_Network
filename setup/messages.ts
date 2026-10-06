/**
 * Everything the setup assistant says, in French and in English. The two catalogs have the same keys
 * (the type of `en` is the type of `fr`, and a test compares them), and a `{name}` in a text is
 * replaced by the value of that name.
 */

export type Lang = 'fr' | 'en';

const fr = {
  // ---- opening
  welcome: "Assistant d'installation de BDE_Network",
  welcomeIntro:
    "Je vais vous poser quelques questions, puis écrire la configuration à votre place : vous n'ouvrirez aucun fichier.\nÀ tout moment, Ctrl+C quitte sans rien modifier. Entrée valide la valeur proposée entre crochets.",
  existingFound:
    'Une configuration existe déjà : ses valeurs sont proposées par défaut. Rien ne sera modifié avant le récapitulatif final, et une copie de sauvegarde sera faite.',
  localConfigWarning:
    "Attention : le fichier bde.config.local.yml existe et remplace bde.config.yml quand la plateforme démarre. Les réponses de cet assistant n'auront d'effet qu'une fois ce fichier supprimé.",
  notInProject:
    "Je ne trouve pas le dossier du projet (docker-compose.yml). Lancez l'assistant depuis le dossier BDE_Network avec :\n  docker compose -f docker-compose.setup.yml run --rm --build setup",
  step: 'Étape {n}/{total} — {title}',
  invalid: '✗ {reason}',
  yes: 'oui',
  no: 'non',
  yesNoHint: 'o/n',
  answerYesNo: 'Répondez par « o » (oui) ou « n » (non).',
  chooseNumber: 'Tapez un numéro entre 1 et {max}.',
  aborted: 'Interrompu : aucun fichier n’a été modifié.',
  inputClosed: 'Plus de réponses à lire : aucun fichier n’a été modifié.',
  unexpected: 'Une erreur inattendue est survenue : {message}\nAucun fichier n’a été modifié.',

  // ---- step titles
  stepIdentity: 'Votre BDE',
  stepAddress: 'Adresse de la plateforme',
  stepOAuth: 'Application OAuth 42',
  stepCampuses: 'Campus autorisés',
  stepOwners: 'Propriétaires',
  stepModules: 'Modules',
  stepNotifications: 'Notifications',
  stepSummary: 'Récapitulatif',
  stepStart: 'Démarrage',

  // ---- identity
  askName: 'Nom du BDE (affiché dans l’interface)',
  askColor: "Couleur d'accent, en hexadécimal (ex. #0f766e)",
  askLocale: 'Langue des messages envoyés par la plateforme (e-mails, Discord, Slack)',
  localeFr: 'Français',
  localeEn: 'English',
  askTimezone: 'Fuseau horaire',
  timezoneGuessed: 'Fuseau déduit du campus {campus} : {zone}.',
  errName: 'Le nom doit faire entre 1 et 60 caractères, sans retour à la ligne.',
  errColor: 'Une couleur hexadécimale est attendue, par exemple #0f766e ou #0a8.',
  errTimezone: 'Fuseau horaire inconnu. Exemples : Europe/Paris, America/Montreal, Asia/Seoul.',

  // ---- address
  addressIntro:
    'À quelle adresse la plateforme sera-t-elle ouverte ?\n  • pour un essai sur cet ordinateur : localhost\n  • pour un vrai site : votre nom de domaine, par exemple bde.exemple.fr (il faudra un proxy HTTPS, voir docs/deployment.md)',
  askAddress: 'Adresse (localhost ou nom de domaine)',
  errAddress:
    'Adresse invalide. Écrivez localhost, localhost:3001 ou un nom de domaine comme bde.exemple.fr (sans chemin).',
  addressHttpWarning:
    'Vous avez choisi http (sans chiffrement) pour un nom de domaine : à éviter hors essai.',
  addressSummary: 'Adresse de la plateforme (APP_URL) : {url}',
  domainReminder:
    'Pour un nom de domaine, mettez un proxy HTTPS devant la plateforme : voir docs/deployment.md.',

  // ---- OAuth
  oauthIntro:
    "La connexion se fait avec les comptes 42 : il faut déclarer une « application » sur l'intra.\n\n  1. Ouvrez https://profile.intra.42.fr/oauth/applications/new\n  2. Name : le nom de votre BDE.   Type : Campus Tool.   Scopes : public (le défaut)\n  3. Website : {url}\n  4. Redirect URI — à copier exactement, sans espace ni barre finale :\n\n       {redirect}\n\n  5. Validez, puis notez l'UID et le SECRET de la page de l'application.\n\n  Le secret expire : sa date est affichée sur cette page, notez-la.",
  askClientId: 'UID de l’application (FORTYTWO_CLIENT_ID)',
  askClientSecret: 'Secret de l’application (la saisie reste invisible)',
  keepOAuth: 'Garder l’UID et le secret déjà enregistrés ?',
  verifyingOAuth: 'Vérification auprès de l’API 42…',
  oauthOk: '✓ L’API 42 accepte ces identifiants.',
  errClientId: 'L’UID est vide ou contient des espaces. Copiez-le depuis la page de l’application.',
  errClientSecret:
    'Le secret est vide, contient des espaces ou une apostrophe. Copiez-le depuis la page de l’application.',
  errSwapped:
    'Il semble que l’UID et le secret soient inversés (l’UID commence par u-, le secret par s-).',
  oauthInvalid:
    '✗ L’API 42 refuse ces identifiants (invalid_client).\n  Causes fréquentes : UID ou secret mal copiés (espace en trop, caractère manquant), secret expiré ou régénéré depuis,\n  ou UID et secret pris dans deux applications différentes. Ouvrez la page de l’application et copiez-les à nouveau.',
  oauthRateLimited:
    '✗ L’API 42 demande de patienter (trop de requêtes). Attendez une minute puis réessayez.',
  oauthNetwork:
    '✗ Impossible de joindre l’API 42 ({detail}). Vérifiez la connexion Internet de cet ordinateur.',
  oauthUnexpected: '✗ Réponse inattendue de l’API 42 (code {status}).',
  retry: 'Réessayer ?',
  keepSaved: 'Garder la valeur déjà enregistrée ?',
  continueUnverified:
    'Continuer sans vérification ? (les identifiants ne seront pas testés, et les campus seront à écrire à la main)',
  noApiNotice:
    'L’API 42 est injoignable : je continue sans la liste des campus ni la vérification.',

  // ---- campuses
  campusesIntro:
    'Choisissez les campus 42 dont les étudiants peuvent se connecter.\n  Tapez une partie du nom pour chercher (ex. nic), un numéro pour choisir, -1 pour retirer le premier choix,\n  « tous » pour accepter tous les campus, « ok » pour terminer.',
  campusesLoaded: '{count} campus trouvés.',
  askCampus: 'Campus',
  askCampusesManual: 'Campus autorisés, séparés par des virgules (laissez vide pour tous)',
  campusNone: 'Aucun campus ne correspond à « {query} ».',
  campusMatches: 'Résultats pour « {query} » (tapez un numéro) :',
  campusAdded: 'Ajouté : {name}',
  campusRemoved: 'Retiré : {name}',
  campusSelected: 'Choisis : {names}',
  campusAll: 'Tous les campus seront acceptés.',
  campusNeedOne: 'Choisissez au moins un campus (ou tapez « tous »).',
  campusAlready: '{name} est déjà dans la liste.',
  askMainCampus: 'Campus principal du bureau (affichage uniquement)',

  // ---- owners
  ownersIntro:
    "Les propriétaires gèrent tout (rôles, membres, configuration). Donnez leur login 42, celui de l'intra, en minuscules.\n  Plusieurs logins : séparez-les par des virgules.",
  askOwners: 'Login(s) 42 des propriétaires',
  errOwners:
    'Un login 42 ne contient que des lettres, des chiffres et des tirets. Exemple : jdupont',
  ownerOk: '✓ {login} existe sur l’intra 42.',
  ownerMissing: '✗ Le login « {login} » n’existe pas sur l’intra 42. Vérifiez l’orthographe.',
  ownerUnchecked:
    'Je n’ai pas pu vérifier « {login} » (API 42 indisponible). Il sera enregistré tel quel.',

  // ---- modules
  askEvents:
    'Activer le module Événements (calendrier, agenda synchronisé, rappels) ? Vous pourrez le changer plus tard.',

  // ---- notifications
  notifIntro:
    'La plateforme peut prévenir le bureau (nouvel événement, rappel, demande d’accès…). C’est facultatif.',
  askChannel: 'Où envoyer les notifications ?',
  channelDiscord: 'Discord (le plus simple : un lien à copier dans un salon)',
  channelSlack: 'Slack (demande de créer une petite application, un lien pré-rempli est fourni)',
  channelEmail: 'E-mail (il faut un serveur SMTP)',
  channelNone: 'Aucune pour l’instant',
  channelKeep: 'Garder la configuration actuelle (réglages personnalisés)',
  discordHowTo:
    'Dans Discord : Paramètres du salon → Intégrations → Webhooks → Nouveau webhook → Copier l’URL du webhook.',
  askDiscord: 'URL du webhook Discord (la saisie reste invisible)',
  errDiscord:
    'Ce n’est pas une URL de webhook Discord (elle commence par https://discord.com/api/webhooks/).',
  slackHowTo:
    'Créez l’application Slack avec ce lien (webhooks entrants, aucune autre permission), puis « Incoming Webhooks » → « Add New Webhook to Workspace » :\n\n  {link}\n',
  askSlack: 'URL du webhook Slack (la saisie reste invisible)',
  errSlack:
    'Ce n’est pas une URL de webhook Slack (elle commence par https://hooks.slack.com/services/).',
  askSmtpHost: 'Serveur SMTP (ex. smtp.gmail.com)',
  askSmtpPort: 'Port SMTP',
  askSmtpUser: 'Identifiant SMTP (vide si le serveur n’en demande pas)',
  askSmtpPassword: 'Mot de passe SMTP (la saisie reste invisible)',
  askSmtpFrom: 'Adresse d’expédition (ex. bde@exemple.fr)',
  errSmtpHost: 'Un nom de serveur est attendu (ex. smtp.gmail.com), sans http://.',
  errPort: 'Un numéro de port entre 1 et 65535 est attendu.',
  errEmail: 'Une adresse e-mail est attendue, par exemple bde@exemple.fr.',
  errSecretChars: 'Les apostrophes et les retours à la ligne ne sont pas pris en charge ici.',
  sendingTest: 'Envoi d’un message de test…',
  testSent: '✓ Message de test envoyé.',
  testFailed: '✗ Le message de test a échoué : {detail}',
  askTestReceived: 'Avez-vous bien reçu le message de test ?',
  askTestRecipient: 'Adresse qui recevra le message de test',
  testNotReceived: 'Pas reçu. Que faire ?',
  testRetry: 'Saisir à nouveau les informations',
  testSkip: 'Continuer quand même',
  smtpVerifying: 'Connexion au serveur SMTP…',
  smtpOk: '✓ Le serveur SMTP accepte la connexion.',
  testBody:
    '✅ Ceci est un message de test de BDE_Network pour « {name} ». Si vous le voyez, les notifications fonctionneront.',
  testMailSubject: 'Test BDE_Network : {name}',
  notifChosen: 'Les 5 notifications utiliseront : {channel}.',

  // ---- secrets
  secretsGenerated:
    'Le secret de session et le mot de passe de la base de données ont été générés automatiquement (ils ne sont pas affichés).',
  secretsKept:
    'Le secret de session et le mot de passe de la base de données déjà enregistrés sont conservés (les changer casserait la base existante).',

  // ---- summary
  summaryTitle: 'Voici ce qui sera écrit :',
  sumName: 'Nom du BDE',
  sumColor: 'Couleur',
  sumLocale: 'Langue des messages',
  sumTimezone: 'Fuseau horaire',
  sumUrl: 'Adresse (APP_URL)',
  sumRedirect: 'URL de redirection 42',
  sumCampuses: 'Campus autorisés',
  sumAllCampuses: 'tous',
  sumOwners: 'Propriétaires',
  sumEvents: 'Module Événements',
  sumNotifications: 'Notifications',
  sumOAuth: 'Application 42',
  sumSecret: '••• enregistré',
  sumNotSet: 'non configuré',
  sumFiles: 'Fichiers : .env (secrets, jamais commité) et bde.config.yml',
  askWrite: 'Écrire ces fichiers ?',
  cancelledAtSummary: 'Rien n’a été écrit.',
  written: '✓ Fichiers écrits : {files}',
  backedUp: 'Anciennes versions sauvegardées dans {dir}',

  // ---- start
  askStart: 'Démarrer la plateforme maintenant ?',
  starting: 'Démarrage en cours (la première fois, la construction prend quelques minutes)…',
  waitingHealthy: 'En attente que la plateforme réponde…',
  started: '✓ La plateforme est démarrée.',
  openUrl: 'Ouvrez {url} et cliquez sur « Se connecter avec 42 ».',
  ownerNext:
    'Connectez-vous avec le compte 42 d’un propriétaire : vous aurez directement tous les droits.',
  startManual:
    'Pour la démarrer vous-même, depuis le dossier du projet :\n  docker compose up --build -d',
  startUnavailable:
    'Je ne peux pas démarrer la plateforme depuis ici ({detail}). Depuis le dossier du projet :\n  docker compose up --build -d',
  startFailed:
    '✗ Le démarrage a échoué (code {code}). Relancez-le vous-même :\n  docker compose up --build -d\nPuis consultez les messages : docker compose logs app',
  startTimeout:
    'La plateforme met du temps à répondre. Vérifiez dans une minute avec : docker compose ps',
  rerunHint:
    'Pour modifier la configuration plus tard, relancez simplement la même commande : docker compose -f docker-compose.setup.yml run --rm --build setup',
  doneTitle: 'Terminé.',
};

export type Messages = typeof fr;

const en: Messages = {
  welcome: 'BDE_Network setup assistant',
  welcomeIntro:
    "I will ask a few questions, then write the configuration for you: you won't open any file.\nAt any time, Ctrl+C quits without changing anything. Enter accepts the value shown in brackets.",
  existingFound:
    'A configuration already exists: its values are offered as defaults. Nothing is changed before the final summary, and a backup copy will be made.',
  localConfigWarning:
    'Warning: the file bde.config.local.yml exists and replaces bde.config.yml when the platform starts. The answers of this assistant will only take effect once that file is removed.',
  notInProject:
    'I cannot find the project folder (docker-compose.yml). Run the assistant from the BDE_Network folder with:\n  docker compose -f docker-compose.setup.yml run --rm --build setup',
  step: 'Step {n}/{total} — {title}',
  invalid: '✗ {reason}',
  yes: 'yes',
  no: 'no',
  yesNoHint: 'y/n',
  answerYesNo: 'Answer "y" (yes) or "n" (no).',
  chooseNumber: 'Type a number between 1 and {max}.',
  aborted: 'Interrupted: no file was changed.',
  inputClosed: 'No more answers to read: no file was changed.',
  unexpected: 'An unexpected error occurred: {message}\nNo file was changed.',

  stepIdentity: 'Your BDE',
  stepAddress: 'Address of the platform',
  stepOAuth: '42 OAuth application',
  stepCampuses: 'Allowed campuses',
  stepOwners: 'Owners',
  stepModules: 'Modules',
  stepNotifications: 'Notifications',
  stepSummary: 'Summary',
  stepStart: 'Start',

  askName: 'Name of the BDE (shown in the interface)',
  askColor: 'Accent colour, in hexadecimal (e.g. #0f766e)',
  askLocale: 'Language of the messages the platform sends (e-mails, Discord, Slack)',
  localeFr: 'Français',
  localeEn: 'English',
  askTimezone: 'Time zone',
  timezoneGuessed: 'Time zone taken from the {campus} campus: {zone}.',
  errName: 'The name must be 1 to 60 characters long, on one line.',
  errColor: 'A hexadecimal colour is expected, for example #0f766e or #0a8.',
  errTimezone: 'Unknown time zone. Examples: Europe/Paris, America/Montreal, Asia/Seoul.',

  addressIntro:
    'At which address will the platform be opened?\n  • to try it on this computer: localhost\n  • for a real site: your domain name, for example bde.example.org (an HTTPS proxy is needed, see docs/deployment.md)',
  askAddress: 'Address (localhost or domain name)',
  errAddress:
    'Invalid address. Write localhost, localhost:3001 or a domain name such as bde.example.org (no path).',
  addressHttpWarning:
    'You chose http (not encrypted) for a domain name: avoid it outside a try-out.',
  addressSummary: 'Address of the platform (APP_URL): {url}',
  domainReminder:
    'For a domain name, put an HTTPS proxy in front of the platform: see docs/deployment.md.',

  oauthIntro:
    'Sign-in uses 42 accounts: an "application" must be declared on the intra.\n\n  1. Open https://profile.intra.42.fr/oauth/applications/new\n  2. Name: your BDE name.   Type: Campus Tool.   Scopes: public (the default)\n  3. Website: {url}\n  4. Redirect URI — copy it exactly, no space and no trailing slash:\n\n       {redirect}\n\n  5. Submit, then note the UID and the SECRET on the application page.\n\n  The secret expires: its date is shown on that page, write it down.',
  askClientId: 'Application UID (FORTYTWO_CLIENT_ID)',
  askClientSecret: 'Application secret (typing stays invisible)',
  keepOAuth: 'Keep the UID and secret already saved?',
  verifyingOAuth: 'Checking with the 42 API…',
  oauthOk: '✓ The 42 API accepts these credentials.',
  errClientId: 'The UID is empty or contains spaces. Copy it from the application page.',
  errClientSecret:
    'The secret is empty, or contains spaces or an apostrophe. Copy it from the application page.',
  errSwapped: 'The UID and the secret look swapped (the UID starts with u-, the secret with s-).',
  oauthInvalid:
    '✗ The 42 API rejects these credentials (invalid_client).\n  Frequent causes: UID or secret badly copied (extra space, missing character), secret expired or regenerated since,\n  or UID and secret taken from two different applications. Open the application page and copy them again.',
  oauthRateLimited: '✗ The 42 API asks you to wait (too many requests). Wait a minute and retry.',
  oauthNetwork:
    '✗ Cannot reach the 42 API ({detail}). Check the Internet connection of this computer.',
  oauthUnexpected: '✗ Unexpected answer from the 42 API (code {status}).',
  retry: 'Retry?',
  keepSaved: 'Keep the value already saved?',
  continueUnverified:
    'Continue without checking? (the credentials will not be tested, and campuses must be typed by hand)',
  noApiNotice: 'The 42 API is unreachable: I continue without the campus list or the check.',

  campusesIntro:
    'Choose the 42 campuses whose students can sign in.\n  Type part of a name to search (e.g. nic), a number to choose, -1 to remove the first choice,\n  "all" to accept every campus, "ok" to finish.',
  campusesLoaded: '{count} campuses found.',
  askCampus: 'Campus',
  askCampusesManual: 'Allowed campuses, separated by commas (leave empty for all)',
  campusNone: 'No campus matches "{query}".',
  campusMatches: 'Results for "{query}" (type a number):',
  campusAdded: 'Added: {name}',
  campusRemoved: 'Removed: {name}',
  campusSelected: 'Chosen: {names}',
  campusAll: 'Every campus will be accepted.',
  campusNeedOne: 'Choose at least one campus (or type "all").',
  campusAlready: '{name} is already in the list.',
  askMainCampus: "The BDE's main campus (display only)",

  ownersIntro:
    'Owners manage everything (roles, members, configuration). Give their 42 login, the one from the intra, in lower case.\n  Several logins: separate them with commas.',
  askOwners: '42 login(s) of the owners',
  errOwners: 'A 42 login only has letters, digits and dashes. Example: jdupont',
  ownerOk: '✓ {login} exists on the 42 intra.',
  ownerMissing: '✗ The login "{login}" does not exist on the 42 intra. Check the spelling.',
  ownerUnchecked: 'I could not check "{login}" (42 API unavailable). It will be saved as typed.',

  askEvents:
    'Turn on the Events module (calendar, synced agenda, reminders)? You can change this later.',

  notifIntro:
    'The platform can notify the board (new event, reminder, access request…). It is optional.',
  askChannel: 'Where should notifications go?',
  channelDiscord: 'Discord (simplest: one link to copy from a channel)',
  channelSlack: 'Slack (needs a small app, a pre-filled link is provided)',
  channelEmail: 'E-mail (needs an SMTP server)',
  channelNone: 'None for now',
  channelKeep: 'Keep the current settings (customised)',
  discordHowTo:
    'In Discord: Channel settings → Integrations → Webhooks → New webhook → Copy webhook URL.',
  askDiscord: 'Discord webhook URL (typing stays invisible)',
  errDiscord:
    'That is not a Discord webhook URL (it starts with https://discord.com/api/webhooks/).',
  slackHowTo:
    'Create the Slack app with this link (incoming webhooks, no other permission), then "Incoming Webhooks" → "Add New Webhook to Workspace":\n\n  {link}\n',
  askSlack: 'Slack webhook URL (typing stays invisible)',
  errSlack: 'That is not a Slack webhook URL (it starts with https://hooks.slack.com/services/).',
  askSmtpHost: 'SMTP server (e.g. smtp.gmail.com)',
  askSmtpPort: 'SMTP port',
  askSmtpUser: 'SMTP username (empty if the server asks for none)',
  askSmtpPassword: 'SMTP password (typing stays invisible)',
  askSmtpFrom: 'Sender address (e.g. bde@example.org)',
  errSmtpHost: 'A server name is expected (e.g. smtp.gmail.com), without http://.',
  errPort: 'A port number between 1 and 65535 is expected.',
  errEmail: 'An e-mail address is expected, for example bde@example.org.',
  errSecretChars: 'Apostrophes and line breaks are not supported here.',
  sendingTest: 'Sending a test message…',
  testSent: '✓ Test message sent.',
  testFailed: '✗ The test message failed: {detail}',
  askTestReceived: 'Did you receive the test message?',
  askTestRecipient: 'Address that will receive the test message',
  testNotReceived: 'Not received. What now?',
  testRetry: 'Enter the details again',
  testSkip: 'Continue anyway',
  smtpVerifying: 'Connecting to the SMTP server…',
  smtpOk: '✓ The SMTP server accepts the connection.',
  testBody:
    '✅ This is a BDE_Network test message for "{name}". If you can see it, notifications will work.',
  testMailSubject: 'BDE_Network test: {name}',
  notifChosen: 'The 5 notifications will use: {channel}.',

  secretsGenerated:
    'The session secret and the database password were generated automatically (they are not displayed).',
  secretsKept:
    'The session secret and the database password already saved are kept (changing them would break the existing database).',

  summaryTitle: 'This is what will be written:',
  sumName: 'BDE name',
  sumColor: 'Colour',
  sumLocale: 'Message language',
  sumTimezone: 'Time zone',
  sumUrl: 'Address (APP_URL)',
  sumRedirect: '42 redirect URL',
  sumCampuses: 'Allowed campuses',
  sumAllCampuses: 'all',
  sumOwners: 'Owners',
  sumEvents: 'Events module',
  sumNotifications: 'Notifications',
  sumOAuth: '42 application',
  sumSecret: '••• saved',
  sumNotSet: 'not configured',
  sumFiles: 'Files: .env (secrets, never committed) and bde.config.yml',
  askWrite: 'Write these files?',
  cancelledAtSummary: 'Nothing was written.',
  written: '✓ Files written: {files}',
  backedUp: 'Previous versions saved in {dir}',

  askStart: 'Start the platform now?',
  starting: 'Starting (the first time, the build takes a few minutes)…',
  waitingHealthy: 'Waiting for the platform to answer…',
  started: '✓ The platform is running.',
  openUrl: 'Open {url} and click "Sign in with 42".',
  ownerNext: 'Sign in with the 42 account of an owner: you will directly have every right.',
  startManual: 'To start it yourself, from the project folder:\n  docker compose up --build -d',
  startUnavailable:
    'I cannot start the platform from here ({detail}). From the project folder:\n  docker compose up --build -d',
  startFailed:
    '✗ Starting failed (code {code}). Start it yourself:\n  docker compose up --build -d\nThen read the messages: docker compose logs app',
  startTimeout: 'The platform is slow to answer. Check again in a minute with: docker compose ps',
  rerunHint:
    'To change the configuration later, simply run the same command again: docker compose -f docker-compose.setup.yml run --rm --build setup',
  doneTitle: 'Done.',
};

export const catalogs: Record<Lang, Messages> = { fr, en };

export type MessageKey = keyof Messages;

/** A function that writes a message of the chosen language, replacing `{name}` by its value. */
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function translator(lang: Lang): Translate {
  const catalog = catalogs[lang];
  return (key, values = {}) =>
    catalog[key].replace(/\{(\w+)\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match,
    );
}
