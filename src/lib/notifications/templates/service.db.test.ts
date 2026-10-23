// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, createMigratedDatabase, type TestDatabase } from '../../../../qa/test-database';

/**
 * The service on a real PostgreSQL with every migration applied (the `migrations` job of CI sets the address; elsewhere the suite is
 * skipped): the checks of the migration itself, the versions, the history, the audit trail, two saves at once, and the directory of
 * mentions. The in-memory parts (validation, resolution) have their own tests.
 */

const describeWithDatabase = ADMIN_URL ? describe : describe.skip;

describeWithDatabase('the storage of the notification templates', () => {
  let database: TestDatabase;
  let service: typeof import('./service');
  let prismaClient: typeof import('@/lib/prisma').prisma;
  const paula = { login: 'paula', id: null as string | null };

  beforeAll(async () => {
    database = await createMigratedDatabase();
    process.env.DATABASE_URL = database.url;
    delete (globalThis as { prismaClient?: unknown }).prismaClient;
    vi.resetModules();
    ({ prisma: prismaClient } = await import('@/lib/prisma'));
    service = await import('./service');
    const user = await database.client.query(
      `INSERT INTO "User" (id, login, "fullName", email, campus, status, "updatedAt")
       VALUES ('u-paula', 'paula', 'Paula Martin', 'paula@example.fr', 'Nice', 'OWNER', now()) RETURNING id`,
    );
    paula.id = user.rows[0].id;
  });

  afterAll(async () => {
    await prismaClient?.$disconnect();
    await database?.drop();
  });

  beforeEach(async () => {
    await database.client.query(
      'TRUNCATE "NotificationTemplate", "NotificationTemplateVersion", "NotificationMention", "AuditLog"',
    );
  });

  const rows = async (sql: string) => (await database.client.query(sql)).rows;
  const audit = () =>
    rows(`SELECT action, "targetId", metadata FROM "AuditLog" ORDER BY "createdAt", id`);

  describe('the migration', () => {
    it('refuses a scope that is not "all" or a channel', async () => {
      await expect(
        database.client.query(
          `INSERT INTO "NotificationTemplate" (id, type, scope, content, version, "basedOnRevision", "updatedAt", "updatedByLogin")
           VALUES ('x', 'eventConfirmed', 'sms', '{}', 1, 1, now(), 'paula')`,
        ),
      ).rejects.toThrow(/NotificationTemplate_scope_known/);
    });

    it('refuses a version below 1 and an action it does not know', async () => {
      await expect(
        database.client.query(
          `INSERT INTO "NotificationTemplate" (id, type, scope, content, version, "basedOnRevision", "updatedAt", "updatedByLogin")
           VALUES ('x', 'eventConfirmed', 'all', '{}', 0, 1, now(), 'paula')`,
        ),
      ).rejects.toThrow(/version_positive/);
      await expect(
        database.client.query(
          `INSERT INTO "NotificationTemplateVersion" (id, type, scope, version, content, "basedOnRevision", action, "authorLogin")
           VALUES ('x', 'eventConfirmed', 'all', 1, '{}', 1, 'delete', 'paula')`,
        ),
      ).rejects.toThrow(/action_known/);
    });

    it('refuses a mention whose kind, name or identifier does not fit its platform', async () => {
      const insert = (platform: string, kind: string, key: string, id: string) =>
        database.client.query(
          `INSERT INTO "NotificationMention" (id, key, platform, kind, label, "externalId", "createdByLogin")
           VALUES (gen_random_uuid()::text, '${key}', '${platform}', '${kind}', 'L', '${id}', 'paula')`,
        );
      await expect(insert('discord', 'group', 'a', '123456789012345678')).rejects.toThrow(
        /kind_for_platform/,
      );
      await expect(insert('slack', 'role', 'a', 'S0614TZR7')).rejects.toThrow(/kind_for_platform/);
      await expect(insert('discord', 'role', 'Bad Key', '123456789012345678')).rejects.toThrow(
        /key_shape/,
      );
      await expect(insert('discord', 'role', 'a--b', '123456789012345678')).rejects.toThrow(
        /key_shape/,
      );
      await expect(insert('discord', 'role', 'a', '12345')).rejects.toThrow(/id_shape/);
      await expect(insert('slack', 'group', 'a', 'x0614TZR7')).rejects.toThrow(/id_shape/);
      await expect(insert('teams', 'role', 'a', '123456789012345678')).rejects.toThrow(
        /violates check constraint/,
      );
      await insert('discord', 'role', 'bureau', '123456789012345678');
      await insert('slack', 'group', 'bureau', 'S0614TZR7');
    });

    it('lets an account be deleted whatever the templates say: the author becomes unknown, the login stays', async () => {
      await service.saveTemplate(
        { type: 'eventConfirmed', scope: 'all', content: { title: 'T' }, expectedVersion: 0 },
        paula,
      );
      await database.client.query(`DELETE FROM "User" WHERE id = 'u-paula'`);
      const [template] = await rows(
        `SELECT "updatedById", "updatedByLogin" FROM "NotificationTemplate"`,
      );
      expect(template).toEqual({ updatedById: null, updatedByLogin: 'paula' });
      const [version] = await rows(
        `SELECT "authorId", "authorLogin" FROM "NotificationTemplateVersion"`,
      );
      expect(version).toEqual({ authorId: null, authorLogin: 'paula' });
      // put the account back for the other tests
      await database.client.query(
        `INSERT INTO "User" (id, login, "fullName", email, campus, status, "updatedAt")
         VALUES ('u-paula', 'paula', 'Paula Martin', 'paula@example.fr', 'Nice', 'OWNER', now())`,
      );
    });
  });

  describe('saving', () => {
    const save = (
      content: unknown,
      expectedVersion = 0,
      scope: 'all' | 'discord' | 'slack' | 'email' = 'all',
    ) => service.saveTemplate({ type: 'eventConfirmed', scope, content, expectedVersion }, paula);

    it('stores the first version as 1, with the history and the audit entry in the same go', async () => {
      expect(await save({ title: 'Hello {title}' })).toEqual({
        ok: true,
        version: 1,
        changed: true,
      });
      const [row] = await rows(`SELECT * FROM "NotificationTemplate"`);
      expect(row).toMatchObject({
        type: 'eventConfirmed',
        scope: 'all',
        version: 1,
        basedOnRevision: 1,
        updatedByLogin: 'paula',
        updatedById: 'u-paula',
        content: { title: 'Hello {title}' },
      });
      expect(await rows(`SELECT version, action FROM "NotificationTemplateVersion"`)).toEqual([
        { version: 1, action: 'save' },
      ]);
      const [entry] = await audit();
      expect(entry).toMatchObject({
        action: 'notification_template.update',
        targetId: 'eventConfirmed:all',
        metadata: { type: 'eventConfirmed', scope: 'all', version: 1, fields: ['title'] },
      });
    });

    it('cleans what it is given: texts trimmed, colour in lower case', async () => {
      await save({ title: '  {title}  ', color: '#AABBCC' });
      const [row] = await rows(`SELECT content FROM "NotificationTemplate"`);
      expect(row.content).toEqual({ title: '{title}', color: '#aabbcc' });
    });

    it('writes nothing, and says so, when nothing changed', async () => {
      await save({ title: 'A' });
      expect(await save({ title: 'A' }, 1)).toEqual({ ok: true, version: 1, changed: false });
      expect(await rows(`SELECT 1 FROM "NotificationTemplateVersion"`)).toHaveLength(1);
      expect(await audit()).toHaveLength(1);
    });

    it('counts the versions, and keeps every one in the history', async () => {
      await save({ title: 'A' });
      expect(await save({ title: 'B' }, 1)).toMatchObject({ ok: true, version: 2 });
      expect(await save({ title: 'C' }, 2)).toMatchObject({ ok: true, version: 3 });
      expect(
        await rows(`SELECT version, content FROM "NotificationTemplateVersion" ORDER BY version`),
      ).toEqual([
        { version: 1, content: { title: 'A' } },
        { version: 2, content: { title: 'B' } },
        { version: 3, content: { title: 'C' } },
      ]);
    });

    it('refuses a save over a version the editor did not see, and changes nothing', async () => {
      await save({ title: 'A' });
      await save({ title: 'B' }, 1);
      expect(await save({ title: 'Mine' }, 1)).toEqual({ ok: false, code: 'conflict' });
      expect(await save({ title: 'Mine' }, 0)).toEqual({ ok: false, code: 'conflict' });
      const [row] = await rows(`SELECT content, version FROM "NotificationTemplate"`);
      expect(row).toEqual({ content: { title: 'B' }, version: 2 });
    });

    it('lets only one of two saves made at the same time through', async () => {
      const [a, b] = await Promise.all([save({ title: 'A' }), save({ title: 'B' })]);
      const results = [a, b].map((r) => (r.ok ? 'ok' : r.code)).sort();
      expect(results).toEqual(['conflict', 'ok']);
      expect(await rows(`SELECT version FROM "NotificationTemplateVersion"`)).toHaveLength(1);
    });

    it('answers what is wrong, in codes, and stores nothing', async () => {
      const unknown = await save({ title: '{nope}' });
      expect(unknown).toMatchObject({ ok: false, code: 'invalid' });
      if (!unknown.ok) {
        expect(unknown.issues).toEqual([
          { path: 'title', code: 'unknownVariable', params: { variable: 'nope' } },
        ]);
      }
      const shape = await save({ eyebrow: '', surprise: true });
      expect(shape).toMatchObject({ ok: false, code: 'invalid' });
      if (!shape.ok) {
        expect(shape.issues).toEqual(
          expect.arrayContaining([
            { path: 'eyebrow', code: 'required' },
            { path: '', code: 'unknownField' },
          ]),
        );
      }
      expect(await rows(`SELECT 1 FROM "NotificationTemplate"`)).toHaveLength(0);
      expect(await audit()).toHaveLength(0);
    });

    it('refuses a channel the notification is not sent on', async () => {
      expect(
        await service.saveTemplate(
          { type: 'memberRemoved', scope: 'email', content: { title: 'x' }, expectedVersion: 0 },
          paula,
        ),
      ).toEqual({ ok: false, code: 'channelNotForType' });
    });

    it('says in the audit entry which mentions and which address the template reaches, and never the text', async () => {
      await service.addMention(
        {
          platform: 'discord',
          kind: 'role',
          key: 'bureau',
          label: 'Bureau',
          externalId: '123456789012345678',
        },
        paula,
      );
      await save(
        {
          above: 'Secret words {@everyone} {@role:bureau}',
          button: { enabled: true, url: 'https://forms.example.fr/join' },
        },
        0,
        'discord',
      );
      const entries = await audit();
      const entry = entries.find((e) => e.action === 'notification_template.update');
      expect(entry?.metadata).toMatchObject({
        scope: 'discord',
        fields: ['above', 'button'],
        mentions: ['everyone', 'role:bureau'],
        buttonUrl: 'https://forms.example.fr/join',
      });
      expect(JSON.stringify(entries)).not.toContain('Secret words');
    });

    it('keeps the last 50 versions of the history, and never reuses a number', async () => {
      await save({ title: 'v1' });
      for (let version = 2; version <= 53; version += 1) {
        await save({ title: `v${version}` }, version - 1);
      }
      const kept = await rows(`SELECT version FROM "NotificationTemplateVersion" ORDER BY version`);
      expect(kept).toHaveLength(50);
      expect(kept[0]).toEqual({ version: 4 });
      expect(kept[49]).toEqual({ version: 53 });
    });
  });

  describe('making a channel different', () => {
    it('starts the channel as a copy of what was written for all of them, without what the channel cannot hold', async () => {
      await service.saveTemplate(
        {
          type: 'eventConfirmed',
          scope: 'all',
          content: { title: 'Shared', subject: 'A subject', above: '{@here}' },
          expectedVersion: 0,
        },
        paula,
      );
      expect(
        await service.customizeChannel({ type: 'eventConfirmed', channel: 'slack' }, paula),
      ).toEqual({
        ok: true,
        version: 1,
      });
      expect(
        await service.customizeChannel({ type: 'eventConfirmed', channel: 'email' }, paula),
      ).toEqual({
        ok: true,
        version: 1,
      });
      const copies = await rows(
        `SELECT scope, content FROM "NotificationTemplate" WHERE scope <> 'all' ORDER BY scope`,
      );
      expect(copies).toEqual([
        { scope: 'email', content: { title: 'Shared', subject: 'A subject' } },
        { scope: 'slack', content: { title: 'Shared', above: '{@here}' } },
      ]);
    });

    it('starts empty when nothing was shared, and refuses a channel that already differs', async () => {
      expect(
        await service.customizeChannel({ type: 'eventReminder', channel: 'discord' }, paula),
      ).toEqual({
        ok: true,
        version: 1,
      });
      expect(
        await service.customizeChannel({ type: 'eventReminder', channel: 'discord' }, paula),
      ).toEqual({
        ok: false,
        code: 'conflict',
      });
    });

    it('does not exist for a channel the notification is not sent on', async () => {
      expect(
        await service.customizeChannel({ type: 'memberRemoved', channel: 'email' }, paula),
      ).toEqual({
        ok: false,
        code: 'channelNotForType',
      });
    });
  });

  describe('going back to the platform’s own', () => {
    const save = (scope: 'all' | 'slack', content: unknown, expectedVersion = 0) =>
      service.saveTemplate({ type: 'eventConfirmed', scope, content, expectedVersion }, paula);

    it('removes the template, keeps what it was in the history, and goes on counting', async () => {
      await save('all', { title: 'A' });
      expect(await service.resetTemplate({ type: 'eventConfirmed', scope: 'all' }, paula)).toEqual({
        ok: true,
        changed: true,
      });
      expect(await rows(`SELECT 1 FROM "NotificationTemplate"`)).toHaveLength(0);
      expect(await save('all', { title: 'B' })).toMatchObject({ ok: true, version: 3 });
      expect(
        await rows(`SELECT version, action FROM "NotificationTemplateVersion" ORDER BY version`),
      ).toEqual([
        { version: 1, action: 'save' },
        { version: 2, action: 'reset' },
        { version: 3, action: 'save' },
      ]);
    });

    it('says nothing changed, and writes nothing, when there was nothing to reset', async () => {
      expect(await service.resetTemplate({ type: 'eventConfirmed', scope: 'all' }, paula)).toEqual({
        ok: true,
        changed: false,
      });
      expect(await audit()).toHaveLength(0);
    });

    it('resets every scope of a notification at once, and only that notification’s', async () => {
      await save('all', { title: 'A' });
      await save('slack', { title: 'B' });
      await service.saveTemplate(
        { type: 'eventReminder', scope: 'all', content: { title: 'C' }, expectedVersion: 0 },
        paula,
      );
      expect(await service.resetType({ type: 'eventConfirmed' }, paula)).toEqual({
        ok: true,
        scopes: ['all', 'slack'],
      });
      expect(await rows(`SELECT type FROM "NotificationTemplate"`)).toEqual([
        { type: 'eventReminder' },
      ]);
      const entries = (await audit()).filter(
        (entry) => entry.action === 'notification_template.reset_type',
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]?.metadata).toMatchObject({
        type: 'eventConfirmed',
        scopes: ['all', 'slack'],
      });
    });
  });

  describe('restoring a version', () => {
    const save = (content: unknown, expectedVersion = 0) =>
      service.saveTemplate(
        { type: 'eventConfirmed', scope: 'all', content, expectedVersion },
        paula,
      );

    it('puts an earlier version back as a new one, and leaves the history as it was', async () => {
      await save({ title: 'A' });
      await save({ title: 'B' }, 1);
      expect(
        await service.restoreVersion({ type: 'eventConfirmed', scope: 'all', version: 1 }, paula),
      ).toEqual({ ok: true, version: 3 });
      const [row] = await rows(`SELECT content, version FROM "NotificationTemplate"`);
      expect(row).toEqual({ content: { title: 'A' }, version: 3 });
      expect(
        await rows(`SELECT version, action FROM "NotificationTemplateVersion" ORDER BY version`),
      ).toEqual([
        { version: 1, action: 'save' },
        { version: 2, action: 'save' },
        { version: 3, action: 'restore:1' },
      ]);
      const entry = (await audit()).find((e) => e.action === 'notification_template.restore');
      expect(entry?.metadata).toMatchObject({ version: 3, restored: 1 });
    });

    it('restoring a reset resets again', async () => {
      await save({ title: 'A' });
      await service.resetTemplate({ type: 'eventConfirmed', scope: 'all' }, paula);
      await save({ title: 'B' }, 0);
      expect(
        await service.restoreVersion({ type: 'eventConfirmed', scope: 'all', version: 2 }, paula),
      ).toMatchObject({ ok: true });
      expect(await rows(`SELECT 1 FROM "NotificationTemplate"`)).toHaveLength(0);
    });

    it('answers "not found" for a version that is gone', async () => {
      expect(
        await service.restoreVersion({ type: 'eventConfirmed', scope: 'all', version: 9 }, paula),
      ).toEqual({ ok: false, code: 'notFound' });
    });

    it('checks the old version again: one that mentions somebody who is gone is not put back', async () => {
      await service.addMention(
        {
          platform: 'discord',
          kind: 'role',
          key: 'bureau',
          label: 'Bureau',
          externalId: '123456789012345678',
        },
        paula,
      );
      await service.saveTemplate(
        {
          type: 'eventConfirmed',
          scope: 'discord',
          content: { above: '{@role:bureau} hi' },
          expectedVersion: 0,
        },
        paula,
      );
      await service.saveTemplate(
        {
          type: 'eventConfirmed',
          scope: 'discord',
          content: { title: 'Without' },
          expectedVersion: 1,
        },
        paula,
      );
      const [mention] = await rows(`SELECT id FROM "NotificationMention"`);
      expect(await service.removeMention({ id: mention.id }, paula)).toEqual({ ok: true });
      const result = await service.restoreVersion(
        { type: 'eventConfirmed', scope: 'discord', version: 1 },
        paula,
      );
      expect(result).toMatchObject({ ok: false, code: 'restoreInvalid' });
      const [row] = await rows(`SELECT content FROM "NotificationTemplate"`);
      expect(row.content).toEqual({ title: 'Without' });
    });
  });

  describe('the revision of the platform’s own notification', () => {
    it('keeps the revision a template was written over, and says it was read when asked', async () => {
      await service.saveTemplate(
        { type: 'eventConfirmed', scope: 'all', content: { title: 'A' }, expectedVersion: 0 },
        paula,
      );
      await database.client.query(`UPDATE "NotificationTemplate" SET "basedOnRevision" = 0`);
      await service.saveTemplate(
        { type: 'eventConfirmed', scope: 'all', content: { title: 'B' }, expectedVersion: 1 },
        paula,
      );
      // saving does not read the news for the BDE
      expect((await rows(`SELECT "basedOnRevision" FROM "NotificationTemplate"`))[0]).toEqual({
        basedOnRevision: 0,
      });
      expect(
        await service.acknowledgeRevision({ type: 'eventConfirmed', scope: 'all' }, paula),
      ).toEqual({ ok: true });
      expect((await rows(`SELECT "basedOnRevision" FROM "NotificationTemplate"`))[0]).toEqual({
        basedOnRevision: 1,
      });
    });
  });

  describe('the people, roles and groups that can be mentioned', () => {
    const bureau = {
      platform: 'discord' as const,
      kind: 'role' as const,
      key: 'bureau',
      label: 'Bureau',
      externalId: '123456789012345678',
    };

    it('adds one, once for a name on a platform, and says so in the audit trail', async () => {
      const added = await service.addMention(bureau, paula);
      expect(added).toMatchObject({ ok: true });
      expect(await service.addMention(bureau, paula)).toEqual({ ok: false, code: 'mentionExists' });
      // the same name on the other platform is another entry
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
      const entry = (await audit()).find((e) => e.action === 'notification_mention.add');
      expect(entry?.metadata).toEqual({ platform: 'discord', kind: 'role', key: 'bureau' });
    });

    it.each([
      [{ ...bureau, key: 'Bad Key' }, 'key'],
      [{ ...bureau, key: '' }, 'key'],
      [{ ...bureau, externalId: '12' }, 'externalId'],
      [{ ...bureau, kind: 'group' as const }, 'kind'],
      [{ ...bureau, label: '   ' }, 'label'],
    ])('refuses what does not fit (%#)', async (input, path) => {
      const result = await service.addMention(input, paula);
      expect(result).toMatchObject({ ok: false, code: 'invalid' });
      if (!result.ok) expect(result.issues?.map((issue) => issue.path)).toContain(path);
    });

    it('refuses to take one away while a template mentions it, and says which', async () => {
      const added = await service.addMention(bureau, paula);
      await service.saveTemplate(
        {
          type: 'eventReminder',
          scope: 'discord',
          content: { above: '{@role:bureau}' },
          expectedVersion: 0,
        },
        paula,
      );
      if (!added.ok) throw new Error('not added');
      expect(await service.removeMention({ id: added.id }, paula)).toEqual({
        ok: false,
        code: 'mentionInUse',
        detail: 'eventReminder:discord',
      });
      await service.resetTemplate({ type: 'eventReminder', scope: 'discord' }, paula);
      expect(await service.removeMention({ id: added.id }, paula)).toEqual({ ok: true });
    });

    it('does not count the other platform’s templates as using a name', async () => {
      const added = await service.addMention(bureau, paula);
      await service.addMention(
        {
          platform: 'slack',
          kind: 'group',
          key: 'bureau',
          label: 'Bureau',
          externalId: 'S0614TZR7',
        },
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
      if (!added.ok) throw new Error('not added');
      expect(await service.removeMention({ id: added.id }, paula)).toEqual({ ok: true });
    });

    it('does not accept a template that mentions somebody who is not in the directory', async () => {
      const result = await service.saveTemplate(
        {
          type: 'eventReminder',
          scope: 'discord',
          content: { above: '{@role:nobody}' },
          expectedVersion: 0,
        },
        paula,
      );
      expect(result).toMatchObject({ ok: false, code: 'invalid' });
    });
  });
});
