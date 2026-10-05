import NextAuth from 'next-auth';
import { getConfig } from '@/config';
import { prisma } from '@/lib/prisma';
import { FortyTwoProvider } from './fortytwo-provider';
import { isCampusAllowed, isOwnerLogin } from './authorize';
import { jwtCallback, sessionCallback } from './callbacks';

const AUTH_ERROR_PATH = '/auth-error';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [FortyTwoProvider()],
  session: { strategy: 'jwt' },
  trustHost: true,
  pages: {
    error: AUTH_ERROR_PATH,
  },
  callbacks: {
    async signIn({ user }) {
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
      const existing = await prisma.user.findUnique({ where: { login } });

      if (existing) {
        await prisma.user.update({
          where: { login },
          data: {
            fullName: user.name ?? existing.fullName,
            email,
            photoUrl: user.image ?? null,
            campus,
            role: isOwner ? 'OWNER' : existing.role === 'OWNER' ? 'MEMBER' : existing.role,
            lastLoginAt: new Date(),
          },
        });
      } else {
        await prisma.user.create({
          data: {
            login,
            fullName: user.name ?? login,
            email,
            photoUrl: user.image ?? null,
            campus,
            role: isOwner ? 'OWNER' : 'PENDING',
            lastLoginAt: new Date(),
          },
        });
      }

      return true;
    },
    jwt: jwtCallback,
    session: sessionCallback,
  },
});
