import { createTranslator } from 'next-intl';

/** `t` of one namespace of the message catalog, decoupled from next-intl's types. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A translator for text sent outside any request (notifications), in the BDE's own language. */
export async function getNotificationTranslate(
  locale: string,
  namespace: string,
): Promise<Translate> {
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  const translator = createTranslator({ locale, messages, namespace });
  return (key, values) => (translator as unknown as Translate)(key, values);
}
