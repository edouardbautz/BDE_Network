import NextAuth from 'next-auth';
import { getConfig } from '@/config';
import { prisma } from '@/lib/prisma';
import { FortyTwoProvider } from './fortytwo-provider';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [FortyTwoProvider()],
  session: { strategy: 'jwt' },
  trustHost: true,
  callbacks: {
    async signIn({ user }) {
      const login = user.login;
      const campus = user.campus;

      if (!login || !campus || !user.email) {
        return false;
      }

      const config = getConfig();
      if (!config.auth.allowedCampuses.includes(campus)) {
        return false;
      }

      const isOwner = config.auth.owners.includes(login.toLowerCase());
      const existing = await prisma.user.findUnique({ where: { login } });

      if (existing) {
        await prisma.user.update({
          where: { login },
          data: {
            fullName: user.name ?? existing.fullName,
            email: user.email,
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
            email: user.email,
            photoUrl: user.image ?? null,
            campus,
            role: isOwner ? 'OWNER' : 'PENDING',
            lastLoginAt: new Date(),
          },
        });
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user?.login) {
        token.login = user.login;
      }
      return token;
    },
    async session({ session, token }) {
      const login = token.login;
      if (!login) {
        return session;
      }

      const dbUser = await prisma.user.findUnique({ where: { login } });
      if (!dbUser) {
        return session;
      }

      session.user.id = dbUser.id;
      session.user.login = dbUser.login;
      session.user.role = dbUser.role;
      session.user.campus = dbUser.campus;
      session.user.name = dbUser.fullName;
      session.user.email = dbUser.email;
      session.user.image = dbUser.photoUrl;
      return session;
    },
  },
});
