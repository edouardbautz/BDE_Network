// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  IMAGE,
  changelogSection,
  checkRelease,
  composeVersion,
  parseTag,
  releaseNotes,
} from './release.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const COMPOSE = `services:\n  app:\n    image: ${IMAGE}:\${BDE_VERSION:-1.2.0}\n    restart: unless-stopped\n`;
const CHANGELOG = `# Changelog

## [Unreleased]

## [1.2.0] - 2026-11-01

### Added

- A thing.

## [1.1.0] - 2026-10-15

- Older.

[Unreleased]: https://example.org/compare/v1.2.0...HEAD
[1.2.0]: https://example.org/compare/v1.1.0...v1.2.0
`;

describe('parseTag', () => {
  it('reads a version tag', () => {
    expect(parseTag('v1.2.3')).toEqual({
      version: '1.2.3',
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: false,
    });
  });

  it('knows a version with a suffix is a prerelease', () => {
    expect(parseTag('v1.2.3-rc.1')).toMatchObject({ version: '1.2.3-rc.1', prerelease: true });
  });

  it.each(['1.2.3', 'v1.2', 'v1.2.3.4', 'latest', 'v1.2.3-', 'vv1.2.3', '', 'v1.2.3 '])(
    'refuses %j',
    (tag) => {
      expect(parseTag(tag)).toBeNull();
    },
  );
});

describe('composeVersion', () => {
  it('reads the default version of the image line', () => {
    expect(composeVersion(COMPOSE)).toBe('1.2.0');
  });

  it('refuses latest, another image and a line that is not the expected one', () => {
    expect(composeVersion(COMPOSE.replace('${BDE_VERSION:-1.2.0}', 'latest'))).toBeNull();
    expect(composeVersion(COMPOSE.replace('ghcr.io/edouardbautz', 'ghcr.io/someone'))).toBeNull();
    expect(composeVersion('services:\n  app:\n    build: .\n')).toBeNull();
    expect(composeVersion(`    image: ${IMAGE}:\${BDE_VERSION}\n`)).toBeNull();
  });
});

describe('changelogSection', () => {
  it('returns the text of one version, up to the next section', () => {
    expect(changelogSection(CHANGELOG, '1.2.0')).toBe('### Added\n\n- A thing.');
  });

  it('stops at the list of links for the last section', () => {
    expect(changelogSection(CHANGELOG, '1.1.0')).toBe('- Older.');
  });

  it('does not take 1.2.0 for 1.2.01, nor a dot for any character', () => {
    expect(changelogSection(CHANGELOG, '1.2.01')).toBeNull();
    expect(changelogSection(CHANGELOG, '1x2.0')).toBeNull();
  });

  it('returns an empty text for an empty section and null for a missing one', () => {
    expect(changelogSection(CHANGELOG, 'Unreleased')).toBe('');
    expect(changelogSection(CHANGELOG, '9.9.9')).toBeNull();
  });

  it('reads a file with Windows line endings', () => {
    expect(changelogSection(CHANGELOG.replace(/\n/g, '\r\n'), '1.2.0')).toBe(
      '### Added\n\n- A thing.',
    );
  });
});

describe('checkRelease', () => {
  const ok = {
    tag: 'v1.2.0',
    packageVersion: '1.2.0',
    composeText: COMPOSE,
    changelogText: CHANGELOG,
  };

  it('accepts a release whose four places agree', () => {
    expect(checkRelease(ok)).toEqual([]);
  });

  it('refuses a tag that is not a version', () => {
    expect(checkRelease({ ...ok, tag: 'release-1' })).toHaveLength(1);
  });

  it('refuses a package.json at another version', () => {
    expect(checkRelease({ ...ok, packageVersion: '1.1.0' })).toEqual([
      expect.stringContaining('package.json says 1.1.0'),
    ]);
  });

  it('refuses a compose file that would start another image', () => {
    const problems = checkRelease({ ...ok, composeText: COMPOSE.replace('1.2.0', '1.1.0') });
    expect(problems).toEqual([expect.stringContaining('docker-compose.yml starts 1.1.0')]);
  });

  it('refuses a compose file without the image line', () => {
    expect(checkRelease({ ...ok, composeText: 'services: {}\n' })).toEqual([
      expect.stringContaining('docker-compose.yml has no line'),
    ]);
  });

  it('refuses a missing or empty CHANGELOG section', () => {
    expect(
      checkRelease({ ...ok, changelogText: CHANGELOG.replace('## [1.2.0]', '## [1.2.9]') }),
    ).toEqual([expect.stringContaining('no section "## [1.2.0]"')]);
    expect(
      checkRelease({ ...ok, changelogText: CHANGELOG.replace('### Added\n\n- A thing.\n', '') }),
    ).toEqual([expect.stringContaining('is empty')]);
  });

  it('tells everything that is wrong at once', () => {
    expect(
      checkRelease({ tag: 'v1.2.0', packageVersion: '0.0.1', composeText: 'x', changelogText: '' }),
    ).toHaveLength(3);
  });
});

describe('releaseNotes', () => {
  it('is the CHANGELOG section, as written', () => {
    expect(releaseNotes(CHANGELOG, '1.2.0')).toBe('### Added\n\n- A thing.');
  });

  it('refuses a version without notes', () => {
    expect(() => releaseNotes(CHANGELOG, '9.9.9')).toThrow('No notes for 9.9.9');
    expect(() => releaseNotes(CHANGELOG, 'Unreleased')).toThrow();
  });
});

describe('this repository', () => {
  // The day somebody bumps package.json and forgets the compose file, the people who update would start the old image.
  it('has a docker-compose.yml that starts the version of package.json', () => {
    const version = (JSON.parse(read('package.json')) as { version: string }).version;
    expect(composeVersion(read('docker-compose.yml'))).toBe(version);
  });

  it('has notes for the version of package.json', () => {
    const version = (JSON.parse(read('package.json')) as { version: string }).version;
    expect(changelogSection(read('CHANGELOG.md'), version)).toBeTruthy();
  });

  it('only builds the image in the file made for it, and never names it latest', () => {
    expect(read('docker-compose.yml')).not.toMatch(/^\s*build:/m);
    expect(read('docker-compose.yml')).not.toMatch(/bde_network:latest/);
    expect(read('docker-compose.build.yml')).toMatch(/^\s*build: \./m);
    // a locally built image must not be taken for the published one
    expect(read('docker-compose.build.yml')).not.toContain(IMAGE);
  });
});
