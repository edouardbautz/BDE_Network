import { getConfig } from '@/config';

/** Whether the platform publishes the events on the intra 42: every event then carries the fields of the intra's form,
 * and none is confirmed without them. A setting of the events section, off until the BDE turns it on. */
export function intraPublicationEnabled(): boolean {
  return getConfig().events?.intraPublication === true;
}
