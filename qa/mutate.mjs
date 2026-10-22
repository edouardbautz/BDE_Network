// Mutation check: break one rule at a time and make sure a test fails. It runs in a DEDICATED git worktree: nothing here touches the working tree of the project (the rule of
// docs/architecture.md). The worktree is made from HEAD, borrows node_modules and the generated Prisma client, and is
// reset as a whole between mutations (`git reset --hard` inside the worktree) and removed at the end. It is made and removed
// by qa/worktree.mjs and by nothing else: the links to node_modules are removed first, as links (see that file for why).
//
//   node qa/mutate.mjs <mutations.json> [name filter]
// mutations.json: [[name, file, find, replace, [test files]], ...]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addWorktree, removeWorktree } from './worktree.mjs';

const PROJECT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
const [file, only] = process.argv.slice(2);
const mutations = JSON.parse(readFileSync(file, 'utf8'));

const base = mkdtempSync(join(tmpdir(), 'bde-mutations-'));
const wt = join(base, 'tree');
const git = (...args) => execFileSync('git', args, { cwd: wt, stdio: 'pipe' }).toString();
addWorktree(PROJECT, wt, 'HEAD', { links: ['node_modules', join('src', 'generated')] });

let survived = 0;
try {
  for (const [name, path, find, replace, tests] of mutations) {
    if (only && !name.includes(only)) continue;
    const target = join(wt, path);
    const original = readFileSync(target, 'utf8');
    if (!original.includes(find)) {
      console.log(`?? ${name}: the text to break is not in ${path}`);
      survived += 1;
      continue;
    }
    writeFileSync(
      target,
      original.replace(find, () => replace),
    );
    const run = spawnSync(`npx vitest run ${tests.map((test) => JSON.stringify(test)).join(' ')}`, {
      cwd: wt,
      shell: true,
      stdio: 'pipe',
    });
    const killed = run.status !== 0;
    git('reset', '--hard', 'HEAD');
    if (!killed) survived += 1;
    console.log(`${killed ? 'killed  ' : 'SURVIVED'}  ${name}`);
  }
} finally {
  // Links first, as links, then the worktree: an error here is shown, never hidden (nothing was deleted when it is thrown).
  removeWorktree(PROJECT, wt);
}
console.log(`\n${survived} surviving mutation(s)`);
process.exitCode = survived ? 1 : 0;
