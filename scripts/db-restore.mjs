#!/usr/bin/env node
// Restores a backup produced by db-backup.mjs into the "postgres" Docker
// Compose service. Usage: node scripts/db-restore.mjs backups/<file>.sql
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';

const user = process.env.POSTGRES_USER;
const database = process.env.POSTGRES_DB;
const backupPath = process.argv[2];

if (!user || !database) {
  console.error('POSTGRES_USER and POSTGRES_DB must be set in .env');
  process.exit(1);
}

if (!backupPath) {
  console.error('Usage: node scripts/db-restore.mjs <path-to-backup.sql>');
  process.exit(1);
}

try {
  await access(backupPath);
} catch {
  console.error(`File not found: ${backupPath}`);
  process.exit(1);
}

console.log(`Restoring ${backupPath} into database "${database}"...`);
console.log('This overwrites existing data in that database.');

const child = spawn(
  'docker',
  ['compose', 'exec', '-T', 'postgres', 'psql', '-U', user, '-d', database],
  {
    stdio: ['pipe', 'inherit', 'inherit'],
  },
);

createReadStream(backupPath).pipe(child.stdin);

child.on('error', (error) => {
  console.error(`Failed to run docker: ${error.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  if (code === 0) {
    console.log('Restore complete.');
  } else {
    console.error(`psql exited with code ${code}`);
    process.exit(code ?? 1);
  }
});
