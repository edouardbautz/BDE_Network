// @vitest-environment node
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addWorktree, findLinks, removeWorktree } from './worktree.mjs';

// Real git, a throwaway repository: what is checked is what the script does to the folders a link points to, which a
// stand-in for git could not show.
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

let base: string;
let project: string;
let tree: string;

const NODE_MODULES_FILE = join('node_modules', 'pkg', 'index.js');
const GENERATED_FILE = join('src', 'generated', 'client.js');

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'bde-worktree-test-'));
  project = join(base, 'project');
  mkdirSync(join(project, 'src'), { recursive: true });
  git(project, 'init', '-q');
  git(project, 'config', 'user.email', 'test@example.com');
  git(project, 'config', 'user.name', 'Test');
  writeFileSync(join(project, '.gitignore'), 'node_modules\nsrc/generated\n');
  writeFileSync(join(project, 'src', 'a.txt'), 'tracked');
  git(project, 'add', '-A');
  git(project, 'commit', '-q', '-m', 'first');
  // What a worktree borrows from the project: it holds files that must survive anything done to the worktree.
  mkdirSync(join(project, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(project, NODE_MODULES_FILE), 'the real node_modules');
  mkdirSync(join(project, 'src', 'generated'), { recursive: true });
  writeFileSync(join(project, GENERATED_FILE), 'the real client');
  tree = join(base, 'tree');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true, maxRetries: 3 });
});

const isLink = (path: string) => lstatSync(path).isSymbolicLink();
const worktrees = () => git(project, 'worktree', 'list', '--porcelain');
const targetsIntact = () => {
  expect(readFileSync(join(project, NODE_MODULES_FILE), 'utf8')).toBe('the real node_modules');
  expect(readFileSync(join(project, GENERATED_FILE), 'utf8')).toBe('the real client');
  expect(readFileSync(join(project, 'src', 'a.txt'), 'utf8')).toBe('tracked');
};

describe('addWorktree', () => {
  it('makes the worktree and links what the project keeps outside git', () => {
    addWorktree(project, tree, 'HEAD', { links: ['node_modules', join('src', 'generated')] });

    expect(readFileSync(join(tree, 'src', 'a.txt'), 'utf8')).toBe('tracked');
    expect(isLink(join(tree, 'node_modules'))).toBe(true);
    expect(isLink(join(tree, 'src', 'generated'))).toBe(true);
    // through the links the worktree sees the project's files
    expect(readFileSync(join(tree, NODE_MODULES_FILE), 'utf8')).toBe('the real node_modules');
    expect(findLinks(tree).sort()).toEqual(
      [join(tree, 'node_modules'), join(tree, 'src', 'generated')].sort(),
    );
  });

  it('skips a link whose source does not exist', () => {
    rmSync(join(project, 'src', 'generated'), { recursive: true });
    addWorktree(project, tree, 'HEAD', { links: ['node_modules', join('src', 'generated')] });
    expect(existsSync(join(tree, 'src', 'generated'))).toBe(false);
    expect(isLink(join(tree, 'node_modules'))).toBe(true);
  });
});

