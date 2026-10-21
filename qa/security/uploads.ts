import { crc32, deflateSync } from 'node:zlib';
import { callAction, locate, readManifest } from '../access/actions-run';
import { withDatabase, type Platform } from '../access/http';
import { Report, send } from './core';

/**
 * The one file a member of the platform can put on it is the BDE's logo, and it is public: the login page, Discord, Slack
 * and the mail clients all fetch it. What is played here is what somebody with the right to change it (or the owner's
 * session, stolen) could try to make of it: a script, a page, a file that is not an image, a bomb, a path.
 */

const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  return Buffer.concat([u32(data.length), name, data, u32(crc32(Buffer.concat([name, data])))]);
}

/** A real PNG of one colour; `claimed` is the size written in its header, which can be a lie. */
export function png(
  side: number,
  claimed: { width: number; height: number } = { width: side, height: side },
): Buffer {
  const header = Buffer.concat([
    u32(claimed.width),
    u32(claimed.height),
    Buffer.from([8, 2, 0, 0, 0]),
  ]);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(side * 3, 0x40)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: side }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

interface Attempt {
  name: string;
  file: File | null;
  /** The code the platform must answer; null when it must accept. */
  refusedWith: string | null;
}

const file = (bytes: Buffer | string, name: string, type: string) =>
  new File([typeof bytes === 'string' ? Buffer.from(bytes) : new Uint8Array(bytes)], name, {
    type,
  });

