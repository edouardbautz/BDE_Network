import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { isSetupMode } from '@/lib/setup/guard';

const intl = createMiddleware(routing);

const SETUP_PATH = /^\/(?:fr|en)\/setup(?:\/|$)/;

/** Whether the percent-encoding of an address can be read (`%ff` and a lone `%` cannot). */
function isWellEncoded(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return true;
  } catch {
    return false;
  }
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // An address that cannot be decoded makes Next.js fail while it reads the parameters of the route, and answer 500 with an
  // error in the logs for a request that is simply wrong: it is answered here, before anything else, as what it is.
  if (!isWellEncoded(pathname)) {
    return new NextResponse('Bad Request', {
      status: 400,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // The platform is not installed: the installer is the only page, and the only thing that answers besides
  // the health check. (This runs on the Node.js runtime, so it sees the same state as the server.)
  if (isSetupMode() && pathname !== '/api/health') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { status: 'not-installed' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!SETUP_PATH.test(pathname)) {
      const locale = pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'fr';
      // From request.nextUrl, which carries the host the visitor used (a relative address is refused here, and
      // `request.url` can carry the container's own host name).
      const target = request.nextUrl.clone();
      target.pathname = `/${locale}/setup`;
      target.search = '';
      const response = NextResponse.redirect(target);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
  }

  // The API has no language in its address.
  if (pathname.startsWith('/api/')) return NextResponse.next();
  return intl(request);
}

// (Next.js 16 calls this file a "proxy" and always runs it on the Node.js runtime.)
export const config = {
  // Everything but Next's own files and files with an extension (images, the favicon...).
  matcher: ['/((?!_next|_vercel|.*\\..*).*)'],
};
