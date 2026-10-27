// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, type Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PBKDF2_ROUNDS,
  createDecryptStream,
  createEncryptStream,
  downloadName,
  passphraseProblem,
} from './encrypt';

async function collect(source: Readable, through: Transform): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline(source, through, async function (all: AsyncIterable<Buffer>) {
    for await (const chunk of all) chunks.push(chunk);
  });
  return Buffer.concat(chunks);
}

const encrypt = async (data: Buffer, passphrase: string, chunk = 64 * 1024) =>
  collect(
    Readable.from(
      Array.from({ length: Math.ceil(data.length / chunk) || 1 }, (_, i) =>
        data.subarray(i * chunk, (i + 1) * chunk),
      ),
    ),
    await createEncryptStream(passphrase),
  );

const PASS = 'a passphrase of the owner';
const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

describe('the encryption of a downloaded backup', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bde-encrypt-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the format of openssl enc: the word Salted__, 8 bytes of salt, whole blocks of 16', async () => {
    const data = randomBytes(1000);
    const out = await encrypt(data, PASS);
    expect(out.subarray(0, 8).toString('ascii')).toBe('Salted__');
    expect((out.length - 16) % 16).toBe(0);
    expect(out.length).toBeGreaterThanOrEqual(16 + data.length);
    expect(out.includes(data.subarray(0, 32))).toBe(false);
  });

  it('is different every time (a new salt), and opens with the same passphrase', async () => {
    const data = randomBytes(5000);
    const [one, two] = [await encrypt(data, PASS), await encrypt(data, PASS)];
    expect(one.equals(two)).toBe(false);
    for (const encrypted of [one, two]) {
      const back = await collect(Readable.from([encrypted]), createDecryptStream(PASS));
      expect(back.equals(data)).toBe(true);
    }
  });

  it.each([0, 1, 15, 16, 17, 65535, 65536, 200_000])('round-trips %i bytes', async (size) => {
    const data = randomBytes(size);
    const back = await collect(
      Readable.from([await encrypt(data, PASS, 7919)]),
      createDecryptStream(PASS),
    );
    expect(back.equals(data)).toBe(true);
  });

  it('does not open with another passphrase, and does not hand back the data', async () => {
    const encrypted = await encrypt(randomBytes(4000), PASS);
    await expect(
      collect(Readable.from([encrypted]), createDecryptStream('another one')),
    ).rejects.toThrow();
  });

  it('refuses what is not an encrypted backup', async () => {
    await expect(
      collect(
        Readable.from([Buffer.from('not encrypted at all, just text')]),
        createDecryptStream(PASS),
      ),
    ).rejects.toThrow(/not an encrypted backup/);
  });

  it('uses the rounds that restore.sh asks openssl for', () => {
    expect(PBKDF2_ROUNDS).toBe(600_000);
    expect(readFileSync(join(process.cwd(), 'scripts', 'restore.sh'), 'utf8')).toContain(
      `-iter ${PBKDF2_ROUNDS}`,
    );
  });

  it.skipIf(!hasOpenssl)(
    'is opened by the real openssl, which is what restore.sh runs',
    async () => {
      const data = randomBytes(300_000);
      writeFileSync(join(dir, 'backup.enc'), await encrypt(data, PASS));
      const decrypted = spawnSync(
        'openssl',
        [
          'enc',
          '-d',
          '-aes-256-cbc',
          '-pbkdf2',
          '-iter',
          String(PBKDF2_ROUNDS),
          '-md',
          'sha256',
          '-pass',
          'env:P',
        ],
        {
          input: readFileSync(join(dir, 'backup.enc')),
          env: { ...process.env, P: PASS },
          maxBuffer: 10_000_000,
        },
      );
      expect(decrypted.status, decrypted.stderr?.toString()).toBe(0);
      expect(Buffer.compare(decrypted.stdout, data)).toBe(0);
    },
  );

  it.skipIf(!hasOpenssl)('opens what the real openssl wrote', async () => {
    const data = randomBytes(70_000);
    const encrypted = spawnSync(
      'openssl',
      [
        'enc',
        '-aes-256-cbc',
        '-pbkdf2',
        '-iter',
        String(PBKDF2_ROUNDS),
        '-md',
        'sha256',
        '-pass',
        'env:P',
      ],
      { input: data, env: { ...process.env, P: PASS }, maxBuffer: 10_000_000 },
    );
    expect(encrypted.status).toBe(0);
    const back = await collect(Readable.from([encrypted.stdout]), createDecryptStream(PASS));
    expect(back.equals(data)).toBe(true);
  });

  it.skipIf(!hasOpenssl)('is not opened by openssl with a wrong passphrase', async () => {
    const encrypted = await encrypt(randomBytes(5000), PASS);
    const decrypted = spawnSync(
      'openssl',
      [
        'enc',
        '-d',
        '-aes-256-cbc',
        '-pbkdf2',
        '-iter',
        String(PBKDF2_ROUNDS),
        '-md',
        'sha256',
        '-pass',
        'env:P',
      ],
      { input: encrypted, env: { ...process.env, P: 'wrong passphrase!' } },
    );
    expect(decrypted.status).not.toBe(0);
  });
});

describe('the passphrase', () => {
  it('needs 12 characters and no more than 200', () => {
    expect(passphraseProblem('12345678901')).toBe('tooShort');
    expect(passphraseProblem('123456789012')).toBeNull();
    expect(passphraseProblem('é'.repeat(12))).toBeNull(); // characters, not bytes
    expect(passphraseProblem('x'.repeat(200))).toBeNull();
    expect(passphraseProblem('x'.repeat(201))).toBe('tooLong');
  });
});

describe('the name of the downloaded file', () => {
  it("is the archive's plus .enc", () => {
    expect(downloadName('bde-auto-2026-10-27_02-00-04Z.tar.gz')).toBe(
      'bde-auto-2026-10-27_02-00-04Z.tar.gz.enc',
    );
  });
});
