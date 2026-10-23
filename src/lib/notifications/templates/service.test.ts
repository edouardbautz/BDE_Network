import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeTemplatesDb } from '@/test/fake-templates-db';

const db = vi.hoisted(() => ({
  current: undefined as undefined | ReturnType<typeof createFakeTemplatesDb>,
}));
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return db.current!.prisma;
  },
}));

const service = await import('./service');
const { HISTORY_KEPT } = service;

const paula = { login: 'paula', id: 'u1' };
let fake: ReturnType<typeof createFakeTemplatesDb>;

beforeEach(() => {
  fake = createFakeTemplatesDb();
  db.current = fake;
});

const save = (
  content: unknown,
  expectedVersion = 0,
  scope: 'all' | 'discord' | 'slack' | 'email' = 'all',
) => service.saveTemplate({ type: 'eventConfirmed', scope, content, expectedVersion }, paula);

const bureau = {
  platform: 'discord' as const,
  kind: 'role' as const,
  key: 'bureau',
  label: 'Bureau',
  externalId: '123456789012345678',
};

describe('saveTemplate', () => {
  it('stores the first version as 1 with its history and its audit entry', async () => {
    expect(await save({ title: 'Hello {title}' })).toEqual({ ok: true, version: 1, changed: true });
    expect(fake.templates).toHaveLength(1);
    expect(fake.templates[0]).toMatchObject({
      type: 'eventConfirmed',
      scope: 'all',
      version: 1,
      basedOnRevision: 1,
      updatedByLogin: 'paula',
      updatedById: 'u1',
      content: { title: 'Hello {title}' },
    });
    expect(fake.versions.map((row) => [row.version, row.action])).toEqual([[1, 'save']]);
    expect(fake.audit).toEqual([
      expect.objectContaining({
        action: 'notification_template.update',
        targetId: 'eventConfirmed:all',
        metadata: { type: 'eventConfirmed', scope: 'all', version: 1, fields: ['title'] },
      }),
    ]);
  });

  it('writes nothing, and says so, when nothing changed', async () => {
    await save({ title: 'A' });
    expect(await save({ title: 'A' }, 1)).toEqual({ ok: true, version: 1, changed: false });
    expect(fake.versions).toHaveLength(1);
    expect(fake.audit).toHaveLength(1);
  });

  it('counts the versions and refuses a save over one the editor did not see', async () => {
    await save({ title: 'A' });
    expect(await save({ title: 'B' }, 1)).toMatchObject({ ok: true, version: 2 });
    expect(await save({ title: 'Mine' }, 1)).toEqual({ ok: false, code: 'conflict' });
    expect(await save({ title: 'Mine' }, 0)).toEqual({ ok: false, code: 'conflict' });
    expect(fake.templates[0]?.content).toEqual({ title: 'B' });
    expect(fake.versions).toHaveLength(2);
  });

  it('keeps the revision the template was written over when it is saved again', async () => {
    await save({ title: 'A' });
    fake.templates[0]!.basedOnRevision = 0;
    await save({ title: 'B' }, 1);
    expect(fake.templates[0]?.basedOnRevision).toBe(0);
  });

  it('answers what is wrong in codes, and stores nothing', async () => {
    const result = await save({ title: '{nope}' });
    expect(result).toEqual({
      ok: false,
      code: 'invalid',
      issues: [{ path: 'title', code: 'unknownVariable', params: { variable: 'nope' } }],
    });
    expect(fake.templates).toHaveLength(0);
    expect(fake.audit).toHaveLength(0);
  });

  it('refuses a channel the notification is not sent on', async () => {
    expect(
      await service.saveTemplate(
        { type: 'memberRemoved', scope: 'email', content: {}, expectedVersion: 0 },
        paula,
      ),
    ).toEqual({ ok: false, code: 'channelNotForType' });
  });

  it('says in the audit entry which mentions and which address are reached, and never the text', async () => {
    await service.addMention(bureau, paula);
    await save(
      {
        above: 'Secret words {@everyone} {@role:bureau}',
        button: { enabled: true, url: 'https://forms.example.fr/join' },
      },
      0,
      'discord',
    );
    const entry = fake.audit.find((row) => row.action === 'notification_template.update');
    expect(entry?.metadata).toMatchObject({
      fields: ['above', 'button'],
      mentions: ['everyone', 'role:bureau'],
      buttonUrl: 'https://forms.example.fr/join',
    });
    expect(JSON.stringify(fake.audit)).not.toContain('Secret words');
  });

  it('keeps the last versions of the history only, and never reuses a number', async () => {
    await save({ title: 'v1' });
    for (let version = 2; version <= HISTORY_KEPT + 3; version += 1) {
      await save({ title: `v${version}` }, version - 1);
    }
    expect(fake.versions).toHaveLength(HISTORY_KEPT);
    expect(Math.min(...fake.versions.map((row) => row.version as number))).toBe(4);
  });

  it('retries a transaction the database could not serialize, and then goes through', async () => {
    fake.failSerialization(2);
    expect(await save({ title: 'A' })).toMatchObject({ ok: true, version: 1 });
    expect(fake.transactionRuns).toBe(3);
  });

  it('answers a conflict, not an error, when it still cannot be serialized after the last try', async () => {
    fake.failSerialization(5);
    expect(await save({ title: 'A' })).toEqual({ ok: false, code: 'conflict' });
    expect(fake.transactionRuns).toBe(3);
    expect(fake.templates).toHaveLength(0);
  });

  it('answers a conflict when the same version is written twice, and changes nothing', async () => {
    await save({ title: 'A' });
    fake.failUniqueVersion(1);
    expect(await save({ title: 'B' }, 1)).toEqual({ ok: false, code: 'conflict' });
    expect(fake.templates[0]).toMatchObject({ content: { title: 'A' }, version: 1 });
    expect(fake.versions).toHaveLength(1);
  });

  it('lets any other error through', async () => {
    const failing = fake.prisma as unknown as { $transaction: () => Promise<never> };
    failing.$transaction = async () => {
      throw new Error('connection lost');
    };
    await expect(save({ title: 'C' })).rejects.toThrow('connection lost');
  });
});

