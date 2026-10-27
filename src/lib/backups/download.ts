import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createEncryptStream, downloadName, passphraseProblem } from './encrypt';
import { parseArchiveName } from './names';

/**
 * A backup leaving the server: the file of the folder, encrypted with a passphrase the owner chose just now. The passphrase is never
 * stored, logged or sent back; lost, the downloaded file cannot be opened by anybody (the page says so before it is asked).
 */
export type DownloadRefusal = 'badName' | 'missing' | 'tooShort' | 'tooLong';

export type Download =
  | { ok: true; filename: string; stream: ReadableStream<Uint8Array> }
  | { ok: false; refusal: DownloadRefusal };

export async function openDownload(options: {
  dir: string;
  name: unknown;
  passphrase: unknown;
}): Promise<Download> {
  const { dir, name, passphrase } = options;
  // The name comes from the request: only a name of our own making (a date in a fixed pattern) can reach the folder.
  if (typeof name !== 'string' || !parseArchiveName(name)) return { ok: false, refusal: 'badName' };
  if (typeof passphrase !== 'string') return { ok: false, refusal: 'tooShort' };
  const problem = passphraseProblem(passphrase);
  if (problem) return { ok: false, refusal: problem };

  const path = join(dir, name);
  const isFile = await stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
  if (!isFile) return { ok: false, refusal: 'missing' };

  const encrypt = await createEncryptStream(passphrase);
  const source = createReadStream(path);
  source.on('error', (error) => encrypt.destroy(error));
  source.pipe(encrypt);
  return {
    ok: true,
    filename: downloadName(name),
    stream: Readable.toWeb(encrypt) as ReadableStream<Uint8Array>,
  };
}
