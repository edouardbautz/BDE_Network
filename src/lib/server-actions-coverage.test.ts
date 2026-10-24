import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startsWithUseServer } from '../../qa/access/use-server';

/**
 * Every server action of the platform is played in a real browser, on the real image, by one of the scripts of `e2e/`
 * (see "Actions that stay on the page" in docs/architecture.md): in the production build, what a page shows after an
 * action that stays on it is not what `next dev` or a unit test shows, and nothing else catches it.
 *
 * This test makes that automatic for the modules to come. It lists the exported actions of every `'use server'` file
 * and wants each one either named in a `// covers: <folder>.<action>` line of an `e2e/*.mjs` script, or listed
 * below with the reason it does not need one. A new action fails here until the author has written the scenario
 * (`e2e/actions.mjs`: a scenario is a few lines) or said, in a reviewable place, why not.
 */

const ROOT = join(__dirname, '..', '..');

/** Actions that no browser scenario plays, and why. A reason must be a fact, not a wish. */
const EXEMPT: Record<string, string> = {
  'events.createEvent':
    'leaves the page: the form redirects to the new event (another pathname, which the router shows)',
  'events.deleteEvent': 'leaves the page: it redirects to the list (another pathname)',
  'settings.saveAddress':
    'a section of the settings page that answers like saveIdentity (same `answer()`), which is played',
  'settings.skipFortyTwoVerification': 'a variant of settings.verifyFortyTwo, same `answer()`',
  'settings.loadCampuses': 'reads only: nothing on the page changes',
  'settings.saveStaffChannel':
    'a section of the settings page that answers like saveIdentity (same `answer()`)',
  'settings.testStaffChannel': 'sends a test message: nothing on the page changes',
  'settings.saveCampuses':
    'a section of the settings page that answers like saveIdentity (same `answer()`)',
  'settings.saveNotifications':
    'a section of the settings page that answers like saveIdentity (same `answer()`)',
  'settings.testNotification': 'sends a test message: nothing on the page changes',
  'profile.saveMentionIds':
    'a form that keeps its own state (useActionState) and says "saved" itself: the page shows nothing else of what it writes',
  'notifications.acknowledgeRevision':
    'loads the page again like resetTemplate (same `reload()`); the notice it clears only exists once the platform improves a message, and none has yet',
  'notifications.previewTemplate': 'reads only: draws the notification, writes nothing',
  'notifications.sendTemplateTestMessage': 'sends a test message: nothing on the page changes',
  'notifications.loadHistory': 'reads only: lists the versions in a dialog',
  'dev-impersonation.startImpersonation':
    'development only (refused in production, see isDevImpersonationEnabled)',
  'dev-impersonation.stopImpersonation':
    'development only (refused in production, see isDevImpersonationEnabled)',
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === 'node_modules' || name === 'generated') return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

/** `<folder>.<action>` for every exported action of a file that starts with the `'use server'` directive. */
function exportedActions(): string[] {
  return sourceFiles(join(ROOT, 'src'))
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    .flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      if (!startsWithUseServer(source)) return [];
      const file = basename(path).replace(/\.tsx?$/, '');
      // `.../settings/actions.ts` is "settings"; `dev-impersonation-actions.ts` is "dev-impersonation".
      const owner = file === 'actions' ? basename(dirname(path)) : file.replace(/-actions$/, '');
      return [...source.matchAll(/^export async function (\w+)/gm)].map(
        (match) => `${owner}.${match[1]}`,
      );
    });
}

function coveredActions(): Set<string> {
  const directory = join(ROOT, 'e2e');
  const covered = new Set<string>();
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.mjs'))) {
    for (const line of readFileSync(join(directory, name), 'utf8').split('\n')) {
      const match = /^\/\/ covers:(.*)$/.exec(line);
      for (const action of match?.[1]?.split(',') ?? [])
        if (action.trim()) covered.add(action.trim());
    }
  }
  return covered;
}

describe('the browser scenarios cover every server action', () => {
  const actions = exportedActions();
  const covered = coveredActions();

  it('finds the actions of the platform (the scan itself works)', () => {
    expect(actions).toEqual(
      expect.arrayContaining([
        'members.approveMember',
        'roles.deleteRole',
        'settings.saveIdentity',
        'setup.finishInstallation',
        'shared-calendar.enableSharedCalendar',
        'events.updateEvent',
      ]),
    );
  });

  it('plays every action in a browser, or says why it does not need to', () => {
    const missing = actions.filter((action) => !covered.has(action) && !(action in EXEMPT));
    expect(
      missing,
      `no e2e scenario (\`// covers: ${missing[0] ?? '<folder>.<action>'}\` in an e2e/*.mjs script) and no entry in EXEMPT. ` +
        'Write the scenario in e2e/actions.mjs: see "Actions that stay on the page" in docs/architecture.md.',
    ).toEqual([]);
  });

  it('keeps no stale entry: a covered or exempt name must be a real action, and not both', () => {
    const known = new Set(actions);
    expect([...covered].filter((name) => !known.has(name))).toEqual([]);
    expect(Object.keys(EXEMPT).filter((name) => !known.has(name))).toEqual([]);
    expect(Object.keys(EXEMPT).filter((name) => covered.has(name))).toEqual([]);
  });
});
