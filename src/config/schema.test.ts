import { describe, expect, it } from 'vitest';
import { bdeConfigSchema } from './schema';

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
        expect(result.data.notifications.eventConfirmed).toBe('none');
        expect(result.data.notifications.eventReminder).toBe('none');
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
