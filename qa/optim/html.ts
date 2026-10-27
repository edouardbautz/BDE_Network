/**
 * What a page of the platform loads, read from its HTML: the scripts and style sheets its tags name (what the browser fetches
 * before it can draw and hydrate), and every script the page refers to anywhere, including those Next.js only lists in its data
 * to load later (a route's lazy chunks).
 */

export interface PageAssets {
  /** `<script src>`: loaded at once, the `nomodule` ones left out. */
  scripts: string[];
  /** `<link rel="stylesheet">`. */
  stylesheets: string[];
  /** Every `static/…/*.js` the HTML mentions, the scripts above included, the `nomodule` ones left out. */
  referenced: string[];
}

const unique = (values: Iterable<string>): string[] => [...new Set(values)];

/** A path under `/_next/static/`, as the platform serves it. */
const normalise = (path: string): string => {
  const match = /static\/[^"'\\\s<>)]+/.exec(path);
  return match ? `/_next/${match[0]}` : path;
};

const srcOf = (attributes: string): string | undefined => /\bsrc="([^"]+)"/i.exec(attributes)?.[1];

export function assetsOf(html: string): PageAssets {
  const tags = [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1]!);
  // A `nomodule` script is the polyfills for browsers without modules: no browser that matters downloads it. The page is read as it
  // is (nothing is cut out of the HTML); the paths of those scripts are told apart and left out of the lists.
  const legacy = new Set(
    tags
      .filter((attributes) => /\bnomodule\b/i.test(attributes))
      .map(srcOf)
      .filter((src): src is string => src !== undefined)
      .map(normalise),
  );

  const scripts = tags
    .filter((attributes) => !/\bnomodule\b/i.test(attributes))
    .map(srcOf)
    .filter((src): src is string => src !== undefined && src.includes('/_next/static/'))
    .map(normalise);
  const stylesheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/gi)]
    .map((match) => match[1]!)
    .concat(
      [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*\brel="stylesheet"/gi)].map((m) => m[1]!),
    )
    .map(normalise);
  const mentioned = [...html.matchAll(/static\/(?:chunks|media|css)\/[^"'\\\s<>)]+\.js/g)]
    .map((match) => normalise(match[0]))
    .filter((path) => !legacy.has(path));
  const loadedAtOnce = unique(scripts);
  return {
    scripts: loadedAtOnce,
    stylesheets: unique(stylesheets),
    referenced: unique([...loadedAtOnce, ...mentioned]),
  };
}
