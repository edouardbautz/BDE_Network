#!/usr/bin/env node
// Dumps the PostgreSQL database running in the "postgres" Docker Compose
// service to backups/<timestamp>.sql. Works identically on Windows, Linux
// and macOS: it never shells out through a platform shell, only spawns
// `docker` directly with an argument array.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

const user = process.env.POSTGRES_USER;
const database = process.env.POSTGRES_DB;

if (!user || !database) {
  console.error('POSTGRES_USER and POSTGRES_DB must be set in .env');
  process.exit(1);
}

const backupsDir = join(process.cwd(), 'backups');
await mkdir(backupsDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = join(backupsDir, `${timestamp}.sql`);

console.log(`Backing up database "${database}" to ${outputPath}...`);

const child = spawn(
  'docker',
  ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', user, '--clean', '--if-exists', database],
  { stdio: ['ignore', 'pipe', 'inherit'] },
);

const out = createWriteStream(outputPath);
child.stdout.pipe(out);

child.on('error', (error) => {
  console.error(`Failed to run docker: ${error.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  if (code === 0) {
    console.log('Backup complete.');
  } else {
    console.error(`pg_dump exited with code ${code}`);
    process.exit(code ?? 1);
  }
});
