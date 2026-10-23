import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bdeConfigSchema, channelsFor, DEFAULT_ACCENT } from './schema';

const validConfig = {
  bde: {
    name: 'BDE Test',
    campus: 'Paris',
    timezone: 'Europe/Paris',
    defaultLocale: 'fr',
    accentColor: '#0f766e',
    logoPath: '/logo.svg',
  },
  auth: {
    owners: ['jdupont'],
    allowedCampuses: ['Paris'],
  },
  modules: {
    enabled: [],
  },
  notifications: {
    memberPending: 'email',
    memberApproved: 'none',
    memberRemoved: 'none',
  },
};

describe('bdeConfigSchema', () => {
  it('accepts a well-formed config', () => {
    const result = bdeConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('accepts a contact address, which is optional', () => {
    expect(bdeConfigSchema.safeParse(validConfig).success).toBe(true);
    const withContact = bdeConfigSchema.safeParse({
      ...validConfig,
      bde: { ...validConfig.bde, contactEmail: 'bureau@exemple.fr' },
    });
    expect(withContact.success).toBe(true);
  });

  it.each(['pas une adresse', 'bureau@', '', 'a b@exemple.fr'])(
    'rejects a contact address that is not one: %j',
    (contactEmail) => {
      const result = bdeConfigSchema.safeParse({
        ...validConfig,
        bde: { ...validConfig.bde, contactEmail },
      });
      expect(result.success).toBe(false);
    },
  );

  it('does not need a notifications section: every notification is then off', () => {
    const withoutNotifications: Partial<typeof validConfig> = { ...validConfig };
    delete withoutNotifications.notifications;
    const result = bdeConfigSchema.safeParse(withoutNotifications);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notifications).toEqual({
        memberPending: [],
        memberApproved: [],
        memberRemoved: [],
        eventConfirmed: [],
        eventReminder: [],
        eventProposed: [],
        eventApproved: [],
        eventRefused: [],
      });
    }
  });

  describe('the channels of a notification: a list, and the old single value still read', () => {
    const channelsOf = (notifications: unknown) => {
      const result = bdeConfigSchema.safeParse({ ...validConfig, notifications });
      return result.success ? result.data.notifications : null;
    };

    it.each([
      ['discord', ['discord']],
      ['slack', ['slack']],
      ['email', ['email']],
      ['none', []],
      [undefined, []],
      [null, []],
    ])(
      'reads the single value %j as the list %j (a configuration written before 1.5.0)',
      (value, list) => {
        expect(channelsOf({ memberPending: value })?.memberPending).toEqual(list);
      },
    );

    it('accepts none, one or several channels', () => {
      const n = channelsOf({
        memberPending: [],
        memberApproved: ['slack'],
        eventConfirmed: ['discord', 'slack', 'email'],
      });
      expect(n?.memberPending).toEqual([]);
      expect(n?.memberApproved).toEqual(['slack']);
      expect(n?.eventConfirmed).toEqual(['discord', 'slack', 'email']);
    });

    it('writes a list once, in the order of the table, whatever the order it was given', () => {
      expect(
        channelsOf({ eventConfirmed: ['email', 'discord', 'email', 'slack'] })?.eventConfirmed,
      ).toEqual(['discord', 'slack', 'email']);
    });

    it('refuses a channel that does not exist, in a list too, and something that is neither a name nor a list', () => {
      expect(channelsOf({ memberPending: ['discord', 'carrier-pigeon'] })).toBeNull();
      expect(channelsOf({ memberPending: ['none'] })).toBeNull();
      expect(channelsOf({ memberPending: 3 })).toBeNull();
      expect(channelsOf({ memberPending: { discord: true } })).toBeNull();
    });

    it('keeps a keyed-out notification off, and one that is there is not touched by the others', () => {
      const n = channelsOf({ eventReminder: 'slack' });
      expect(n?.eventReminder).toEqual(['slack']);
      expect(n?.eventConfirmed).toEqual([]);
    });
  });

  describe('channelsFor: what a notification really goes through', () => {
    it('is the list, except the e-mail of a member removed, which is never sent', () => {
      const parsed = bdeConfigSchema.parse({
        ...validConfig,
        notifications: { memberRemoved: ['discord', 'email'], memberPending: ['email'] },
      });
      expect(channelsFor(parsed, 'memberRemoved')).toEqual(['discord']);
      expect(channelsFor(parsed, 'memberPending')).toEqual(['email']);
      expect(channelsFor(parsed, 'eventConfirmed')).toEqual([]);
    });
  });

  it('still refuses a channel that does not exist in a notifications section that is there', () => {
    const result = bdeConfigSchema.safeParse({
      ...validConfig,
      notifications: { memberPending: 'carrier-pigeon' },
    });
    expect(result.success).toBe(false);
  });

  it('says which notification and which channels when a channel does not exist', () => {
    const result = bdeConfigSchema.safeParse({
      ...validConfig,
      notifications: { eventReminder: ['discord', 'carrier-pigeon'] },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]!.message;
      expect(message).toContain('"eventReminder"');
      expect(message).toContain('discord, slack, email');
    }
  });

  it('says which notification when its channels are not a list', () => {
    const result = bdeConfigSchema.safeParse({
      ...validConfig,
      notifications: { memberRemoved: { discord: true } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]!.message;
      expect(message).toContain('"memberRemoved"');
      expect(message).toContain('une liste');
    }
  });

  it('rejects an invalid accent color', () => {
    const result = bdeConfigSchema.safeParse({
      ...validConfig,
      bde: { ...validConfig.bde, accentColor: 'not-a-color' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown timezone', () => {
    const result = bdeConfigSchema.safeParse({
      ...validConfig,
      bde: { ...validConfig.bde, timezone: 'Not/AZone' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an empty allowedCampuses list (means "no filter")', () => {
    const result = bdeConfigSchema.safeParse({
      ...validConfig,
      auth: { ...validConfig.auth, allowedCampuses: [] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty owners list', () => {
    const result = bdeConfigSchema.safeParse({
      ...validConfig,
      auth: { ...validConfig.auth, owners: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown notification channel', () => {
    const result = bdeConfigSchema.safeParse({
      ...validConfig,
      notifications: { ...validConfig.notifications, memberPending: 'carrier-pigeon' },
    });
    expect(result.success).toBe(false);
  });

  it('defaults modules.enabled to an empty array when omitted', () => {
    const result = bdeConfigSchema.safeParse({ ...validConfig, modules: {} });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modules.enabled).toEqual([]);
    }
  });
  describe('events module', () => {
    const eventsConfig = {
      categories: [
        { key: 'soiree', label: 'Soirée', color: '#db2777' },
        { key: 'sport', label: 'Sport', color: '#16a34a' },
      ],
    };
    const withEvents = { ...validConfig, modules: { enabled: ['events'] }, events: eventsConfig };

    it('accepts an enabled module with categories and applies defaults', () => {
      const result = bdeConfigSchema.safeParse(withEvents);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.events?.reminderHour).toBe(18);
        expect(result.data.notifications.eventConfirmed).toEqual([]);
        expect(result.data.notifications.eventReminder).toEqual([]);
        // The proposal circuit's notifications came later: an older file keeps validating, with them off.
        expect(result.data.notifications.eventProposed).toEqual([]);
        expect(result.data.notifications.eventApproved).toEqual([]);
        expect(result.data.notifications.eventRefused).toEqual([]);
      }
    });

    it('requires an events section when the module is enabled', () => {
      const result = bdeConfigSchema.safeParse({
        ...validConfig,
        modules: { enabled: ['events'] },
      });
      expect(result.success).toBe(false);
    });

    it('does not require an events section when the module is disabled', () => {
      expect(bdeConfigSchema.safeParse(validConfig).success).toBe(true);
    });

    it('rejects an empty category list', () => {
      const result = bdeConfigSchema.safeParse({ ...withEvents, events: { categories: [] } });
      expect(result.success).toBe(false);
    });

    it('rejects duplicate category keys', () => {
      const result = bdeConfigSchema.safeParse({
        ...withEvents,
        events: { categories: [eventsConfig.categories[0], eventsConfig.categories[0]] },
      });
      expect(result.success).toBe(false);
    });

    it('rejects an invalid category color', () => {
      const result = bdeConfigSchema.safeParse({
        ...withEvents,
        events: { categories: [{ key: 'a', label: 'A', color: 'red' }] },
      });
      expect(result.success).toBe(false);
    });

    it('rejects an out-of-range reminder hour', () => {
      const result = bdeConfigSchema.safeParse({
        ...withEvents,
        events: { ...eventsConfig, reminderHour: 24 },
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('the accent colour', () => {
  it('is #2F5BEA when nobody chose one (a new platform), and is the one written when somebody did', () => {
    const { accentColor: _chosen, ...bdeWithout } = validConfig.bde;
    void _chosen;
    const without = bdeConfigSchema.parse({ ...validConfig, bde: bdeWithout });
    expect(without.bde.accentColor).toBe(DEFAULT_ACCENT);
    expect(DEFAULT_ACCENT).toBe('#2F5BEA');
    // a platform that already has one keeps it
    expect(bdeConfigSchema.parse(validConfig).bde.accentColor).toBe('#0f766e');
  });

  it('is #2F5BEA in the example configuration, which a new installation is made from', () => {
    const example = readFileSync(join(process.cwd(), 'bde.config.example.yml'), 'utf8');
    expect(example).toMatch(/accentColor:\s*'#2F5BEA'/);
  });
});
