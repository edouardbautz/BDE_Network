import { describe, expect, it } from 'vitest';
import { chatNames, confirmationNotice } from './confirmation-notice';

describe('confirmationNotice', () => {
  it('says nothing when no notification is configured', () => {
    expect(confirmationNotice([], false)).toBeNull();
    expect(confirmationNotice([], true)).toBeNull();
  });

  it('says members will be told by email, or in the channel, on a first confirmation', () => {
    expect(confirmationNotice(['email'], false)?.key).toBe('notifyEmail');
    expect(confirmationNotice(['discord'], false)?.key).toBe('notifyChat');
    expect(confirmationNotice(['slack'], false)?.key).toBe('notifyChat');
    expect(confirmationNotice(['discord', 'slack'], false)?.key).toBe('notifyChat');
  });

  it('says both when an e-mail and a chat channel are set', () => {
    expect(confirmationNotice(['discord', 'email'], false)?.key).toBe('notifyBoth');
    expect(confirmationNotice(['discord', 'slack', 'email'], false)?.key).toBe('notifyBoth');
  });

  it('says members were already told when the event was confirmed before', () => {
    for (const channels of [['email'], ['discord'], ['slack', 'email']] as const) {
      expect(confirmationNotice(channels, true)?.key).toBe('alreadyNotified');
    }
  });

  it('names the chat channels as a sentence, in the language of the page', () => {
    const both = confirmationNotice(['discord', 'slack'], false);
    expect(both && chatNames(both, 'en')).toBe('Discord and Slack');
    expect(both && chatNames(both, 'fr')).toBe('Discord et Slack');
    const one = confirmationNotice(['slack', 'email'], false);
    expect(one && chatNames(one, 'en')).toBe('Slack');
  });
});
