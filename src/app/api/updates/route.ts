import { NextResponse } from 'next/server';
import { getSettingsManager } from '@/lib/settings/access';
import { updateStatus } from '@/lib/updates/status';

export const dynamic = 'force-dynamic';

/**
 * Whether a newer version is published, for the banner the owners see. Owners only, and a bare 404 for anybody else
 * (a member has nothing to learn here). The answer comes from a cache; see `lib/updates/latest-release.ts`.
 */
export async function GET() {
  if (!(await getSettingsManager())) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json(await updateStatus(), { headers: { 'Cache-Control': 'no-store' } });
}
