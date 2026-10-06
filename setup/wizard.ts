import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Answers, Channel, NotificationAnswers, SmtpAnswers } from './answers';
import { planStart, startPlatform, tail, waitHealthy, type Runner } from './docker';
import {
  envChanges,
  envTemplate,
  generateAuthSecret,
  generatePassword,
  readExisting,
  renderConfig,
  renderEnv,
  writeFiles,
  type ExistingState,
} from './files';
import {
  checkLogin,
  listCampuses,
  searchCampuses,
  verifyCredentials,
  type Campus,
  type FetchLike,
  type Sleep,
} from './fortytwo';
import type { Lang, MessageKey } from './messages';
import {
  sendDiscordTest,
  sendSlackTest,
  sendTestMail,
  verifySmtp,
  type TestResult,
  type TransportFactory,
} from './notify-test';
import type { Prompts } from './prompts';
import {
  redirectUrl,
  validateAddress,
  validateClientId,
  validateClientSecret,
  validateColor,
  validateDiscordWebhook,
  validateEmail,
  validateLogins,
  validateName,
  validateOptionalText,
  validatePort,
  validateSecretText,
  validateSlackWebhook,
  validateSmtpHost,
  validateTimezone,
  type Check,
} from './validate';

export interface WizardDeps {
  prompts: Prompts;
  /** The folder of the project, where docker-compose.yml, .env and bde.config.yml live. */
  projectDir: string;
  fetchFn: FetchLike;
  sleep: Sleep;
  transport: TransportFactory;
  run: Runner;
  /** The id of the container the assistant runs in, to start the platform from it. */
  containerId: string | undefined;
  /** The time zone of this computer, when it is known (inside a container it usually is not). */
  guessTimezone: () => string | undefined;
  now: () => Date;
  /** The pre-filled Slack link of the documentation, or null when the manifest is not there. */
  slackLink: () => string | null;
  startTimeoutMs: number;
}

const TOTAL_STEPS = 9;
const PLACEHOLDER_LOGIN = 'votre-login-42';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** What the person already decided in an earlier run: the defaults of every question. */
interface Defaults {
  lang?: Lang;
  name?: string;
  accentColor?: string;
  messageLocale?: Lang;
  timezone?: string;
  campuses: string[];
  mainCampus?: string;
  owners: string[];
  events?: boolean;
  appUrl?: string;
  clientId?: string;
  clientSecret?: string;
  authSecret?: string;
  postgresPassword?: string;
  channel?: Channel | 'mixed';
}

/** The bde.config.yml that ships with the project: placeholders, not decisions of this BDE. */
function isShippedTemplate(config: Record<string, unknown> | null): boolean {
  const owners =
    isRecord(config?.auth) && Array.isArray(config.auth.owners) ? config.auth.owners : [];
  return owners.length === 1 && owners[0] === PLACEHOLDER_LOGIN;
}

/** Whether an earlier run (or a hand edit) already decided something: the shipped template does not count. */
export function hasPriorConfiguration(existing: ExistingState): boolean {
  const decided = (key: string) => {
    const value = existing.env.get(key)?.trim();
    return Boolean(value) && value !== 'change-me';
  };
  return (
    (existing.config !== null && !isShippedTemplate(existing.config)) ||
    decided('FORTYTWO_CLIENT_ID') ||
    decided('AUTH_SECRET')
  );
}

