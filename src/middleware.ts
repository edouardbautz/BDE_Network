import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { isSetupMode } from '@/lib/setup/guard';

const intl = createMiddleware(routing);

const SETUP_PATH = /^\/(?:fr|en)\/setup(?:\/|$)/;

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
      // A relative address on purpose: behind Docker, `request.url` can carry the container's own host name.
      return new NextResponse(null, {
        status: 307,
        headers: { Location: `/${locale}/setup`, 'Cache-Control': 'no-store' },
      });
    }
  }

  // The API has no language in its address.
  if (pathname.startsWith('/api/')) return NextResponse.next();
  return intl(request);
}

export const config = {
  runtime: 'nodejs',
  // Everything but Next's own files and files with an extension (images, the favicon...).
  matcher: ['/((?!_next|_vercel|.*\..*).*)'],
};
