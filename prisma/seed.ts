import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { seedDemoEvents } from './seed-events';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DEMO_USERS = [
  {
    login: 'demo-owner',
    fullName: 'Olivia Owner',
    email: 'demo-owner@example.com',
    campus: 'Paris',
    role: 'OWNER' as const,
  },
  {
    login: 'demo-admin',
    fullName: 'Adam Admin',
    email: 'demo-admin@example.com',
    campus: 'Paris',
    role: 'ADMIN' as const,
  },
  {
    login: 'demo-member1',
    fullName: 'Mila Member',
    email: 'demo-member1@example.com',
    campus: 'Paris',
    role: 'MEMBER' as const,
  },
  {
    login: 'demo-member2',
    fullName: 'Marco Member',
    email: 'demo-member2@example.com',
    campus: 'Lyon',
    role: 'MEMBER' as const,
  },
  {
    login: 'demo-pending',
    fullName: 'Priya Pending',
    email: 'demo-pending@example.com',
    campus: 'Paris',
    role: 'PENDING' as const,
  },
];

async function main() {
  console.log('Seeding demo data...');

  const users = new Map<string, { id: string }>();
  for (const data of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { login: data.login },
      update: data,
      create: data,
    });
    users.set(data.login, user);
  }

  const owner = users.get('demo-owner')!;
  const admin = users.get('demo-admin')!;
  const member1 = users.get('demo-member1')!;

  const auditLogCount = await prisma.auditLog.count();
  if (auditLogCount === 0) {
    await prisma.auditLog.createMany({
      data: [
        {
          actorLogin: 'demo-admin',
          actorId: admin.id,
          action: 'member.approve',
          targetType: 'User',
          targetId: member1.id,
          targetLabel: 'demo-member1',
        },
        {
          actorLogin: 'demo-owner',
          actorId: owner.id,
          action: 'member.approve',
          targetType: 'User',
          targetId: admin.id,
          targetLabel: 'demo-admin',
        },
      ],
    });
  }

  console.log(`Seeded ${DEMO_USERS.length} demo users.`);

  await seedDemoEvents(prisma, users);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
