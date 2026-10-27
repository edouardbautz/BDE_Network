import { open } from 'node:fs/promises';

/** The line PostgreSQL writes last when a dump is whole. */
export const DUMP_FOOTER = 'PostgreSQL database dump complete';
const TAIL_BYTES = 400;

/**
 * Whether the dump ends with PostgreSQL's last line. Only the end of the file is read, through one open handle (the size and the bytes come
 * from the same file, and a dump of hundreds of megabytes is not held in memory to look at its last line).
 */
export async function dumpIsWhole(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(TAIL_BYTES, size);
    const tail = Buffer.alloc(length);
    await handle.read(tail, 0, length, size - length);
    return tail.toString('utf8').includes(DUMP_FOOTER);
  } finally {
    await handle.close();
  }
}
