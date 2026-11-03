import { describe, expect, it } from 'vitest';
import { homeFor } from './home';
import type { EffectiveSession } from './session';

const session = (realStatus: 'PENDING' | 'MEMBER' | 'OWNER', missing: boolean): EffectiveSession =>
  ({
    // while an id is missing the session is the one of an account that waits, whatever the account is
    user: { status: missing ? 'PENDING' : realStatus },
    realStatus,
    missingIds: missing ? ['discord'] : [],
    requiredIds: missing ? ['discord'] : [],
  }) as unknown as EffectiveSession;

describe('where a signed-in account belongs', () => {
  it('is the step that asks the ids for an account that waits and has one to give, before the waiting page', () => {
    expect(homeFor(session('PENDING', true))).toBe('/identifiers');
  });

  it('is the dashboard, where the window asks it, for an approved account that has one to give', () => {
    expect(homeFor(session('MEMBER', true))).toBe('/dashboard');
    expect(homeFor(session('OWNER', true))).toBe('/dashboard');
  });

  it('is the waiting page for an account that waits and has nothing to give, and the dashboard for the others', () => {
    expect(homeFor(session('PENDING', false))).toBe('/pending');
    expect(homeFor(session('MEMBER', false))).toBe('/dashboard');
    expect(homeFor(session('OWNER', false))).toBe('/dashboard');
  });
});
