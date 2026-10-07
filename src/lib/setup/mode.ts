import { startSetupMode } from './guard';

interface Logger {
  log(message: string): void;
}

/** The two lines of the box are written in both languages: nobody has chosen one yet. */
export function setupBanner(code: string, address: string): string {
  const lines = [
    'INSTALLATION DE LA PLATEFORME  ·  PLATFORM SETUP',
    '',
    `1. Ouvrez / Open :              ${address}`,
    `2. Code d'installation / Code : ${code}`,
    '',
    '(Ce code change à chaque démarrage. / This code changes at every start.)',
  ];
  const width = Math.max(...lines.map((line) => [...line].length));
  const bar = '═'.repeat(width + 4);
  const row = (line: string) => `║  ${line}${' '.repeat(width - [...line].length)}  ║`;
  return ['', `╔${bar}╗`, ...lines.map(row), `╚${bar}╝`, ''].join('\n');
}

/**
 * The platform is not installed: the installer opens, protected by a code made now and written to the logs
 * (and so to the terminal of `docker compose up`). `BDE_HOST_PORT` is the port the operator reaches the
 * platform on from this computer (docker-compose.yml passes APP_PORT).
 */
export function enterSetupMode(
  logger: Logger = console,
  env: Record<string, string | undefined> = process.env,
): string {
  const code = startSetupMode();
  const port = env.BDE_HOST_PORT?.trim() || '3000';
  logger.log(setupBanner(code, `http://localhost:${port}`));
  return code;
}
