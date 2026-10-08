import { headers } from 'next/headers';
import { publicOrigin } from '@/lib/public-address';

/** Absolute URL of this instance: the registered address when there is one, otherwise what the browser used. */
export async function getOrigin(): Promise<string> {
  return publicOrigin(await headers());
}
