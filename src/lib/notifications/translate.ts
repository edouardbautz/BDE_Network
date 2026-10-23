import { createTranslator } from 'next-intl';

/** `t` of one namespace of the message catalog, decoupled from next-intl's types. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The text of a message as it is written in the catalog, its `{placeholders}` untouched: what the editor of the templates shows as
 * "what the platform says" (the placeholders are the variables of a template). Missing: an empty string.
 */
export async function getNotificationRaw(
  locale: string,
  namespace: string,
  key: string,
): Promise<string> {
  const messages = (await import(`../../../messages/${locale}.json`)).default as Record<
    string,
    unknown
  >;
  const node = [...namespace.split('.'), ...key.split('.')].reduce<unknown>(
    (current, part) => (current as Record<string, unknown> | undefined)?.[part],
    messages,
  );
  return typeof node === 'string' ? node : '';
}

/** A translator for text sent outside any request (notifications), in the BDE's own language. */
export async function getNotificationTranslate(
  locale: string,
  namespace: string,
): Promise<Translate> {
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  const translator = createTranslator({ locale, messages, namespace });
  return (key, values) => (translator as unknown as Translate)(key, values);
}
