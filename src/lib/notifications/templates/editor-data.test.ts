// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredMention, StoredTemplate } from './store';

/** What the page of the editor is given for a notification: the saved templates, the platform's words, the examples, the directory. */

const mocks = vi.hoisted(() => ({
  templates: [] as StoredTemplate[],
  mentions: [] as StoredMention[],
  revisionChanges: [] as Array<{ since: number; note: string }>,
}));

vi.mock('@/config', () => ({
  getConfig: () => ({
    bde: {
      name: 'BDE Nice',
      defaultLocale: 'fr',
      timezone: 'Europe/Paris',
      accentColor: '#2F5BEA',
    },
    modules: { enabled: ['events'] },
    notifications: {
      eventConfirmed: ['discord', 'email'],
      eventReminder: [],
      eventProposed: [],
      eventApproved: [],
      eventRefused: [],
      memberPending: ['slack'],
      memberApproved: [],
      memberRemoved: ['email', 'discord'],
      intraRequested: ['discord'],
      intraChanged: [],
      intraCancelled: [],
      intraPublished: [],
      intraRefused: [],
      backupFailed: [],
      backupStale: [],
    },
  }),
}));
vi.mock('./store', () => ({
  loadTemplates: async (type?: string) =>
    mocks.templates.filter((row) => !type || row.type === type),
  loadMentions: async () => ({ rows: mocks.mentions, directory: {} }),
}));
vi.mock('./revisions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./revisions')>();
  return {
    ...actual,
    changesSince: (type: string, revision: number) =>
      mocks.revisionChanges.filter((change) => change.since > revision && type),
  };
});

const { customisedScopes, listedTypes, loadEditorData } = await import('./editor-data');

const row = (over: Partial<StoredTemplate>): StoredTemplate => ({
  type: 'eventConfirmed',
  scope: 'all',
  content: { title: 'Mon titre' },
  version: 2,
  basedOnRevision: 1,
  updatedAt: new Date('2026-10-22T10:00:00Z'),
  updatedByLogin: 'paula',
  lastFallbackAt: null,
  lastFallbackReason: null,
  ...over,
});

beforeEach(() => {
  mocks.templates = [];
  mocks.mentions = [];
  mocks.revisionChanges = [];
});

describe('the notifications the page lists', () => {
  it('leaves out those of a module that is off', () => {
    expect(listedTypes(['events'])).toHaveLength(10);
    // the ones about the backups are the owners' whatever the modules
    expect(listedTypes([])).toEqual([
      'memberPending',
      'memberApproved',
      'memberRemoved',
      'backupFailed',
      'backupStale',
    ]);
  });

  it('adds those about the intra only while the platform publishes there (and the events module is on)', () => {
    expect(listedTypes(['events'], true)).toHaveLength(15);
    expect(listedTypes(['events'], true)).toEqual(
      expect.arrayContaining([
        'intraRequested',
        'intraChanged',
        'intraCancelled',
        'intraPublished',
        'intraRefused',
      ]),
    );
    expect(listedTypes(['events'], false).some((type) => type.startsWith('intra'))).toBe(false);
    expect(listedTypes([], true).some((type) => type.startsWith('intra'))).toBe(false);
  });

  it('gives the editor of a message about the intra its own facts, variables and words', async () => {
    const data = await loadEditorData('intraRequested');
    expect(data.items).toEqual([
      'when',
      'repeats',
      'where',
      'description',
      'intraFields',
      'requestedBy',
    ]);
    expect(data.variables.map((variable) => variable.id)).toContain('requester');
    expect(data.variables.find((variable) => variable.id === 'requester')?.sample).toBe(
      'Camille Martin',
    );
    expect(data.channels).toEqual(['discord', 'slack', 'email']);
    expect(data.defaults.discord?.items.intraFields?.label).toBeTruthy();
  });

  it('counts the notifications a BDE customised, by tab', async () => {
    mocks.templates = [
      row({ scope: 'all' }),
      row({ scope: 'slack' }),
      row({ type: 'memberPending', scope: 'discord' }),
    ];
    expect(await customisedScopes()).toEqual({
      eventConfirmed: ['all', 'slack'],
      memberPending: ['discord'],
    });
  });
});

