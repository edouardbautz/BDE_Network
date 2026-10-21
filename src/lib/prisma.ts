import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { databasePoolConfig } from '@/lib/database-pool';

declare global {
  var prismaClient: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  // A database that does not answer must fail in seconds, not hang the page forever (see database-pool.ts).
  const adapter = new PrismaPg(databasePoolConfig(process.env.DATABASE_URL));
  return new PrismaClient({ adapter });
}

export const prisma = globalThis.prismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaClient = prisma;
}