export async function checkUploads(platform: Platform, report: Report): Promise<void> {
  const manifest = readManifest();
  const save = locate(manifest, 'settings.saveLogo');
  const remove = locate(manifest, 'settings.removeLogo');

  await withDatabase(platform, async (db) => {
    const logoPath = async () =>
      String(
        (await db.query(`SELECT config->'bde'->>'logoPath' AS path FROM "PlatformSettings"`))
          .rows[0]?.path,
      );
    const start = await logoPath();

    const upload = async (as: 'owner' | 'member' | 'validator', form: FormData) =>
      callAction(platform, as, save.id, save.page, [form]);
    const formOf = (logo: File | null, field = 'logo') => {
      const form = new FormData();
      if (logo) form.append(field, logo);
      return form;
    };

    const good = png(128);
    const polyglotHtml = Buffer.concat([
      good,
      Buffer.from('<!doctype html><script>alert(document.domain)</script>'),
    ]);
    const gifHtml = Buffer.concat([
      Buffer.from('GIF89a'),
      Buffer.from([128, 0, 128, 0]),
      Buffer.from('<script>alert(1)</script><svg onload=alert(1)>'),
    ]);

    const refusals: Attempt[] = [
      {
        name: 'an SVG with a script',
        file: file(
          '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
          'logo.svg',
          'image/svg+xml',
        ),
        refusedWith: 'logoFormat',
      },
      {
        name: 'an SVG announced as a PNG',
        file: file(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
          'logo.png',
          'image/png',
        ),
        refusedWith: 'logoFormat',
      },
      {
        name: 'an HTML page named logo.png',
        file: file('<!doctype html><script>alert(1)</script>', 'logo.png', 'image/png'),
        refusedWith: 'logoFormat',
      },
      {
        name: 'a script named logo.png',
        file: file('#!/bin/sh\nrm -rf /\n', 'logo.png', 'image/png'),
        refusedWith: 'logoFormat',
      },
      {
        name: 'a PDF',
        file: file('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj', 'logo.pdf', 'application/pdf'),
        refusedWith: 'logoFormat',
      },
      { name: 'an empty file', file: file('', 'logo.png', 'image/png'), refusedWith: 'logoEmpty' },
      {
        name: 'a PNG cut after its signature',
        file: file(good.subarray(0, 12), 'logo.png', 'image/png'),
        refusedWith: 'logoFormat',
      },
      {
        name: 'a PNG that says it is 100000 × 100000 pixels (a decompression bomb)',
        file: file(png(64, { width: 100_000, height: 100_000 }), 'logo.png', 'image/png'),
        refusedWith: 'logoLarge',
      },
      {
        name: 'a PNG that says it is 4294967295 pixels wide',
        file: file(png(64, { width: 0xffffffff, height: 64 }), 'logo.png', 'image/png'),
        refusedWith: 'logoLarge',
      },
      {
        name: 'a PNG of one pixel',
        file: file(png(1), 'logo.png', 'image/png'),
        refusedWith: 'logoSmall',
      },
      {
        name: 'a PNG that says it is 0 × 0',
        file: file(png(64, { width: 0, height: 0 }), 'logo.png', 'image/png'),
        refusedWith: 'logoFormat',
      },
      {
        name: 'a file just over 2 MB',
        file: file(
          Buffer.concat([good, Buffer.alloc(2 * 1024 * 1024 - good.length + 1)]),
          'logo.png',
          'image/png',
        ),
        refusedWith: 'logoTooBig',
      },
    ];

    for (const attempt of refusals) {
      const call = await upload('owner', formOf(attempt.file));
      const after = await logoPath();
      report.check(
        'uploads',
        `${attempt.name}: refused (${attempt.refusedWith}) and the logo is unchanged`,
        call.status < 500 && call.text.includes(`"${attempt.refusedWith}"`) && after === start,
        `status ${call.status}, logo ${after === start ? 'unchanged' : 'CHANGED'}`,
      );
    }

    // Sent without a file, or under another name: a refusal that is a code, never an error.
    for (const [name, form] of [
      ['no file at all', formOf(null)],
      ['a file in another field', formOf(file(good, 'logo.png', 'image/png'), 'avatar')],
      [
        'a text where the file should be',
        (() => {
          const form = new FormData();
          form.append('logo', 'not a file');
          return form;
        })(),
      ],
    ] as const) {
      const call = await upload('owner', form);
      report.check(
        'uploads',
        `${name}: refused, logo unchanged`,
        call.status < 500 && (await logoPath()) === start,
        `status ${call.status}`,
      );
    }

    // Over the limit of the request itself (3 MB): refused by the server, which stays up.
    const huge = await upload(
      'owner',
      formOf(file(Buffer.alloc(4 * 1024 * 1024, 0x41), 'logo.png', 'image/png')),
    );
    const alive = await send(platform, '/api/health');
    report.check(
      'uploads',
      'a request of 4 MB is refused and the platform stays up',
      huge.status >= 400 && alive.status === 200 && (await logoPath()) === start,
      `status ${huge.status}, health ${alive.status}`,
    );

    // Who may change it: not a member, not somebody who validates events.
    for (const who of ['member', 'validator'] as const) {
      const call = await upload(who, formOf(file(good, 'logo.png', 'image/png')));
      report.check(
        'uploads',
        `a ${who} cannot change the logo`,
        (await logoPath()) === start,
        `status ${call.status}`,
      );
    }

    // What is accepted: a real image, and the files that carry something else after the image.
    const accepted: [string, Buffer, string][] = [
      ['a real PNG', good, 'image/png'],
      ['a PNG followed by an HTML page (a polyglot)', polyglotHtml, 'image/png'],
      ['a GIF followed by a script', gifHtml, 'image/gif'],
    ];
    for (const [name, bytes, type] of accepted) {
      const call = await upload('owner', formOf(file(bytes, '../../../etc/passwd.png', type)));
      const path = await logoPath();
      const version = /\?v=([a-f0-9]{16})$/.exec(path)?.[1];
      report.check(
        'uploads',
        `${name}: a logo is stored, under a name made by the platform`,
        call.status < 500 && Boolean(version),
        `${path}`,
      );
      if (!version) continue;

      const served = await send(platform, `/api/logo?v=${version}`);
      const headers = served.headers;
      report.check(
        'uploads',
        `${name}: served as the image it starts as, never as a page`,
        headers.get('content-type') === type,
        `${headers.get('content-type')}`,
      );
      report.check(
        'uploads',
        `${name}: nosniff, so a browser never guesses it is HTML`,
        headers.get('x-content-type-options')?.toLowerCase() === 'nosniff',
      );
      report.check(
        'uploads',
        `${name}: a policy that forbids everything, in a sandbox, if it is opened as a page`,
        /default-src 'none'/.test(headers.get('content-security-policy') ?? '') &&
          /sandbox/.test(headers.get('content-security-policy') ?? ''),
        headers.get('content-security-policy') ?? '(none)',
      );
      report.check(
        'uploads',
        `${name}: not offered as a page to open in a frame`,
        headers.get('x-frame-options')?.toUpperCase() === 'DENY',
      );
      report.check(
        'uploads',
        `${name}: no cookie, whatever the cookie asked`,
        !headers.get('set-cookie'),
      );
    }

    // The route never builds a path from the request.
    for (const version of [
      '../../etc/passwd',
      '..%2f..%2fetc%2fpasswd',
      '0000000000000000',
      'A'.repeat(16),
      `${'a'.repeat(15)}%00`,
      'a'.repeat(16) + '/../x',
      '%2e%2e%2f%2e%2e%2f',
      "a'b",
      '',
    ]) {
      const served = await send(platform, `/api/logo?v=${version}`);
      report.check(
        'uploads',
        `the logo route with v=${version.slice(0, 24) || '(empty)'} is a 404 or the platform’s logo, never a file of the server`,
        [200, 404].includes(served.status) && !/root:|\[boot loader\]/.test(served.body),
        `status ${served.status}`,
      );
    }
    const noVersion = await send(platform, '/api/logo');
    report.check(
      'uploads',
      'the logo route without a version does not fail',
      noVersion.status < 500,
      `status ${noVersion.status}`,
    );
    const other = await send(platform, '/api/files/logo-0000000000000000');
    report.check(
      'uploads',
      'there is no other route that serves the uploads',
      other.status === 404,
      `status ${other.status}`,
    );

    // Back to the logo that comes with the platform, and the files of the attempts are gone.
    await callAction(platform, 'owner', remove.id, remove.page, []);
    report.check(
      'uploads',
      'removing the logo goes back to the platform’s own',
      (await logoPath()) === '/logo.svg',
      await logoPath(),
    );
  });
}
