// Mutation check: break one rule at a time and make sure a test fails. It runs in a DEDICATED git worktree: nothing here touches the working tree of the project (the rule of
// docs/architecture.md). The worktree is made from HEAD, borrows node_modules and the generated Prisma client, and is
// reset as a whole between mutations (`git reset --hard` inside the worktree) and removed at the end.
//
//   node qa/mutate.mjs <mutations.json> [name filter]
// mutations.json: [[name, file, find, replace, [test files]], ...]
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
const [file, only] = process.argv.slice(2);
const mutations = JSON.parse(readFileSync(file, 'utf8'));

const base = mkdtempSync(join(tmpdir(), 'bde-mutations-'));
const wt = join(base, 'tree');
const git = (...args) => execFileSync('git', args, { cwd: wt, stdio: 'pipe' }).toString();
execFileSync('git', ['worktree', 'add', '--detach', wt, 'HEAD'], { cwd: PROJECT, stdio: 'pipe' });
symlinkSync(join(PROJECT, 'node_modules'), join(wt, 'node_modules'), 'junction');
mkdirLinkGenerated();

function mkdirLinkGenerated() {
  const generated = join(PROJECT, 'src', 'generated');
  if (existsSync(generated)) symlinkSync(generated, join(wt, 'src', 'generated'), 'junction');
}

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
  // The links first (unlink removes a junction, never what it points to): then nothing of the project can be reached
  // from the worktree when it is removed.
  for (const link of [join(wt, 'node_modules'), join(wt, 'src', 'generated')]) {
    try {
      unlinkSync(link);
    } catch {
      /* not there */
    }
  }
  try {
    execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: PROJECT, stdio: 'pipe' });
  } catch {
    /* removed with the temporary folder */
  }
}
console.log(`\n${survived} surviving mutation(s)`);
process.exitCode = survived ? 1 : 0;
