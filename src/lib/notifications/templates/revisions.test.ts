import { afterEach, describe, expect, it } from 'vitest';
import en from '../../../../messages/en.json';
import fr from '../../../../messages/fr.json';
import { ITEMS } from './catalog';
import {
  changesSince,
  isOutdated,
  REVISION_CHANGES,
  REVISIONS,
  type RevisionChange,
} from './revisions';
import type { TemplateType } from './types';

const TYPES = Object.keys(ITEMS) as TemplateType[];

describe('the revision of the platform’s own notifications', () => {
  it('has a revision for every type, starting at 1', () => {
    for (const type of TYPES) expect(REVISIONS[type]).toBeGreaterThanOrEqual(1);
    expect(Object.keys(REVISIONS).sort()).toEqual([...TYPES].sort());
  });

  it('says a template is outdated only when the platform moved past the revision it was written over', () => {
    for (const type of TYPES) {
      expect(isOutdated(type, REVISIONS[type])).toBe(false);
      expect(isOutdated(type, REVISIONS[type] + 1)).toBe(false);
      expect(isOutdated(type, REVISIONS[type] - 1)).toBe(true);
    }
  });

  it('lists what changed since a revision, for the types it concerns only', () => {
    for (const type of TYPES) expect(changesSince(type, REVISIONS[type])).toEqual([]);
  });

  it('only describes changes of revisions that exist, once, for known types, newest last', () => {
    let previous = 1;
    for (const change of REVISION_CHANGES) {
      expect(change.revision).toBeGreaterThan(previous - 1);
      previous = change.revision;
      expect(change.revision).toBeLessThanOrEqual(Math.max(...Object.values(REVISIONS)));
      for (const type of change.types) expect(TYPES).toContain(type);
      expect(change.note).toMatch(/^[a-zA-Z0-9]+$/);
    }
  });
});

describe('what the platform changed', () => {
  const changes = REVISION_CHANGES as RevisionChange[];
  afterEach(() => {
    changes.length = 0;
  });

  it('is listed for a template written before it, for the types it concerns only', () => {
    changes.push(
      { revision: 2, types: ['eventConfirmed'], note: 'newFooter' },
      { revision: 3, types: ['memberPending'], note: 'newLine' },
    );
    expect(changesSince('eventConfirmed', 1).map((change) => change.note)).toEqual(['newFooter']);
    expect(changesSince('eventConfirmed', 2)).toEqual([]);
    expect(changesSince('memberPending', 1).map((change) => change.note)).toEqual(['newLine']);
    expect(changesSince('memberRemoved', 1)).toEqual([]);
  });

  it('has a sentence in both languages for every change of the platform', () => {
    for (const messages of [fr, en]) {
      const written = (messages as { templates: { revisions: Record<string, string> } }).templates
        .revisions;
      for (const change of REVISION_CHANGES) expect(written[change.note], change.note).toBeTruthy();
    }
  });
});
