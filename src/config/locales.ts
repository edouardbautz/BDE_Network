// The languages of the interface, alone: the client code (the routing, the language menus) needs this list and must not pull in
// the schema of the configuration, which brings Zod with it (about 27 KiB on the wire, on every page, before this file existed).
export const SUPPORTED_LOCALES = ['fr', 'en'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
