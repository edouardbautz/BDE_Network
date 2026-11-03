import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentSecurityPolicy } from './security-headers';
import {
  describeMissingPhoto,
  OFFICIAL_PHOTO_SOURCE,
  officialPhotoUrl,
  photoOf42,
} from './fortytwo-photo';
import { FortyTwoProvider, type FortyTwoProfile } from './auth/fortytwo-provider';

/**
 * The profile picture of a 42 account: read wherever the API puts it, kept only if it is on 42's own domain, and the same list for what the pages may
 * load. `LINK` and `VERSIONS` are the shape of the answers of `/v2/me` and `/v2/users/:login`: `image.link` is the original, `image.versions` the
 * smaller ones.
 */

const LINK = 'https://cdn.intra.42.fr/users/2c1f6ed5a43f9b7f1a7d3a6e2f4e0c11/cmartin.jpg';
const VERSIONS = {
  large: 'https://cdn.intra.42.fr/users/2c1f6ed5a43f9b7f1a7d3a6e2f4e0c11/large_cmartin.jpg',
  medium: 'https://cdn.intra.42.fr/users/2c1f6ed5a43f9b7f1a7d3a6e2f4e0c11/medium_cmartin.jpg',
  small: 'https://cdn.intra.42.fr/users/2c1f6ed5a43f9b7f1a7d3a6e2f4e0c11/small_cmartin.jpg',
  micro: 'https://cdn.intra.42.fr/users/2c1f6ed5a43f9b7f1a7d3a6e2f4e0c11/micro_cmartin.jpg',
};

describe('the addresses of 42 that are kept', () => {
  it.each([
    LINK,
    VERSIONS.medium,
    'https://profile.intra.42.fr/users/cmartin.png',
    '  https://cdn.intra.42.fr/users/x.jpg  ',
  ])('keeps %s', (address) => {
    expect(officialPhotoUrl(address)).toBe(new URL(address.trim()).toString());
  });

  it.each([
    ['not text', 42],
    ['nothing', null],
    ['empty', ''],
    ['blank', '   '],
    ['plain http', 'http://cdn.intra.42.fr/users/x.jpg'],
    ['another site', 'https://evil.example/users/x.jpg'],
    ['a look-alike host', 'https://cdn.intra.42.fr.evil.example/users/x.jpg'],
    ['a look-alike domain', 'https://cdn.intra.42.fr@evil.example/x.jpg'],
    ['a look-alike without the dot', 'https://evilintra.42.fr.example/x.jpg'],
    ['the bare domain (it serves pages)', 'https://intra.42.fr/users/x.jpg'],
    ['credentials', 'https://user:pass@cdn.intra.42.fr/x.jpg'],
    ['a port', 'https://cdn.intra.42.fr:8443/x.jpg'],
    ['a script', 'javascript:alert(1)'],
    ['a data address', 'data:image/png;base64,AAAA'],
    ['a space', 'https://cdn.intra.42.fr/a b.jpg'],
    ['a line break', 'https://cdn.intra.42.fr/a\nb.jpg'],
    ['a control character', 'https://cdn.intra.42.fr/a\u0000b.jpg'],
    ['a protocol-relative address', '//cdn.intra.42.fr/x.jpg'],
    ['far too long', `https://cdn.intra.42.fr/${'a'.repeat(600)}.jpg`],
  ])('refuses %s', (_label, address) => {
    expect(officialPhotoUrl(address)).toBeNull();
  });
});

