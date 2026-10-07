import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('uses the configuration loaded from the database, and not the file, once there is one', async () => {
    writeFileSync(join(dir, 'bde.config.yml'), yamlFor('Versioned'));
    const { getConfig } = await import('./index');
    const { bdeConfigSchema } = await import('./schema');
    const { load } = await import('js-yaml');
    const { setRuntimeSettings } = await import('@/lib/settings/runtime');

    expect(getConfig().bde.name).toBe('Versioned');
    setRuntimeSettings({
      config: bdeConfigSchema.parse(load(yamlFor('From the database'))),
      values: {},
      source: 'database',
    });
    try {
      expect(getConfig().bde.name).toBe('From the database');
    } finally {
      setRuntimeSettings(undefined);
    }
  });

  describe('when the file cannot be loaded', () => {
    const messageOf = async (): Promise<string> => {
      const { getConfig } = await import('./index');
      try {
        getConfig();
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('getConfig should have thrown');
    };

    it('says the file is absent, with the exact path checked', async () => {
      const message = await messageOf();
      expect(message).toContain('est introuvable');
      expect(message).toContain(`Chemin vérifié : ${join(dir, 'bde.config.yml')}`);
      expect(message).toContain('docker compose up --build -d');
      expect(message).not.toContain('DOSSIER');
    });

    it('says a directory sits in place of the file, and how to get rid of it', async () => {
      mkdirSync(join(dir, 'bde.config.yml'));
      const message = await messageOf();
      expect(message).toContain('Un DOSSIER nommé bde.config.yml se trouve à la place du fichier');
      expect(message).toContain(`Chemin vérifié : ${join(dir, 'bde.config.yml')}`);
      expect(message).toContain('rmdir bde.config.yml');
      expect(message).not.toContain('est introuvable');
    });

    it('says the file is unreadable, with the error code, when it exists', async () => {
      const { describeReadFailure } = await import('./index');
      const path = join(dir, 'bde.config.yml');
      writeFileSync(path, yamlFor('Locked'));
      // The real cause (EACCES on a network share, a user namespace) cannot be made on every machine
      // the tests run on (Windows, root in a container): the error the read would raise is handed in.
      const message = describeReadFailure(
        'bde.config.yml',
        path,
        Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
      );
      expect(message).toContain('existe mais ne peut pas être lu (code EACCES)');
      expect(message).toContain(`Chemin vérifié : ${path}`);
      expect(message).toContain('chmod 644 bde.config.yml');
      expect(message).not.toContain('est introuvable');
      expect(message).not.toContain('DOSSIER');
    });

    it('says the file is empty rather than reporting a missing field', async () => {
      writeFileSync(join(dir, 'bde.config.yml'), '# nothing yet\n');
      expect(await messageOf()).toContain('bde.config.yml est vide');
    });

    it('still reports invalid YAML and invalid values as before', async () => {
      writeFileSync(join(dir, 'bde.config.yml'), 'bde: [unclosed');
      expect(await messageOf()).toContain('erreur de syntaxe YAML');
      vi.resetModules();
      writeFileSync(join(dir, 'bde.config.yml'), 'bde: {}');
      expect(await messageOf()).toContain('Configuration invalide dans bde.config.yml');
    });
  });
});
