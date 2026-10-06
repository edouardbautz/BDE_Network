import { describe, expect, it } from 'vitest';
import { confirmationNotice } from './confirmation-notice';

describe('confirmationNotice', () => {
  it('says nothing when no notification is configured', () => {
    expect(confirmationNotice('none', false)).toBeNull();
    expect(confirmationNotice('none', true)).toBeNull();
  });

  it('says members will be told by email, or in the channel, on a first confirmation', () => {
    expect(confirmationNotice('email', false)).toBe('notifyEmail');
    expect(confirmationNotice('discord', false)).toBe('notifyChat');
    expect(confirmationNotice('slack', false)).toBe('notifyChat');
  });

  it('says members were already told when the event was confirmed before', () => {
    for (const channel of ['email', 'discord', 'slack'] as const) {
      expect(confirmationNotice(channel, true)).toBe('alreadyNotified');
    }
  });
});
