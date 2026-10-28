import { describe, expect, it } from 'vitest';
import { findings, isProven, judge } from './zap-gate.mjs';
import { contentSecurityPolicy } from '../../src/lib/security-headers';
import { OWN_POLICY, cspProblems, missingEverywhere, parseCsp } from './headers';
import { unfold } from './feeds';
import { PAYLOADS, unescaped, violations } from './injection';
import { markdownViolations } from './intra';
import { png } from './uploads';
import { inspectImage } from '../../src/lib/branding/image';

/**
 * The attacks are only worth what their detectors are worth: a check that cannot fail proves nothing. Each detector is
 * given what it must catch and what it must leave alone.
 */

describe('cspProblems', () => {
  it('accepts the policy of the platform', () => {
    expect(cspProblems(contentSecurityPolicy())).toEqual([]);
  });

  it.each([
    ['default-src *', 'allows every origin'],
    ["default-src 'self'; script-src 'self' 'unsafe-eval'", 'allows eval'],
    ["default-src 'self'; script-src https:", 'every https: address'],
    ["default-src 'self'; font-src data:", 'allows data: addresses'],
    [
      "default-src 'self'; img-src 'self' https://evil.example",
      'img-src allows https://evil.example',
    ],
    [
      "default-src 'self'; form-action https://evil.example",
      'form-action allows https://evil.example',
    ],
  ])('catches %s', (policy, expected) => {
    expect(cspProblems(policy).join('\n')).toContain(expected);
  });

  it('catches a missing frame-ancestors, object-src and base-uri', () => {
    const problems = cspProblems("default-src 'self'").join('\n');
    expect(problems).toContain('frame-ancestors is missing');
    expect(problems).toContain('object-src is missing');
    expect(problems).toContain('base-uri is missing');
  });

  it('reads directives', () => {
    expect(parseCsp("default-src 'self'; img-src 'self' data:")).toEqual({
      'default-src': ["'self'"],
      'img-src': ["'self'", 'data:'],
    });
  });
});

describe('missingEverywhere', () => {
  const response = (headers: Record<string, string>) => ({
    status: 200,
    headers: new Headers(headers),
    body: '',
    ms: 0,
  });
  const good = {
    'content-security-policy': contentSecurityPolicy(),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=()',
  };

  it('accepts a complete answer', () => {
    expect(missingEverywhere(response(good))).toEqual([]);
  });

  it.each([
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
  ])('notices %s missing', (name) => {
    const headers: Record<string, string> = { ...good };
    delete headers[name];
    expect(missingEverywhere(response(headers)).length).toBeGreaterThan(0);
  });

  it('notices what an answer must not say', () => {
    expect(missingEverywhere(response({ ...good, 'x-powered-by': 'Next.js' })).join()).toContain(
      'X-Powered-By',
    );
    expect(
      missingEverywhere(response({ ...good, 'access-control-allow-origin': '*' })).join(),
    ).toContain('CORS');
    expect(missingEverywhere(response({ ...good, server: 'nginx/1.18.0' })).join()).toContain(
      'version',
    );
  });
});

describe('missingEverywhere, for a route with a policy of its own', () => {
  const own = {
    status: 404,
    headers: new Headers({
      'content-security-policy': OWN_POLICY,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=()',
    }),
    body: '',
    ms: 0,
  };

  it('accepts its exact policy, and refuses it where the policy of the pages is expected', () => {
    expect(missingEverywhere(own, { ownPolicy: true })).toEqual([]);
    expect(missingEverywhere(own).length).toBeGreaterThan(0);
  });

  it('notices the policy of the pages where its own is expected', () => {
    const pages = { ...own, headers: new Headers(own.headers) };
    pages.headers.set('content-security-policy', contentSecurityPolicy());
    expect(missingEverywhere(pages, { ownPolicy: true }).join()).toContain('expected');
  });

  it('notices a refusal without any policy', () => {
    const bare = { ...own, headers: new Headers(own.headers) };
    bare.headers.delete('content-security-policy');
    expect(missingEverywhere(bare, { ownPolicy: true })).toContain('Content-Security-Policy');
  });
});

