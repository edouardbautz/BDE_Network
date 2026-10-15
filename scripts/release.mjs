// What a release is made of, checked before anything is published (.github/workflows/release.yml).
//
//   node scripts/release.mjs check v1.1.0        the tag, package.json, docker-compose.yml and CHANGELOG.md agree
//   node scripts/release.mjs notes v1.1.0        the release notes: the CHANGELOG's section for that version
//   node scripts/release.mjs prerelease v1.1.0   "true" or "false" (a version with a suffix, like 1.2.0-rc.1)
//
// The pure parts are exported and tested (release.test.ts): a release that publishes an image the compose file does
// not point to, or notes that are not the CHANGELOG's, would be found by the people who update, not by us.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE = 'ghcr.io/edouardbautz/bde_network';

const TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/;

/** "v1.2.3" or "v1.2.3-rc.1" → its parts; null for anything else. */
export function parseTag(tag) {
  const match = TAG.exec(String(tag));
  if (!match) return null;
  const [, major, minor, patch, suffix] = match;
  return {
    version: `${major}.${minor}.${patch}${suffix ? `-${suffix}` : ''}`,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: Boolean(suffix),
  };
}

/** The version docker-compose.yml starts when nothing says otherwise, or null when the line is not the expected one. */
export function composeVersion(composeText) {
  const escaped = IMAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `^\\s*image:\\s*${escaped}:\\$\\{BDE_VERSION:-([^}\\s]+)\\}\\s*$`,
    'm',
  ).exec(composeText);
  return match?.[1] ?? null;
}

/** The text of the CHANGELOG's section `## [version]`, up to the next one (or the link list); null when absent. */
export function changelogSection(changelogText, version) {
  const lines = changelogText.replace(/\r\n/g, '\n').split('\n');
  const heading = new RegExp(
    `^## \\[${version.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')}\\](?:\\s|$)`,
  );
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  let end = lines.findIndex(
    (line, index) => index > start && (/^## \[/.test(line) || /^\[[^\]]+\]: /.test(line)),
  );
  if (end === -1) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

/** What is wrong with publishing this tag; an empty list when it can go out. */
export function checkRelease({ tag, packageVersion, composeText, changelogText }) {
  const parsed = parseTag(tag);
  if (!parsed) return [`The tag "${tag}" is not a version like v1.2.3 (or v1.2.3-rc.1).`];
  const problems = [];
  if (packageVersion !== parsed.version) {
    problems.push(
      `package.json says ${packageVersion}, the tag says ${parsed.version}. Change one, in a pull request.`,
    );
  }
  const inCompose = composeVersion(composeText);
  if (inCompose === null) {
    problems.push(`docker-compose.yml has no line "image: ${IMAGE}:\${BDE_VERSION:-<version>}".`);
  } else if (inCompose !== parsed.version) {
    problems.push(
      `docker-compose.yml starts ${inCompose} by default, the tag says ${parsed.version}: the people who update would get another image than the one published.`,
    );
  }
  const section = changelogSection(changelogText, parsed.version);
  if (section === null) problems.push(`CHANGELOG.md has no section "## [${parsed.version}]".`);
  else if (section === '')
    problems.push(`The section "## [${parsed.version}]" of CHANGELOG.md is empty.`);
  return problems;
}

/** The release notes: the CHANGELOG's section, as written. */
export function releaseNotes(changelogText, version) {
  const section = changelogSection(changelogText, version);
  if (!section) throw new Error(`No notes for ${version} in CHANGELOG.md.`);
  return section;
}

function main(argv) {
  const [command, tag] = argv;
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const parsed = parseTag(tag);
  if (!parsed || !['check', 'notes', 'prerelease'].includes(command ?? '')) {
    console.error('Usage: node scripts/release.mjs <check|notes|prerelease> v1.2.3');
    return 2;
  }
  const read = (file) => readFileSync(join(root, file), 'utf8');
  if (command === 'prerelease') {
    console.log(parsed.prerelease ? 'true' : 'false');
    return 0;
  }
  if (command === 'notes') {
    console.log(releaseNotes(read('CHANGELOG.md'), parsed.version));
    return 0;
  }
  const problems = checkRelease({
    tag,
    packageVersion: JSON.parse(read('package.json')).version,
    composeText: read('docker-compose.yml'),
    changelogText: read('CHANGELOG.md'),
  });
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length === 0)
    console.log(`✓ ${tag}: package.json, docker-compose.yml and CHANGELOG.md agree.`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exitCode = main(process.argv.slice(2));
