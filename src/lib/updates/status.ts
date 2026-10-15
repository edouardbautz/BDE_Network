import { getConfig } from '@/config';
import { latestRelease } from './latest-release';
import { isNewerVersion, runningVersion } from './version';

export type UpdateStatus =
  /** The owner turned the check off: nothing was asked to anybody. */
  | { state: 'disabled' }
  /** This platform does not know its own version (development), or GitHub could not be asked. */
  | { state: 'unknown' }
  | { state: 'current' }
  | { state: 'available'; current: string; latest: string; url: string; summary: string };

/** Whether a newer version than the one that runs is published. */
export async function updateStatus(): Promise<UpdateStatus> {
  if (!getConfig().updates.check) return { state: 'disabled' };
  const current = runningVersion();
  if (!current) return { state: 'unknown' };
  const release = await latestRelease(current);
  if (!release) return { state: 'unknown' };
  if (!isNewerVersion(release.version, current)) return { state: 'current' };
  return {
    state: 'available',
    current,
    latest: release.version,
    url: release.url,
    summary: release.summary,
  };
}
