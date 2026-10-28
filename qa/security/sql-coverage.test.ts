// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CASES } from '../access/actions';
import {
  discoverActionFields,
  discoverActionParameters,
  discoverExportedActions,
} from '../access/discover';
import { NO_TEXT, TEXT_ARGUMENTS, attackSurface } from './sql-args';

/**
 * The `sql` suite attacks every server action that is given something (qa/security/sql.ts), and the gate of the ZAP scan accepts its SQL injection
 * rule only where the suite attacked (zap-gate.mjs). Which actions take something is read from the source, as the coverage of the browser
 * scenarios does (`server-actions-coverage.test.ts`): an exported action with a parameter must be one the suite attacks, or say, here, why it
 * takes nothing a request could change. A new action fails here until its case of the access matrix (or `TEXT_ARGUMENTS`) holds the text a page sends.
 */

const context = { seriesStart: 0, intraHashes: {} };
const parameters = discoverActionParameters();

const attacked = (action: string) =>
  CASES.filter((item) => item.action === action).some(
    (item) => attackSurface(item, context).leaves.length > 0,
  );

describe('the sql suite attacks every server action that is given something', () => {
  it('finds the actions of the platform and their parameters (the scan itself works)', () => {
    expect(parameters['events.createEvent']).toBe(2);
    expect(parameters['roles.deleteRole']).toBeGreaterThanOrEqual(1);
    expect(parameters['settings.removeLogo']).toBe(0);
    expect(Object.keys(parameters).sort()).toEqual(discoverExportedActions());
  });

  it('attacks every action that has a parameter, or says why it takes no text', () => {
    const missing = Object.entries(parameters)
      .filter(([action, count]) => count > 0 && !attacked(action) && !(action in NO_TEXT))
      .map(([action]) => action);
    expect(
      missing,
      `no string, number or boolean in the arguments of any case of ${missing.join(', ')}: ` +
        'put the text a page sends in the case of the access matrix (qa/access/actions.ts), or in TEXT_ARGUMENTS (qa/security/sql-args.ts) ' +
        'when the case only tests the gate, or say in NO_TEXT why the action takes nothing a request could change.',
    ).toEqual([]);
  });

  it('keeps no stale entry: an action that takes no text is a real action, with a parameter, that is not attacked', () => {
    for (const [action, reason] of Object.entries(NO_TEXT)) {
      expect(parameters[action], `${action} is not an action`).toBeGreaterThan(0);
      expect(attacked(action), `${action} is attacked: remove it from NO_TEXT`).toBe(false);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it('has text arguments only for real actions, each with a case of the matrix', () => {
    const cases = new Set(CASES.map((item) => item.action));
    for (const action of Object.keys(TEXT_ARGUMENTS)) {
      expect(parameters[action], `${action} is not an action`).toBeGreaterThan(0);
      expect(cases.has(action), `${action} has no case in the matrix`).toBe(true);
      expect(
        attacked(action),
        `${action}: the arguments of TEXT_ARGUMENTS hold nothing to attack`,
      ).toBe(true);
    }
  });

  it('finds the fields an action reads from a form, which the form of the matrix may not hold', () => {
    const fields = discoverActionFields();
    expect(fields['events.updateEvent']).toEqual(
      expect.arrayContaining(['scope', 'occurrence', 'assignees']),
    );
    expect(fields['roles.createRole']).toEqual(expect.arrayContaining(['allPermissions']));
    const update = CASES.find((item) => item.action === 'events.updateEvent');
    const names = attackSurface(update!, context).leaves.map((leaf) => leaf.name);
    expect(names).toEqual(expect.arrayContaining(['title', 'scope', 'occurrence', 'assignees']));
  });
});
