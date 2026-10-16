// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PERSONAS, PLATFORM_VARIANTS } from '../personas';
import { CASES } from './actions';
import {
  discoverApiRoutes,
  discoverExportedActions,
  discoverInlineActions,
  discoverPages,
} from './discover';
import { API, INLINE_ACTIONS, PAGES } from './matrix';

/**
 * The access matrix must say something about everything the platform answers. A page, an API route or a server action
 * that nobody declared fails here, in the CI of every pull request, instead of going unnoticed until somebody finds
 * out who can open it.
 */

const names = (items: readonly string[]) => [...new Set(items)].sort();

describe('the access matrix covers every page, route and action of the source', () => {
  it('has an entry for each page, and none for a page that is gone', () => {
    expect(names(PAGES.map((spec) => spec.route))).toEqual(names(discoverPages()));
  });

  it('has an entry for each API route, and none for a route that is gone', () => {
    expect(names(API.map((spec) => spec.route))).toEqual(names(discoverApiRoutes()));
  });

  it('has a case for each exported server action, and none for an action that is gone', () => {
    expect(names(CASES.map((item) => item.action))).toEqual(discoverExportedActions());
  });

  it('declares the actions written inside components, and they only hand over to an action', () => {
    const found = discoverInlineActions();
    const perFile: Record<string, number> = {};
    for (const action of found) perFile[action.file] = (perFile[action.file] ?? 0) + 1;
    expect(perFile).toEqual(INLINE_ACTIONS);

    const exported = new Set(discoverExportedActions().map((action) => action.split('.')[1]));
    for (const action of found) {
      // never a query of its own: whatever it does goes through an action that checks who is asking
      expect(action.body, action.file).not.toMatch(/\bprisma\b/);
      const calls = [...action.body.matchAll(/\b(\w+)\(/g)].map((match) => match[1] ?? '');
      expect(
        calls.some((name) => exported.has(name) || ['signIn', 'signOut'].includes(name)),
        `${action.file}: ${action.body.slice(0, 120)}`,
      ).toBe(true);
    }
  });
});

describe('the matrix is complete', () => {
  it('answers for every persona and every variant, on every probe', () => {
    for (const spec of [...PAGES, ...API]) {
      expect(spec.probes.length, spec.route).toBeGreaterThan(0);
      for (const probe of spec.probes) {
        for (const persona of PERSONAS) {
          for (const variant of PLATFORM_VARIANTS) {
            expect(
              () => probe.expect(persona.key, variant),
              `${spec.route} ${probe.label}`,
            ).not.toThrow();
          }
        }
      }
    }
  });

  it('never lets the visitor, a removed member or somebody who waits into a page of the application', () => {
    for (const spec of PAGES.filter(
      (item) =>
        ![
          '/',
          '/privacy',
          '/auth-error',
          '/unavailable',
          '/pending',
          '/setup',
          '/[...rest]',
        ].includes(item.route),
    )) {
      for (const probe of spec.probes) {
        for (const who of ['anonymous', 'deleted', 'pending'] as const) {
          for (const variant of PLATFORM_VARIANTS) {
            expect(probe.expect(who, variant).kind, `${who} ${spec.route} ${probe.label}`).not.toBe(
              'ok',
            );
          }
        }
      }
    }
  });

  it('has no case where somebody who is not signed in may do something', () => {
    for (const item of CASES) {
      for (const who of ['anonymous', 'deleted', 'pending'] as const) {
        for (const variant of PLATFORM_VARIANTS) {
          expect(item.allowed(who, variant), `${who} ${item.action} ${item.label}`).toBe(false);
        }
      }
    }
  });

  it('asks of an allowed persona the tables that must change, for every case that changes the database', () => {
    for (const item of CASES) {
      const someoneAllowed = PERSONAS.some((who) => item.allowed(who.key, 'events-enabled'));
      if (!someoneAllowed || item.control === 'answers') continue;
      expect(item.effect?.length, `${item.action}: ${item.label}`).toBeGreaterThan(0);
    }
  });

  it('turns every action of the events module off with the module', () => {
    for (const item of CASES.filter((candidate) =>
      /^(events|shared-calendar)\./.test(candidate.action),
    )) {
      for (const who of PERSONAS) {
        expect(
          item.allowed(who.key, 'events-disabled'),
          `${who.key} ${item.action} ${item.label}`,
        ).toBe(false);
      }
    }
  });

  it('keeps the settings and the installer out of reach of everybody but the owner (and the installer of everybody)', () => {
    for (const item of CASES.filter((candidate) => candidate.action.startsWith('settings.'))) {
      expect(
        PERSONAS.filter((who) => item.allowed(who.key, 'events-enabled')).map((who) => who.key),
      ).toEqual(['owner']);
    }
    for (const item of CASES.filter((candidate) =>
      /^(setup|dev-impersonation)\./.test(candidate.action),
    )) {
      expect(PERSONAS.filter((who) => item.allowed(who.key, 'events-enabled'))).toEqual([]);
    }
  });
});
