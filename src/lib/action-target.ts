/**
 * What a server action that stays on the page you are on answers: where to look next. The browser LOADS that address
 * (`window.location.assign`), it does not ask the router to show it. Why: in the production build, Next.js 15 and 16 (checked on 16.4.1) answer
 * an action that changes the page you are on (and refreshes that same page) with the "loading" state it cached for it,
 * then often never shows the page it fetched: the action is done, the page still shows the old state, nothing is
 * logged, and the development server does not do it. Loading the page again is what a plain link to the current page
 * does for the same reason (`src/i18n/link.tsx`); see "Navigation" in docs/architecture.md.
 */
export interface ActionTarget {
  href: string;
}

export function isActionTarget(value: unknown): value is ActionTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    'href' in value &&
    typeof (value as ActionTarget).href === 'string'
  );
}
