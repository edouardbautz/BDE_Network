'use client';

import { ErrorView } from '@/components/layout/error-view';

/** A page of the signed-in app failed while rendering: the menu stays, only the page is replaced. */
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
