import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import ts from 'typescript';
import { startsWithUseServer } from './use-server';

/**
 * Everything the platform answers, found in the source: its pages, its API routes and its server actions. The access
 * matrix is checked against this list, so a route nobody declared in the matrix fails the CI instead of going
 * unnoticed. (The image has its own, authoritative list of actions: `server-reference-manifest.json`, which the HTTP
 * run reads; see `run.ts`.)
 */

const SKIP = new Set(['node_modules', 'generated', '.next']);

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const isSource = (path: string) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path);
const slash = (path: string) => path.replaceAll('\\', '/');

/** `/events/[id]/edit` for `src/app/[locale]/(app)/events/[id]/edit/page.tsx`: no locale, no route group. */
function routeOf(path: string, root: string): string {
  const parts = slash(relative(join(root, 'src', 'app'), dirname(path)))
    .split('/')
    .filter((part) => part !== '[locale]' && !/^\(.*\)$/.test(part) && part !== '');
  return `/${parts.join('/')}`;
}

export function discoverPages(root = process.cwd()): string[] {
  return files(join(root, 'src', 'app'))
    .filter((path) => basename(path) === 'page.tsx')
    .map((path) => routeOf(path, root))
    .sort();
}

export function discoverApiRoutes(root = process.cwd()): string[] {
  return files(join(root, 'src', 'app', 'api'))
    .filter((path) => basename(path) === 'route.ts')
    .map((path) => routeOf(path, root))
    .sort();
}

/** `<folder>.<action>` for every exported action of a file that starts with `'use server'`. */
export function discoverExportedActions(root = process.cwd()): string[] {
  return files(join(root, 'src'))
    .filter(isSource)
    .flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      if (!startsWithUseServer(source)) return [];
      const file = basename(path).replace(/\.tsx?$/, '');
      const owner = file === 'actions' ? basename(dirname(path)) : file.replace(/-actions$/, '');
      return [...source.matchAll(/^export async function (\w+)/gm)].map(
        (match) => `${owner}.${match[1]}`,
      );
    })
    .sort();
}

/**
 * `<folder>.<action>` and the number of parameters, for every exported action, read from the declaration by TypeScript's parser (nothing is
 * resolved: the number of parameters is a fact of the syntax). An action with a parameter is one a crafted request can send text to, and the
 * `sql` suite must have attacked it (`sql-coverage.test.ts`).
 */
export function discoverActionParameters(root = process.cwd()): Record<string, number> {
  const found: Record<string, number> = {};
  for (const path of files(join(root, 'src')).filter(isSource)) {
    const source = readFileSync(path, 'utf8');
    if (!startsWithUseServer(source)) continue;
    const file = basename(path).replace(/\.tsx?$/, '');
    const owner = file === 'actions' ? basename(dirname(path)) : file.replace(/-actions$/, '');
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false);
    for (const statement of tree.statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name &&
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        found[`${owner}.${statement.name.text}`] = statement.parameters.length;
    }
  }
  return found;
}

/**
 * The fields of a form that the actions of each file read (`formData.get('scope')`, `.getAll('assignees')`, `.has(…)`), by action: a crafted request can send any of
 * them, whether or not the form the matrix sends holds it (the scan found `scope` and `occurrence` of the event form that way). Read per file, not per
 * action: a field is read by a helper of the file the action calls, so every action of a file that takes a form is given all of the file's fields (more than it
 * reads, never fewer). A field read from a form that is not named `formData`, `form` or `data` is not found.
 */
export function discoverActionFields(root = process.cwd()): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const path of files(join(root, 'src')).filter(isSource)) {
    const source = readFileSync(path, 'utf8');
    if (!startsWithUseServer(source)) continue;
    const file = basename(path).replace(/\.tsx?$/, '');
    const owner = file === 'actions' ? basename(dirname(path)) : file.replace(/-actions$/, '');
    const fields = [
      ...new Set(
        [
          ...source.matchAll(/\b(?:formData|form|data)\.(?:get|getAll|has)\(\s*['"]([\w.-]+)['"]/g),
        ].map((match) => match[1] as string),
      ),
    ].sort();
    for (const match of source.matchAll(/^export async function (\w+)/gm))
      found[`${owner}.${match[1]}`] = fields;
  }
  return found;
}

export interface InlineAction {
  /** The source file, from the project root. */
  file: string;
  /** The text of the function the directive opens. */
  body: string;
}

/**
 * The actions written inside a component (`async () => { 'use server'; ... }`): each is an entry point of its own
 * that a crafted request can call, and none of them is a file of actions. They must only hand over to an exported action.
 */
export function discoverInlineActions(root = process.cwd()): InlineAction[] {
  return files(join(root, 'src'))
    .filter(isSource)
    .flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      if (startsWithUseServer(source)) return [];
      const lines = source.split('\n');
      const found: InlineAction[] = [];
      lines.forEach((line, index) => {
        if (!/^\s*['"]use server['"];?\s*$/.test(line)) return;
        let depth = 1;
        const body: string[] = [];
        for (let next = index + 1; next < lines.length && depth > 0; next += 1) {
          const text = lines[next] ?? '';
          for (const character of text) {
            if (character === '{') depth += 1;
            if (character === '}') depth -= 1;
          }
          body.push(text);
        }
        found.push({ file: slash(relative(root, path)), body: body.join('\n') });
      });
      return found;
    });
}
