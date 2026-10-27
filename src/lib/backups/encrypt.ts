import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { promisify } from 'node:util';

export { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH, passphraseProblem } from './passphrase';

/**
 * The encryption of a DOWNLOADED backup: the format of `openssl enc`, not one of ours. AES-256-CBC, the key and the IV derived from the
 * passphrase by PBKDF2-HMAC-SHA256 (600,000 rounds, the figure OWASP gives for it) and a random salt of 8 bytes, written after the
 * word `Salted__`. Anyone with OpenSSL can open such a file without this platform:
 *
 *     openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in bde-auto-….tar.gz.enc -out backup.tar.gz
 *
 * (that is what scripts/restore.sh runs, in the image). Nothing here is a primitive of our own: Node's `crypto` does all the work, and
 * `encrypt.test.ts` opens what this writes with the real `openssl` (and the other way round).
 *
 * CBC does not authenticate: a wrong passphrase mostly shows as a padding error and otherwise as an archive that does not open, and the
 * manifest inside the archive (a SHA-256 of each file, checked by restore) is what says it is whole. The archive on the server is not encrypted
 * (it has to be made at 3 a.m. with nobody there to type a passphrase): this is only for the file that leaves the server.
 */
export const ENCRYPTED_SUFFIX = '.enc';
export const PBKDF2_ROUNDS = 600_000;
const MAGIC = Buffer.from('Salted__', 'ascii');
const SALT_BYTES = 8;
const derive = promisify(pbkdf2);

async function keyAndIv(passphrase: string, salt: Buffer): Promise<{ key: Buffer; iv: Buffer }> {
  const bytes = await derive(passphrase, salt, PBKDF2_ROUNDS, 48, 'sha256');
  return { key: bytes.subarray(0, 32), iv: bytes.subarray(32, 48) };
}

/** A stream that turns bytes into the encrypted file (`Salted__`, the salt, the ciphertext). */
export async function createEncryptStream(passphrase: string): Promise<Transform> {
  const salt = randomBytes(SALT_BYTES);
  const { key, iv } = await keyAndIv(passphrase, salt);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      if (!started) {
        started = true;
        this.push(Buffer.concat([MAGIC, salt]));
      }
      callback(null, cipher.update(chunk));
    },
    flush(callback: TransformCallback) {
      if (!started) this.push(Buffer.concat([MAGIC, salt]));
      callback(null, cipher.final());
    },
  });
}

/** The opposite, for the tests and for a tool that needs it; the product never decrypts (restore.sh does, with `openssl`). */
export function createDecryptStream(passphrase: string): Transform {
  let header = Buffer.alloc(0);
  let decipher: ReturnType<typeof createDecipheriv> | null = null;
  return new Transform({
    async transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      try {
        if (!decipher) {
          header = Buffer.concat([header, chunk]);
          if (header.length < MAGIC.length + SALT_BYTES) return callback();
          if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
            return callback(new Error('not an encrypted backup'));
          }
          const { key, iv } = await keyAndIv(
            passphrase,
            header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES),
          );
          decipher = createDecipheriv('aes-256-cbc', key, iv);
          const rest = header.subarray(MAGIC.length + SALT_BYTES);
          return callback(null, rest.length > 0 ? decipher.update(rest) : undefined);
        }
        callback(null, decipher.update(chunk));
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      try {
        callback(null, decipher ? decipher.final() : undefined);
      } catch {
        callback(new Error('wrong passphrase or damaged file'));
      }
    },
  });
}

/** The name of the file given to the person: the archive's, plus `.enc`. */
export const downloadName = (archive: string): string => `${archive}${ENCRYPTED_SUFFIX}`;
