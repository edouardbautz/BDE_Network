// Prisma configuration used by the production image to apply migrations at
// start-up (`prisma migrate deploy`). The repository's own prisma.config.ts
// loads .env through dotenv and is meant for developers; the image has no
// .env, DATABASE_URL comes from the container environment.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: '/app/prisma/schema.prisma',
  migrations: { path: '/app/prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
});
