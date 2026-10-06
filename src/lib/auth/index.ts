import NextAuth from 'next-auth';
import { FortyTwoProvider } from './fortytwo-provider';
import { AUTH_ERROR_PATH, jwtCallback, sessionCallback, signInCallback } from './callbacks';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [FortyTwoProvider()],
  session: { strategy: 'jwt' },
  trustHost: true,
  pages: {
    error: AUTH_ERROR_PATH,
  },
  callbacks: {
    signIn: signInCallback,
    jwt: jwtCallback,
    session: sessionCallback,
  },
});
