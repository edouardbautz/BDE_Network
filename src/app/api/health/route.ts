import { NextResponse } from 'next/server';
import { isDatabaseReachable } from '@/lib/health';

export const dynamic = 'force-dynamic';

/** Liveness and database check, for the Docker health check and the "service
 * unavailable" page. Public and deliberately bare: no version, no detail. */
export async function GET() {
  const ok = await isDatabaseReachable();
  return NextResponse.json(
    { status: ok ? 'ok' : 'unavailable' },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
