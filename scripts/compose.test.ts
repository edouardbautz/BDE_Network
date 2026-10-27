// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * A platform that nobody watches must not fill its disk with logs nor take its server down with one runaway process: every service
 * that keeps running has a ceiling for its memory and a log that Docker cuts. The one that makes a file and stops (`secrets`) has
 * neither to need.
 */
interface Service {
  restart?: string;
  mem_limit?: string;
  logging?: { driver?: string; options?: Record<string, string> };
}

const compose = load(readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8')) as {
  services: Record<string, Service>;
};
const running = Object.entries(compose.services).filter(([, service]) => service.restart !== 'no');

describe('docker-compose.yml, for a platform that nobody watches', () => {
  it('has services that keep running (the check is not blind)', () => {
    expect(running.map(([name]) => name).sort()).toEqual(['app', 'postgres']);
  });

  it.each(running)('%s: Docker cuts the log (3 files of 10 MB at most)', (_name, service) => {
    expect(service.logging?.driver).toBe('json-file');
    expect(service.logging?.options).toMatchObject({ 'max-size': '10m', 'max-file': '3' });
  });

  it.each(running)(
    '%s: has a ceiling for its memory, that the server can change',
    (_name, service) => {
      expect(service.mem_limit).toMatch(/^\$\{[A-Z_]+:-\d+m\}$/);
    },
  );
});