describe('where the picture is in the answer of the API', () => {
  it('is the medium version of the current answer: a few kilobytes for an avatar, not the original', () => {
    expect(photoOf42({ image: { link: LINK, versions: VERSIONS } })).toBe(VERSIONS.medium);
  });

  it('is the link when the answer has no versions', () => {
    expect(photoOf42({ image: { link: LINK } })).toBe(LINK);
    expect(photoOf42({ image: { link: LINK, versions: null } })).toBe(LINK);
  });

  it('is a version when the link is null (an account whose original is not given)', () => {
    expect(photoOf42({ image: { link: null, versions: VERSIONS } })).toBe(VERSIONS.medium);
    expect(photoOf42({ image: { link: null, versions: { small: VERSIONS.small } } })).toBe(
      VERSIONS.small,
    );
  });

  it('is `image_url` in the answers that had only that, and the image itself when it is a string', () => {
    expect(photoOf42({ image_url: LINK })).toBe(LINK);
    expect(photoOf42({ image: LINK })).toBe(LINK);
    expect(photoOf42({ image: null, image_url: LINK })).toBe(LINK);
  });

  it('skips an address that is not 42’s for the next one that is, and gives nothing when none is', () => {
    expect(
      photoOf42({
        image: {
          link: 'https://evil.example/x.jpg',
          versions: { medium: 'http://cdn.intra.42.fr/x.jpg' },
        },
        image_url: LINK,
      }),
    ).toBe(LINK);
    expect(photoOf42({ image: { link: 'https://evil.example/x.jpg' } })).toBeNull();
    expect(photoOf42({})).toBeNull();
    expect(photoOf42({ image: { link: null, versions: null } })).toBeNull();
  });
});

describe('what is written when there is no picture', () => {
  it('says which fields the answer has and the host of each address, never a path', () => {
    const text = describeMissingPhoto({
      image: { link: 'https://evil.example/secret/path.jpg?token=abc', versions: { medium: null } },
      image_url: null,
    });
    expect(text).toContain('clés : link,versions');
    expect(text).toContain('https://evil.example');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('token');
    expect(text).not.toContain('path.jpg');
    expect(describeMissingPhoto({})).toContain('image : absent');
  });
});

describe('the policy of the pages', () => {
  it('lets an image come from exactly what the platform keeps: the pictures of 42’s domain, and nothing else outside the platform', () => {
    const img = contentSecurityPolicy()
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('img-src'));
    expect(img).toBe(`img-src 'self' data: blob: ${OFFICIAL_PHOTO_SOURCE}`);
    expect(OFFICIAL_PHOTO_SOURCE).toBe('https://*.intra.42.fr');
  });
});

describe('the sign-in with 42 reads the picture', () => {
  afterEach(() => vi.restoreAllMocks());

  const answer = (image: FortyTwoProfile['image'], extra: Partial<FortyTwoProfile> = {}) =>
    ({
      id: 1,
      login: 'cmartin',
      email: 'cmartin@student.42.fr',
      first_name: 'Camille',
      last_name: 'Martin',
      usual_full_name: 'Camille Martin',
      image,
      campus: [{ id: 1, name: 'Paris' }],
      campus_users: [{ campus_id: 1, is_primary: true }],
      ...extra,
    }) as FortyTwoProfile;

  const profile = (value: FortyTwoProfile) =>
    (
      FortyTwoProvider().profile as unknown as (profile: FortyTwoProfile) => {
        image: string | null;
      }
    )(value);

  it('puts the picture of the answer in the profile', () => {
    expect(profile(answer({ link: LINK, versions: VERSIONS })).image).toBe(VERSIONS.medium);
    expect(profile(answer({ link: LINK })).image).toBe(LINK);
    expect(profile(answer({ link: null, versions: VERSIONS })).image).toBe(VERSIONS.medium);
    expect(profile(answer(null, { image_url: LINK })).image).toBe(LINK);
  });

  it('puts nothing, and says so in the log with no path, for an answer with no picture the platform accepts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(profile(answer({ link: 'https://evil.example/a/b.jpg?x=1' })).image).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('cmartin');
    expect(line).toContain('https://evil.example');
    expect(line).not.toContain('b.jpg');
    expect(line).not.toContain('x=1');
  });

  it('says nothing when there is a picture', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    profile(answer({ link: LINK }));
    expect(warn).not.toHaveBeenCalled();
  });
});
