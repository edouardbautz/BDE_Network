// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What a workflow of the project may not forget: the permissions of its token, and the commit of every action that is not
 * GitHub's own. A tag moves (whoever owns the action can point \`v3\` at other code, and every workflow that uses it runs
 * that code with its token); a commit does not. Dependabot keeps the commits up to date, with the tag in a comment.
 * CodeQL had these as alerts (\`actions/unpinned-tag\`, \`actions/missing-workflow-permissions\`); this keeps them from coming back.
 */

const dir = join(process.cwd(), '.github', 'workflows');
const files = readdirSync(dir).filter((name) => name.endsWith('.yml'));

/** Every `uses:` of a workflow, with its line. */
function usesOf(text: string): { line: number; reference: string; comment: string }[] {
  return text.split('\n').flatMap((line, index) => {
    const match = /^\s*(?:-\s+)?uses:\s+(\S+)(?:\s+#\s*(.*))?$/.exec(line);
    return match ? [{ line: index + 1, reference: match[1]!, comment: match[2] ?? '' }] : [];
  });
}

/** GitHub's own actions are held by GitHub; a local action is in the repository. */
const isThirdParty = (reference: string) =>
  !reference.startsWith('./') && !/^(actions|github)\//.test(reference);

describe('the workflows', () => {
  it('are found (the checks below mean something)', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)('%s declares the permissions of its token, at the top', (name) => {
    expect(readFileSync(join(dir, name), 'utf8')).toMatch(/^permissions:/m);
  });

  it.each(files)(
    "%s pins every action that is not GitHub's by the full commit, with its tag in a comment",
    (name) => {
      const unpinned = usesOf(readFileSync(join(dir, name), 'utf8'))
        .filter(({ reference }) => isThirdParty(reference))
        .filter(
          ({ reference, comment }) => !/@[0-9a-f]{40}$/.test(reference) || !/^v\d/.test(comment),
        )
        .map(({ line, reference }) => `${name}:${line} ${reference}`);
      expect(unpinned).toEqual([]);
    },
  );

  it('use at least one third-party action (the test of pinning is not blind)', () => {
    const all = files.flatMap((name) => usesOf(readFileSync(join(dir, name), 'utf8')));
    expect(all.filter(({ reference }) => isThirdParty(reference)).length).toBeGreaterThan(10);
  });
});

/**
 * A test that needs a PostgreSQL skips itself when `MIGRATION_TEST_DATABASE_URL` is not set, so on a computer, and in a job that does
 * not set it, it passes by running nothing. It must therefore be named by a `vitest run` of a job that has the database
 * (`migrations` of ci.yml, `longtime` of qa.yml): the storage of the notification templates had a test of its own that no job ran, and
 * nothing said so (`service.db.test.ts`, found by reading the workflow, not by a failure).
 */
describe('the tests that need a database', () => {
  const root = process.cwd();
  const testFiles = (folder: string): string[] =>
    readdirSync(join(root, folder)).flatMap((name) => {
      const path = join(folder, name);
      if (name === 'node_modules' || name === 'generated') return [];
      if (statSync(join(root, path)).isDirectory()) return testFiles(path);
      return /\.test\.tsx?$/.test(name) ? [path.split(sep).join('/')] : [];
    });
  const needDatabase = [...testFiles('src'), ...testFiles('qa')].filter((path) =>
    /MIGRATION_TEST_DATABASE_URL|test-database/.test(readFileSync(join(root, path), 'utf8')),
  );

  /** The files and folders given to every `vitest run` of the workflows that have a database. */
  const played = ['ci.yml', 'qa.yml'].flatMap((name) =>
    readFileSync(join(dir, name), 'utf8')
      .split('\n')
      .flatMap((line) => {
        const match = /vitest run ([^|&;#]*)/.exec(line);
        if (!match) return [];
        return match[1]!
          .split(/\s+/)
          .filter((word) => word && !word.startsWith('-') && !word.startsWith('$'));
      }),
  );

  it('are found (the check below means something)', () => {
    expect(needDatabase.length).toBeGreaterThanOrEqual(8);
    expect(needDatabase).toContain('src/test/migrations/event-repeat-rules.test.ts');
    expect(played).toContain('qa');
  });

  it.each(needDatabase)('%s is run by a job that has the database', (path) => {
    const covered = played.some(
      (word) => path === word || path.startsWith(`${word.replace(/\/$/, '')}/`),
    );
    expect(
      covered,
      `no vitest run of ci.yml or qa.yml names ${path} or a folder that holds it`,
    ).toBe(true);
  });
});
