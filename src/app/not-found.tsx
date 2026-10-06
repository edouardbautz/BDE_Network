import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { StatusCard } from '@/components/layout/status-card';
import './globals.css';

/**
 * The 404 of last resort: a URL with no valid language segment, where no layout (and so no
 * translation) applies. Everything with a language is handled by `[locale]/not-found.tsx`.
 */
export default function RootNotFound() {
  return (
    <html lang="fr">
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <StatusCard
          fullPage
          icon={SearchX}
          title="Page introuvable · Page not found"
          description="Cette page n'existe pas. / This page does not exist."
        >
          <Link
            href="/"
            className="bg-primary text-primary-foreground h-8 rounded-lg px-2.5 text-sm leading-8 font-medium"
          >
            Retour à l&apos;accueil · Back to home
          </Link>
        </StatusCard>
      </body>
    </html>
  );
}