describe('removeWorktree', () => {
  it('removes the links as links BEFORE git is asked to remove the worktree, and never touches what they point to', () => {
    addWorktree(project, tree, 'HEAD', { links: ['node_modules', join('src', 'generated')] });
    const seen: { args: string[]; linksLeft: number; targets: boolean }[] = [];
    removeWorktree(project, tree, {
      git: (cwd: string, args: string[]) => {
        if (args.includes('remove'))
          seen.push({
            args,
            linksLeft: findLinks(tree).length,
            targets: existsSync(join(project, NODE_MODULES_FILE)),
          });
        return git(cwd, ...args);
      },
    });

    // git was asked once, when no link was left: a git that follows junctions (Windows) would have had nothing to follow
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ linksLeft: 0, targets: true });
    expect(existsSync(tree)).toBe(false);
    // only the project is left
    expect(
      worktrees()
        .split('\n')
        .filter((line) => line.startsWith('worktree ')),
    ).toHaveLength(1);
    targetsIntact();
  });

  it('removes a link nobody asked for, wherever it is, without following it', () => {
    const outside = join(base, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'precious.txt'), 'keep');
    addWorktree(project, tree, 'HEAD', { links: ['node_modules'] });
    mkdirSync(join(tree, 'deep', 'er'), { recursive: true });
    symlinkSync(outside, join(tree, 'deep', 'er', 'stray'), 'junction');

    removeWorktree(project, tree);

    expect(existsSync(tree)).toBe(false);
    expect(readFileSync(join(outside, 'precious.txt'), 'utf8')).toBe('keep');
    targetsIntact();
  });

  it('does not go into a link to look for other links', () => {
    // a link to a folder that holds another link: only the first is the worktree's
    const outside = join(base, 'outside');
    mkdirSync(join(outside, 'inner'), { recursive: true });
    symlinkSync(join(project, 'node_modules'), join(outside, 'inner', 'second'), 'junction');
    addWorktree(project, tree, 'HEAD');
    symlinkSync(outside, join(tree, 'first'), 'junction');

    expect(findLinks(tree)).toEqual([join(tree, 'first')]);
    removeWorktree(project, tree);

    expect(isLink(join(outside, 'inner', 'second'))).toBe(true);
    targetsIntact();
  });

  it('refuses to remove anything when a link cannot be removed', () => {
    addWorktree(project, tree, 'HEAD', { links: ['node_modules'] });
    const asked: string[][] = [];
    const stuck = () => {
      throw new Error('busy');
    };

    expect(() =>
      removeWorktree(project, tree, {
        unlink: stuck,
        rmdir: stuck,
        git: (cwd: string, args: string[]) => {
          asked.push(args);
          return git(cwd, ...args);
        },
      }),
    ).toThrow(/could not be removed/);

    // git was only asked what it knows, never to remove: the worktree and the link are still there
    expect(asked.some((args) => args.includes('remove'))).toBe(false);
    expect(isLink(join(tree, 'node_modules'))).toBe(true);
    expect(existsSync(join(tree, 'src', 'a.txt'))).toBe(true);
    targetsIntact();
  });

  it('removes the folder itself when git cannot (a path Windows finds too long), the links being gone already', () => {
    addWorktree(project, tree, 'HEAD', { links: ['node_modules'] });
    removeWorktree(project, tree, {
      git: (cwd: string, args: string[]) => {
        // git stops on a long path: it fails and leaves the folder, as it did on a .next cache
        if (args.includes('remove')) throw new Error('Filename too long');
        return git(cwd, ...args);
      },
    });

    expect(existsSync(tree)).toBe(false);
    expect(
      worktrees()
        .split('\n')
        .filter((line) => line.startsWith('worktree ')),
    ).toHaveLength(1);
    targetsIntact();
  });

  it('does not fall back on deleting the folder when something else is wrong with it', () => {
    addWorktree(project, tree, 'HEAD');
    const outside = join(base, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'precious.txt'), 'keep');

    expect(() =>
      removeWorktree(project, tree, {
        git: (cwd: string, args: string[]) => {
          if (args.includes('remove')) {
            // a link appears after the scan, and git then fails: the folder must not be deleted by hand
            symlinkSync(outside, join(tree, 'late'), 'junction');
            throw new Error('Filename too long');
          }
          return git(cwd, ...args);
        },
      }),
    ).toThrow(/Filename too long/);

    expect(existsSync(join(tree, 'src', 'a.txt'))).toBe(true);
    expect(readFileSync(join(outside, 'precious.txt'), 'utf8')).toBe('keep');
  });

  it('refuses the project itself', () => {
    expect(() => removeWorktree(project, project)).toThrow(/the project/);
    targetsIntact();
  });

  it('refuses a folder that is not a worktree of the repository, and deletes nothing in it', () => {
    const stranger = join(base, 'stranger');
    mkdirSync(stranger);
    writeFileSync(join(stranger, 'file.txt'), 'mine');
    symlinkSync(join(project, 'node_modules'), join(stranger, 'node_modules'), 'junction');

    expect(() => removeWorktree(project, stranger)).toThrow(/not a worktree/);
    expect(readFileSync(join(stranger, 'file.txt'), 'utf8')).toBe('mine');
    expect(isLink(join(stranger, 'node_modules'))).toBe(true);
    targetsIntact();
  });

  it('refuses a worktree of another repository', () => {
    const other = join(base, 'other');
    mkdirSync(other);
    git(other, 'init', '-q');
    git(other, 'config', 'user.email', 'test@example.com');
    git(other, 'config', 'user.name', 'Test');
    writeFileSync(join(other, 'x.txt'), 'x');
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'x');
    const foreign = join(base, 'foreign');
    addWorktree(other, foreign, 'HEAD');

    expect(() => removeWorktree(project, foreign)).toThrow(/not a worktree/);
    expect(existsSync(join(foreign, 'x.txt'))).toBe(true);
  });
});

describe('the rule: nobody else creates or removes a worktree', () => {
  it('is held by this script alone', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const files = execFileSync('git', ['ls-files'], { cwd: root, stdio: 'pipe' })
      .toString()
      .split('\n')
      .filter(
        (file) =>
          file &&
          !file.startsWith('docs/') &&
          !file.startsWith('.next/') &&
          file !== 'CHANGELOG.md' &&
          file !== 'qa/worktree.mjs' &&
          file !== 'qa/worktree.test.ts' &&
          /\.(mjs|cjs|js|ts|tsx|sh|ya?ml|json)$/.test(file),
      );
    const offenders = files.filter((file) =>
      /worktree['"]?,?\s+['"]?(add|remove)\b/.test(readFileSync(join(root, file), 'utf8')),
    );
    expect(offenders, 'use qa/worktree.mjs (addWorktree / removeWorktree)').toEqual([]);
  });
});
