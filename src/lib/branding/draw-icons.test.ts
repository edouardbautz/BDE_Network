// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawIcons } from './draw-icons';
import { ICON_SIZES } from './icons';

/**
 * The drawing of the icons runs in the owner's browser; here the browser is played by doubles, to see what is asked of it: one square canvas
 * per size, the logo fitted in it, white behind the icon of the iPhone only, and nothing thrown when the browser cannot draw.
 */

interface Call {
  size: number;
  fills: string[];
  drawn: { x: number; y: number; width: number; height: number }[];
}

function browser(options: { image?: 'ok' | 'broken'; context?: boolean; blob?: boolean } = {}) {
  const calls: Call[] = [];
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    options.image === 'broken'
      ? () => Promise.reject(new Error('not an image'))
      : () => Promise.resolve({ width: 300, height: 150, close }),
  );
  vi.stubGlobal('document', {
    createElement: () => {
      const call: Call = { size: 0, fills: [], drawn: [] };
      calls.push(call);
      return {
        set width(value: number) {
          call.size = value;
        },
        set height(_value: number) {},
        getContext: () =>
          options.context === false
            ? null
            : {
                set fillStyle(value: string) {
                  call.fills.push(value);
                },
                fillRect: () => {},
                imageSmoothingQuality: '',
                drawImage: (_image: unknown, x: number, y: number, width: number, height: number) =>
                  call.drawn.push({ x, y, width, height }),
              },
        toBlob: (done: (blob: Blob | null) => void) =>
          done(
            options.blob === false ? null : new Blob([new Uint8Array([1])], { type: 'image/png' }),
          ),
      };
    },
  });
  return { calls, close };
}

afterEach(() => vi.unstubAllGlobals());

describe('drawing the icons of a logo', () => {
  it('draws one square icon per size, the logo fitted and centred, and lets go of the picture', async () => {
    const { calls, close } = browser();
    const icons = await drawIcons(new Blob(['x']));
    expect(Object.keys(icons).map(Number)).toEqual([...ICON_SIZES]);
    expect(calls.map((call) => call.size)).toEqual([...ICON_SIZES]);
    for (const call of calls) {
      expect(call.drawn).toHaveLength(1);
      // a logo twice as wide as it is high stays so, and sits in the middle
      expect(call.drawn[0]!.width / call.drawn[0]!.height).toBeCloseTo(2, 1);
      expect(call.drawn[0]!.x).toBeGreaterThan(0);
    }
    expect(close).toHaveBeenCalledOnce();
  });

  it('puts white behind the icon of an iPhone, which would be black behind a transparency, and behind no other', async () => {
    const { calls } = browser();
    await drawIcons(new Blob(['x']));
    expect(calls.filter((call) => call.fills.length > 0).map((call) => call.size)).toEqual([180]);
    expect(calls.find((call) => call.size === 180)?.fills).toEqual(['#ffffff']);
  });

  it('gives no icon, and no error, for an image the browser cannot read: the logo is then used as it is', async () => {
    browser({ image: 'broken' });
    expect(await drawIcons(new Blob(['x']))).toEqual({});
  });

  it('skips a size the browser cannot draw, or cannot encode', async () => {
    browser({ context: false });
    expect(await drawIcons(new Blob(['x']))).toEqual({});
    browser({ blob: false });
    expect(await drawIcons(new Blob(['x']))).toEqual({});
  });
});
