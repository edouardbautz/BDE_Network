import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

declare global {
  var prismaClient: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  // A database that does not answer must fail in seconds, not hang the page forever.
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3_000,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalThis.prismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaClient = prisma;
}
