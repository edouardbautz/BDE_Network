import { NextResponse } from 'next/server';
import { logAuditEvent } from '@/lib/audit-log';
import { openDownload } from '@/lib/backups/download';
import { backupDir } from '@/lib/backups/service';
import { getSettingsManager } from '@/lib/settings/access';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

/** A page of this platform asks from its own address: the origin of a request that carries one must be the host it was sent to. */
function fromAnotherSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

const refusal = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Takes a backup away from the server, encrypted with a passphrase the owner chose for this download (`{ name, passphrase }` in the body, so
 * that it is in no address and no log). Owners only, and a bare 404 for anybody else. The passphrase is never kept: lost, the file cannot be
 * opened (the page says so). The download is written in the audit log before the first byte leaves, and without it no byte leaves.
 */
export async function POST(request: Request) {
  const session = await getSettingsManager();
  if (!session) return new NextResponse(null, { status: 404 });
  if (fromAnotherSite(request)) return refusal('origin', 403);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return refusal('tooLarge', 413);
  let body: { name?: unknown; passphrase?: unknown };
  try {
    body = JSON.parse(text) as { name?: unknown; passphrase?: unknown };
  } catch {
    return refusal('badRequest', 400);
  }

  const download = await openDownload({
    dir: backupDir(),
    name: body.name,
    passphrase: body.passphrase,
  });
  if (!download.ok) return refusal(download.refusal, download.refusal === 'missing' ? 404 : 400);

  await logAuditEvent({
    actorLogin: session.user.login,
    actorId: session.user.id,
    action: 'backup.download',
    targetType: 'Backup',
    targetLabel: String(body.name),
    metadata: { encrypted: true },
  });

  return new Response(download.stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${download.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