function defaultsFrom(existing: ExistingState): Defaults {
  // The template that ships with the project holds placeholders, which are no defaults worth offering.
  const config = isShippedTemplate(existing.config) ? null : existing.config;
  const bde = isRecord(config?.bde) ? config.bde : {};
  const auth = isRecord(config?.auth) ? config.auth : {};
  const modules = isRecord(config?.modules) ? config.modules : {};
  const notifications = isRecord(config?.notifications) ? config.notifications : {};

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  const locale = text(bde.defaultLocale);
  const env = (key: string): string | undefined => {
    const value = existing.env.get(key)?.trim();
    return value && value !== 'change-me' ? value : undefined;
  };

  const channels = Object.values(notifications).filter(
    (v): v is string => v === 'email' || v === 'discord' || v === 'slack' || v === 'none',
  );
  const distinct = new Set(channels);

  return {
    ...(locale === 'fr' || locale === 'en' ? { lang: locale, messageLocale: locale } : {}),
    ...(text(bde.name) ? { name: text(bde.name) } : {}),
    ...(text(bde.accentColor) ? { accentColor: text(bde.accentColor) } : {}),
    ...(text(bde.timezone) ? { timezone: text(bde.timezone) } : {}),
    ...(text(bde.campus) ? { mainCampus: text(bde.campus) } : {}),
    campuses: strings(auth.allowedCampuses),
    owners: strings(auth.owners).filter((login) => login !== PLACEHOLDER_LOGIN),
    ...(config ? { events: strings(modules.enabled).includes('events') } : {}),
    ...(env('APP_URL') ? { appUrl: env('APP_URL') } : {}),
    ...(env('FORTYTWO_CLIENT_ID') ? { clientId: env('FORTYTWO_CLIENT_ID') } : {}),
    ...(env('FORTYTWO_CLIENT_SECRET') ? { clientSecret: env('FORTYTWO_CLIENT_SECRET') } : {}),
    ...((env('AUTH_SECRET') ?? '').length >= 32 ? { authSecret: env('AUTH_SECRET') } : {}),
    ...(env('POSTGRES_PASSWORD') ? { postgresPassword: env('POSTGRES_PASSWORD') } : {}),
    ...(distinct.size === 1
      ? { channel: [...distinct][0] as Channel }
      : distinct.size > 1
        ? { channel: 'mixed' as const }
        : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Steps

/** Campuses: search by name, choose by number, remove, "all". Returns the names ([] = every campus). */
export async function selectCampuses(
  p: Prompts,
  campuses: readonly Campus[],
  preselected: readonly string[],
): Promise<string[]> {
  // The campuses chosen before, in the order they were chosen (names are compared without the case).
  const chosen: Campus[] = preselected.flatMap((name) => {
    const found = campuses.find(
      (campus) => campus.name.toLowerCase() === name.trim().toLowerCase(),
    );
    return found ? [found] : [];
  });
  let matches: Campus[] = [];
  const show = () =>
    p.say(
      p.t('campusSelected', { names: chosen.map((c, i) => `[${i + 1}] ${c.name}`).join(', ') }),
    );
  if (chosen.length > 0) show();

  for (;;) {
    const input = (await p.reader.readLine(`${p.t('askCampus')}: `)).trim();
    const lower = input.toLowerCase();

    if (lower === 'ok' || (input === '' && chosen.length > 0)) {
      if (chosen.length > 0) return chosen.map((campus) => campus.name);
      p.say(p.t('campusNeedOne'));
    } else if (['tous', 'tout', 'all', '*'].includes(lower)) {
      p.say(p.t('campusAll'));
      return [];
    } else if (/^-\d+$/.test(input)) {
      const removed = chosen.splice(Number(input.slice(1)) - 1, 1)[0];
      if (removed) {
        p.say(p.t('campusRemoved', { name: removed.name }));
        if (chosen.length > 0) show();
      }
    } else if (/^\d+(\s*,\s*\d+)*$/.test(input) && matches.length > 0) {
      const picked = input
        .split(',')
        .map((n) => matches[Number(n.trim()) - 1])
        .filter((campus): campus is Campus => campus !== undefined);
      if (picked.length === 0) {
        p.say(p.t('chooseNumber', { max: matches.length }));
        continue; // the list stays: the person can choose again
      }
      for (const campus of picked) {
        if (chosen.some((c) => c.id === campus.id)) {
          p.say(p.t('campusAlready', { name: campus.name }));
        } else {
          chosen.push(campus);
          p.say(p.t('campusAdded', { name: campus.name }));
        }
      }
      matches = [];
      if (chosen.length > 0) show();
    } else if (input !== '') {
      matches = searchCampuses(campuses, input).slice(0, 12);
      if (matches.length === 0) {
        p.say(p.t('campusNone', { query: input }));
      } else if (matches.length === 1 && matches[0]) {
        const [only] = matches;
        if (!chosen.some((c) => c.id === only.id)) {
          chosen.push(only);
          p.say(p.t('campusAdded', { name: only.name }));
        } else {
          p.say(p.t('campusAlready', { name: only.name }));
        }
        matches = [];
        show();
      } else {
        p.say(p.t('campusMatches', { query: input }));
        matches.forEach((campus, index) =>
          p.say(`  ${index + 1}) ${campus.name}${campus.country ? ` (${campus.country})` : ''}`),
        );
      }
    }
  }
}

/** Whether a test message arrived: asks, and when it did not, lets the person retry or go on. */
async function confirmDelivery(p: Prompts, result: TestResult): Promise<'done' | 'retry' | 'skip'> {
  if (result.ok) {
    p.say(p.t('testSent'));
    return (await p.confirm(p.t('askTestReceived'), true)) ? 'done' : askRetry(p);
  }
  p.say(p.t('testFailed', { detail: result.detail }));
  return askRetry(p);
}

async function askRetry(p: Prompts): Promise<'retry' | 'skip'> {
  return p.choose(
    p.t('testNotReceived'),
    [
      { value: 'retry' as const, label: p.t('testRetry') },
      { value: 'skip' as const, label: p.t('testSkip') },
    ],
    0,
  );
}

async function askWebhook(
  p: Prompts,
  kind: 'discord' | 'slack',
  name: string,
  saved: string | undefined,
  deps: WizardDeps,
): Promise<string> {
  const validate = kind === 'discord' ? validateDiscordWebhook : validateSlackWebhook;
  p.say(
    kind === 'discord'
      ? p.t('discordHowTo')
      : p.t('slackHowTo', { link: deps.slackLink() ?? 'docs/notifications.md' }),
  );
  const send = kind === 'discord' ? sendDiscordTest : sendSlackTest;
  for (let attempt = 0; ; attempt++) {
    let url: string;
    if (attempt === 0 && saved && validate(saved).ok && (await p.confirm(p.t('keepSaved'), true))) {
      url = saved;
    } else {
      url = await p.ask(p.t(kind === 'discord' ? 'askDiscord' : 'askSlack'), validate, {
        secret: true,
      });
    }
    p.say(p.t('sendingTest'));
    const outcome = await confirmDelivery(
      p,
      await send(deps.fetchFn, url, p.t('testBody', { name })),
    );
    if (outcome !== 'retry') return url;
  }
}

async function askSmtp(
  p: Prompts,
  name: string,
  existing: ExistingState,
  deps: WizardDeps,
): Promise<SmtpAnswers> {
  const env = existing.env;
  for (let attempt = 0; ; attempt++) {
    const host = await p.ask(p.t('askSmtpHost'), validateSmtpHost, {
      default: env.get('SMTP_HOST'),
    });
    const port = await p.ask(p.t('askSmtpPort'), validatePort, {
      default: env.get('SMTP_PORT') || '587',
    });
    const user = await p.ask(p.t('askSmtpUser'), validateOptionalText, {
      default: env.get('SMTP_USER') ?? '',
    });
    let password = '';
    const savedPassword = env.get('SMTP_PASSWORD');
    if (user) {
      password =
        attempt === 0 && savedPassword && (await p.confirm(p.t('keepSaved'), true))
          ? savedPassword
          : await p.ask(p.t('askSmtpPassword'), validateSecretText, { secret: true });
    }
    const from = await p.ask(p.t('askSmtpFrom'), validateEmail, {
      default: env.get('SMTP_FROM') ?? (user.includes('@') ? user : undefined),
    });
    const smtp: SmtpAnswers = { host, port, user, password, from };

    p.say(p.t('smtpVerifying'));
    const verified = await verifySmtp(deps.transport, smtp);
    if (!verified.ok) {
      p.say(p.t('testFailed', { detail: verified.detail }));
      if ((await askRetry(p)) === 'retry') continue;
      return smtp;
    }
    p.say(p.t('smtpOk'));

    const to = await p.ask(p.t('askTestRecipient'), validateEmail);
    p.say(p.t('sendingTest'));
    const sent = await sendTestMail(
      deps.transport,
      smtp,
      to,
      p.t('testMailSubject', { name }),
      p.t('testBody', { name }),
    );
    if ((await confirmDelivery(p, sent)) !== 'retry') return smtp;
  }
}

async function askNotifications(
  p: Prompts,
  name: string,
  existing: ExistingState,
  defaults: Defaults,
  deps: WizardDeps,
): Promise<NotificationAnswers> {
  p.say(p.t('notifIntro'));
  const options: Array<{ value: Channel | 'keep'; label: string }> = [
    { value: 'discord', label: p.t('channelDiscord') },
    { value: 'slack', label: p.t('channelSlack') },
    { value: 'email', label: p.t('channelEmail') },
    { value: 'none', label: p.t('channelNone') },
    ...(defaults.channel === 'mixed'
      ? [{ value: 'keep' as const, label: p.t('channelKeep') }]
      : []),
  ];
  const wanted = defaults.channel === 'mixed' ? 'keep' : (defaults.channel ?? 'none');
  const mode = await p.choose(
    p.t('askChannel'),
    options,
    Math.max(
      0,
      options.findIndex((option) => option.value === wanted),
    ),
  );

  if (mode === 'discord') {
    return {
      mode,
      discordWebhook: await askWebhook(
        p,
        'discord',
        name,
        existing.env.get('DISCORD_WEBHOOK_URL'),
        deps,
      ),
    };
  }
  if (mode === 'slack') {
    return {
      mode,
      slackWebhook: await askWebhook(p, 'slack', name, existing.env.get('SLACK_WEBHOOK_URL'), deps),
    };
  }
  if (mode === 'email') return { mode, smtp: await askSmtp(p, name, existing, deps) };
  return { mode };
}

// ---------------------------------------------------------------------------------------------
// The whole assistant

const channelLabel = (p: Prompts, mode: NotificationAnswers['mode']): string =>
  p
    .t(
      mode === 'discord'
        ? 'channelDiscord'
        : mode === 'slack'
          ? 'channelSlack'
          : mode === 'email'
            ? 'channelEmail'
            : mode === 'keep'
              ? 'channelKeep'
              : 'channelNone',
    )
    .replace(/\s*\(.*$/, '');

/**
 * Runs the assistant from the first question to the optional start. Everything is collected in memory;
 * the files are written once, at the end, after the summary is confirmed.
 */
export async function runWizard(deps: WizardDeps): Promise<void> {
  const p = deps.prompts;
  const existing = readExisting(deps.projectDir);
  const defaults = defaultsFrom(existing);

  // ---- language
  const lang = await p.choose<Lang>(
    'Langue / Language',
    [
      { value: 'fr', label: 'Français' },
      { value: 'en', label: 'English' },
    ],
    defaults.lang === 'en' ? 1 : 0,
  );
  p.setLanguage(lang);

  p.say();
  p.say(p.t('welcome'));
  p.say(p.t('welcomeIntro'));
  if (hasPriorConfiguration(existing)) p.say(`\n${p.t('existingFound')}`);
  if (existing.hasLocalConfig) p.say(`\n${p.t('localConfigWarning')}`);

  // ---- 1. identity
  p.step(1, TOTAL_STEPS, 'stepIdentity');
  const name = await p.ask(p.t('askName'), validateName, { default: defaults.name });
  const accentColor = await p.ask(p.t('askColor'), validateColor, {
    default: defaults.accentColor ?? '#0f766e',
  });
  const messageLocale = await p.choose<Lang>(
    p.t('askLocale'),
    [
      { value: 'fr', label: p.t('localeFr') },
      { value: 'en', label: p.t('localeEn') },
    ],
    (defaults.messageLocale ?? lang) === 'en' ? 1 : 0,
  );

  // ---- 2. address
  p.step(2, TOTAL_STEPS, 'stepAddress');
  p.say(p.t('addressIntro'));
  const address = await p.ask(p.t('askAddress'), validateAddress, {
    default: defaults.appUrl ?? 'localhost',
  });
  p.say(p.t('addressSummary', { url: address.url }));
  if (address.insecureDomain) p.say(p.t('addressHttpWarning'));
  if (!address.isLocal) p.say(p.t('domainReminder'));

  // ---- 3. 42 OAuth application
  p.step(3, TOTAL_STEPS, 'stepOAuth');
  p.say(p.t('oauthIntro', { url: address.url, redirect: redirectUrl(address.url) }));

  let clientId = '';
  let clientSecret = '';
  let token: string | null = null;
  let reuseSaved =
    Boolean(defaults.clientId && defaults.clientSecret) &&
    (await p.confirm(p.t('keepOAuth'), true));
  for (;;) {
    if (reuseSaved && defaults.clientId && defaults.clientSecret) {
      clientId = defaults.clientId;
      clientSecret = defaults.clientSecret;
    } else {
      clientId = await p.ask(p.t('askClientId'), validateClientId);
      clientSecret = await p.ask(p.t('askClientSecret'), validateClientSecret, { secret: true });
    }

    p.say(p.t('verifyingOAuth'));
    const check = await verifyCredentials(deps.fetchFn, clientId, clientSecret);
    if (check.ok) {
      p.say(p.t('oauthOk'));
      token = check.token;
      break;
    }
    reuseSaved = false;
    if (check.reason === 'invalid') {
      p.say(p.t('oauthInvalid'));
      continue;
    }
    p.say(
      check.reason === 'rate-limited'
        ? p.t('oauthRateLimited')
        : check.reason === 'network'
          ? p.t('oauthNetwork', { detail: check.detail })
          : p.t('oauthUnexpected', { status: check.status }),
    );
    if (await p.confirm(p.t('retry'), true)) continue;
    if (await p.confirm(p.t('continueUnverified'), false)) break;
  }

  // ---- 4. campuses (and the time zone they give)
  p.step(4, TOTAL_STEPS, 'stepCampuses');
  let campusList: Campus[] | null = null;
  if (token) {
    campusList = await listCampuses(deps.fetchFn, token, deps.sleep);
    if (!campusList || campusList.length === 0) {
      campusList = null;
      p.say(p.t('noApiNotice'));
    }
  } else {
    p.say(p.t('noApiNotice'));
  }

  let campuses: string[];
  if (campusList) {
    p.say(p.t('campusesLoaded', { count: campusList.length }));
    p.say(p.t('campusesIntro'));
    campuses = await selectCampuses(p, campusList, defaults.campuses);
  } else {
    campuses = await p.ask(
      p.t('askCampusesManual'),
      (input): Check<string[]> => ({
        ok: true,
        value: input
          .split(/[,;]+/)
          .map((entry) => entry.trim())
          .filter(Boolean),
      }),
      { default: defaults.campuses.join(', ') },
    );
  }

  let mainCampus: string;
  if (campuses.length === 1 && campuses[0]) {
    mainCampus = campuses[0];
  } else if (campuses.length > 1) {
    mainCampus = await p.choose(
      p.t('askMainCampus'),
      campuses.map((campusName) => ({ value: campusName, label: campusName })),
      Math.max(0, campuses.indexOf(defaults.mainCampus ?? '')),
    );
  } else {
    mainCampus = await p.ask(p.t('askMainCampus'), validateName, { default: defaults.mainCampus });
  }

  const campusZone = campusList?.find((c) => c.name === mainCampus)?.timeZone;
  if (campusZone && !defaults.timezone)
    p.say(p.t('timezoneGuessed', { campus: mainCampus, zone: campusZone }));
  const timezone = await p.ask(p.t('askTimezone'), validateTimezone, {
    default: defaults.timezone ?? campusZone ?? deps.guessTimezone() ?? 'Europe/Paris',
  });

  // ---- 5. owners
  p.step(5, TOTAL_STEPS, 'stepOwners');
  p.say(p.t('ownersIntro'));
  let owners: string[];
  for (;;) {
    owners = await p.ask(p.t('askOwners'), validateLogins, {
      default: defaults.owners.length > 0 ? defaults.owners.join(', ') : undefined,
    });
    let missing = false;
    if (!token) {
      for (const login of owners) p.say(p.t('ownerUnchecked', { login }));
    } else {
      for (const login of owners) {
        const verdict = await checkLogin(deps.fetchFn, token, login, deps.sleep);
        if (verdict === 'exists') p.say(p.t('ownerOk', { login }));
        else if (verdict === 'missing') {
          p.say(p.t('ownerMissing', { login }));
          missing = true;
        } else p.say(p.t('ownerUnchecked', { login }));
      }
    }
    if (!missing) break;
  }

  // ---- 6. modules
  p.step(6, TOTAL_STEPS, 'stepModules');
  const events = await p.confirm(p.t('askEvents'), defaults.events ?? true);

  // ---- 7. notifications
  p.step(7, TOTAL_STEPS, 'stepNotifications');
  const notifications = await askNotifications(p, name, existing, defaults, deps);
  p.say(p.t('notifChosen', { channel: channelLabel(p, notifications.mode) }));

  // ---- secrets: generated, or the ones already saved (changing them would break the database)
  const authSecret = defaults.authSecret ?? generateAuthSecret();
  const postgresPassword = defaults.postgresPassword ?? generatePassword();
  p.say(
    `\n${p.t(defaults.authSecret && defaults.postgresPassword ? 'secretsKept' : 'secretsGenerated')}`,
  );

  const answers: Answers = {
    lang,
    name,
    accentColor,
    messageLocale,
    timezone,
    address,
    clientId,
    clientSecret,
    campuses,
    mainCampus,
    owners,
    events,
    notifications,
    authSecret,
    postgresPassword,
  };

  // ---- 8. summary (no secret on screen)
  p.step(8, TOTAL_STEPS, 'stepSummary');
  p.say(p.t('summaryTitle'));
  const row = (label: MessageKey, value: string) => p.say(`  ${p.t(label).padEnd(26)} ${value}`);
  row('sumName', name);
  row('sumColor', accentColor);
  row('sumLocale', messageLocale === 'fr' ? p.t('localeFr') : p.t('localeEn'));
  row('sumTimezone', timezone);
  row('sumUrl', address.url);
  row('sumRedirect', redirectUrl(address.url));
  row('sumCampuses', campuses.length > 0 ? campuses.join(', ') : p.t('sumAllCampuses'));
  row('sumOwners', owners.join(', '));
  row('sumEvents', events ? p.t('yes') : p.t('no'));
  row('sumNotifications', channelLabel(p, notifications.mode));
  row('sumOAuth', token ? `${p.t('sumSecret')}` : p.t('sumNotSet'));
  p.say(`\n  ${p.t('sumFiles')}`);

  if (!(await p.confirm(`\n${p.t('askWrite')}`, true))) {
    p.say(p.t('cancelledAtSummary'));
    return;
  }

  const envText = renderEnv(
    existing.envText ?? envTemplate(deps.projectDir),
    envChanges(answers, existing.env),
  );
  const configText = renderConfig(answers, existing.config);
  const result = writeFiles(deps.projectDir, { env: envText, config: configText }, deps.now());
  p.say(p.t('written', { files: result.written.join(', ') || '—' }));
  if (result.backupDir) p.say(p.t('backedUp', { dir: result.backupDir }));

  // ---- 9. start
  p.step(9, TOTAL_STEPS, 'stepStart');
  if (!(await p.confirm(p.t('askStart'), true))) {
    p.say(p.t('startManual'));
  } else {
    const plan = await planStart(
      deps.run,
      deps.containerId,
      existing.env.get('COMPOSE_PROJECT_NAME'),
    );
    if (!plan.ok) {
      p.say(p.t('startUnavailable', { detail: plan.detail }));
    } else {
      p.say(p.t('starting'));
      const started = await startPlatform(deps.run, plan, () => p.reader.write('.'));
      p.say();
      if (started.code !== 0) {
        p.say(tail(started.stdout));
        p.say(p.t('startFailed', { code: started.code }));
      } else {
        p.say(p.t('waitingHealthy'));
        const healthy = await waitHealthy(deps.run, plan.project, {
          timeoutMs: deps.startTimeoutMs,
          intervalMs: 3000,
          sleep: deps.sleep,
        });
        if (healthy) {
          p.say(`\n${p.t('started')}`);
          p.say(p.t('openUrl', { url: address.url }));
          p.say(p.t('ownerNext'));
        } else {
          p.say(p.t('startTimeout'));
        }
      }
    }
  }

  p.say(`\n${p.t('rerunHint')}`);
  p.say(`\n${p.t('doneTitle')}`);
}

/** Whether `dir` is the project folder (the assistant refuses to write anywhere else). */
export function isProjectDir(dir: string): boolean {
  return existsSync(join(dir, 'docker-compose.yml'));
}
