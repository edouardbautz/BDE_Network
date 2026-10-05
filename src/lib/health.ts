import { prisma } from '@/lib/prisma';

/**
 * Whether the database answers. Used by /api/health (the container health
 * check) and to tell "the service is down" from "you are not signed in": when
 * the database is unreachable Auth.js reports no session, which would otherwise
 * look exactly like a logged-out visitor.
 *
 * Never throws and never waits longer than `timeoutMs`.
 */
export async function isDatabaseReachable(timeoutMs = 3000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('database check timed out')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
