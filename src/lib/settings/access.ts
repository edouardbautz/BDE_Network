import { getEffectiveSession, type EffectiveSession } from '@/lib/auth/session';
import { canManageSettings } from '@/lib/permissions';
import { getRuntimeSettings } from './runtime';

/**
 * Whether the settings can be changed from the app: they must be in the database (an installation that still
 * runs from bde.config.yml and .env, because they are not complete, has nothing to write to).
 */
export function isSettingsEditable(): boolean {
  return getRuntimeSettings() !== undefined;
}

/**
 * The owner behind this request, for a page. Null when nobody is signed in or the account is not an owner (a
 * simulated role in development counts for what it simulates).
 */
export async function getSettingsManager(): Promise<EffectiveSession | null> {
  const session = await getEffectiveSession();
  return session && canManageSettings(session.user) ? session : null;
}

/**
 * The owner behind this request, for a server action: throws otherwise. A hidden link is not a permission
 * check, and every action is an entry point of its own.
 */
export async function requireSettingsManager(): Promise<EffectiveSession> {
  const session = await getSettingsManager();
  if (!session) {
    throw new Error('Forbidden');
  }
  return session;
}
