import { randomBytes } from 'node:crypto';
import type { Client } from 'pg';
import type { Platform } from '../access/http';
import { changedTables, snapshot, withDatabase } from '../access/http';
import { CASES, eventForm, type ActionCase, type Context } from '../access/actions';
import { callAction, contextOf, locate, readManifest } from '../access/actions-run';
import { resetDatabase } from '../reset';
import { isNotFoundPage, Report, send } from './core';
import { attackSurface } from './sql-args';
import { withLeaf, type Leaf } from './sql-targets';

/**
 * SQL injection through every server action that is given text. It is what ZAP's active scan reports (rule 40018, "the page results were
 * successfully manipulated using the boolean conditions"): the same field sent with a condition that is true and with one that is false. The scan
 * gives no evidence, and the platform builds no SQL from a string anywhere in `src/` (Prisma binds every value; a Semgrep rule forbids the
 * rest), but "the code does not do it" is not the same as "the platform does not do it": this plays the pairs against the real image and reads what
 * the database holds.
 *
 * **Every action of the platform, from the cases of the access matrix** (`qa/access/actions.ts`, which the CI forces to hold a case for each action
 * of the image, so a new action is attacked without anybody adding it here): for every string in its arguments (a field of a form, a string of an object,
 * an identifier or a code given as an argument: a crafted request can put anything in them), the string is replaced, one at a time, by
 *
 *  - the pairs the scan sends, a condition that is true and one that is false, in each way a value can be closed: the outcome (the status of the
 *    answer, the tables written) must be **the same whether the condition is true or false**, which is all the scan's rule looks at;
 *  - hostile statements (`DROP TABLE`, `UPDATE "User"`, `UNION SELECT`): **no table may change that the action does not change**, which is where a
 *    statement that ran would show.
 *
 * The two members of a pair are played one after the other; when they differ, each is played again from a database put back to the state the dataset leaves it in
 * (`resetDatabase`), because what the first one wrote (a name that is now taken) is a reason to answer otherwise that has nothing to do with the condition. `sql-targets.ts` has the pure parts, `sql-proven.ts` says which pages and fields this
 * proves, and the gate of ZAP accepts the rule only there (`zap-gate.mjs`).
 */

const tag = `sql${randomBytes(3).toString('hex')}`;

/** What the scan sends: a true condition and a false one, in each way a value can be closed. */
export const PAIRS: [string, string][] = [
  [`x' AND '1'='1' -- `, `x' AND '1'='2' -- `],
  [`x" AND "1"="1" -- `, `x" AND "1"="2" -- `],
  [`x AND 1=1 -- `, `x AND 1=2 -- `],
  [`x' OR '1'='1`, `x' OR '1'='2`],
];

export const HOSTILE = [
  `'; DROP TABLE "Event"; --`,
  `1; UPDATE "User" SET status='OWNER'; --`,
  `' UNION SELECT login, "calendarToken" FROM "User" --`,
];

/**
 * What an action writes besides what its cases say, by family of actions, and why: these are the tables it writes **as a consequence of what it does**, in
 * some variant of the platform or with some of its fields, and not tables an injection could reach.
 */
const ALSO_WRITTEN: [RegExp, string[], string][] = [
  [
    /^settings\./,
    ['PlatformSettings'],
    'the settings are what an action of the settings writes: a name typed is a name saved',
  ],
  [
    /^events\./,
    [
      'EventAssignee',
      'EventOccurrence',
      'EventOccurrenceAssignee',
      'EventCancellation',
      'IntraRequest',
    ],
    'an event action writes the people in charge and the dates of an event, and keeps the request to publish it on the intra in line, in the same transaction (a platform that publishes there)',
  ],
  [
    /^intra\./,
    ['IntraRequest'],
    'the answers to a request to publish on the intra are written on the request',
  ],
];

/** The tables an action may write: what any case of it must change, the audit log (an action that is refused may still say so there), and the tables above. */
export function writableBy(action: string): Set<string> {
  return new Set([
    'AuditLog',
    ...ALSO_WRITTEN.filter(([family]) => family.test(action)).flatMap(([, tables]) => tables),
    ...CASES.filter((item) => item.action === action).flatMap((item) => item.effect ?? []),
  ]);
}

/** The variant the platform runs in, from what it answers (`qa/platform.sh up --variant …`). */
async function variantOf(platform: Platform): Promise<string> {
  if (isNotFoundPage(await send(platform, '/fr/events', { as: 'owner' }))) return 'events-disabled';
  return isNotFoundPage(await send(platform, '/fr/events/intra', { as: 'owner' }))
    ? 'events-enabled'
    : 'events-intra';
}

interface Outcome {
  status: number;
  changed: string[];
}

const show = (outcome: Outcome) =>
  `${outcome.status} ${outcome.changed.join('+') || 'nothing written'}`;