describe('what the editor is given for a notification', () => {
  it('is the platform’s own for a notification nobody customised: no template, version 0, nothing to warn about', async () => {
    const data = await loadEditorData('eventConfirmed');
    expect(data.type).toBe('eventConfirmed');
    expect(data.locale).toBe('fr');
    expect(data.channels).toEqual(['discord', 'slack', 'email']);
    expect(data.shared).toEqual(['discord', 'slack', 'email']);
    expect(data.ticked).toEqual(['discord', 'email']);
    for (const scope of ['all', 'discord', 'slack', 'email'] as const) {
      expect(data.scopes[scope]).toEqual({
        content: null,
        version: 0,
        updatedByLogin: null,
        updatedAt: null,
        fallback: null,
        outdated: [],
      });
    }
    expect(data.bde).toEqual({ name: 'BDE Nice', accent: '#2F5BEA' });
  });

  it('carries what the BDE saved, who saved it and when', async () => {
    mocks.templates = [
      row({}),
      row({ scope: 'discord', content: { footer: 'Merci' }, version: 5 }),
    ];
    const data = await loadEditorData('eventConfirmed');
    expect(data.scopes.all).toMatchObject({
      content: { title: 'Mon titre' },
      version: 2,
      updatedByLogin: 'paula',
      updatedAt: '2026-10-22T10:00:00.000Z',
    });
    expect(data.scopes.discord).toMatchObject({ content: { footer: 'Merci' }, version: 5 });
    expect(data.scopes.slack.version).toBe(0);
  });

  it('says when a template could not be used the last time, and why', async () => {
    mocks.templates = [
      row({ lastFallbackAt: new Date('2026-10-21T09:00:00Z'), lastFallbackReason: 'invalid' }),
    ];
    const data = await loadEditorData('eventConfirmed');
    expect(data.scopes.all.fallback).toEqual({ at: '2026-10-21T09:00:00.000Z', reason: 'invalid' });
  });

  it('lists what the platform improved since the template was written', async () => {
    mocks.templates = [row({ basedOnRevision: 1 })];
    mocks.revisionChanges = [
      { since: 2, note: 'newFooter' },
      { since: 1, note: 'old' },
    ];
    const data = await loadEditorData('eventConfirmed');
    expect(data.scopes.all.outdated).toEqual(['newFooter']);
  });

  it('gives the platform’s words for each channel, and the words they share for all of them', async () => {
    const data = await loadEditorData('eventConfirmed');
    expect(data.defaults.discord?.eyebrow).toBe('Nouvel événement confirmé');
    expect(data.defaults.email?.subject).toContain('{title}');
    expect(data.defaults.all.title).toBe('{title}');
    expect(data.defaults.all.emoji).toBe('');
  });

  it('knows which channels a notification cannot be sent on, and where a shared template stops', async () => {
    const removed = await loadEditorData('memberRemoved');
    expect(removed.channels).toEqual(['discord', 'slack']);
    expect(removed.ticked).toEqual(['discord']);
    const approved = await loadEditorData('memberApproved');
    expect(approved.shared).toEqual(['discord', 'slack']);
    expect(approved.channels).toEqual(['discord', 'slack', 'email']);
    expect(approved.nativeOrder.email).toEqual(['summary', 'role']);
  });

  it('gives the facts of the type and the order each channel shows them in', async () => {
    const data = await loadEditorData('eventConfirmed');
    expect(data.items).toEqual([
      'when',
      'repeats',
      'where',
      'description',
      'category',
      'assignees',
    ]);
    expect(data.nativeOrder.discord?.[0]).toBe('when');
    expect(data.nativeOrder.slack?.[0]).toBe('description');
  });

  it('gives each variable of the type with its value in the example, so that the choice is concrete', async () => {
    const data = await loadEditorData('eventConfirmed');
    const byId = Object.fromEntries(
      data.variables.map((variable) => [variable.id, variable.sample]),
    );
    expect(byId.title).toBe('Soirée de rentrée');
    expect(byId.place).toBe('Foyer des étudiants');
    expect(byId.bde).toBe('BDE Nice');
    expect(Object.keys(byId)).not.toContain('author');
    const member = await loadEditorData('memberPending');
    expect(member.variables.map((variable) => variable.id)).toContain('login');
    const refused = await loadEditorData('eventRefused');
    expect(refused.variables.map((variable) => variable.id)).toContain('comment');
  });

  it('gives the directory of people to mention, without the author or the date', async () => {
    mocks.mentions = [
      {
        id: 'm1',
        key: 'bureau',
        platform: 'discord',
        kind: 'role',
        label: 'Bureau',
        externalId: '123456789012345678',
        createdByLogin: 'paula',
        createdAt: new Date(),
      },
    ];
    const data = await loadEditorData('eventConfirmed');
    expect(data.mentions).toEqual([
      {
        id: 'm1',
        key: 'bureau',
        platform: 'discord',
        kind: 'role',
        label: 'Bureau',
        externalId: '123456789012345678',
      },
    ]);
  });
});
