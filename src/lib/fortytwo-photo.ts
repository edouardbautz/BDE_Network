/**
 * The profile picture of a 42 account: where the API puts it, and which addresses the platform accepts.
 *
 * **Only an address on 42's own domain is ever kept or shown** (`https://<something>.intra.42.fr/...`): the address comes from an API we do not
 * control the content of, it is stored, and then it is put in a page, in the card of Discord and Slack, and in an e-mail, where a mail client
 * or a chat fetches it by itself. The same list is what the policy of the pages allows to load (`security-headers.ts`), so the two cannot
 * drift apart: a host accepted here that the policy refuses would be a picture that never shows, and the other way round a hole.
 *
 * The API says where the picture is in more than one place (`image.link` is the original, which can be large; `image.versions` has smaller
 * ones; older answers had `image_url`), and a field can be null while another is not. The platform reads them in the order that suits an
 * avatar (a version of medium size first: a few kilobytes, not the original), and keeps the first one that is acceptable.
 */

/** The domain every picture of 42 is served from, or a subdomain of it (`cdn.intra.42.fr`). */
export const OFFICIAL_PHOTO_DOMAIN = 'intra.42.fr';

/** What the pages' policy lets an image come from: the same domain, any host under it. */
export const OFFICIAL_PHOTO_SOURCE = `https://*.${OFFICIAL_PHOTO_DOMAIN}`;

const MAX_LENGTH = 500;

/**
 * The address as it is kept, or null when it is not a picture of 42: not text, too long, with a control character or a space, not `https`, with
 * credentials or a port, or on another host (a look-alike, `cdn.intra.42.fr.evil.example`, and the bare domain, which serves pages, are refused).
 */
export function officialPhotoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text.length > MAX_LENGTH || /[\u0000- \u007f]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!url.hostname.endsWith(`.${OFFICIAL_PHOTO_DOMAIN}`)) return null;
  return url.toString();
}

interface FortyTwoVersions {
  large?: string | null;
  medium?: string | null;
  small?: string | null;
  micro?: string | null;
}

/** What the 42 API sends of a user that matters here (`/v2/me`, `/v2/users/:login`). Every field may be missing or null. */
export interface FortyTwoImageFields {
  image?: string | { link?: string | null; versions?: FortyTwoVersions | null } | null;
  /** What older answers had. */
  image_url?: string | null;
}

/** The places of the picture in the answer, in the order they are tried: an avatar is small, so a medium version before the original. */
function candidates(profile: FortyTwoImageFields): unknown[] {
  const image = profile.image;
  if (typeof image === 'string') return [image, profile.image_url];
  return [
    image?.versions?.medium,
    image?.link,
    image?.versions?.large,
    image?.versions?.small,
    profile.image_url,
  ];
}

/** The picture of a 42 account, or null when the answer holds none that the platform accepts. */
export function photoOf42(profile: FortyTwoImageFields): string | null {
  for (const candidate of candidates(profile)) {
    const url = officialPhotoUrl(candidate);
    if (url) return url;
  }
  return null;
}

/** The scheme and host of an address, for a log: never a path or a query. */
function hostOf(value: unknown): string {
  if (typeof value !== 'string' || value === '') return 'absent';
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}`.slice(0, 80);
  } catch {
    return 'illisible';
  }
}

/**
 * Why no picture was kept, in words fit for a log: which fields the answer has and the host of each address, **never a path, a query or
 * anything of the account** (the host of a picture is the platform's business, not a secret, and says whether it is the domain that is
 * wrong or the field that is missing).
 */
export function describeMissingPhoto(profile: FortyTwoImageFields): string {
  const image = profile.image;
  const object = image !== null && typeof image === 'object' ? image : null;
  const shape = image === null || image === undefined ? 'absent' : typeof image;
  const keys = object
    ? Object.keys(object)
        .map((key) => key.replace(/[^a-z_]/gi, '').slice(0, 20))
        .slice(0, 10)
        .join(',')
    : '';
  const link = typeof image === 'string' ? image : object?.link;
  return (
    `image : ${shape}${keys ? ` (clés : ${keys})` : ''}, link : ${hostOf(link)}, ` +
    `medium : ${hostOf(object?.versions?.medium)}, image_url : ${hostOf(profile.image_url)}`
  );
}
