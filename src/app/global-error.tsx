'use client';

import { TriangleAlert } from 'lucide-react';
import { StatusCard } from '@/components/layout/status-card';
import './globals.css';

/**
 * The last resort: the root layout itself failed, so there is no language, no theme and no
 * translation provider to rely on. It replaces the whole document, so it brings its own
 * `<html>`, speaks both languages at once and leaves with a plain link (a full page load,
 * since the app's router may be what broke).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <StatusCard
          fullPage
          icon={TriangleAlert}
          title="Quelque chose s'est mal passé · Something went wrong"
          description="Une erreur est survenue de notre côté. Vos données n'ont pas été perdues. / An error occurred on our side. Your data has not been lost."
        >
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={reset}
              className="bg-primary text-primary-foreground h-8 rounded-lg px-2.5 text-sm font-medium"
            >
              Réessayer · Try again
            </button>
            {/* A plain link on purpose: a full page load, since the router may be what broke. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="border-border h-8 rounded-lg border px-2.5 text-sm leading-7 font-medium"
            >
              Retour à l&apos;accueil · Back to home
            </a>
          </div>
          {error.digest && (
            <p className="text-muted-foreground text-xs">Référence / Reference : {error.digest}</p>
          )}
        </StatusCard>
      </body>
    </html>
  );
}
