export async function register(): Promise<void> {
  // Node.js server only, and never while building (the image is built without
  // .env). The dynamic imports behind this guard keep Prisma and node:fs (config
  // loader, scheduler) out of the Edge bundle.
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    // The settings come from the database (copied from bde.config.yml and .env at the first start after the
    // update): load them before anything reads the configuration.
    const { initializePlatform, PlatformSettingsError } = await import('./lib/settings/store');
    const { refuseToStart, runStartupChecks } = await import('./lib/startup-checks');
    try {
      await initializePlatform();
    } catch (error) {
      if (error instanceof PlatformSettingsError) refuseToStart('config', error.message);
      throw error;
    }
    runStartupChecks();

    // In the background: only says, in the logs, when 42 refuses the application's identifiers.
    const { warnIfFortyTwoRejectsTheApplication } = await import('./lib/auth/oauth-check');
    warnIfFortyTwoRejectsTheApplication();

    const { startEventReminderScheduler } = await import('./lib/events/scheduler');
    startEventReminderScheduler();
  }
}
