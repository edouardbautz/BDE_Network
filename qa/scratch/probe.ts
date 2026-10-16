import { readFileSync } from 'node:fs';
import { cookieHeaderFor, persona, type PersonaKey } from '../personas';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { encodeReply } = require('next/dist/compiled/react-server-dom-webpack/client.node');

const manifest = JSON.parse(readFileSync(process.argv[2]!, 'utf8')).node as Record<
  string,
  { exportedName: string; filename: string; workers: Record<string, unknown> }
>;
const base = 'http://127.0.0.1:3100';
const secret = 'qa-only-secret-never-used-anywhere-else-0123456789abcdef';

async function call(
  name: string,
  file: RegExp,
  args: unknown[],
  as: PersonaKey,
  page = '/fr/members',
) {
  const entry = Object.entries(manifest).find(
    ([, v]) => v.exportedName === name && file.test(v.filename),
  );
  if (!entry) throw new Error('no action ' + name);
  const body = await encodeReply(args);
  const cookie = await cookieHeaderFor(persona(as), secret);
  const response = await fetch(base + page, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Next-Action': entry[0],
      Accept: 'text/x-component',
      ...(typeof body === 'string' ? { 'Content-Type': 'text/plain;charset=UTF-8' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body,
  });
  const text = await response.text();
  console.log(
    as.padEnd(10),
    name.padEnd(14),
    response.status,
    text.slice(0, 160).replace(/\n/g, ' | '),
  );
}

(async () => {
  for (const who of ['anonymous', 'pending', 'member', 'custom', 'owner'] as PersonaKey[]) {
    await call('rejectMember', /members\/actions/, ['qa-user-0001'], who);
  }
})();
