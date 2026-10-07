import { writeFileSync } from 'node:fs';
import { ConfigError, getConfig } from '@/config';
import { formatEnvironmentErrors, validateEnvironment } from '@/config/env';
import { effectiveEnvironment } from '@/lib/settings/runtime';

/** Exit code of a refusal to start because of the configuration (EX_CONFIG in sysexits.h). The container's
 * command (docker/start.mjs) knows it: it then explains the problem in the browser instead of letting the
 * restart policy loop. `docker/startup-problems.mjs` holds the same number (a test keeps them equal). */
export const EXIT_CONFIG = 78;

/**
 * Prints why, leaves a small report for docker/start.mjs (`BDE_STARTUP_REPORT`: the kind of problem and
 * the NAMES of the variables, never a value) and ends the process with EXIT_CONFIG.
 */
export function refuseToStart(
  kind: 'env' | 'config',
  message: string,
  variables: readonly string[] = [],
): never {
  console.error(`\n❌ ${message}\n`);
  const reportPath = process.env.BDE_STARTUP_REPORT;
  if (reportPath) {
    try {
      writeFileSync(reportPath, JSON.stringify({ kind, variables }));
    } catch {
      /* the explanation page then speaks of .env in general: not worth failing for */
    }
  }
  return process.exit(EXIT_CONFIG);
}

/**
 * Runs once when the server starts (from instrumentation.ts). Refuses to start,
 * with a message a non-developer can act on, when `bde.config.yml` or `.env` is
 * unusable; only warns about things that are probably wrong but not fatal.
 *
 * This lives here and not in next.config.ts because a standalone production
 * build (the Docker image) never evaluates next.config.ts when it starts.
 * `.env` cannot be checked at build time at all: the image is built without it.
 */
export function runStartupChecks(): void {
  let config: ReturnType<typeof getConfig>;
  try {
    config = getConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      refuseToStart('config', error.message);
    }
    throw error;
  }

  const { errors, warnings, variables } = validateEnvironment(effectiveEnvironment(), config);

  for (const warning of warnings) {
    console.warn(`\n⚠️  ${warning}\n`);
  }

  if (errors.length > 0) {
    refuseToStart('env', formatEnvironmentErrors(errors), variables);
  }
}
