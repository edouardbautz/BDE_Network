import { backupTick, platformBackupContext } from './service';

const TICK_INTERVAL_MS = 5 * 60 * 1000;
// A little after the reminders' first tick: a platform that has just started is busy with its first requests.
const FIRST_TICK_DELAY_MS = 60 * 1000;
const STARTED = Symbol.for('bde-network.backups.scheduler');

interface Timers {
  first: ReturnType<typeof setTimeout>;
  every: ReturnType<typeof setInterval>;
}

/** On `globalThis`, like the reminders' loop: the instrumentation hook and the server actions are bundled apart. */
type GlobalWithScheduler = typeof globalThis & { [STARTED]?: Timers };

/**
 * Starts the loop that makes the nightly backup (03:00, BDE time): called from instrumentation.ts when the server boots, and by the
 * installer when it finishes. In-process like the reminders, so it needs no cron and works the same everywhere; idempotent.
 * A tick looks at the status file and the clock (schedule.ts): a platform that was off at 03:00 catches up when it is back.
 */
export function startBackupScheduler(): void {
  const scope = globalThis as GlobalWithScheduler;
  if (scope[STARTED]) return;
  // `npm run dev` and the tests have no pg_dump and nobody to read the result: the production server only.
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.DATABASE_URL?.trim()) {
    console.warn(
      "💾 Sauvegardes automatiques : pas d'adresse de base de données, planificateur non démarré.",
    );
    return;
  }

  let running = false;
  const tick = async () => {
    // A backup can last minutes: a tick never overlaps the previous one.
    if (running) return;
    running = true;
    try {
      const context = platformBackupContext();
      if (context) await backupTick(context);
    } catch (error) {
      console.error('[backups] tick failed', error);
    } finally {
      running = false;
    }
  };

  const first = setTimeout(tick, FIRST_TICK_DELAY_MS);
  const every = setInterval(tick, TICK_INTERVAL_MS);
  first.unref();
  every.unref();
  scope[STARTED] = { first, every };
  console.log(
    '💾 Sauvegardes automatiques : planificateur démarré (chaque nuit à 3 h, heure du BDE).',
  );
}
