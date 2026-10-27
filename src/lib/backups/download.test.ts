// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDownload } from './download';
import { createDecryptStream } from './encrypt';
import { archiveName } from './names';

let dir: string;
const PASS = 'a passphrase of the owner';
const name = archiveName(new Date('2026-10-26T02:00:00Z'));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bde-download-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function readAll(stream: ReadableStream<Uint8Array>, passphrase?: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const source = Readable.fromWeb(stream as import('node:stream/web').ReadableStream<Uint8Array>);
  const sink = async function (all: AsyncIterable<Buffer>) {
    for await (const chunk of all) chunks.push(chunk);
  };
  if (passphrase) await pipeline(source, createDecryptStream(passphrase), sink);
  else await pipeline(source, sink);
  return Buffer.concat(chunks);
}

describe('taking a backup away', () => {
  it('gives the file encrypted, under its name plus .enc, and what comes out of it with the passphrase is the file', async () => {
    const bytes = randomBytes(200_000);
    writeFileSync(join(dir, name), bytes);
    const download = await openDownload({ dir, name, passphrase: PASS });
    expect(download.ok).toBe(true);
    if (!download.ok) return;
    expect(download.filename).toBe(`${name}.enc`);

    const encrypted = await readAll(download.stream);
    expect(encrypted.subarray(0, 8).toString('ascii')).toBe('Salted__');
    expect(encrypted.includes(bytes.subarray(0, 64))).toBe(false);

    const again = await openDownload({ dir, name, passphrase: PASS });
    if (!again.ok) throw new Error('second download refused');
    expect((await readAll(again.stream, PASS)).equals(bytes)).toBe(true);
  });

  it.each([
    ['a name that is not a backup', 'passwd'],
    ['a path', `../${name}`],
    ['a path inside the folder', `sub/${name}`],
    ['a download', `${name}.enc`],
    ['a script’s backup', 'bde-backup-2026-10-26_02-00-00.tar.gz'],
    ['nothing', undefined],
    ['a number', 42],
  ])('refuses %s', async (_what, asked) => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, name), 'x');
    expect(await openDownload({ dir, name: asked, passphrase: PASS })).toEqual({
      ok: false,
      refusal: 'badName',
    });
  });

  it('refuses a passphrase that is too short or too long, or not a text, before reading anything', async () => {
    expect(await openDownload({ dir, name, passphrase: 'short' })).toEqual({
      ok: false,
      refusal: 'tooShort',
    });
    expect(await openDownload({ dir, name, passphrase: 'x'.repeat(201) })).toEqual({
      ok: false,
      refusal: 'tooLong',
    });
    expect(await openDownload({ dir, name, passphrase: { toString: () => PASS } })).toEqual({
      ok: false,
      refusal: 'tooShort',
    });
  });

  it('says a backup is missing when the rotation has taken it, or when it is a folder', async () => {
    expect(await openDownload({ dir, name, passphrase: PASS })).toEqual({
      ok: false,
      refusal: 'missing',
    });
    mkdirSync(join(dir, name));
    expect(await openDownload({ dir, name, passphrase: PASS })).toEqual({
      ok: false,
      refusal: 'missing',
    });
  });
});
