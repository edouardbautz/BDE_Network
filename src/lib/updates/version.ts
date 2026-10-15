/**
 * The version of the platform that runs, and the order of versions. Only plain `major.minor.patch` versions (with an
 * optional `-suffix`, a preview) are known: anything else is "not a version" and is never compared.
 */

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** A preview (`1.2.0-rc.1`) comes before the version it announces. */
  preview: boolean;
}

export function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    preview: match[4] !== undefined,
  };
}

/** Whether `candidate` is strictly newer than `running`. False when either is not a version. */
export function isNewerVersion(candidate: string, running: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(running);
  if (!a || !b) return false;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key];
  }
  return b.preview && !a.preview;
}

/**
 * The version written into the image when it is built (docker/start.mjs hands it over as `BDE_VERSION`). Null when
 * it is not a version: `npm run dev`, `unknown`, anything odd.
 */
export function runningVersion(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const value = env.BDE_VERSION?.trim();
  return value && parseVersion(value) ? value : null;
}
