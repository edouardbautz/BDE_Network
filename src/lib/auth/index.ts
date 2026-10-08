import NextAuth from 'next-auth';
import { FortyTwoProvider } from './fortytwo-provider';
import { registeredAddress } from '@/lib/public-address';
import { AUTH_ERROR_PATH, jwtCallback, sessionCallback, signInCallback } from './callbacks';

// The configuration is built for each request, not once when the module loads: the 42 application's
// identifier and secret now live in the database (src/lib/settings) and can change while the server runs.
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  // The address registered in the settings is the one 42 knows (it is the redirect URL declared on the intra):
  // it is what Auth.js builds the redirect_uri and its redirects from, at the way out (`signIn`) as at the way
  // back (the callback), and what the session cookie's security is decided from. `AUTH_URL` is the setting
  // Auth.js reads for that. Without a registered address nothing is set, and the address of the request is used.
  const address = registeredAddress();
  if (address) process.env.AUTH_URL = address;

  return {
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
  };
});
