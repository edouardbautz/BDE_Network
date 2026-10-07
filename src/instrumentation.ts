export async function register(): Promise<void> {
  // Node.js server only, and never while building (the image is built without
  // .env). The dynamic imports behind this guard keep Prisma and node:fs (config
  // loader, scheduler) out of the Edge bundle.
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { runStartupChecks } = await import('./lib/startup-checks');
    runStartupChecks();

    // In the background: only says, in the logs, when 42 refuses the application's identifiers.
    const { warnIfFortyTwoRejectsTheApplication } = await import('./lib/auth/oauth-check');
    warnIfFortyTwoRejectsTheApplication();

    const { startEventReminderScheduler } = await import('./lib/events/scheduler');
    startEventReminderScheduler();
  }
}
