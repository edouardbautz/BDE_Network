import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * An operator's installation, as the guide of upgrading describes it: a folder of the project (checked out at a version) with its
 * `.env` and `bde.config.yml`, a Docker Compose project with its volumes, and the commands `docker compose up -d`,
 * `./scripts/backup.sh` and `./scripts/restore.sh`. The folder is moved from one version to another with `git checkout`, exactly
 * as `git pull` does, and the volumes stay. Every command is started without a shell (arguments, not a command line) and every
 * wait has a deadline.
 */

export const PASSWORD = 'qa-upgrade-password';
export const AUTH_SECRET = 'qa-upgrade-secret-never-used-anywhere-else-0123456789abcdef';

/** The configuration an operator of any version could have written: the keys that exist since 1.0.0 and nothing newer. */
const CONFIG = `bde:
  name: 'BDE Upgrade'
  campus: 'Paris'
  timezone: 'Europe/Paris'
  defaultLocale: 'fr'
  accentColor: '#0f766e'
  logoPath: '/logo.svg'
auth:
  owners:
    - 'qa-owner'
  allowedCampuses:
    - 'Paris'
modules:
  enabled: [events]
events:
  categories:
    - { key: 'soiree', label: 'Soirée', color: '#db2777' }
    - { key: 'sport', label: 'Sport', color: '#16a34a' }
    - { key: 'wei', label: 'WEI', color: '#ea580c' }
    - { key: 'partenariat', label: 'Partenariat', color: '#2563eb' }
  reminderHour: 18
notifications:
  memberPending: 'email'
  memberApproved: 'discord'
  memberRemoved: 'slack'
  eventConfirmed: 'discord'
  eventReminder: 'email'
`;

/**
 * What `CONFIG` says about each notification, as the settings page of the current version must show it after the update: one
 * channel per notification was how every version before 1.5.0 wrote it, and each becomes one ticked box of the table. The
 * labels are the English ones of the page ("type — channel").
 */
export const NOTIFICATION_BOXES = [
  'Access request waiting — E-mail',
  'Request approved — Discord',
  'Member removed — Slack',
  'Event confirmed — Discord',
  'Event reminder — E-mail',
] as const;

export interface Run {
  ok: boolean;
  out: string;
}

export function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Run {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, MSYS_NO_PATHCONV: '1', ...options.env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Stack {
  /** The compose files in use, which change with the version the folder is at. */
  private files: string[] = ['docker-compose.yml'];

  constructor(
    readonly dir: string,
    readonly project: string,
    readonly port: number,
    readonly databasePort: number,
  ) {}

  get base(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get databaseUrl(): string {
    return `postgresql://bde:${PASSWORD}@127.0.0.1:${this.databasePort}/bde_network`;
  }

  /** The environment of every command: the project, and the compose files (the scripts read them from here too). */
  get env(): Record<string, string> {
    return {
      COMPOSE_PROJECT_NAME: this.project,
      COMPOSE_FILE: this.files.join(':'),
      COMPOSE_PATH_SEPARATOR: ':',
    };
  }

  /** What an operator writes once, and keeps through every update. */
  writeEnvironment(): void {
    writeFileSync(
      join(this.dir, '.env'),
      [
        'POSTGRES_USER=bde',
        `POSTGRES_PASSWORD=${PASSWORD}`,
        'POSTGRES_DB=bde_network',
        `DATABASE_URL="postgresql://bde:${PASSWORD}@localhost:5432/bde_network?schema=public"`,
        `AUTH_SECRET=${AUTH_SECRET}`,
        'FORTYTWO_CLIENT_ID=qa-client',
        'FORTYTWO_CLIENT_SECRET=qa-client-secret',
        // what the channels of `CONFIG` need to start: nothing is ever sent to them
        'DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123456789/qa-upgrade',
        'SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T123/B456/qaupgrade',
        'SMTP_HOST=smtp.invalid',
        'SMTP_PORT=587',
        'SMTP_FROM=bde@example.org',
        `APP_URL=http://localhost:${this.port}`,
        'APP_BIND=127.0.0.1',
        `APP_PORT=${this.port}`,
        'ENABLE_DEV_IMPERSONATION=false',
        '',
      ].join('\n'),
    );
  }

  /**
   * The folder is at a version: the configuration is the operator's file (a checkout puts the template back, as `git pull` would
   * if the file were not theirs), and a file of the QA adds what the guide does not have: the database's port to look at it, and,
   * for the compose files that do not mount the configuration themselves, its mount.
   */
  prepare(options: { mountsConfig: boolean; build: boolean }): void {
    writeFileSync(join(this.dir, 'bde.config.yml'), CONFIG);
    const lines = [
      'services:',
      '  postgres:',
      `    ports: ['127.0.0.1:${this.databasePort}:5432']`,
    ];
    if (options.mountsConfig) {
      lines.push('  app:', '    volumes:', '      - ./bde.config.yml:/app/bde.config.yml:ro');
    }
    writeFileSync(join(this.dir, 'qa-override.yml'), `${lines.join('\n')}\n`);
    this.files = options.build
      ? ['docker-compose.yml', 'docker-compose.build.yml', 'qa-override.yml']
      : ['docker-compose.yml', 'qa-override.yml'];
  }

  compose(...args: string[]): Run {
    return run('docker', ['compose', ...args], { cwd: this.dir, env: this.env });
  }

  /** `docker compose up -d` (and the build, for a version whose image is built from its folder). */
  up(options: { build: boolean }): Run {
    return this.compose('up', '-d', ...(options.build ? ['--build'] : []));
  }

  /** One of the folder's scripts (`scripts/backup.sh`, `scripts/restore.sh`), as an operator runs it. */
  script(name: string, ...args: string[]): Run {
    return run('sh', [join('scripts', name), ...args], { cwd: this.dir, env: this.env });
  }

  logs(tail = 60): string {
    return this.compose('logs', '--no-color', '--tail', String(tail), 'app').out;
  }

  async healthy(seconds: number): Promise<number | null> {
    const started = Date.now();
    while (Date.now() - started < seconds * 1000) {
      try {
        const response = await fetch(`${this.base}/api/health`, {
          signal: AbortSignal.timeout(5_000),
          cache: 'no-store',
        });
        await response.text();
        if (response.status === 200) return Date.now() - started;
      } catch {
        // not yet
      }
      await sleep(2_000);
    }
    return null;
  }

  async database<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const deadline = Date.now() + 90_000;
    for (;;) {
      const client = new Client({ connectionString: this.databaseUrl });
      try {
        await client.connect();
        try {
          return await work(client);
        } finally {
          await client.end();
        }
      } catch (error) {
        await client.end().catch(() => {});
        if (Date.now() > deadline) throw error;
        if (
          !/ECONNREFUSED|ECONNRESET|terminated|starting up|the database system/i.test(String(error))
        )
          throw error;
        await sleep(2_000);
      }
    }
  }

  /** The migrations folders the folder's version carries, which the database must have applied once it started. */
  migrationsHere(): number {
    const folder = join(this.dir, 'prisma', 'migrations');
    return existsSync(folder)
      ? readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
      : 0;
  }

  /** Everything this installation made: containers, volumes, the network. */
  down(): void {
    this.compose('down', '-v', '--remove-orphans', '--timeout', '5');
  }

  ensureBackups(): void {
    mkdirSync(join(this.dir, 'backups'), { recursive: true });
  }
}
