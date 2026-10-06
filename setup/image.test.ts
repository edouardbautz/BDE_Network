// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * The setup assistant is shipped as a Docker image (setup/Dockerfile) started by one command
 * (docker-compose.setup.yml). These tests keep that packaging consistent with the rest of the project.
 */

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const dockerfile = read('setup/Dockerfile');
const lock = JSON.parse(read('package-lock.json')) as {
  packages: Record<string, { version: string }>;
};

describe('the assistant image', () => {
  it('installs the same versions of its dependencies as the platform', () => {
    const line = /npm install[^\n]*\\\n\s*((?:[@\w.-]+@[\d.]+\s*)+)/.exec(dockerfile)?.[1] ?? '';
    const installed = Object.fromEntries(
      line
        .trim()
        .split(/\s+/)
        .map((spec) => [
          spec.slice(0, spec.lastIndexOf('@')),
          spec.slice(spec.lastIndexOf('@') + 1),
        ]),
    );

    expect(Object.keys(installed).sort()).toEqual(['js-yaml', 'nodemailer', 'tsx', 'zod']);
    for (const [name, version] of Object.entries(installed)) {
      expect(version, name).toBe(lock.packages[`node_modules/${name}`]?.version);
    }
  });

  it('uses the same Node major version as the platform image', () => {
    const base = (text: string) => /^FROM (node:\d+-alpine)/m.exec(text)?.[1];
    expect(base(dockerfile)).toBe(base(read('Dockerfile')));
  });

  it('copies only files that exist', () => {
    const copied = [...dockerfile.matchAll(/^COPY (\S+) /gm)].map((match) => match[1] ?? '');
    expect(copied.sort()).toEqual(['docs/slack-app-manifest.yml', 'setup', 'src/config/schema.ts']);
    for (const path of copied) expect(existsSync(join(root, path)), path).toBe(true);
  });

  it('lets in the build context only what it copies, and not the tests', () => {
    const ignore = read('setup/Dockerfile.dockerignore');
    expect(ignore).toMatch(/^\*$/m);
    for (const allowed of ['!setup', '!src/config/schema.ts', '!docs/slack-app-manifest.yml']) {
      expect(ignore).toContain(allowed);
    }
    expect(ignore).toContain('setup/*.test.ts');
  });

  it('starts the assistant, with the project mounted where it looks for it', () => {
    expect(dockerfile).toContain('PROJECT_DIR=/project');
    expect(dockerfile).toMatch(/CMD \["node_modules\/\.bin\/tsx", "setup\/main\.ts"\]/);
  });

  it('has the Docker CLI and the compose plugin, to be able to start the platform', () => {
    expect(dockerfile).toContain('docker-cli docker-cli-compose docker-cli-buildx');
  });
});

describe('docker-compose.setup.yml', () => {
  const compose = load(read('docker-compose.setup.yml')) as {
    services: Record<
      string,
      {
        build?: { context: string; dockerfile: string };
        image?: string;
        stdin_open?: boolean;
        tty?: boolean;
        volumes?: string[];
      }
    >;
  };
  const setup = compose.services.setup;

  it('has one service, `setup`, built from the assistant Dockerfile with the repository as context', () => {
    expect(Object.keys(compose.services)).toEqual(['setup']);
    expect(setup?.build).toEqual({ context: '.', dockerfile: 'setup/Dockerfile' });
    expect(existsSync(join(root, 'setup/Dockerfile'))).toBe(true);
  });

  it('is interactive', () => {
    expect(setup?.stdin_open).toBe(true);
    expect(setup?.tty).toBe(true);
  });

  it('mounts the project folder, and the Docker socket for the optional start', () => {
    expect(setup?.volumes).toEqual(['.:/project', '/var/run/docker.sock:/var/run/docker.sock']);
  });

  it('names its image, which the assistant reuses to start the platform', () => {
    expect(setup?.image).toBe('bde-network-setup');
  });

  it("has a project of its own, so that compose does not take the platform's containers for orphans", () => {
    expect((compose as unknown as { name?: string }).name).toBe('bde-network-setup');
  });

  it('does not depend on .env, which does not exist yet on a first run', () => {
    const code = read('docker-compose.setup.yml')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(code).not.toMatch(/env_file|\.env/);
  });
});

describe('repository hygiene', () => {
  it('ignores the backups of replaced files, which hold secrets, in git and in the platform image', () => {
    expect(read('.gitignore')).toMatch(/^\/\.setup-backups\/$/m);
    expect(read('.dockerignore')).toMatch(/^\.setup-backups$/m);
  });

  it('keeps the setup folder out of the platform image', () => {
    // The platform image builds from the whole context: the assistant is not part of it.
    const standalone = read('Dockerfile');
    expect(standalone).not.toContain('setup/');
    expect(read('.dockerignore')).toMatch(/^setup$/m);
  });
});
