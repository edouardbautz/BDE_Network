import { notFound } from 'next/navigation';

/** Any URL under a locale that no page matches: renders the localized `not-found.tsx`
 * (without this, Next shows its own English 404 outside the layout). */
export default function UnknownPage(): never {
  notFound();
}
