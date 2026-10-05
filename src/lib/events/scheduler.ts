import { isEventsModuleEnabled } from './access';
import { runReminderTick } from './reminders';

const TICK_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 15 * 1000;
const STARTED = Symbol.for('bde-network.events.reminder-scheduler');

type GlobalWithScheduler = typeof globalThis & { [STARTED]?: boolean };

/**
 * Starts the in-process reminder loop (called once from instrumentation.ts
 * when the Node.js server boots). It needs no cron, no OS service and no
 * external scheduler, so it behaves the same on Windows, Linux and macOS and
 * inside Docker. Idempotent: dev hot-reloads and repeated calls start one loop.
 */
export function startEventReminderScheduler(): void {
  const scope = globalThis as GlobalWithScheduler;
  if (scope[STARTED]) {
    return;
  }

  try {
    if (!isEventsModuleEnabled()) {
      return;
    }
  } catch (error) {
    // An invalid config is reported by next.config.ts; just don't schedule.
    console.error('[events] reminder scheduler not started: cannot read the configuration', error);
    return;
  }

  scope[STARTED] = true;
  let running = false;

  const tick = async () => {
    // A slow tick must never overlap the next one.
    if (running) return;
    running = true;
    try {
      await runReminderTick();
    } catch (error) {
      console.error('[events] reminder tick failed', error);
    } finally {
      running = false;
    }
  };

  // unref() so the timers never keep the process alive on shutdown.
  setTimeout(tick, FIRST_TICK_DELAY_MS).unref();
  setInterval(tick, TICK_INTERVAL_MS).unref();
  console.log(
    "⏰ Rappels d'événements : planificateur démarré (vérification toutes les 5 minutes).",
  );
}
