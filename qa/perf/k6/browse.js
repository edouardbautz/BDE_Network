// What a platform does when many people use it at once, played with k6 against the platform of `qa/platform.sh` (docs/architecture.md,
// "Performance and load"). A mix of what members, people who validate and owners open, weighted like a day of a BDE: the calendar
// and the dashboard most, the heavy pages (300 members, the audit log, the settings) less, and the calendar feed that
// calendar applications fetch by themselves.
//
// Run by `qa/perf/load.ts`, which gives it the cookies of the personas (`COOKIE_<PERSONA>`), a feed link (`FEED_TOKEN`), the
// address of the platform (`BASE`), and the size of the load (`VUS`, `DURATION`). The limits are thresholds: k6 ends with a
// non-zero status when one is crossed, and the report says which.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE;
const VUS = Number(__ENV.VUS || 20);
const DURATION = __ENV.DURATION || '40s';
const cookie = (persona) => __ENV[`COOKIE_${persona.toUpperCase()}`] || '';

const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
const month = () => MONTHS[Math.floor(Math.random() * MONTHS.length)];

/**
 * Every page of the mix: its name (the tag of its numbers), who asks, what share of the visits it gets, the slowest answer
 * accepted for 95 % of the requests (milliseconds: two to three times what the shared runners of the CI gave, whose speed varies
 * from one run to the next by a factor of two, so that it takes a change of order of magnitude to cross), and a text the page must hold (an error page that answers 200 is not a
 * success).
 */
const PAGES = [
  {
    name: 'dashboard',
    who: 'member',
    weight: 18,
    p95: 2500,
    path: () => '/en/dashboard',
    marker: '<h1',
  },
  {
    name: 'calendar',
    who: 'member',
    weight: 24,
    p95: 3000,
    path: () => `/en/events?view=calendar&month=${month()}`,
    marker: 'Previous month',
  },
  {
    name: 'event-list',
    who: 'member',
    weight: 14,
    p95: 3000,
    path: () => '/en/events?view=list',
    marker: '<h1',
  },
  {
    name: 'event',
    who: 'member',
    weight: 12,
    p95: 2500,
    path: () => '/en/events/qa-fx-series',
    marker: 'Upcoming occurrences',
  },
  {
    name: 'profile',
    who: 'member',
    weight: 4,
    p95: 2500,
    path: () => '/en/profile',
    marker: '<h1',
  },
  {
    name: 'review',
    who: 'validator',
    weight: 5,
    p95: 3000,
    path: () => '/en/events/review',
    marker: 'To validate',
  },
  {
    name: 'event-form',
    who: 'proposer',
    weight: 4,
    p95: 3000,
    path: () => '/en/events/new',
    marker: 'New event',
  },
  {
    name: 'members',
    who: 'owner',
    weight: 4,
    p95: 4000,
    path: () => '/en/members',
    marker: 'Member management',
  },
  {
    name: 'audit-log',
    who: 'owner',
    weight: 2,
    p95: 4000,
    path: () => '/en/audit-log',
    marker: 'Audit log',
  },
  { name: 'roles', who: 'owner', weight: 2, p95: 3000, path: () => '/en/roles', marker: '<h1' },
  {
    name: 'settings',
    who: 'owner',
    weight: 2,
    p95: 3500,
    path: () => '/en/settings',
    marker: 'Settings',
  },
  { name: 'login', who: 'anonymous', weight: 6, p95: 1500, path: () => '/en', marker: 'Sign in' },
  {
    name: 'feed',
    who: 'feed',
    weight: 3,
    p95: 2500,
    path: () => `/api/calendar/${__ENV.FEED_TOKEN}`,
    marker: 'BEGIN:VCALENDAR',
  },
];
const TOTAL_WEIGHT = PAGES.reduce((sum, page) => sum + page.weight, 0);

function pick() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const page of PAGES) {
    roll -= page.weight;
    if (roll < 0) return page;
  }
  return PAGES[0];
}

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Almost nothing may fail, and what answers must be the page that was asked for.
    http_req_failed: ['rate<0.005'],
    checks: ['rate>0.995'],
    ...Object.fromEntries(
      PAGES.map((page) => [`http_req_duration{page:${page.name}}`, [`p(95)<${page.p95}`]]),
    ),
    // Every page of the mix is asked at least once (and the summary says how many times).
    ...Object.fromEntries(PAGES.map((page) => [`http_reqs{page:${page.name}}`, ['count>0']])),
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
};

export default function browse() {
  const page = pick();
  const headers =
    page.who === 'anonymous' || page.who === 'feed' ? {} : { Cookie: cookie(page.who) };
  const response = http.get(`${BASE}${page.path()}`, {
    headers,
    redirects: 0,
    tags: { page: page.name },
  });
  check(
    response,
    {
      [`${page.name}: 200`]: (r) => r.status === 200,
      [`${page.name}: it is the page`]: (r) =>
        typeof r.body === 'string' && r.body.includes(page.marker),
    },
    { page: page.name },
  );
  // A person reads before they click.
  sleep(0.2 + Math.random() * 0.6);
}
