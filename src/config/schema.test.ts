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
});
