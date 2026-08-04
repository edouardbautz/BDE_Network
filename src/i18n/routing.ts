import { defineRouting } from 'next-intl/routing';
import { SUPPORTED_LOCALES } from '@/config/schema';

/**
 * The URL routing default is fixed to "fr" so this file stays runtime-config
 * free and works unmodified in the Edge runtime. bde.config.yml's
 * bde.defaultLocale is used elsewhere (e.g. outgoing notification content),
 * not for picking the locale segment on first visit.
 */
export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: 'fr',
});
