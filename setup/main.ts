import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realRunner } from './docker';
import { realSleep } from './fortytwo';
import { realTransport } from './notify-test';
import { AbortedError, createTerminalReader, InputClosedError, Prompts } from './prompts';
import { isProjectDir, runWizard } from './wizard';
import { translator } from './messages';

/**
 * Entry point of the setup assistant. It runs in its own container (docker-compose.setup.yml) with the
 * project folder mounted at /project, and talks to the person on the terminal.
 */

const projectDir = process.env.PROJECT_DIR ?? '/project';
const here = dirname(fileURLToPath(import.meta.url));

/** The time zone of this computer when it is more than the container's default (UTC). */
function guessTimezone(): string | undefined {
  const zone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && !/^(?:Etc\/)?(?:UTC|GMT)$/i.test(zone) ? zone : undefined;
}

/** The documentation's pre-filled Slack link, built from the very manifest of the repository. */
function slackLink(): string | null {
  const path = join(here, '..', 'docs', 'slack-app-manifest.yml');
  return existsSync(path)
    ? `https://api.slack.com/apps?new_app=1&manifest_yaml=${encodeURIComponent(readFileSync(path, 'utf8'))}`
    : null;
}

async function main(): Promise<number> {
  if (!isProjectDir(projectDir)) {
    console.error(`${translator('fr')('notInProject')}\n\n${translator('en')('notInProject')}`);
    return 1;
  }

  const prompts = new Prompts(
    createTerminalReader(process.stdin, process.stdout, {
      onInterrupt: () => {
        process.stdout.write(`\n${prompts.t('aborted')}\n`);
        process.exit(130);
      },
    }),
  );

  try {
    await runWizard({
      prompts,
      projectDir,
      fetchFn: (url, init) => fetch(url, init),
      sleep: realSleep,
      transport: realTransport,
      run: realRunner,
      containerId: process.env.HOSTNAME,
      guessTimezone,
      now: () => new Date(),
      slackLink,
      startTimeoutMs: 300_000,
    });
    return 0;
  } catch (error) {
    if (error instanceof AbortedError) {
      console.log(`\n${prompts.t('aborted')}`);
      return 130;
    }
    if (error instanceof InputClosedError) {
      console.log(`\n${prompts.t('inputClosed')}`);
      return 1;
    }
    console.error(
      `\n${prompts.t('unexpected', { message: error instanceof Error ? error.message : String(error) })}`,
    );
    return 1;
  } finally {
    prompts.reader.close();
  }
}

void main().then((code) => {
  process.exitCode = code;
});
