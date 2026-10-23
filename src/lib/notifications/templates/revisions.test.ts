import { describe, expect, it } from 'vitest';
import { ITEMS } from './catalog';
import { changesSince, isOutdated, REVISION_CHANGES, REVISIONS } from './revisions';
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
