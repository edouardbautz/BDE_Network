// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The content policy of the platform forbids evaluating a string, and Zod finds out whether it may compile its schemas by
 * calling `Function("")`: in a browser that is a policy violation on every page that carries a schema. Every module that
 * brings a schema to the browser must therefore tell Zod not to try, before it builds its schemas (see `zod-config.ts`).
 */

const realFunction = globalThis.Function;
const attempts: string[] = [];

/** Watches the calls that turn a string into code, and lets them through. */
function watchEvaluation() {
  attempts.length = 0;
  globalThis.Function = new Proxy(realFunction, {
    apply(target, thisArg, args) {
      attempts.push(String(args.at(-1) ?? ''));
      return Reflect.apply(target, thisArg, args);
    },
    construct(target, args, newTarget) {
      attempts.push(String(args.at(-1) ?? ''));
      return Reflect.construct(target, args, newTarget);
    },
  });
}

afterEach(() => {
  globalThis.Function = realFunction;
  vi.resetModules();
});

/** The modules that reach the browser with schemas: the language menu, the event and repeat forms, the notification forms. */
const MODULES = [
  '@/config/schema',
  '@/lib/events/input',
  '@/lib/events/repeat',
  '@/lib/setup/notifications',
];

describe('the schemas that reach the browser', () => {
  it('detects the evaluation it is meant to forbid (the watcher is not blind)', async () => {
    vi.resetModules();
    watchEvaluation();
    const { z } = await import('zod');
    z.config({ jitless: false });
    z.object({ a: z.string() });
    expect(attempts.length).toBeGreaterThan(0);
  });

  it.each(MODULES)('%s never asks to evaluate a string', async (path) => {
    vi.resetModules();
    watchEvaluation();
    await import(path);
    expect(attempts).toEqual([]);
  });

  it('still parses, on the plain path', async () => {
    vi.resetModules();
    watchEvaluation();
    const { SUPPORTED_LOCALES } = await import('@/config/schema');
    expect(SUPPORTED_LOCALES).toContain('fr');
    const { repeatRuleSchema } = await import('@/lib/events/repeat');
    expect(repeatRuleSchema.safeParse({ freq: 'WEEKLY', interval: 2 }).success).toBe(true);
    expect(repeatRuleSchema.safeParse({ freq: 'SOMETIMES', interval: 2 }).success).toBe(false);
    expect(attempts).toEqual([]);
  });
});
