import { useTranslations } from 'next-intl';

export default function LoginPage() {
  const t = useTranslations('auth');
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <h1 className="text-2xl font-semibold">{t('loginTitle')}</h1>
    </main>
  );
}
