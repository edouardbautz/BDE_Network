import { z } from 'zod';

/**
 * Zod compiles a schema into a function with `new Function` when the environment allows it, and finds out by trying. The
 * content policy of the platform forbids evaluating a string (no `'unsafe-eval'`, on purpose), so in a browser the attempt
 * was a policy violation on every page that carries a schema (every one: the language menu does), reported in the console
 * and to any report address. Nothing broke (Zod falls back), but a policy that is violated by our own code on every page
 * cannot be told from one that is attacked.
 *
 * Every module that brings a schema to the browser imports this one first, before its schemas are built (they probe when
 * they are created). A schema here parses a form or a file once: the plain path costs nothing that can be measured.
 */
z.config({ jitless: true });
