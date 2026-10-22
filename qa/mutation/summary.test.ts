import { describe, expect, it } from 'vitest';
import { markdown, scoreOf, survivors, type Report } from './summary';

const mutant = (status: string, line = 1, mutatorName = 'ConditionalExpression') => ({
  status,
  mutatorName,
  replacement: 'true',
  location: { start: { line } },
});

const report: Report = {
  files: {
    'src/a.ts': {
      source: 'if (x) {\n  return 1;\n}\n',
      mutants: [
        mutant('Killed'),
        mutant('Killed'),
        mutant('Timeout'),
        mutant('Survived', 1),
        mutant('Ignored'),
      ],
    },
    'src/b.ts': {
      source: 'return y;\n',
      mutants: [mutant('NoCoverage', 1, 'StringLiteral'), mutant('Killed')],
    },
  },
};

describe('scoreOf', () => {
  it('counts a killed or timed out mutant as caught, and one no test runs against the score, as Stryker does', () => {
    const { files, total } = scoreOf(report);
    expect(files.find((file) => file.file === 'src/a.ts')).toMatchObject({
      killed: 3,
      survived: 1,
      uncovered: 0,
      score: 75,
    });
    expect(files.find((file) => file.file === 'src/b.ts')).toMatchObject({
      killed: 1,
      survived: 0,
      uncovered: 1,
      score: 50,
    });
    expect(total).toBeCloseTo((4 / 6) * 100, 5);
  });

  it('leaves out the mutants that were ignored, and says 100 for a file with nothing to count', () => {
    const { files } = scoreOf({
      files: { 'src/c.ts': { source: '', mutants: [mutant('Ignored')] } },
    });
    expect(files[0]?.score).toBe(100);
  });
});

describe('survivors', () => {
  it('names where each mutation no test noticed is, and what it did', () => {
    expect(survivors(report)).toEqual([
      'src/a.ts:1 [Survived] ConditionalExpression: if (x) { → true',
      'src/b.ts:1 [NoCoverage] StringLiteral: return y; → true',
    ]);
  });
});

describe('markdown', () => {
  it('writes the table and the list of survivors', () => {
    const text = markdown(report);
    expect(text).toMatch(/### Mutation testing: 66\.7 %/);
    expect(text).toMatch(/\| src\/a\.ts \| 75\.0 % \| 3 \| 1 \| 0 \|/);
    expect(text).toContain('src/a.ts:1 [Survived]');
  });

  it('says so when none survived', () => {
    const clean: Report = { files: { 'src/a.ts': { source: 'x', mutants: [mutant('Killed')] } } };
    expect(markdown(clean)).toContain('No mutation survived.');
  });
});
