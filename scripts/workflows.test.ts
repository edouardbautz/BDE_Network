// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