describe('violations (what a browser would act on in a page)', () => {
  const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

  it.each([
    ['an event handler', '<img src="x" onerror="alert(1)">'],
    ['a javascript: link', '<a href="javascript:alert(1)">x</a>'],
    ['a frame', '<iframe srcdoc="x"></iframe>'],
    ['a base', '<base href="https://evil.example/">'],
    ['a form that sends elsewhere', '<form action="https://evil.example"></form>'],
    ['a redirect', '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
    ['a style that loads', '<style>@import "https://evil.example/x.css"</style>'],
    ['a link to another host', '<a href="https://evil.example/x">x</a>'],
  ])('finds %s', (_name, body) => {
    expect(violations(page(body)).length).toBeGreaterThan(0);
  });

  it.each([
    ['text', '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'],
    ['a label that says the text', '<a aria-label="evil.example" href="/fr">x</a>'],
    ['a form of the platform', '<form action="/api/auth/signout" method="post"></form>'],
    ['a comment of React', '<p>a<!-- -->b</p>'],
  ])('leaves %s alone', (_name, body) => {
    expect(violations(page(body))).toEqual([]);
  });
});

describe('unescaped', () => {
  it('finds a tag as it was typed, not escaped', () => {
    expect(unescaped('<p><img src=x onerror=alert(1)></p>', PAYLOADS)).toContain(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('leaves what is escaped, and what has no tag', () => {
    expect(unescaped('&lt;img src=x onerror=alert(1)&gt; \\u003cscript\\u003e', PAYLOADS)).toEqual(
      [],
    );
    expect(unescaped('<!-- -->', ['<!--'])).toEqual([]);
    expect(unescaped('javascript:alert(1)', ['javascript:alert(1)'])).toEqual([]);
  });
});

describe('unfold', () => {
  it('joins the lines a calendar file folds', () => {
    expect(unfold('SUMMARY:one\r\n two\r\n\tthree\r\nEND:VEVENT\r\n')).toEqual([
      'SUMMARY:onetwothree',
      'END:VEVENT',
      '',
    ]);
  });
});

describe('png (the file the upload attacks are made of)', () => {
  it('is an image the platform reads as one, of the size asked', () => {
    expect(inspectImage(png(128))).toMatchObject({ type: 'png', width: 128, height: 128 });
  });

  it('can lie about its size, as a bomb does', () => {
    expect(inspectImage(png(64, { width: 100_000, height: 100_000 }))).toMatchObject({
      width: 100_000,
      height: 100_000,
    });
  });
});

describe('the verdict on a ZAP report', () => {
  const report = {
    site: [
      {
        alerts: [
          {
            pluginid: '10055',
            name: 'CSP',
            riskcode: '2',
            instances: [{ uri: 'http://x/fr' }, { uri: 'http://x/en' }],
          },
          {
            pluginid: '40012',
            name: 'XSS',
            riskcode: '3',
            instances: [{ uri: 'http://x/fr/events?q=1' }],
          },
          { pluginid: '10010', name: 'Cookie', riskcode: '1', instances: [{ uri: 'http://x/' }] },
        ],
      },
    ],
  };

  it('lists one row per instance', () => {
    expect(findings(report)).toHaveLength(4);
  });

  it('fails what is medium or above and not accepted, whatever the level', () => {
    const { failing } = judge(findings(report), []);
    expect(failing.map((row: { plugin: string }) => row.plugin).sort()).toEqual([
      '10055',
      '10055',
      '40012',
    ]);
  });

  it('accepts by plugin and path, and only that', () => {
    const accepted = [{ plugin: '10055', path: '/fr', reason: 'x' }];
    const { failing, accepted: kept } = judge(findings(report), accepted);
    expect(kept).toHaveLength(1);
    expect(failing.map((row: { uri: string }) => row.uri)).toContain('http://x/en');
  });

  it('never lets an accepted alert hide another one', () => {
    const { failing } = judge(findings(report), [{ plugin: '10055', path: '.*', reason: 'x' }]);
    expect(failing.map((row: { plugin: string }) => row.plugin)).toEqual(['40012']);
  });

  it('says which accepted entries match nothing any more', () => {
    const { unused } = judge(findings(report), [{ plugin: '99999', path: '.*', reason: 'x' }]);
    expect(unused).toHaveLength(1);
  });
});

describe('the gate accepts the SQL injection rule only where the sql suite attacked', () => {
  const alert = (uri: string, param: string) => ({
    pluginid: '40018',
    name: 'SQL Injection',
    riskcode: '3',
    instances: [{ uri, param, method: 'POST' }],
  });
  const proven = {
    pages: [
      {
        pattern: '^/(?:en|fr)/events/new$',
        actions: ['events.createEvent'],
        fields: ['title', 'location'],
      },
    ],
  };
  const accepted = [{ plugin: '40018', path: '.*', proven: 'sql', reason: 'x' }];
  const failingOf = (...alerts: ReturnType<typeof alert>[]) =>
    judge(findings({ site: [{ alerts: alerts }] }), accepted, proven).failing.map(
      (row: { uri: string; param: string }) => `${row.uri} ${row.param}`,
    );

  it('accepts a field the suite attacked, on a page that holds the action', () => {
    expect(
      failingOf(
        alert('http://x/en/events/new', 'title'),
        alert('http://x/fr/events/new', 'location'),
      ),
    ).toEqual([]);
  });

  it('accepts the internal fields of a server action on such a page', () => {
    expect(
      failingOf(
        alert('http://x/en/events/new', '$ACTION_REF_1'),
        alert('http://x/en/events/new', '$ACTION_1:0'),
      ),
    ).toEqual([]);
  });

  it('fails a field no action of the page was attacked through', () => {
    expect(failingOf(alert('http://x/en/events/new', 'repeatFreq'))).toEqual([
      'http://x/en/events/new repeatFreq',
    ]);
  });

  it('fails a page that holds no action that was attacked, whatever the field', () => {
    expect(
      failingOf(
        alert('http://x/en/members', 'title'),
        alert('http://x/en/members', '$ACTION_REF_1'),
      ),
    ).toHaveLength(2);
  });

  it('is the page and the field together: the field of another page does not do', () => {
    expect(failingOf(alert('http://x/en/events/new/extra', 'title'))).toHaveLength(1);
  });

  it('accepts nothing when nothing was proven (no file: the entry would otherwise accept everything)', () => {
    const rows = findings({ site: [{ alerts: [alert('http://x/en/events/new', 'title')] }] });
    expect(judge(rows, accepted).failing).toHaveLength(1);
    expect(isProven({ pages: [] }, '/en/events/new', 'title')).toBe(false);
  });

  it('does not let the entry accept another rule', () => {
    const other = {
      pluginid: '40012',
      name: 'XSS',
      riskcode: '3',
      instances: [{ uri: 'http://x/en/events/new', param: 'title' }],
    };
    expect(judge(findings({ site: [{ alerts: [other] }] }), accepted, proven).failing).toHaveLength(
      1,
    );
  });
});

describe('markdownViolations', () => {
  const page = (body: string) => `<html><body>${body}</body></html>`;

  it.each([
    [
      '<a href="javascript:alert(1)" target="_blank" rel="noopener noreferrer">x</a>',
      'javascript:',
    ],
    ['<a href=" JaVaScRiPt:alert(1)">x</a>', 'JaVaScRiPt'],
    ['<a href="data:text/html,x">x</a>', 'data:'],
    ['<a href="vbscript:msgbox(1)">x</a>', 'vbscript:'],
    ['<a href="https://evil.example/x">x</a>', 'not opened apart'],
    ['<a href="https://evil.example/x" target="_blank">x</a>', 'not opened apart'],
    ['<a href="https://evil.example/x" rel="noopener noreferrer">x</a>', 'not opened apart'],
    ['<img src="https://evil.example/x.png">', '<img'],
    ['<img src="javascript:alert(1)">', '<img'],
  ])('catches %s', (html, expected) => {
    expect(markdownViolations(page(html)).join('\n')).toContain(expected);
  });

  it('leaves alone what the platform draws from a description: a link opened apart, a mail address, the platform’s own pictures', () => {
    expect(
      markdownViolations(
        page(
          '<a href="https://evil.example/x" target="_blank" rel="noopener noreferrer">x</a><a href="mailto:a@b.fr">m</a><img src="/api/logo?v=0123456789abcdef"><a href="/events/1">e</a>',
        ),
      ),
    ).toEqual([]);
  });
});
