import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const yamlFor = (name: string) => `
bde:
  name: '${name}'
  campus: 'Paris'
  timezone: 'Europe/Paris'
  defaultLocale: 'fr'
  accentColor: '#0f766e'
  logoPath: '/logo.svg'
auth:
  owners: ['someone']
  allowedCampuses: ['Paris']
modules:
  enabled: []
notifications:
  memberPending: 'none'
  memberApproved: 'none'
  memberRemoved: 'none'
`;

describe('getConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bde-config-'));
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads bde.config.yml when no local override exists', async () => {
    writeFileSync(join(dir, 'bde.config.yml'), yamlFor('Versioned'));
    const { getConfig } = await import('./index');
    expect(getConfig().bde.name).toBe('Versioned');
  });

  it('prefers bde.config.local.yml over bde.config.yml', async () => {
    writeFileSync(join(dir, 'bde.config.yml'), yamlFor('Versioned'));
    writeFileSync(join(dir, 'bde.config.local.yml'), yamlFor('Local'));
    const { getConfig } = await import('./index');
    expect(getConfig().bde.name).toBe('Local');
  });

  it('names the loaded file in validation errors', async () => {
    writeFileSync(join(dir, 'bde.config.local.yml'), 'bde: {}');
    const { getConfig } = await import('./index');
    expect(() => getConfig()).toThrow(/bde\.config\.local\.yml/);
  });
});
