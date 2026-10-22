// The one place that creates and removes git worktrees (docs/architecture.md, "Conventions"). Nothing else in the project may
// run `git worktree add` or `git worktree remove` (qa/worktree.test.ts looks for it).
//
// Why: the mutation checks and the update suite work in a throwaway worktree that borrows the project's `node_modules` (and the
// generated Prisma client) through a junction. On Windows `git worktree remove --force` FOLLOWS a junction and deletes what it
// points to: it emptied the real `node_modules` of the project, twice. So a worktree is removed in this order, always:
//   1. every link (symbolic link or junction) in the worktree is removed as a link, never followed, and none may be left;
//   2. only then is the worktree removed by git, which has nothing left to follow.
// Whatever the links pointed to is never touched. When a link cannot be removed, or the folder is not a worktree of this
// repository, nothing is deleted and the error says why.
//
//   node qa/worktree.mjs add <dir> [ref] [--link node_modules] [--link src/generated]
//   node qa/worktree.mjs remove <dir>
//
// or, from a script:  import { addWorktree, removeWorktree } from './worktree.mjs'
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runGit = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

/** The same folder written two ways (slashes, case on Windows, a short name like EDOUAR~1) compares equal. */
const normalized = (path) => {
  let real = resolve(path);
  try {
    real = realpathSync.native(real);
  } catch {
    /* not there: compared as written */
  }
  const full = real.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? full.toLowerCase() : full;
};

/** Every symbolic link and junction under `dir`, found without ever going into one. */
export function findLinks(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) found.push(path);
      else if (entry.isDirectory() && entry.name !== '.git') walk(path);
    }
  };
  walk(dir);
  return found;
}

/** Removes a link as a link: what it points to is not touched. */
function removeLink(path, unlink, rmdir) {
  try {
    unlink(path);
  } catch {
    // A junction is a directory to some systems: rmdir removes the junction itself (never a folder with content).
    try {
      rmdir(path);
    } catch {
      /* checked just below */
    }
  }
  if (lstatExists(path)) throw new Error(`the link ${path} could not be removed`);
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** The folders git knows as worktrees of the repository of `project`. */
function registeredWorktrees(project, git) {
  return git(project, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => normalized(line.slice('worktree '.length)));
}

/**
 * Makes a worktree of `ref` in `dir` (an empty folder or one that does not exist) and links `links` (paths of the project
 * that a worktree does not have: `node_modules`, `src/generated`) into it. A link whose source does not exist is skipped.
 */
/**
 * @param {string} project
 * @param {string} dir
 * @param {string} [ref]
 * @param {{ links?: string[], git?: (cwd: string, args: string[]) => string }} [options]
 */
export function addWorktree(project, dir, ref = 'HEAD', { links = [], git = runGit } = {}) {
  git(project, ['worktree', 'add', '--detach', dir, ref]);
  for (const link of links) {
    const source = join(project, link);
    if (!existsSync(source)) continue;
    const target = join(dir, link);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target, 'junction');
  }
  return dir;
}

/**
 * Removes the worktree in `dir`: its links first, as links; then the worktree. Refuses (and deletes nothing) a folder that is
 * not a worktree of this repository, the project itself, and a worktree in which a link could not be removed.
 * `git`, `unlink` and `rmdir` are there for the tests.
 */
export function removeWorktree(
  project,
  dir,
  { git = runGit, unlink = unlinkSync, rmdir = rmdirSync } = {},
) {
  if (normalized(dir) === normalized(project))
    throw new Error('that is the project, not a worktree');
  if (!registeredWorktrees(project, git).includes(normalized(dir)))
    throw new Error(`${dir} is not a worktree of this repository: nothing was removed`);

  if (existsSync(dir)) {
    for (const link of findLinks(dir)) removeLink(link, unlink, rmdir);
    const left = findLinks(dir);
    if (left.length > 0)
      throw new Error(`links are left in ${dir} (${left.join(', ')}): nothing was removed`);
  }
  git(project, ['worktree', 'remove', '--force', dir]);
  git(project, ['worktree', 'prune']);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, dir, ...rest] = process.argv.slice(2);
  const project = runGit(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  if (command === 'add' && dir) {
    const links = [];
    let ref;
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === '--link') links.push(rest[(index += 1)]);
      else ref = rest[index];
    }
    addWorktree(project, dir, ref, { links });
  } else if (command === 'remove' && dir) {
    removeWorktree(project, dir);
  } else {
    console.error('usage: node qa/worktree.mjs add <dir> [ref] [--link path]... | remove <dir>');
    process.exitCode = 2;
  }
}
