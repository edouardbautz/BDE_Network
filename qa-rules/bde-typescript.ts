// Test cases of bde-typescript.yml: `ruleid:` must be reported on the next line, `ok:` must not.
// (`semgrep --test .semgrep`; this file is not part of the application and is never compiled.)
/* eslint-disable */
// @ts-nocheck

// ---- bde-managed-setting-read-from-env
// ruleid: bde-managed-setting-read-from-env
const url = process.env.APP_URL;
// ruleid: bde-managed-setting-read-from-env
const secret = process.env.FORTYTWO_CLIENT_SECRET;
// ok: bde-managed-setting-read-from-env
const level = process.env.NODE_ENV;
// ok: bde-managed-setting-read-from-env
const port = process.env.PORT;

// ---- bde-computed-process-env
// ruleid: bde-computed-process-env
const any = process.env[name];

// ---- bde-no-eval
// ruleid: bde-no-eval
eval(code);
// ruleid: bde-no-eval
const f = new Function('a', 'return a');
// ok: bde-no-eval
const evaluate = () => 1;

// ---- bde-no-child-process
// ruleid: bde-no-child-process
import { exec } from 'node:child_process';
// ruleid: bde-no-child-process
import cp from 'child_process';
// ok: bde-no-child-process
import { readFile } from 'node:fs/promises';

// ---- bde-no-math-random
// ruleid: bde-no-math-random
const guess = Math.random();
// ok: bde-no-math-random
const safe = randomBytes(32);

// ---- bde-no-unsafe-raw-sql
// ruleid: bde-no-unsafe-raw-sql
await prisma.$queryRawUnsafe('SELECT ' + column);
// ruleid: bde-no-unsafe-raw-sql
await db.$executeRawUnsafe(sql);
// ok: bde-no-unsafe-raw-sql
await prisma.$queryRaw`SELECT ${value}`;

// ---- bde-link-through-the-i18n-link
// ruleid: bde-link-through-the-i18n-link
import Link from 'next/link';
// ruleid: bde-link-through-the-i18n-link
import { createNavigation } from 'next-intl/navigation';
// ok: bde-link-through-the-i18n-link
import { Link } from '@/i18n/navigation';

// ---- bde-cookie-must-be-http-only
// ruleid: bde-cookie-must-be-http-only
store.set('choice', value, { path: '/' });
// ruleid: bde-cookie-must-be-http-only
(await cookies()).set('session', token, { sameSite: 'lax', httpOnly: false });
// ok: bde-cookie-must-be-http-only
store.set('choice', value, { httpOnly: true, sameSite: 'lax', path: '/' });
// ok: bde-cookie-must-be-http-only
drafts.set(sessionKey, draft);

// ---- bde-no-secret-in-a-log
// ruleid: bde-no-secret-in-a-log
console.log('sealed', secret);
// ruleid: bde-no-secret-in-a-log
console.error('failed', webhookUrl);
// ruleid: bde-no-secret-in-a-log
console.warn(token);
// ok: bde-no-secret-in-a-log
console.log('created', login);
// ok: bde-no-secret-in-a-log
console.error('[events] reminder tick failed', error);
