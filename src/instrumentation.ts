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
    let initialized;
    try {
      initialized = await initializePlatform();
    } catch (error) {
      if (error instanceof PlatformSettingsError) refuseToStart('config', error.message);
      throw error;
    }

    // Nothing decided yet (the unfilled template, nothing in the database): the platform is installed from the
    // browser, with a code that is written to the logs. Nothing else runs until it is installed.
    if (initialized.source === 'setup') {
      // ...but never over a database that already has people in it (a platform installed before the installer, started
      // with an image that does not hold its bde.config.yml): the installer would replace their settings. It is said
      // in the browser instead (docker/startup-problems.mjs, "existing-data").
      const { prisma } = await import('./lib/prisma');
      if ((await prisma.user.count()) > 0) {
        refuseToStart(
          'existing-data',
          'La base contient déjà des comptes, mais aucun réglage enregistré ni fichier de configuration complet : ' +
            "l'installateur n'est pas ouvert (il remplacerait vos réglages). Voir « Si votre plateforme date d'avant l'installateur » " +
            'dans le guide de mise à jour.',
        );
      }
      const { enterSetupMode } = await import('./lib/setup/mode');
      enterSetupMode();
      return;
    }

    runStartupChecks();

    // OWNER is the status of an account, and the settings only list logins: bring the accounts in line with the
    // list (a change made while the platform was stopped, through the files, must not wait for a sign-in).
    const { reconcileOwnerAccounts } = await import('./lib/settings/owners');
    const { getConfig } = await import('./config');
    await reconcileOwnerAccounts(getConfig().auth.owners);

    // In the background: only says, in the logs, when 42 refuses the application's identifiers.
    const { warnIfFortyTwoRejectsTheApplication } = await import('./lib/auth/oauth-check');
    warnIfFortyTwoRejectsTheApplication();

    const { startEventReminderScheduler } = await import('./lib/events/scheduler');
    startEventReminderScheduler();
  }
}
