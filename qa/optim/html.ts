/**
 * What a page of the platform loads, read from its HTML: the scripts and style sheets its tags name (what the browser fetches
 * before it can draw and hydrate), and every script the page refers to anywhere, including those Next.js only lists in its data
 * to load later (a route's lazy chunks).
 */

export interface PageAssets {
  /** `<script src>`: loaded at once. */
  scripts: string[];
  /** `<link rel="stylesheet">`. */
  stylesheets: string[];
  /** Every `static/…/*.js` the HTML mentions, the scripts above included. */
  referenced: string[];
}

const unique = (values: Iterable<string>): string[] => [...new Set(values)];

/** A path under `/_next/static/`, as the platform serves it. */
const normalise = (path: string): string => {
  const match = /static\/[^"'\\\s<>)]+/.exec(path);
  return match ? `/_next/${match[0]}` : path;
};

export function assetsOf(html: string): PageAssets {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
    .map((match) => match[1]!)
    .filter((src) => src.includes('/_next/static/'))
    .map(normalise);
  const stylesheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)]
    .map((match) => match[1]!)
    .concat(
      [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*\brel="stylesheet"/g)].map((m) => m[1]!),
    )
    .map(normalise);
  const mentioned = [...html.matchAll(/static\/(?:chunks|media|css)\/[^"'\\\s<>)]+\.js/g)].map(
    (match) => normalise(match[0]),
  );
  const loadedAtOnce = unique(scripts);
  return {
    scripts: loadedAtOnce,
    stylesheets: unique(stylesheets),
    referenced: unique([...loadedAtOnce, ...mentioned]),
  };
}
