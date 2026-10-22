import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A loading screen that is shorter or taller than its page moves the footer when the page replaces it: the performance budget
 * counted 0.1 of layout shift on the page of an event, whose skeleton still had the head of the old interface. Every
 * `loading.tsx` of the signed-in area starts with the head the page will have (`PageHeaderSkeleton`), or is the dashboard's, which
 * draws its own greeting.
 */
const root = join(process.cwd(), 'src/app/[locale]/(app)');

const loadingFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return loadingFiles(path);
    return name === 'loading.tsx' ? [path] : [];
  });

const files = loadingFiles(root).map((file) => relative(root, file).split(sep).join('/'));

describe('the loading screens of the signed-in area', () => {
  it('are found (the walk reads the right folder)', () => {
    expect(files.length).toBeGreaterThanOrEqual(13);
  });

  it.each(files)('%s draws the head of its page', (file) => {
    const source = readFileSync(join(root, file), 'utf8');
    const drawsHead =
      source.includes('PageHeaderSkeleton') ||
      source.includes('EventFormSkeleton') ||
      file === 'dashboard/loading.tsx';
    expect(drawsHead).toBe(true);
  });
});
