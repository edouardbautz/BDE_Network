import { summarizeNotes } from './notes';
import { parseVersion } from './version';

/**
 * The newest published version of BDE_Network, asked to GitHub (the project's releases, public, no account).
 *
 * This is the one thing the platform asks the outside world about itself, and it only runs for an owner who looks
 * at the dashboard or the settings, while `updates.check` is on (see docs/en/configuration.md). The request carries
 * nothing of the BDE: no member, no address, no setting; GitHub sees the server's address and the version it runs
 * (the `User-Agent`), like any download.
 *
 * Never throws, never waits more than a few seconds, and answers from a cache: a success is kept 6 hours, a failure
 * 30 minutes (GitHub allows 60 anonymous requests an hour per address, and an outage must not be asked again on
 * every page).
 */

export const RELEASES_REPOSITORY = 'edouardbautz/BDE_Network';
const RELEASES_URL_PREFIX = `https://github.com/${RELEASES_REPOSITORY}/releases/`;

export interface LatestRelease {
  version: string;
  /** The release's page: an address on github.com/<the project>/releases, nothing else. */
  url: string;
  /** A short plain-text summary of the notes. */
  summary: string;
}

const TIMEOUT_MS = 3000;
const TTL_OK_MS = 6 * 60 * 60_000;
const TTL_FAILED_MS = 30 * 60_000;

/** Where the releases are asked. `RELEASES_API_URL` replaces GitHub for the end-to-end tests; never set in a real installation. */
function apiBase(): string {
  const custom = process.env.RELEASES_API_URL?.trim().replace(/\/+$/, '');
  return custom || 'https://api.github.com';
}

interface Cached {
  release: LatestRelease | null;
  until: number;
}

let cached: Cached | null = null;
let inFlight: Promise<LatestRelease | null> | null = null;

/** Forgets the last answer (for the tests). */
export function resetLatestReleaseCache(): void {
  cached = null;
  inFlight = null;
}

/** What GitHub answered, if it is a published release of the project; null otherwise. */
export function readRelease(payload: unknown): LatestRelease | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { tag_name, html_url, body, draft, prerelease } = payload as Record<string, unknown>;
  if (draft === true || prerelease === true) return null;
  if (typeof tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag_name)) return null;
  const version = tag_name.slice(1);
  if (!parseVersion(version)) return null;
  if (typeof html_url !== 'string' || !html_url.startsWith(RELEASES_URL_PREFIX)) return null;
  return { version, url: html_url, summary: typeof body === 'string' ? summarizeNotes(body) : '' };
}

async function ask(
  fetchImpl: typeof fetch,
  runningVersion: string | null,
): Promise<LatestRelease | null> {
  try {
    const response = await fetchImpl(`${apiBase()}/repos/${RELEASES_REPOSITORY}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `BDE_Network/${runningVersion ?? 'unknown'}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return readRelease(await response.json());
  } catch {
    return null; // no network, timeout, not JSON
  }
}

export async function latestRelease(
  runningVersion: string | null,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<LatestRelease | null> {
  if (cached && cached.until > now()) return cached.release;
  inFlight ??= ask(fetchImpl, runningVersion)
    .then((release) => {
      cached = { release, until: now() + (release ? TTL_OK_MS : TTL_FAILED_MS) };
      return release;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
