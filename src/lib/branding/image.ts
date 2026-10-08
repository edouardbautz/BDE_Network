/**
 * What the platform accepts as the BDE's logo, checked on the bytes themselves (never on the name or the type the
 * browser announces): a PNG, a JPEG, a GIF or a WebP, of a reasonable size.
 *
 * No SVG, on purpose. The logo is shown in the interface, but also fetched by Discord, Slack and the readers of
 * e-mails, and none of them shows an SVG; and an SVG is a document that can carry a script, which has no place in a
 * file that anybody with the address can open.
 */

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** The smaller side must be at least this (Discord asks for 128 px for a sharp avatar; below 64 px it is a blur). */
export const LOGO_MIN_SIDE = 64;
export const LOGO_MAX_SIDE = 4096;

export type ImageType = 'png' | 'jpeg' | 'gif' | 'webp';

export interface ImageInfo {
  type: ImageType;
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  width: number;
  height: number;
}

const MIME: Record<ImageType, ImageInfo['mime']> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const be16 = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const le16 = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const be32 = (b: Uint8Array, i: number) => be16(b, i) * 65536 + be16(b, i + 2);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function png(b: Uint8Array): [number, number] | null {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
  return [be32(b, 16), be32(b, 20)];
}

function gif(b: Uint8Array): [number, number] | null {
  return b.length < 10 ? null : [le16(b, 6), le16(b, 8)];
}

function jpeg(b: Uint8Array): [number, number] | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1; // padding
      continue;
    }
    // Start of frame (any process), but not the table markers that sit in the same range.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return [be16(b, i + 7), be16(b, i + 5)];
    }
    i += 2 + be16(b, i + 2);
  }
  return null;
}

function webp(b: Uint8Array): [number, number] | null {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return [le16(b, 26) & 0x3fff, le16(b, 28) & 0x3fff];
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (chunk === 'VP8X') {
    const w = (b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16);
    const h = (b[27] ?? 0) | ((b[28] ?? 0) << 8) | ((b[29] ?? 0) << 16);
    return [w + 1, h + 1];
  }
  return null;
}

/** The kind and the size of an image, read from its first bytes; null when it is none of the four. */
export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  let type: ImageType | null = null;
  let size: [number, number] | null = null;

  if (bytes.length > 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') {
    type = 'png';
    size = png(bytes);
  } else if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    type = 'jpeg';
    size = jpeg(bytes);
  } else if (ascii(bytes, 0, 4) === 'GIF8') {
    type = 'gif';
    size = gif(bytes);
  } else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    type = 'webp';
    size = webp(bytes);
  }
  if (!type || !size) return null;
  const [width, height] = size;
  if (width < 1 || height < 1) return null;
  return { type, mime: MIME[type], width, height };
}

export type LogoCheck =
  | { ok: true; info: ImageInfo }
  | { ok: false; code: 'logoEmpty' | 'logoTooBig' | 'logoFormat' | 'logoSmall' | 'logoLarge' };

/** Whether these bytes can be the logo: a code of what is wrong otherwise (translated by the page). */
export function checkLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.length === 0) return { ok: false, code: 'logoEmpty' };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, code: 'logoTooBig' };
  const info = inspectImage(bytes);
  if (!info) return { ok: false, code: 'logoFormat' };
  if (Math.min(info.width, info.height) < LOGO_MIN_SIDE) return { ok: false, code: 'logoSmall' };
  if (Math.max(info.width, info.height) > LOGO_MAX_SIDE) return { ok: false, code: 'logoLarge' };
  return { ok: true, info };
}
