import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ settings: {} as Record<string, string | undefined> }));
vi.mock('@/lib/settings/runtime', () => ({ setting: (key: string) => mocks.settings[key] }));

const { webhookOf } = await import('./rooms');

beforeEach(() => {
  mocks.settings = {
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/bde',
    DISCORD_STAFF_WEBHOOK_URL: 'https://discord.com/api/webhooks/2/staff',
    SLACK_STAFF_WEBHOOK_URL: '',
  };
});

describe('the rooms of the chat channels', () => {
  it('the BDE room is the settings own webhook: nothing to override', () => {
    expect(webhookOf('discord', 'bde')).toBeUndefined();
    expect(webhookOf('slack', 'bde')).toBeUndefined();
  });

  it('the staff room is its own webhook when the owners gave one', () => {
    expect(webhookOf('discord', 'staff')).toBe('https://discord.com/api/webhooks/2/staff');
  });

  it('falls back on the BDE room when the staff has none for the channel (nothing, or an empty value)', () => {
    expect(webhookOf('slack', 'staff')).toBeUndefined();
    mocks.settings = {};
    expect(webhookOf('discord', 'staff')).toBeUndefined();
  });

  it('has no room for an e-mail: the recipients are the caller’s', () => {
    expect(webhookOf('email', 'staff')).toBeUndefined();
  });
});
