import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, LOGO_MAX_SIDE, LOGO_MIN_SIDE, checkLogo, inspectImage } from './image';

/**
 * The limits of the logo's inspector, exactly: the size at which a file stops being accepted, the shortest file that still says
 * its size, the bytes of a signature one at a time. Found by the mutation testing of the quality campaign (a limit moved by one,
 * a signature checked in part, were not noticed by any test). Headers only: the inspector reads the first bytes, never the pixels.
 */

const bytes = (length: number, head: number[] = []) => {
  const b = new Uint8Array(length);
  b.set(head);
  return b;
};
const png = (w: number, h: number, length = 33) => {
  const b = bytes(
    length,
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52],
  );
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const gif = (w: number, h: number, length = 13) => {
  const b = bytes(length, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  new DataView(b.buffer).setUint16(6, w, true);
  new DataView(b.buffer).setUint16(8, h, true);
  return b;
};
const webpHead = (chunk: string, length = 34) => {
  const b = bytes(length, [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  b.set(
    [...chunk].map((c) => c.charCodeAt(0)),
    12,
  );
  return b;
};
const webpLossy = (w: number, h: number, length = 34) => {
  const b = webpHead('VP8 ', length);
  b.set([0x9d, 0x01, 0x2a], 23);
  new DataView(b.buffer).setUint16(26, w, true);
  new DataView(b.buffer).setUint16(28, h, true);
  return b;
};
const webpLossless = (w: number, h: number) => {
  const b = webpHead('VP8L');
  b[20] = 0x2f;
  new DataView(b.buffer).setUint32(21, ((w - 1) | ((h - 1) << 14)) >>> 0, true);
  return b;
};
const webpExtended = (w: number, h: number) => {
  const b = webpHead('VP8X');
  b.set([(w - 1) & 255, ((w - 1) >> 8) & 255, (w - 1) >> 16], 24);
  b.set([(h - 1) & 255, ((h - 1) >> 8) & 255, (h - 1) >> 16], 27);
  return b;
};

describe('the size at which a logo stops being accepted', () => {
  it('accepts a file of exactly the maximum size and refuses one byte more', () => {
    expect(checkLogo(png(128, 128, LOGO_MAX_BYTES)).ok).toBe(true);
    expect(checkLogo(png(128, 128, LOGO_MAX_BYTES + 1))).toEqual({ ok: false, code: 'logoTooBig' });
  });

  it('accepts a smaller side of exactly the minimum and refuses one pixel less', () => {
    expect(checkLogo(png(LOGO_MIN_SIDE, 500)).ok).toBe(true);
    expect(checkLogo(png(500, LOGO_MIN_SIDE)).ok).toBe(true);
    expect(checkLogo(png(LOGO_MIN_SIDE - 1, 500))).toEqual({ ok: false, code: 'logoSmall' });
    expect(checkLogo(png(500, LOGO_MIN_SIDE - 1))).toEqual({ ok: false, code: 'logoSmall' });
  });

  it('accepts a larger side of exactly the maximum and refuses one pixel more, on either side', () => {
    expect(checkLogo(png(LOGO_MAX_SIDE, 100)).ok).toBe(true);
    expect(checkLogo(png(100, LOGO_MAX_SIDE)).ok).toBe(true);
    expect(checkLogo(png(LOGO_MAX_SIDE + 1, 100))).toEqual({ ok: false, code: 'logoLarge' });
    expect(checkLogo(png(100, LOGO_MAX_SIDE + 1))).toEqual({ ok: false, code: 'logoLarge' });
    // the larger side decides, not the smaller: a wide strip is too large, a square of the maximum is not
    expect(checkLogo(png(LOGO_MAX_SIDE, LOGO_MAX_SIDE)).ok).toBe(true);
    expect(checkLogo(png(9000, 100))).toEqual({ ok: false, code: 'logoLarge' });
  });

  it("accepts a side of exactly one pixel for the inspector (the limits are the logo's, not the format's)", () => {
    expect(inspectImage(png(1, 1))).toMatchObject({ width: 1, height: 1 });
    expect(inspectImage(gif(1, 1))).toMatchObject({ width: 1, height: 1 });
  });
});

describe('the shortest file that still says its size', () => {
  it('reads a PNG of 24 bytes and not one of 23', () => {
    expect(inspectImage(png(50, 60, 24))).toMatchObject({ width: 50, height: 60 });
    expect(inspectImage(png(50, 60, 33).subarray(0, 23))).toBeNull();
  });

  it('reads a GIF of 10 bytes and not one of 9', () => {
    expect(inspectImage(gif(50, 60, 10))).toMatchObject({ width: 50, height: 60 });
    expect(inspectImage(gif(50, 60).subarray(0, 9))).toBeNull();
  });

  it('reads a WebP of 30 bytes and not one of 29', () => {
    expect(inspectImage(webpLossy(50, 60, 30))).toMatchObject({ width: 50, height: 60 });
    expect(inspectImage(webpLossy(50, 60, 34).subarray(0, 29))).toBeNull();
  });
});

describe('a signature is checked whole, byte by byte', () => {
  it('does not take for a PNG a file that has only a part of the signature', () => {
    const noMagic = png(100, 100);
    noMagic[0] = 0x88; // the first byte is wrong, the letters are there
    expect(inspectImage(noMagic)).toBeNull();
    const noLetters = png(100, 100);
    noLetters[2] = 0x58; // 'PXG'
    expect(inspectImage(noLetters)).toBeNull();
    // and a file that is too short to hold a signature and a header
    expect(inspectImage(png(100, 100).subarray(0, 8))).toBeNull();
  });

  it('does not take for a JPEG a file that has only a part of the signature', () => {
    // the signature (ff d8 ff), then a frame of 100 x 100
    const full = bytes(
      40,
      [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0x64, 0x03],
    );
    // an intact one, to be sure the others fail for the byte that was changed
    expect(inspectImage(full)).toMatchObject({ type: 'jpeg', width: 100, height: 100 });
    for (const [index, wrong] of [
      [0, 0x00],
      [1, 0x00],
      [2, 0x00],
    ] as const) {
      const copy = full.slice();
      copy[index] = wrong;
      expect(inspectImage(copy), `byte ${index}`).toBeNull();
    }
  });

  it('does not take for a JPEG a file that is only the signature', () => {
    expect(inspectImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(inspectImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });

  it('does not take for a WebP a file that has only one of its two words', () => {
    const riffOnly = webpLossy(100, 100);
    riffOnly.set([0x58, 0x58, 0x58, 0x58], 8); // RIFF, but not WEBP
    expect(inspectImage(riffOnly)).toBeNull();
    const webpOnly = webpLossy(100, 100);
    webpOnly.set([0x58, 0x58, 0x58, 0x58], 0); // WEBP, but not RIFF
    expect(inspectImage(webpOnly)).toBeNull();
    expect(inspectImage(webpLossy(100, 100))).toMatchObject({ type: 'webp' });
  });

  it('checks the three bytes of the signature of a lossy WebP, each', () => {
    for (const index of [23, 24, 25]) {
      const b = webpLossy(100, 100);
      b[index] = 0x00;
      expect(inspectImage(b), `byte ${index}`).toBeNull();
    }
  });

  it('checks the signature byte of a lossless WebP', () => {
    const b = webpLossless(100, 100);
    b[20] = 0x00;
    expect(inspectImage(b)).toBeNull();
  });
});

describe('every byte of a size counts', () => {
  it('reads a lossless WebP whose height needs the fourth byte of its bit field', () => {
    expect(inspectImage(webpLossless(100, 3000))).toMatchObject({ width: 100, height: 3000 });
    expect(inspectImage(webpLossless(16000, 12000))).toMatchObject({ width: 16000, height: 12000 });
  });

  it('reads an extended WebP whose sides need the third byte, and the inspector refuses what the logo refuses', () => {
    expect(inspectImage(webpExtended(70000, 66000))).toMatchObject({ width: 70000, height: 66000 });
    expect(checkLogo(webpExtended(70000, 100))).toEqual({ ok: false, code: 'logoLarge' });
  });
});
