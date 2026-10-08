// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bdeConfigSchema } from '@/config/schema';
import { toView, type SetupDraft } from './draft';
import { buildInstallation } from './install';
import { enterSetupMode, setupBanner } from './mode';
import { isSetupMode, leaveSetupMode } from './guard';

const complete = (): SetupDraft => ({
  step: 7,
  name: 'BDE Test',
  accentColor: '#0f766e',
  messageLocale: 'fr',
  address: {
    url: 'https://bde.exemple.fr',
    host: 'bde.exemple.fr',
    isLocal: false,
    insecureDomain: false,
  },
  clientId: 'u-s4t2ud-uid-abcdef',
  clientSecret: 's-s4t2ud-secret-abcdef',
  credentialsVerified: true,
  fortyTwoToken: 'app-token',
  campuses: ['Nice'],
  mainCampus: 'Nice',
  timezone: 'Europe/Paris',
  owners: ['alice'],
  events: true,
  notifications: { mode: 'none' },
});

const ENV = { AUTH_SECRET: 'x'.repeat(44), DATABASE_URL: 'postgresql://u:p@postgres:5432/db' };

describe('buildInstallation', () => {
  it('makes the configuration and the settings of what was answered', () => {
    const result = buildInstallation(complete(), ENV);
    if (!result.ok) throw new Error(result.reason);

    expect(bdeConfigSchema.safeParse(result.config).success).toBe(true);
    expect(result.config.bde).toMatchObject({
      name: 'BDE Test',
      campus: 'Nice',
      timezone: 'Europe/Paris',
      defaultLocale: 'fr',
      accentColor: '#0f766e',
    });
    expect(result.config.auth).toEqual({ owners: ['alice'], allowedCampuses: ['Nice'] });
    expect(result.config.modules.enabled).toEqual(['events']);
    expect(result.config.events?.categories.length).toBeGreaterThan(0);
    expect(result.values).toEqual({
      APP_URL: 'https://bde.exemple.fr',
      FORTYTWO_CLIENT_ID: 'u-s4t2ud-uid-abcdef',
      FORTYTWO_CLIENT_SECRET: 's-s4t2ud-secret-abcdef',
    });
  });

  it('carries the contact address when there is one, and none otherwise', () => {
    const without = buildInstallation(complete(), ENV);
    if (!without.ok) throw new Error(without.reason);
    expect(without.config.bde).not.toHaveProperty('contactEmail');

    const withIt = buildInstallation({ ...complete(), contactEmail: 'bureau@exemple.fr' }, ENV);
    if (!withIt.ok) throw new Error(withIt.reason);
    expect(withIt.config.bde.contactEmail).toBe('bureau@exemple.fr');
    expect(
      toView({ ...complete(), contactEmail: 'bureau@exemple.fr' }, { addressUrl: '' }).contactEmail,
    ).toBe('bureau@exemple.fr');
    expect(toView(complete(), { addressUrl: '' }).contactEmail).toBe('');
  });

  it('has no events section when the module is off, and every campus when none is listed', () => {
    const result = buildInstallation({ ...complete(), events: false, campuses: [] }, ENV);
    if (!result.ok) throw new Error(result.reason);
    expect(result.config.modules.enabled).toEqual([]);
    expect(result.config.events).toBeUndefined();
    expect(result.config.auth.allowedCampuses).toEqual([]);
  });

  it('accepts credentials that could not be checked when the person went on without', () => {
    const draft = { ...complete(), credentialsVerified: false, credentialsSkipped: true };
    expect(buildInstallation(draft, ENV).ok).toBe(true);
  });

  it.each([
    ['name', { name: undefined }],
    ['the address', { address: undefined }],
    ['the secret', { clientSecret: undefined }],
    ['the owners', { owners: [] }],
    ['the modules', { events: undefined }],
    ['the notifications', { notifications: undefined }],
    ['the 42 check', { credentialsVerified: false, credentialsSkipped: false }],
  ])('refuses a draft without %s', (_what, change) => {
    expect(buildInstallation({ ...complete(), ...change }, ENV)).toEqual({
      ok: false,
      reason: 'incomplete',
    });
  });

  it('refuses what does not make a valid configuration', () => {
    const result = buildInstallation({ ...complete(), timezone: 'Mars/Olympus' }, ENV);
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });

  describe('the notification channel', () => {
    it('Discord: the webhook is a secret setting, every notification goes there', () => {
      const result = buildInstallation(
        {
          ...complete(),
          notifications: {
            mode: 'discord',
            discordWebhook: 'https://discord.com/api/webhooks/123456789/abc',
          },
        },
        ENV,
      );
      if (!result.ok) throw new Error(result.reason);
      expect(result.values.DISCORD_WEBHOOK_URL).toBe(
        'https://discord.com/api/webhooks/123456789/abc',
      );
      expect(result.config.notifications).toEqual({
        memberPending: 'discord',
        memberApproved: 'discord',
        memberRemoved: 'discord',
        eventConfirmed: 'discord',
        eventReminder: 'discord',
      });
    });

    it('e-mail: the settings of the mail server, and nothing sent when a member is removed', () => {
      const result = buildInstallation(
        {
          ...complete(),
          notifications: {
            mode: 'email',
            smtp: {
              host: 'smtp.exemple.fr',
              port: 587,
              user: 'bde',
              password: 'p4ss',
              from: 'bde@exemple.fr',
            },
          },
        },
        ENV,
      );
      if (!result.ok) throw new Error(result.reason);
      expect(result.values).toMatchObject({
        SMTP_HOST: 'smtp.exemple.fr',
        SMTP_PORT: '587',
        SMTP_USER: 'bde',
        SMTP_PASSWORD: 'p4ss',
        SMTP_FROM: 'bde@exemple.fr',
      });
      expect(result.config.notifications.memberRemoved).toBe('none');
      expect(result.config.notifications.memberPending).toBe('email');
    });

    it('refuses a channel whose settings are missing (the platform would not start)', () => {
      const result = buildInstallation({ ...complete(), notifications: { mode: 'slack' } }, ENV);
      expect(result).toMatchObject({ ok: false, reason: 'invalid' });
      if (!result.ok && result.reason === 'invalid') {
        expect(result.issues).toContain('SLACK_WEBHOOK_URL');
      }
    });
  });
});

