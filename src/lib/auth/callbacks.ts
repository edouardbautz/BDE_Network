import type { JWT } from '@auth/core/jwt';
import { after } from 'next/server';
import type { Session, User } from 'next-auth';
import { getConfig } from '@/config';
import { notifyMemberPending } from '@/lib/members/notifications';
import { prisma } from '@/lib/prisma';
import { accessFor } from './access';
import { accountAfterLogin } from './account';
import { isCampusAllowed, isOwnerLogin } from './authorize';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/** Where Auth.js sends a visitor whose sign-in was refused (the page explains why). */
export const AUTH_ERROR_PATH = '/auth-error';

/**
 * Runs when someone comes back from 42, before the cookie exists: refuses profiles that are
 * incomplete or from a campus the BDE does not take, then creates or refreshes the account.
 * A new account starts as PENDING (OWNER when the config lists the login), and whoever can
 * approve it is told once, after the sign-in went through.
 */
export async function signInCallback({ user }: { user: User }): Promise<boolean | string> {
  const login = user.login;
  const campus = user.campus;
  const email = user.email;

  if (!login || !campus || !email) {
    console.error(
      `[auth] Connexion refusée : profil 42 incomplet — login reçu : "${login ?? ''}", ` +
        `campus reçu : "${campus ?? ''}", email reçu : "${email ?? ''}".`,
    );
    return `${AUTH_ERROR_PATH}?reason=missing-profile`;
  }

  const config = getConfig();
  if (!isCampusAllowed(campus, config.auth.allowedCampuses)) {
    const allowedLabel =
      config.auth.allowedCampuses.length > 0
        ? config.auth.allowedCampuses.join(', ')
        : '(aucun filtre configuré — ce refus ne devrait pas se produire)';
    console.error(
      `[auth] Connexion refusée pour le login "${login}" : campus reçu "${campus}", ` +
        `campus autorisés : [${allowedLabel}].`,
    );
    return `${AUTH_ERROR_PATH}?reason=campus-not-allowed&campus=${encodeURIComponent(campus)}`;
  }

  const isOwner = isOwnerLogin(login, config.auth.owners);
  let existing = await prisma.user.findUnique({ where: { login } });

  if (!existing) {
    try {
      const created = await prisma.user.create({
        data: {
          login,
          fullName: user.name ?? login,
          email,
          photoUrl: user.image ?? null,
          campus,
          status: isOwner ? 'OWNER' : 'PENDING',
          lastLoginAt: new Date(),
        },
      });
      // A new request: tell whoever can approve it, once, after the sign-in went through.
      if (created.status === 'PENDING') {
        after(() => notifyMemberPending(created.id));
      }
      return true;
    } catch (error) {
      // Two first sign-ins at the same moment (a double click, two tabs): the other one created
      // the account between our look and our insert. It is the one that notifies; this one
      // carries on as a return visit instead of failing with a database error.
      if (!isUniqueViolation(error)) throw error;
      existing = await prisma.user.findUnique({ where: { login } });
      if (!existing) throw error;
    }
  }

  await prisma.user.update({
    where: { login },
    data: {
      fullName: user.name ?? existing.fullName,
      email,
      photoUrl: user.image ?? null,
      campus,
      ...(await accountAfterLogin(existing, isOwner)),
      lastLoginAt: new Date(),
    },
  });

  return true;
}

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
