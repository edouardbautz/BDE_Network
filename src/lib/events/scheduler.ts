import { isEventsModuleEnabled } from './access';
import { runReminderTick } from './reminders';

const TICK_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 15 * 1000;
const STARTED = Symbol.for('bde-network.events.reminder-scheduler');

interface Timers {
  first: ReturnType<typeof setTimeout>;
  every: ReturnType<typeof setInterval>;
}

/** On `globalThis`: the instrumentation hook and the server actions are bundled apart (like the runtime settings). */
type GlobalWithScheduler = typeof globalThis & { [STARTED]?: Timers };

/**
 * Starts the in-process reminder loop (called once from instrumentation.ts
 * when the Node.js server boots). It needs no cron, no OS service and no
 * external scheduler, so it behaves the same on Windows, Linux and macOS and
 * inside Docker. Idempotent: dev hot-reloads and repeated calls start one loop. The settings page starts it when
 * the events module is turned on, and stops it (`stopEventReminderScheduler`) when it is turned off.
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
  const first = setTimeout(tick, FIRST_TICK_DELAY_MS);
  const every = setInterval(tick, TICK_INTERVAL_MS);
  first.unref();
  every.unref();
  scope[STARTED] = { first, every };
  console.log(
    "⏰ Rappels d'événements : planificateur démarré (vérification toutes les 5 minutes).",
  );
}

/** Stops the loop (the events module was turned off). A tick already running finishes; none starts after. */
export function stopEventReminderScheduler(): void {
  const scope = globalThis as GlobalWithScheduler;
  const timers = scope[STARTED];
  if (!timers) {
    return;
  }
  clearTimeout(timers.first);
  clearInterval(timers.every);
  delete scope[STARTED];
  console.log("⏰ Rappels d'événements : planificateur arrêté (module désactivé).");
}
