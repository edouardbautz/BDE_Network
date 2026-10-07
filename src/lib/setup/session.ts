import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { draftFor, type SetupDraft } from './draft';
import { SETUP_COOKIE, isSetupMode, setupSessionKey } from './guard';

export interface SetupSession {
  key: string;
  draft: SetupDraft;
}

/**
 * The installer session of this request, or null when the visitor has not given the code (or it ran out).
 * 404 once the platform is installed: from then on the installer does not exist.
 */
export async function getSetupSession(): Promise<SetupSession | null> {
  if (!isSetupMode()) notFound();
  const token = (await cookies()).get(SETUP_COOKIE)?.value;
  const key = setupSessionKey(token);
  return key ? { key, draft: draftFor(key) } : null;
}

/** The address this request came by, as a default for the public address of the platform. */
export async function requestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000';
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http';
  return `${protocol}://${host}`;
}
