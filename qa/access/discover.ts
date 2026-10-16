import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

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

const USE_SERVER_AT_TOP = /^\s*(\/\/.*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/;

/** `<folder>.<action>` for every exported action of a file that starts with `'use server'`. */
export function discoverExportedActions(root = process.cwd()): string[] {
  return files(join(root, 'src'))
    .filter(isSource)
    .flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      if (!USE_SERVER_AT_TOP.test(source)) return [];
      const file = basename(path).replace(/\.tsx?$/, '');
      const owner = file === 'actions' ? basename(dirname(path)) : file.replace(/-actions$/, '');
      return [...source.matchAll(/^export async function (\w+)/gm)].map(
        (match) => `${owner}.${match[1]}`,
      );
    })
    .sort();
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
      if (USE_SERVER_AT_TOP.test(source)) return [];
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
