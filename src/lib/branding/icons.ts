import { inspectImage } from './image';

/**
 * The sizes of the BDE's logo that the platform's icons need, and what the platform accepts for each.
 *
 * The platform has no image library (it would weigh tens of megabytes in the image), so the sizes are not made on the server: the
 * browser of the owner who sends the logo draws them (a canvas, in `components/settings/logo-section.tsx`) and sends them with it.
 * The server does not trust them any more than the logo: each is read again on its bytes, must be a PNG of exactly its size and
 * stays small. A logo sent without them (an older one, or a crafted request) is used as it is: a browser scales an image down.
 */

/** 48: the tab; 180: the home screen of an iPhone (opaque: iOS draws a black corner behind a transparency); 192 and 512: the manifest. */
export const ICON_SIZES = [48, 180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

/** A 512 px PNG of a logo is a few tens of kilobytes; this leaves room for a detailed one and refuses anything else. */
export const ICON_MAX_BYTES = 256 * 1024;

export const isIconSize = (value: number): value is IconSize =>
  (ICON_SIZES as readonly number[]).includes(value);

/** The size in an address (`/api/logo/icon/192`), or null when it is not one of ours. */
export function iconSizeOf(segment: string): IconSize | null {
  if (!/^[0-9]{2,3}$/.test(segment)) return null;
  const size = Number(segment);
  return isIconSize(size) ? size : null;
}

/** Whether these bytes can be the icon of that size: a PNG, exactly square at that size, small. */
export function checkIcon(bytes: Uint8Array, size: IconSize): boolean {
  if (bytes.length === 0 || bytes.length > ICON_MAX_BYTES) return false;
  const info = inspectImage(bytes);
  return info !== null && info.type === 'png' && info.width === size && info.height === size;
}
