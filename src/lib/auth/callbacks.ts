import type { JWT } from '@auth/core/jwt';
import type { Session, User } from 'next-auth';
import { getConfig } from '@/config';
import { prisma } from '@/lib/prisma';
import { accessFor } from './access';

/**
 * Runs when the cookie is created (sign-in, `user` set) and on every later
 * read of it. The JWT only proves who signed in, not that the account still
 * exists: removing a member deletes their `User` row, but their cookie stays
 * cryptographically valid for up to 30 days. Returning `null` ends the session
 * (Auth.js clears the cookie and `auth()` resolves to null), so a removed
 * member is signed out on their very next request.
 */
export async function jwtCallback({
  token,
  user,
}: {
  token: JWT;
  user?: User;
}): Promise<JWT | null> {
  if (user?.login) {
    // Sign-in: the signIn callback has just created or updated the row.
    token.login = user.login;
    return token;
  }

  if (!token.login) {
    return null;
  }

  const account = await prisma.user.findUnique({
    where: { login: token.login },
    select: { id: true },
  });
  return account ? token : null;
}

/**
 * Builds the session from the database on every call, so role and permission
 * changes apply on the user's next request. It throws instead of returning a
 * half-filled session when the account is gone (it can only happen if the row
 * is removed between the jwt callback and this one): Auth.js then treats the
 * request as unauthenticated, and no caller ever sees a user without an id
 * and a status. Likewise for a member without a role, which the database
 * refuses to store: it would otherwise be a member holding nothing by accident.
 */
export async function sessionCallback({
  session,
  token,
}: {
  session: Session;
  token: JWT;
}): Promise<Session> {
  const login = token.login;
  const dbUser = login
    ? await prisma.user.findUnique({ where: { login }, include: { role: true } })
    : null;
  if (!dbUser || (dbUser.status === 'MEMBER' && !dbUser.role)) {
    throw new Error('[auth] No account behind this session');
  }

  session.user.id = dbUser.id;
  session.user.login = dbUser.login;
  Object.assign(session.user, accessFor(dbUser, getConfig().modules.enabled));
  session.user.campus = dbUser.campus;
  session.user.name = dbUser.fullName;
  session.user.email = dbUser.email;
  session.user.image = dbUser.photoUrl;
  return session;
}
