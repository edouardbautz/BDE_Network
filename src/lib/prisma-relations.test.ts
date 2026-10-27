// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The client reads a query's relations with one statement (a join) instead of one statement per relation. That is the preview feature
 * `relationJoins`, and with it on, a join is the default of every query that includes or selects a relation. It is why a page sends
 * 2 to 5 statements where it sent 10 to 12, and why the platform answers 12 % more requests on the same processor (qa/optim). It is
 * not an option written in each query: lose the line of the schema and every page silently goes back to the many statements.
 */
describe('how the client reads relations', () => {
  it('keeps the relationJoins preview feature on in the schema', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
    const generator = /generator client \{[^}]*\}/.exec(schema)?.[0] ?? '';
    expect(generator).toMatch(/previewFeatures\s*=\s*\[[^\]]*"relationJoins"/);
  });
});
