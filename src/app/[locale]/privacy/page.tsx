import { getTranslations } from 'next-intl/server';

export default async function PrivacyPage() {
  const t = await getTranslations('nav');

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold">{t('privacy')}</h1>
    </main>
  );
}