export async function checkSql(platform: Platform, report: Report): Promise<void> {
  const manifest = readManifest();

  await withDatabase(platform, async (db) => {
    let context: Context = await contextOf(db);
    const fresh = async (item?: ActionCase) => {
      await resetDatabase(db);
      context = await contextOf(db);
      await item?.prepare?.(db, context);
    };

    /** One call as the owner, with one string of the arguments replaced; what the answer was and what the database did. */
    const attempt = async (item: ActionCase, leaf: Leaf, value: string): Promise<Outcome> => {
      const { id, page } = locate(manifest, item.action);
      const before = await snapshot(db);
      const call = await callAction(
        platform,
        'owner',
        id,
        page,
        withLeaf(attackSurface(item, context).args, leaf, value),
      );
      return { status: call.status, changed: changedTables(before, await snapshot(db)) };
    };

    let attacked = 0;
    try {
      for (const item of CASES) {
        await fresh(item);
        const { leaves } = attackSurface(item, context);
        if (leaves.length === 0) continue;
        attacked += 1;
        const startedCase = Date.now();
        const allowed = writableBy(item.action);
        const failures: string[] = [];
        let calls = 0;

        for (const leaf of leaves) {
          for (const [yes, no] of PAIRS) {
            let a = await attempt(item, leaf, yes);
            let b = await attempt(item, leaf, no);
            calls += 2;
            if (show(a) !== show(b)) {
              // What the first call wrote may be why the second answered otherwise (a name taken, a thing done): each again, from the database as the dataset leaves it.
              await fresh(item);
              a = await attempt(item, leaf, yes);
              await fresh(item);
              b = await attempt(item, leaf, no);
              calls += 2;
              if (show(a) !== show(b))
                failures.push(`${leaf.name} "${yes.slice(0, 16)}": ${show(a)} / ${show(b)}`);
            }
          }
          for (const statement of HOSTILE) {
            const outcome = await attempt(item, leaf, statement);
            calls += 1;
            const beyond = outcome.changed.filter((table) => !allowed.has(table));
            if (beyond.length > 0)
              failures.push(`${leaf.name} "${statement.slice(0, 16)}" changed ${beyond.join('+')}`);
          }
        }
        console.log(
          `  sql ${item.action} (${item.label}): ${leaves.length} strings, ${calls} calls, ${Date.now() - startedCase} ms`,
        );
        report.check(
          'sql',
          `${item.action} (${item.label}): ${leaves.length} strings, each as true/false pairs and as hostile statements, change nothing and give the same outcome (${calls} calls)`,
          failures.length === 0,
          failures.slice(0, 3).join('; ') ||
            `${[...new Set(leaves.map((leaf) => leaf.name))].slice(0, 6).join(', ')}…`,
        );
      }
      await fresh();
      report.check(
        'sql',
        'the actions that take text were attacked (the list comes from the cases of the matrix)',
        attacked >= 20,
        `${attacked} cases`,
      );
      // The statements above were meant to do harm: the tables are all there, and the dataset is as it was.
      report.check(
        'sql',
        'after all of them every table still answers, and the owner is still the only one',
        Number(
          (await db.query(`SELECT count(*)::int AS n FROM "User" WHERE "status" = 'OWNER'`)).rows[0]
            ?.n,
        ) === 1,
        `${Object.keys(await snapshot(db)).length} tables`,
      );

      await checkEventStorage(platform, report, db, await variantOf(platform));
    } finally {
      await resetDatabase(db);
    }
  });
}

/**
 * What the generic attack above cannot say: that the text of an event typed in the form is **stored as typed**, byte for byte (a title,
 * a description, a place), however hostile: a statement that was neither run nor refused but cut or changed on the way would pass
 * the pairs. Only where there is an event form.
 */
async function checkEventStorage(
  platform: Platform,
  report: Report,
  db: Client,
  variant: string,
): Promise<void> {
  if (variant === 'events-disabled') return;
  const create = locate(readManifest(), 'events.createEvent');
  let counter = 0;
  for (const field of ['title', 'description', 'location'] as const) {
    for (const text of [...PAIRS.flat(), ...HOSTILE]) {
      counter += 1;
      const value = `${text}${tag}`;
      const title = field === 'title' ? value : `${tag}-${field}-${counter}`;
      const call = await callAction(platform, 'validator', create.id, create.page, [
        {},
        eventForm({ ...(field === 'title' ? {} : { title }), [field]: value }),
      ]);
      const row = (
        await db.query(`SELECT "title","description","location" FROM "Event" WHERE "title" = $1`, [
          title,
        ])
      ).rows[0] as Record<string, string> | undefined;
      report.check(
        'sql',
        `the event form, ${field}: ${text.slice(0, 40)}… is stored as typed`,
        !call.threw && row?.[field] === value,
        `${call.status}; stored ${JSON.stringify(row?.[field] ?? null).slice(0, 60)}`,
      );
    }
  }
}
