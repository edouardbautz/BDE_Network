import { describe, expect, it } from 'vitest';
import { ITEMS, channelsOfType } from './catalog';
import { directoryKey, type MentionDirectory } from './mentions';
import { renderPreview, type PreviewOptions } from './preview';
import { TEMPLATE_CHANNELS, type TemplateType } from './types';

const TYPES = Object.keys(ITEMS) as TemplateType[];
const NOW = new Date('2026-10-08T12:00:00Z');
const options = (over: Partial<PreviewOptions> = {}): PreviewOptions => ({
  locale: 'en',
  timeZone: 'Europe/Paris',
  bdeName: 'BDE Nice',
  accent: '#2f5bea',
  appUrl: 'https://bde.example.fr',
  now: NOW,
  ...over,
});

const DIRECTORY: MentionDirectory = {
  [directoryKey('discord', 'bureau')]: {
    platform: 'discord',
    kind: 'role',
    label: 'Bureau',
    externalId: '123456789012345678',
  },
};

describe('renderPreview', () => {
  const cases = TYPES.flatMap((type) =>
    channelsOfType(type).flatMap((channel) =>
      (['fr', 'en'] as const).map((locale) => [type, channel, locale] as const),
    ),
  );

  it.each(cases)(
    'draws %s on %s in %s, with what the channel posts',
    async (type, channel, locale) => {
      const preview = await renderPreview(type, channel, undefined, options({ locale }));
      expect(preview.channel).toBe(channel);
      if (preview.channel === 'discord') {
        expect(preview.embed.title).toBeTruthy();
        expect(preview.embed.author?.name).toBe('BDE Nice');
      } else if (preview.channel === 'slack') {
        expect(preview.message.blocks.length).toBeGreaterThan(2);
        expect(preview.message.fallback).toBeTruthy();
      } else {
        expect(preview.mail.html).toContain('<!doctype html>');
        expect(preview.mail.text).toContain('BDE Nice');
      }
    },
  );

  it('writes nothing for a channel the notification is not sent on', async () => {
    await expect(renderPreview('memberRemoved', 'email', undefined, options())).rejects.toThrow(
      'memberRemoved is not sent on email',
    );
  });

  it('draws every channel of every type with the template applied', async () => {
    for (const type of TYPES) {
      for (const channel of channelsOfType(type)) {
        const preview = await renderPreview(
          type,
          channel,
          { eyebrow: 'Custom eyebrow', title: 'Custom {bde}' },
          options(),
        );
        const text = JSON.stringify(preview);
        expect(text.toLowerCase()).toContain('custom eyebrow');
        expect(text).toContain('Custom BDE Nice');
      }
    }
  });

  it('shows the button when the platform has an address, and none when it has not', async () => {
    const withAddress = await renderPreview('eventConfirmed', 'email', undefined, options());
    expect(withAddress.channel === 'email' && withAddress.mail.html).toContain('class="btn"');
    const without = await renderPreview(
      'eventConfirmed',
      'email',
      undefined,
      options({ appUrl: null }),
    );
    expect(without.channel === 'email' && without.mail.html).not.toContain('class="btn"');
  });

  it('shows the example in the language and the zone of the BDE', async () => {
    const preview = await renderPreview(
      'eventConfirmed',
      'email',
      { title: '{date}' },
      options({ locale: 'fr', timeZone: 'Pacific/Auckland' }),
    );
    expect(preview.channel === 'email' && preview.mail.html).toMatch(
      /(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \d+ \w+ 2026/,
    );
  });

  it('draws the message above a Discord card with its mentions, the way the adapter will post it', async () => {
    const preview = await renderPreview(
      'eventConfirmed',
      'discord',
      { above: '{@here} {@role:bureau} {title}' },
      options({ mentions: DIRECTORY }),
    );
    if (preview.channel !== 'discord') throw new Error('not discord');
    expect(preview.above?.text).toBe('@here <@&123456789012345678> Back-to-school party');
    expect(preview.above?.mentions).toEqual({
      everyone: true,
      roles: ['123456789012345678'],
      users: [],
    });
  });

  it('draws the message above a Slack card', async () => {
    const preview = await renderPreview(
      'eventConfirmed',
      'slack',
      { above: '{@channel} news' },
      options(),
    );
    expect(preview.channel === 'slack' && preview.message.above).toBe('<!channel> news');
  });

  it('makes every text of the card harmless, as the adapter does, even what the BDE typed', async () => {
    const preview = await renderPreview(
      'eventConfirmed',
      'discord',
      {
        title: '@everyone <@123> {title}',
        items: { order: 'native', list: [{ id: 'text:a', enabled: true, text: '@here' }] },
      },
      options(),
    );
    if (preview.channel !== 'discord') throw new Error('not discord');
    const text = JSON.stringify(preview.embed);
    expect(text).not.toContain('@everyone');
    expect(text).not.toContain('<@123>');
    expect(text).not.toContain('@here');
  });

  it('has an example for every channel that mentions the facts a template can ask to show', async () => {
    // every fact of the example is present, so nothing a template asks to show is missing from the preview
    const confirmed = await renderPreview('eventRefused', 'email', undefined, options());
    const text = confirmed.channel === 'email' ? confirmed.mail.text : '';
    for (const word of [
      'When',
      'Repeats',
      'Where',
      'Category',
      'Members in charge',
      'Proposed by',
      'Refused by',
      'Reason',
    ]) {
      expect(text).toContain(word);
    }
    for (const channel of TEMPLATE_CHANNELS) {
      expect(channelsOfType('eventConfirmed')).toContain(channel);
    }
  });
});
