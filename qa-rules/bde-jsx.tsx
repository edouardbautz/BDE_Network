// Test cases of bde-jsx.yml: `ruleid:` must be reported on the next line, `ok:` must not.
/* eslint-disable */
// @ts-nocheck

// ruleid: bde-no-dangerously-set-inner-html
export const unsafe = <div dangerouslySetInnerHTML={{ __html: text }} />;
// ok: bde-no-dangerously-set-inner-html
export const safe = <div>{text}</div>;

// ruleid: bde-external-link-has-rel
export const opener = <a href="https://example.org" target="_blank">x</a>;
// ok: bde-external-link-has-rel
export const guarded = <a href="https://example.org" target="_blank" rel="noopener noreferrer">x</a>;
// ok: bde-external-link-has-rel
export const guardedFirst = <a rel="noopener noreferrer" href="https://example.org" target="_blank">x</a>;
// ok: bde-external-link-has-rel
export const otherOrder = <a href="https://example.org" target="_blank" rel="noreferrer noopener">x</a>;
// ok: bde-external-link-has-rel
export const internal = <a href="/fr/events">x</a>;
