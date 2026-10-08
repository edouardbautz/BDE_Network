import type { NextRequest } from 'next/server';
import { handlers } from '@/lib/auth';
import { atPublicOrigin } from '@/lib/auth/public-request';

// Auth.js builds the redirect_uri and its redirects from the URL of the request: it is the platform's public
// address, not the one the server listens on (see public-request.ts).
export const GET = (request: NextRequest) => handlers.GET(atPublicOrigin(request));
export const POST = (request: NextRequest) => handlers.POST(atPublicOrigin(request));
