import { ICON_SIZES, type IconSize } from './icons';

/**
 * Draws the icons of a logo, in the browser of the owner who sends it (a canvas: the platform has no image library on its server, see
 * `branding/icons.ts`). The logo is fitted in a square with a margin, centred, never stretched. The icon of the home screen of an iPhone
 * (180) is drawn on white, because iOS fills a transparency with black; the others keep their transparency.
 *
 * It never fails the upload: an image the browser cannot draw (or a canvas it refuses) gives no icons, and the server then uses the logo
 * as it is.
 */

/** The share of the square the logo takes: a little air around it, as the icon of an application has. */
const FILL = 0.84;

/** Where the logo goes in a square of this size: the biggest that fits, centred. Pure, tested on its own. */
export function fitInSquare(
  width: number,
  height: number,
  size: number,
): { x: number; y: number; width: number; height: number } {
  const scale = (size * FILL) / Math.max(width, height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return { x: Math.round((size - w) / 2), y: Math.round((size - h) / 2), width: w, height: h };
}

const opaque = (size: IconSize) => size === 180;

export async function drawIcons(file: Blob): Promise<Partial<Record<IconSize, Blob>>> {
  const icons: Partial<Record<IconSize, Blob>> = {};
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return icons;
  }
  try {
    for (const size of ICON_SIZES) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) continue;
      if (opaque(size)) {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, size, size);
      }
      context.imageSmoothingQuality = 'high';
      const at = fitInSquare(bitmap.width, bitmap.height, size);
      context.drawImage(bitmap, at.x, at.y, at.width, at.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) icons[size] = blob;
    }
  } finally {
    bitmap.close();
  }
  return icons;
}