describe('toView: what the browser may see of a draft', () => {
  it('has no secret, only whether there is one', () => {
    const draft: SetupDraft = {
      ...complete(),
      notifications: {
        mode: 'email',
        discordWebhook: 'https://discord.com/api/webhooks/1/secret-webhook',
        slackWebhook: 'https://hooks.slack.com/services/T1/B1/secret-webhook',
        smtp: {
          host: 'smtp.exemple.fr',
          port: 587,
          user: 'bde',
          password: 'smtp-password-secret',
          from: 'bde@exemple.fr',
        },
      },
    };
    const view = toView(draft, { addressUrl: 'http://x' });
    const text = JSON.stringify(view);

    for (const secret of [
      's-s4t2ud-secret-abcdef',
      'app-token',
      'secret-webhook',
      'smtp-password-secret',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(view.hasClientSecret).toBe(true);
    expect(view.notifications.hasDiscordWebhook).toBe(true);
    expect(view.notifications.smtp.hasPassword).toBe(true);
    expect(view.clientId).toBe('u-s4t2ud-uid-abcdef'); // the UID is not a secret
  });

  it('proposes the address the browser used while none was chosen', () => {
    expect(toView({ step: 0 }, { addressUrl: 'http://localhost:3500' }).addressUrl).toBe(
      'http://localhost:3500',
    );
  });
});

describe('the code box of the logs', () => {
  it('shows the address and the code, in both languages, in a box that is closed', () => {
    const banner = setupBanner('K7QM-4XPD', 'http://localhost:3000');
    expect(banner).toContain('K7QM-4XPD');
    expect(banner).toContain('http://localhost:3000');
    expect(banner).toMatch(/Ouvrez \/ Open/);
    const lines = banner.split('\n').filter(Boolean);
    expect(new Set(lines.map((line) => [...line].length)).size).toBe(1);
  });

  it('starts the installation mode and writes the box with the host port of docker-compose', () => {
    leaveSetupMode();
    const logs: string[] = [];
    const code = enterSetupMode(
      { log: (message) => void logs.push(message) },
      { BDE_HOST_PORT: '3500' },
    );
    expect(isSetupMode()).toBe(true);
    expect(logs.join('')).toContain(code);
    expect(logs.join('')).toContain('http://localhost:3500');
    leaveSetupMode();
  });
});
