import { describe, expect, it } from 'vitest';
import { startsWithUseServer } from './use-server';

describe('startsWithUseServer', () => {
  it('finds the directive, with comments and blanks before it', () => {
    expect(startsWithUseServer("'use server';\nexport async function a() {}")).toBe(true);
    expect(startsWithUseServer('"use server"')).toBe(true);
    expect(startsWithUseServer("// one\n// two\n\n  /* three\n four */\n'use server';")).toBe(true);
  });

  it('does not find it where it is not the first statement', () => {
    expect(startsWithUseServer("import x from 'y';\n'use server';")).toBe(false);
    expect(startsWithUseServer("// 'use server'\nexport const a = 1;")).toBe(false);
    expect(startsWithUseServer("/* never closed 'use server'")).toBe(false);
    expect(startsWithUseServer('')).toBe(false);
  });

  it('takes the time of reading the file, whatever the comments look like (a regular expression of the same job did not)', () => {
    const hostile = '/*'.repeat(40_000) + '\n' + '// \n'.repeat(40_000);
    const started = performance.now();
    startsWithUseServer(hostile);
    startsWithUseServer('//\n'.repeat(100_000));
    expect(performance.now() - started).toBeLessThan(500);
  });
});
