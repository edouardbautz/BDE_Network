import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkIcon, ICON_SIZES, type IconSize } from './icons';
import { checkLogo, type ImageInfo, type LogoCheck } from './image';

/**
 * Where the BDE's own logo lives: a file of the `uploads` Docker volume (`UPLOADS_DIR`, `/uploads` in the image;
 * `.uploads/` of the project outside Docker), named after what it contains (`logo-<16 hex of its SHA-256>`).
 *
 * The name is the version: a new logo is a new file and a new address (`/api/logo?v=<version>`), so a browser, a
 * Discord server or a mail client never keeps showing the old one, and the address of the previous logo keeps
 * working until the new one is saved. The bytes are checked (`checkLogo`) before anything is written, and checked
 * again by their content when they are served (`/api/logo`).
 *
 * The sizes of the icons drawn by the browser that sent it sit next to it, `logo-<version>.<size>` (see `branding/icons.ts`).
 */

export const DEFAULT_LOGO_PATH = '/logo.svg';

const VERSION = /^[a-f0-9]{16}$/;
const FILE = /^logo-[a-f0-9]{16}(?:\.(?:48|180|192|512))?$/;

export const isLogoVersion = (value: string | null | undefined): value is string =>
  typeof value === 'string' && VERSION.test(value);

export const logoPathFor = (version: string): string => `/api/logo?v=${version}`;

/** The version an uploaded logo's path carries; null for the default logo or any other path. */
export function logoVersionOf(logoPath: string): string | null {
  const match = /^\/api\/logo\?v=([a-f0-9]{16})$/.exec(logoPath);
  return match?.[1] ?? null;
}

export function uploadsDir(): string {
  return process.env.UPLOADS_DIR?.trim() || join(process.cwd(), '.uploads');
}

const fileFor = (version: string, size?: IconSize) =>
  join(uploadsDir(), `logo-${version}${size ? `.${size}` : ''}`);

export type SavedLogo =
  { ok: true; version: string; info: ImageInfo } | Extract<LogoCheck, { ok: false }>;

/** Writes a file whole or not at all: a temporary name first, so nobody ever reads half a file. */
async function writeWhole(target: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o644 });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Checks and stores a logo, with the icons the browser drew from it. An icon that is not what it says (wrong size, not a PNG, too
 * big) is dropped, never an error: the logo is used as it is for that size.
 */
export async function saveLogo(
  bytes: Uint8Array,
  icons: Partial<Record<IconSize, Uint8Array>> = {},
): Promise<SavedLogo> {
  const checked = checkLogo(bytes);
  if (!checked.ok) return checked;

  const version = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  await mkdir(uploadsDir(), { recursive: true });
  await writeWhole(fileFor(version), bytes);
  for (const size of ICON_SIZES) {
    const icon = icons[size];
    if (icon && checkIcon(icon, size)) await writeWhole(fileFor(version, size), icon);
  }
  return { ok: true, version, info: checked.info };
}

/** The bytes of the logo of this version, or null when there is none (or no folder at all). */
export async function readLogo(version: string): Promise<Buffer | null> {
  if (!isLogoVersion(version)) return null;
  try {
    return await readFile(fileFor(version));
  } catch {
    return null;
  }
}

/** The icon of that size drawn from the logo of this version, or null when there is none. */
export async function readIcon(version: string, size: IconSize): Promise<Buffer | null> {
  if (!isLogoVersion(version)) return null;
  try {
    return await readFile(fileFor(version, size));
  } catch {
    return null;
  }
}

/** Removes every stored logo (and its icons) except `keep` (none: all of them). Never throws: a leftover file is harmless. */
export async function pruneLogos(keep: string | null): Promise<void> {
  try {
    for (const name of await readdir(uploadsDir())) {
      if (FILE.test(name) && !(keep && name.startsWith(`logo-${keep}`)))
        await rm(join(uploadsDir(), name), { force: true });
    }
  } catch {
    /* no folder yet, or not writable: nothing to prune */
  }
}