describe('customizeChannel', () => {
  it('starts the channel as a copy of what was written for all of them, without what it cannot hold', async () => {
    await save({ title: 'Shared', subject: 'A subject', above: '{@here}' });
    expect(
      await service.customizeChannel({ type: 'eventConfirmed', channel: 'slack' }, paula),
    ).toEqual({ ok: true, version: 1 });
    await service.customizeChannel({ type: 'eventConfirmed', channel: 'email' }, paula);
    const byScope = Object.fromEntries(fake.templates.map((row) => [row.scope, row.content]));
    expect(byScope.slack).toEqual({ title: 'Shared', above: '{@here}' });
    expect(byScope.email).toEqual({ title: 'Shared', subject: 'A subject' });
    expect(byScope.all).toEqual({ title: 'Shared', subject: 'A subject', above: '{@here}' });
    expect(
      fake.audit.filter((row) => row.action === 'notification_template.customize'),
    ).toHaveLength(2);
  });

  it('starts empty when nothing was shared, refuses a channel that already differs, and one the type has not', async () => {
    expect(
      await service.customizeChannel({ type: 'eventReminder', channel: 'discord' }, paula),
    ).toEqual({ ok: true, version: 1 });
    expect(fake.templates[0]?.content).toEqual({});
    expect(
      await service.customizeChannel({ type: 'eventReminder', channel: 'discord' }, paula),
    ).toEqual({ ok: false, code: 'conflict' });
    expect(
      await service.customizeChannel({ type: 'memberRemoved', channel: 'email' }, paula),
    ).toEqual({ ok: false, code: 'channelNotForType' });
  });

  it('does not copy what is no longer valid', async () => {
    fake.seed({
      templates: [
        {
          id: 't',
          type: 'eventConfirmed',
          scope: 'all',
          content: { title: '{nope}' },
          version: 1,
          basedOnRevision: 1,
          updatedByLogin: 'x',
          updatedById: null,
        },
      ],
    });
    const result = await service.customizeChannel(
      { type: 'eventConfirmed', channel: 'discord' },
      paula,
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('forChannel leaves out what the channel cannot hold, and leaves the original alone', () => {
    const shared = { title: 'T', above: '{@here}', subject: 'S', preheader: 'P', note: 'N' };
    expect(service.forChannel(shared, 'email')).toEqual({
      title: 'T',
      subject: 'S',
      preheader: 'P',
      note: 'N',
    });
    expect(service.forChannel(shared, 'discord')).toEqual({ title: 'T', above: '{@here}' });
    expect(shared.above).toBe('{@here}');
  });
});

describe('resetTemplate and resetType', () => {
  it('removes the template, keeps what it was in the history, and goes on counting', async () => {
    await save({ title: 'A' });
    expect(await service.resetTemplate({ type: 'eventConfirmed', scope: 'all' }, paula)).toEqual({
      ok: true,
      changed: true,
    });
    expect(fake.templates).toHaveLength(0);
    expect(await save({ title: 'B' })).toMatchObject({ ok: true, version: 3 });
    expect(fake.versions.map((row) => [row.version, row.action])).toEqual([
      [1, 'save'],
      [2, 'reset'],
      [3, 'save'],
    ]);
  });

  it('says nothing changed, and writes nothing, when there was nothing to reset', async () => {
    expect(await service.resetTemplate({ type: 'eventConfirmed', scope: 'all' }, paula)).toEqual({
      ok: true,
      changed: false,
    });
    expect(fake.audit).toHaveLength(0);
    expect(await service.resetType({ type: 'eventConfirmed' }, paula)).toEqual({
      ok: true,
      scopes: [],
    });
    expect(fake.audit).toHaveLength(0);
  });

  it('resets every scope of a notification at once, and only that notification', async () => {
    await save({ title: 'A' });
    await save({ title: 'B' }, 0, 'slack');
    await service.saveTemplate(
      { type: 'eventReminder', scope: 'all', content: { title: 'C' }, expectedVersion: 0 },
      paula,
    );
    expect(await service.resetType({ type: 'eventConfirmed' }, paula)).toEqual({
      ok: true,
      scopes: ['all', 'slack'],
    });
    expect(fake.templates.map((row) => row.type)).toEqual(['eventReminder']);
    expect(
      fake.audit.filter((row) => row.action === 'notification_template.reset_type'),
    ).toHaveLength(1);
  });
});

describe('restoreVersion', () => {
  it('puts an earlier version back as a new one, and leaves the history as it was', async () => {
    await save({ title: 'A' });
    await save({ title: 'B' }, 1);
    expect(
      await service.restoreVersion({ type: 'eventConfirmed', scope: 'all', version: 1 }, paula),
    ).toEqual({ ok: true, version: 3 });
    expect(fake.templates[0]).toMatchObject({ content: { title: 'A' }, version: 3 });
    expect(fake.versions.map((row) => [row.version, row.action])).toEqual([
      [1, 'save'],
      [2, 'save'],
      [3, 'restore:1'],
    ]);
    expect(
      fake.audit.find((row) => row.action === 'notification_template.restore')?.metadata,
    ).toMatchObject({ version: 3, restored: 1 });
  });

  it('restoring a reset resets again, and restoring it when already reset changes nothing', async () => {
    await save({ title: 'A' });
    await service.resetTemplate({ type: 'eventConfirmed', scope: 'all' }, paula);
    await save({ title: 'B' });
    expect(
      await service.restoreVersion({ type: 'eventConfirmed', scope: 'all', version: 2 }, paula),
    ).toMatchObject({ ok: true });
    expect(fake.templates).toHaveLength(0);
    const versions = fake.versions.length;
    expect(
      await service.restoreVersion({ type: 'eventConfirmed', scope: 'all', version: 2 }, paula),
    ).toMatchObject({ ok: true });
    expect(fake.versions).toHaveLength(versions);
  });

  it('answers "not found" for a version that is gone', async () => {
    expect(
      await service.restoreVersion({ type: 'eventConfirmed', scope: 'all', version: 9 }, paula),
    ).toEqual({ ok: false, code: 'notFound' });
  });

  it('checks the old version again: one that mentions somebody who is gone is not put back', async () => {
    await service.addMention(bureau, paula);
    await save({ above: '{@role:bureau} hi' }, 0, 'discord');
    await save({ title: 'Without' }, 1, 'discord');
    await service.removeMention({ id: fake.mentions[0]!.id as string }, paula);
    const result = await service.restoreVersion(
      { type: 'eventConfirmed', scope: 'discord', version: 1 },
      paula,
    );
    expect(result).toMatchObject({ ok: false, code: 'restoreInvalid' });
    expect(fake.templates[0]?.content).toEqual({ title: 'Without' });
  });
});

describe('acknowledgeRevision', () => {
  it('records that the BDE read what the platform changed, and refuses what does not exist', async () => {
    expect(
      await service.acknowledgeRevision({ type: 'eventConfirmed', scope: 'all' }, paula),
    ).toEqual({ ok: false, code: 'notFound' });
    await save({ title: 'A' });
    fake.templates[0]!.basedOnRevision = 0;
    expect(
      await service.acknowledgeRevision({ type: 'eventConfirmed', scope: 'all' }, paula),
    ).toEqual({ ok: true });
    expect(fake.templates[0]?.basedOnRevision).toBe(1);
    expect(fake.audit.at(-1)).toMatchObject({ action: 'notification_template.acknowledge' });
  });
});

describe('the directory of mentions', () => {
  it('adds one once for a name on a platform, trimmed, and says so in the audit trail', async () => {
    expect(
      await service.addMention({ ...bureau, key: ' bureau ', label: ' Bureau ' }, paula),
    ).toMatchObject({ ok: true });
    expect(fake.mentions[0]).toMatchObject({
      key: 'bureau',
      label: 'Bureau',
      createdByLogin: 'paula',
    });
    expect(await service.addMention(bureau, paula)).toEqual({ ok: false, code: 'mentionExists' });
    expect(
      await service.addMention(
        {
          platform: 'slack',
          kind: 'group',
          key: 'bureau',
          label: 'Bureau',
          externalId: 'S0614TZR7',
        },
        paula,
      ),
    ).toMatchObject({ ok: true });
    expect(fake.audit.find((row) => row.action === 'notification_mention.add')?.metadata).toEqual({
      platform: 'discord',
      kind: 'role',
      key: 'bureau',
    });
  });

  it.each([
    [{ ...bureau, key: 'Bad Key' }, 'key'],
    [{ ...bureau, key: '' }, 'key'],
    [{ ...bureau, key: 'a'.repeat(41) }, 'key'],
    [{ ...bureau, externalId: '12' }, 'externalId'],
    [
      { ...bureau, platform: 'slack' as const, kind: 'group' as const, externalId: 'x' },
      'externalId',
    ],
    [{ ...bureau, kind: 'group' as const }, 'kind'],
    [{ ...bureau, platform: 'teams' as never }, 'kind'],
    [{ ...bureau, label: '   ' }, 'label'],
    [{ ...bureau, label: 'x'.repeat(61) }, 'label'],
  ])('refuses what does not fit (%#)', async (input, path) => {
    const result = await service.addMention(input, paula);
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    if (!result.ok) expect(result.issues?.map((issue) => issue.path)).toContain(path);
    expect(fake.mentions).toHaveLength(0);
  });

  it('refuses to take one away while a template mentions it, and says which', async () => {
    const added = await service.addMention(bureau, paula);
    if (!added.ok) throw new Error('not added');
    await service.saveTemplate(
      {
        type: 'eventReminder',
        scope: 'discord',
        content: { above: '{@role:bureau}' },
        expectedVersion: 0,
      },
      paula,
    );
    expect(await service.removeMention({ id: added.id }, paula)).toEqual({
      ok: false,
      code: 'mentionInUse',
      detail: 'eventReminder:discord',
    });
    await service.resetTemplate({ type: 'eventReminder', scope: 'discord' }, paula);
    expect(await service.removeMention({ id: added.id }, paula)).toEqual({ ok: true });
    expect(fake.audit.at(-1)).toMatchObject({ action: 'notification_mention.remove' });
  });

  it('does not count the other platform, nor a template without a message above, as using a name', async () => {
    const added = await service.addMention(bureau, paula);
    await service.addMention(
      { platform: 'slack', kind: 'group', key: 'bureau', label: 'Bureau', externalId: 'S0614TZR7' },
      paula,
    );
    await service.saveTemplate(
      {
        type: 'eventReminder',
        scope: 'slack',
        content: { above: '{@group:bureau}' },
        expectedVersion: 0,
      },
      paula,
    );
    await service.saveTemplate(
      { type: 'eventConfirmed', scope: 'discord', content: { title: 'x' }, expectedVersion: 0 },
      paula,
    );
    if (!added.ok) throw new Error('not added');
    expect(await service.removeMention({ id: added.id }, paula)).toEqual({ ok: true });
  });

  it('says "not found" for somebody who is not there', async () => {
    expect(await service.removeMention({ id: 'nobody' }, paula)).toEqual({
      ok: false,
      code: 'notFound',
    });
  });

  it('does not accept a template that mentions somebody who is not in the directory', async () => {
    expect(
      await service.saveTemplate(
        {
          type: 'eventReminder',
          scope: 'discord',
          content: { above: '{@role:nobody}' },
          expectedVersion: 0,
        },
        paula,
      ),
    ).toMatchObject({ ok: false, code: 'invalid' });
  });
});
