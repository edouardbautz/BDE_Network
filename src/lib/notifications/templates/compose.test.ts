import { describe, expect, it } from 'vitest';
import { composeDrafts, inertMentions } from './compose';
import { directoryKey, type MentionDirectory } from './mentions';

const DIRECTORY: MentionDirectory = {
  [directoryKey('discord', 'bureau')]: {
    platform: 'discord',
    kind: 'role',
    label: 'Le Bureau',
    externalId: '123456789012345678',
  },
  [directoryKey('slack', 'paula')]: {
    platform: 'slack',
    kind: 'user',
    label: 'Paula',
    externalId: 'U01ABCDE2F3',
  },
};

describe('the drafts on screen, as the template a channel would be sent with', () => {
  it('is no template when there are no drafts', () => {
    expect(composeDrafts('eventConfirmed', 'discord', {}, DIRECTORY)).toEqual({
      ok: true,
      template: undefined,
    });
    expect(composeDrafts('eventConfirmed', 'discord', { all: null, own: null }, DIRECTORY)).toEqual(
      { ok: true, template: undefined },
    );
  });

  it('puts the channel’s own draft over the one for all channels, field by field', () => {
    const composed = composeDrafts(
      'eventConfirmed',
      'discord',
      { all: { title: 'Commun', eyebrow: 'Tous' }, own: { title: 'Propre' } },
      DIRECTORY,
    );
    expect(composed).toEqual({ ok: true, template: { title: 'Propre', eyebrow: 'Tous' } });
  });

  it('ignores the draft for all channels on a channel it does not reach', () => {
    const composed = composeDrafts(
      'memberApproved',
      'email',
      { all: { title: 'Commun' }, own: { footer: 'Mien' } },
      DIRECTORY,
    );
    expect(composed).toEqual({ ok: true, template: { footer: 'Mien' } });
  });

  it('checks each draft as it would be saved, and says which one is wrong', () => {
    const composed = composeDrafts(
      'eventConfirmed',
      'discord',
      { all: { title: '{nothing}' }, own: { footer: 'x'.repeat(500) } },
      DIRECTORY,
    );
    expect(composed.ok).toBe(false);
    if (composed.ok) return;
    expect(composed.issues.map((issue) => [issue.scope, issue.path, issue.code])).toEqual([
      ['all', 'title', 'unknownVariable'],
      ['discord', 'footer', 'tooLong'],
    ]);
  });

  it('refuses a mention that does not belong to the tab it is written in', () => {
    const composed = composeDrafts(
      'eventConfirmed',
      'discord',
      { all: { above: '{@role:bureau}' } },
      DIRECTORY,
    );
    expect(composed.ok).toBe(false);
  });
});

describe('a test message’s mentions', () => {
  it('writes each mention as the plain name it stands for, so nobody is notified', () => {
    expect(
      inertMentions('Bonjour {@everyone} {@here} {@role:bureau} !', DIRECTORY, 'discord'),
    ).toBe('Bonjour @everyone @here @Le Bureau !');
    expect(inertMentions('{@channel} et {@user:paula}', DIRECTORY, 'slack')).toBe(
      '@channel et @Paula',
    );
  });

  it('falls back on the name written when the directory does not know it', () => {
    expect(inertMentions('{@role:inconnu}', DIRECTORY, 'discord')).toBe('@inconnu');
  });

  it('leaves variables and everything else alone', () => {
    expect(inertMentions('{title} à {place} {{x}}', DIRECTORY, 'discord')).toBe(
      '{title} à {place} {{x}}',
    );
  });
});
