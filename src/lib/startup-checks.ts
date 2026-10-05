import { ConfigError, getConfig } from '@/config';
import { formatEnvironmentErrors, validateEnvironment } from '@/config/env';

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
      console.error(`\n❌ ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const { errors, warnings } = validateEnvironment(process.env, config);

  for (const warning of warnings) {
    console.warn(`\n⚠️  ${warning}\n`);
  }

  if (errors.length > 0) {
    console.error(`\n❌ ${formatEnvironmentErrors(errors)}\n`);
    process.exit(1);
  }
}
