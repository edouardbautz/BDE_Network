// Mutation check on the PRODUCTION IMAGE: break a guard of the application, build the image from a dedicated worktree, start
// a platform with it, and see whether the access matrix notices. Like qa/mutate.mjs, nothing here touches the working
// tree of the project (docs/architecture.md): the worktree is made from HEAD (commit first), reset as a whole between
// mutations and removed at the end. A mutation costs one image build (a few minutes).
//
//   node qa/mutate-image.mjs <mutations.json> [name filter]
// mutations.json: [[name, file, find, replace, variant?], ...]  (variant: the platform variant to play, default events-enabled)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
const [file, only] = process.argv.slice(2);
const mutations = JSON.parse(readFileSync(file, 'utf8'));

const wt = join(mkdtempSync(join(tmpdir(), 'bde-image-mutations-')), 'tree');
const git = (...args) => execFileSync('git', args, { cwd: wt, stdio: 'pipe' }).toString();
execFileSync('git', ['worktree', 'add', '--detach', wt, 'HEAD'], { cwd: PROJECT, stdio: 'pipe' });

const run = (command, args, options = {}) =>
  spawnSync(command, args, {
    cwd: PROJECT,
    shell: false,
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    ...options,
  });

let survived = 0;
try {
  for (const [name, path, find, replace, variant = 'events-enabled'] of mutations) {
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
    const build = run('docker', ['build', '-q', '-t', 'bde-mutant', wt]);
    git('reset', '--hard', 'HEAD');
    if (build.status !== 0) {
      console.log(`?? ${name}: the image did not build\n${(build.stderr || '').slice(-400)}`);
      survived += 1;
      continue;
    }
    const up = run('sh', ['qa/platform.sh', 'up', '--image', 'bde-mutant', '--variant', variant]);
    let killed = false;
    let detail = '';
    if (up.status !== 0) {
      detail = ' (the platform did not start)';
      killed = true;
    } else {
      const env = Object.fromEntries(
        run('sh', ['qa/platform.sh', 'env'])
          .stdout.split('\n')
          .flatMap((line) => {
            const match = /^export (\w+)='?([^']*)'?$/.exec(line);
            return match ? [[match[1], match[2]]] : [];
          }),
      );
      const result = run('npx', ['tsx', 'qa/access/run.ts', '--variant', variant], {
        shell: true,
        env: { ...process.env, ...env },
      });
      killed = result.status !== 0;
      detail = killed
        ? ` (${(result.stderr || '').split('\n').filter((line) => line.startsWith('✗')).length} cells)`
        : '';
    }
    run('sh', ['qa/platform.sh', 'down']);
    if (!killed) survived += 1;
    console.log(`${killed ? 'killed  ' : 'SURVIVED'}  ${name}${detail}`);
  }
} finally {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: PROJECT, stdio: 'pipe' });
  } catch {
    /* removed with the temporary folder */
  }
}
console.log(`\n${survived} surviving mutation(s)`);
process.exitCode = survived ? 1 : 0;
