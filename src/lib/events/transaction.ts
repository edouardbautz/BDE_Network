import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

const MAX_ATTEMPTS = 3;
/** Prisma's code for "the transaction could not be serialized, try again". */
const SERIALIZATION_FAILURE = 'P2034';

/** Two administrators acting on the same series at once could both read it before either wrote (and cut it
 * twice): the work of a series runs SERIALIZABLE and is retried; `null` after the last try says "somebody else
 * was changing it", for the caller to answer with a notice instead of an error. */
export async function inSeriesTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : undefined;
      if (code !== SERIALIZATION_FAILURE) throw error;
      if (attempt >= MAX_ATTEMPTS) return null;
    }
  }
}
