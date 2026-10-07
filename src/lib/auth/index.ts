import NextAuth from 'next-auth';
import { FortyTwoProvider } from './fortytwo-provider';
import { AUTH_ERROR_PATH, jwtCallback, sessionCallback, signInCallback } from './callbacks';

// The configuration is built for each request, not once when the module loads: the 42 application's
// identifier and secret now live in the database (src/lib/settings) and can change while the server runs.
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
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
}));
