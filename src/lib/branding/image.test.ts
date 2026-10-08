import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, checkLogo, inspectImage } from './image';

/** Headers only: what the inspector reads is the first bytes, never the pixels. */
const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const gif = (w: number, h: number) => {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  new DataView(b.buffer).setUint16(6, w, true);
  new DataView(b.buffer).setUint16(8, h, true);
  return b;
};
const jpeg = (w: number, h: number) => {
  // SOI, an APP0 segment to skip, then SOF0 (height, then width).
  const b = new Uint8Array(2 + 4 + 14 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  new DataView(b.buffer).setUint16(25, h);
  new DataView(b.buffer).setUint16(27, w);
  return b;
};
const webpLossy = (w: number, h: number) => {
  const b = new Uint8Array(34);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  b.set([0x9d, 0x01, 0x2a], 23);
  new DataView(b.buffer).setUint16(26, w, true);
  new DataView(b.buffer).setUint16(28, h, true);
  return b;
};
const webpLossless = (w: number, h: number) => {
  const b = new Uint8Array(34);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c]);
  b[20] = 0x2f;
  const bits = (w - 1) | ((h - 1) << 14);
  new DataView(b.buffer).setUint32(21, bits >>> 0, true);
  return b;
};
const webpExtended = (w: number, h: number) => {
  const b = new Uint8Array(34);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  b.set([(w - 1) & 255, ((w - 1) >> 8) & 255, (w - 1) >> 16], 24);
  b.set([(h - 1) & 255, ((h - 1) >> 8) & 255, (h - 1) >> 16], 27);
  return b;
};

describe('inspectImage', () => {
  it.each([
    ['png', png(512, 300), 'image/png', 512, 300],
    ['gif', gif(200, 120), 'image/gif', 200, 120],
    ['jpeg', jpeg(640, 480), 'image/jpeg', 640, 480],
    ['webp (lossy)', webpLossy(256, 128), 'image/webp', 256, 128],
    ['webp (lossless)', webpLossless(300, 301), 'image/webp', 300, 301],
    ['webp (extended)', webpExtended(1000, 700), 'image/webp', 1000, 700],
  ])('reads a %s', (_name, bytes, mime, width, height) => {
    expect(inspectImage(bytes)).toMatchObject({ mime, width, height });
  });

  it('knows nothing of an SVG, a script, an empty or a truncated file', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(inspectImage(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(inspectImage(text('<script>alert(1)</script>'))).toBeNull();
    expect(inspectImage(new Uint8Array())).toBeNull();
    expect(inspectImage(png(10, 10).subarray(0, 12))).toBeNull();
    expect(inspectImage(jpeg(10, 10).subarray(0, 8))).toBeNull();
  });

  it('does not believe a header that announces no size', () => {
    expect(inspectImage(png(0, 10))).toBeNull();
    expect(inspectImage(gif(10, 0))).toBeNull();
  });
});

describe('checkLogo', () => {
  it('accepts a logo of a good size', () => {
    expect(checkLogo(png(512, 512))).toMatchObject({ ok: true });
  });

  it('refuses an empty file', () => {
    expect(checkLogo(new Uint8Array())).toEqual({ ok: false, code: 'logoEmpty' });
  });

  it('refuses what is not an image, whatever it is called', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(checkLogo(svg)).toEqual({ ok: false, code: 'logoFormat' });
  });

  it('refuses an image that is too small, or too large', () => {
    expect(checkLogo(png(32, 512))).toEqual({ ok: false, code: 'logoSmall' });
    expect(checkLogo(png(5000, 4500))).toEqual({ ok: false, code: 'logoLarge' });
  });

  it('refuses a huge file before reading it', () => {
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(png(512, 512));
    expect(checkLogo(big)).toEqual({ ok: false, code: 'logoTooBig' });
  });
});
