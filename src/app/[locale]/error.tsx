'use client';

import { ErrorView } from '@/components/layout/error-view';

/** A page failed while rendering (outside the app shell: login and public pages). */
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} fullPage />;
}
