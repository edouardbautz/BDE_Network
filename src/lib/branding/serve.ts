import { NextResponse } from 'next/server';
import { inspectImage } from './image';

/**
 * How the platform sends an image it stored (the logo, the icons made from it). Every answer, a refusal included, carries a strict
 * policy of its own (the one of the pages does not apply, see `security-headers.ts`), and the image is sent so that a browser cannot take
 * it for anything else: `nosniff`, and a policy that forbids everything if somebody opens it as a page. A version in the address
 * (`?v=`) is a file that never changes (cached for good: a new logo is a new address); without it, what the settings point to now.
 */
export const IMAGE_POLICY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'X-Content-Type-Options': 'nosniff',
};

export const imageNotFound = () =>
  new NextResponse(null, { status: 404, headers: IMAGE_POLICY_HEADERS });

/** The image as it is stored, identified again by its bytes (never by a stored name); a 404 when it is none. */
export function imageResponse(bytes: Buffer | null, tag: string, versioned: boolean): NextResponse {
  const info = bytes ? inspectImage(bytes) : null;
  if (!bytes || !info) return imageNotFound();
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': info.mime,
      'Content-Length': String(bytes.length),
      ...IMAGE_POLICY_HEADERS,
      ETag: `"${tag}"`,
      'Cache-Control': versioned
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate',
    },
  });
}
