// @vitest-environment node
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

/**
 * The content policy of the platform forbids evaluating a string, and Zod finds out whether it may compile its schemas by
 * calling `Function("")`: in a browser that is a policy violation on every page that carries a schema. Every module that
 * brings a schema to the browser must therefore tell Zod not to try, before it builds its schemas (see `zod-config.ts`).
 *
 * Each module is loaded in a Node process of its own: Zod keeps what it found out for the whole process, and the test runner
 * does not load it again between tests, so a second check in the same process would see nothing whatever the module does.
 */

const run = promisify(execFile);

/** Runs `code` with the calls that turn a string into code watched (and let through), and says what was asked. */
async function evaluationsAskedBy(code: string): Promise<string[]> {
  const script = `
    const real = globalThis.Function;
    const asked = [];
    globalThis.Function = new Proxy(real, {
      apply(target, self, args) { asked.push(String(args.at(-1) ?? '')); return Reflect.apply(target, self, args); },
      construct(target, args, newTarget) { asked.push(String(args.at(-1) ?? '')); return Reflect.construct(target, args, newTarget); },
    });
    ${code}
    console.log(JSON.stringify(asked));
  `;
  const { stdout } = await run(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script],
    { cwd: process.cwd(), timeout: 60_000 },
  );
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '[]') as string[];
}

const load = (file: string) =>
  `await import(${JSON.stringify(pathToFileURL(resolve(file)).href)});`;

/** The modules that reach the browser with schemas: the language menu, the event and repeat forms, the notification forms. */
const MODULES = [
  'src/config/schema.ts',
  'src/lib/events/input.ts',
  'src/lib/events/repeat.ts',
  'src/lib/setup/notifications.ts',
];

describe('the schemas that reach the browser', () => {
  it('detects the evaluation it is meant to forbid (the watcher is not blind)', async () => {
    // A schema built with Zod as it comes, with none of our modules in the way: it asks.
    const asked = await evaluationsAskedBy(
      "const { z } = await import('zod'); z.object({ a: z.string() });",
    );
    expect(asked.length).toBeGreaterThan(0);
  });

  it.each(MODULES)('%s never asks to evaluate a string', async (file) => {
    expect(await evaluationsAskedBy(load(file))).toEqual([]);
  });
});
