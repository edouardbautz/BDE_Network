import { NextResponse } from 'next/server';
import { getStorageAdapter } from '@/lib/storage';

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

function guessContentType(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase();
  return (extension && CONTENT_TYPES[extension]) || 'application/octet-stream';
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const path = key.join('/');

  try {
    const data = await getStorageAdapter().read(path);
    return new NextResponse(new Uint8Array(data), {
      headers: { 'Content-Type': guessContentType(path) },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
