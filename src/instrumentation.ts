export async function register(): Promise<void> {
  // Node.js server only. The dynamic import behind this guard keeps the
  // scheduler (Prisma, config loader, node:fs) out of the Edge bundle.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startEventReminderScheduler } = await import('./lib/events/scheduler');
    startEventReminderScheduler();
  }
}
