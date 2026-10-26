import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A mutation that cannot be applied proves nothing, and nobody sees it: the image job that plays the attacks found one whose text had
 * moved, an hour into its run. Every mutation of every list must still find the text it breaks, in a file that exists.
 */

const DIRECTORY = __dirname;
const ROOT = join(__dirname, '..', '..');

type Mutation = [name: string, file: string, find: string, replace: string, ...rest: unknown[]];

const lists = readdirSync(DIRECTORY).filter((name) => name.endsWith('.json'));

describe.each(lists)('the mutations of %s', (list) => {
  const mutations = JSON.parse(readFileSync(join(DIRECTORY, list), 'utf8')) as Mutation[];

  it.each(mutations.map((mutation) => [mutation[0], mutation] as const))(
    '%s still finds the text it breaks',
    (_name, [, file, find, replace]) => {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source.includes(find), `${file} no longer holds the text to break`).toBe(true);
      expect(find === replace, 'the mutation changes nothing').toBe(false);
    },
  );
});
