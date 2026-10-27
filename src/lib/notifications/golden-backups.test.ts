import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildBackupEmbed } from '@/lib/backups/notifications/discord-embed';
import { buildBackupEmail } from '@/lib/backups/notifications/email';
import { describeFacts, type BackupSituation } from '@/lib/backups/notifications/facts';
import { buildBackupMessage } from '@/lib/backups/notifications/messages';
import { buildBackupSlack } from '@/lib/backups/notifications/slack-blocks';
import { FAILURE_CODES } from '@/lib/backups/status';
import { ITEMS } from './templates/catalog';
import type { TemplateContext, TemplateType } from './templates/types';
import { getNotificationTranslate } from './translate';

/**
 * The notifications about the backups as they are sent, written down like those of `golden.test.ts`: the two kinds, on every channel, in
 * both languages, for a complete case, a bare one, one longer than any limit and one with hostile text. Their own files
 * (`__golden__/backups-*.json`), so that the references of the notifications that existed before stay exactly as they were.
 */

const NOW = new Date('2026-10-27T03:40:00Z');
const PARIS = 'Europe/Paris';
const BRAND = { name: 'BDE Nice', logoUrl: 'https://bde.example.fr/logo.png', accent: '#2f5bea' };
const BARE_BRAND = { name: 'BDE Nice', accent: '#2f5bea' };

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const cut = (email: { html: string; text: string; subject?: string }, full: boolean) => ({
  ...(email.subject !== undefined && { subject: email.subject }),
  text: email.text,
  html: full ? email.html : { sha256: digest(email.html), length: email.html.length },
});

const CASES: Record<string, BackupSituation> = {
  full: {
    reasonCode: 'space',
    lastAt: new Date('2026-10-25T02:00:04Z'),
    lastBytes: 108_107,
    days: 3,
  },
  // nothing ever succeeded, and the reason is not known
  bare: { reasonCode: null, lastAt: null, lastBytes: null, days: 2 },
  // the longest reason and the biggest archive
  longer: {
    reasonCode: 'verify-restore',
    lastAt: new Date('2025-01-01T02:00:04Z'),
    lastBytes: 123_456_789_012,
    days: 300,
  },
};

type Locale = 'fr' | 'en';

async function outputs(locale: Locale, context?: TemplateContext) {
  const t = await getNotificationTranslate(locale, 'backups.notifications');
  const reasons = await getNotificationTranslate(locale, 'settings.backups.reasons');
  const url = `https://bde.example.fr/${locale}/settings`;
  const out: Record<string, unknown> = {};
  for (const [name, situation] of Object.entries(CASES)) {
    const brand = name === 'bare' ? BARE_BRAND : BRAND;
    const facts = describeFacts(situation, { locale, timeZone: PARIS, t, reasons });
    for (const kind of ['failed', 'stale'] as const) {
      const link = name === 'bare' ? null : url;
      out[`${name}/${kind}`] = {
        discord: buildBackupEmbed(kind, facts, t, link, NOW, context),
        slack: buildBackupSlack(kind, facts, t, link, brand, context),
        email: cut(buildBackupEmail(kind, facts, t, link, brand, locale, context), name === 'full'),
      };
    }
    // the plain texts do not follow a template: they are what every channel falls back to
    out[`${name}/plain`] = {
      failed: buildBackupMessage('failed', facts, brand.name, t, name === 'bare' ? null : url),
      stale: buildBackupMessage('stale', facts, brand.name, t, name === 'bare' ? null : url),
    };
  }
  return out;
}

describe.each(['fr', 'en'] as const)('the notifications about the backups (%s)', (locale) => {
  it('the cards, messages, e-mails and plain texts', async () => {
    await expect(JSON.stringify(await outputs(locale), null, 2)).toMatchFileSnapshot(
      `./__golden__/backups-${locale}.json`,
    );
  });

  it('a template that says nothing changes nothing', async () => {
    const empty: TemplateContext = { template: {}, bdeName: 'BDE Nice', locale };
    expect(await outputs(locale, empty)).toEqual(await outputs(locale));
  });

  it('nor does a template that lists every fact in the order the channel shows them', async () => {
    const list = (type: TemplateType) => ({
      items: {
        order: 'native' as const,
        list: ITEMS[type].map((id) => ({ id, enabled: true })),
      },
    });
    const t = await getNotificationTranslate(locale, 'backups.notifications');
    const reasons = await getNotificationTranslate(locale, 'settings.backups.reasons');
    const facts = describeFacts(CASES.full!, { locale, timeZone: PARIS, t, reasons });
    for (const [kind, type] of [
      ['failed', 'backupFailed'],
      ['stale', 'backupStale'],
    ] as const) {
      const plain = buildBackupEmbed(kind, facts, t, null, NOW);
      const listed = buildBackupEmbed(kind, facts, t, null, NOW, { template: list(type) });
      expect(listed).toEqual(plain);
    }
  });

  it('has a sentence for every reason a backup can fail for (the page, the cards and the e-mails say it)', async () => {
    const reasons = await getNotificationTranslate(locale, 'settings.backups.reasons');
    for (const code of FAILURE_CODES) expect(reasons(code), code).not.toMatch(/^settings\./);
  });
});
