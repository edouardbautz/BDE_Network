import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { seedDemoEvents } from './seed-events';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** `SEED_LOCALE=en` writes the demo roles and people in English (the default is French). */
const english = process.env.SEED_LOCALE === 'en';
const tr = (fr: string, en: string): string => (english ? en : fr);

/**
 * The two roles every install has (the migration creates them too, with the same ids): "Admin"
 * holds every permission, "Membre" is the default role and can see the events. They are only
 * created when missing: whatever a BDE changed in them is kept.
 */
const DEFAULT_ROLES = [
  {
    id: 'role-admin',
    name: 'Admin',
    description:
      "Tous les droits, y compris ceux des futurs modules, sauf le journal d'audit (réservé aux propriétaires).",
    permissions: [] as string[],
    allPermissions: true,
    isDefault: false,
  },
  {
    id: 'role-member',
    name: 'Membre',
    description: "Consultation. C'est le rôle proposé aux nouveaux membres.",
    permissions: ['events.view'],
    allPermissions: false,
    isDefault: true,
  },
];

/** Demo roles, to try the permissions and their limits (see docs/en/roles.md). */
const DEMO_ROLES = [
  {
    id: 'role-demo-president',
    name: tr('Président', 'President'),
    description: tr(
      'Gère les membres et les rôles, et tout le module Événements.',
      'Manages members and roles, and the whole Events module.',
    ),
    permissions: [
      'members.manage',
      'roles.manage',
      'events.view',
      'events.propose',
      'events.validate',
      'events.shared_calendar',
    ],
  },
  {
    id: 'role-demo-secretary',
    name: tr('Secrétaire', 'Secretary'),
    description: tr(
      "Valide les demandes d'accès et organise les événements.",
      'Approves access requests and organises events.',
    ),
    permissions: ['members.manage', 'events.view', 'events.propose', 'events.validate'],
  },
  {
    id: 'role-demo-events',
    name: tr('Resp. événements', 'Events lead'),
    description: tr(
      "Organise les événements et gère l'agenda partagé.",
      'Organises events and manages the shared calendar.',
    ),
    permissions: ['events.view', 'events.propose', 'events.validate', 'events.shared_calendar'],
  },
  {
    id: 'role-demo-pole',
    name: tr('Pôle Events', 'Events team'),
    description: tr(
      'Propose des événements, que le bureau valide ou refuse.',
      'Proposes events, which the board approves or refuses.',
    ),
    permissions: ['events.view', 'events.propose'],
  },
];

type DemoUser = {
  login: string;
  fullName: string;
  email: string;
  campus: string;
} & ({ status: 'OWNER' | 'PENDING'; roleId?: undefined } | { status: 'MEMBER'; roleId: string });

const DEMO_USERS: DemoUser[] = [
  {
    login: 'demo-owner',
    fullName: 'Olivia Owner',
    email: 'demo-owner@example.com',
    campus: 'Paris',
    status: 'OWNER',
  },
  {
    login: 'demo-admin',
    fullName: 'Adam Admin',
    email: 'demo-admin@example.com',
    campus: 'Paris',
    status: 'MEMBER',
    roleId: 'role-admin',
  },
  {
    login: 'demo-president',
    fullName: tr('Paula Présidente', 'Paula President'),
    email: 'demo-president@example.com',
    campus: 'Paris',
    status: 'MEMBER',
    roleId: 'role-demo-president',
  },
  {
    login: 'demo-secretary',
    fullName: tr('Sam Secrétaire', 'Sam Secretary'),
    email: 'demo-secretary@example.com',
    campus: 'Paris',
    status: 'MEMBER',
    roleId: 'role-demo-secretary',
  },
  {
    login: 'demo-member1',
    fullName: 'Mila Member',
    email: 'demo-member1@example.com',
    campus: 'Paris',
    status: 'MEMBER',
    roleId: 'role-demo-events',
  },
  {
    login: 'demo-member2',
    fullName: 'Marco Member',
    email: 'demo-member2@example.com',
    campus: 'Lyon',
    status: 'MEMBER',
    roleId: 'role-member',
  },
  {
    login: 'demo-member3',
    fullName: 'Pia Pôle',
    email: 'demo-member3@example.com',
    campus: 'Paris',
    status: 'MEMBER',
    roleId: 'role-demo-pole',
  },
  {
    login: 'demo-pending',
    fullName: 'Priya Pending',
    email: 'demo-pending@example.com',
    campus: 'Paris',
    status: 'PENDING',
  },
];

async function main() {
  console.log('Seeding demo data...');

  for (const role of DEFAULT_ROLES) {
    await prisma.role.upsert({ where: { id: role.id }, update: {}, create: role });
  }
  for (const role of DEMO_ROLES) {
    await prisma.role.upsert({
      where: { id: role.id },
      update: {},
      create: { ...role, allPermissions: false, isDefault: false },
    });
  }

  const users = new Map<string, { id: string }>();
  for (const data of DEMO_USERS) {
    const account = { ...data, roleId: data.roleId ?? null };
    const user = await prisma.user.upsert({
      where: { login: data.login },
      update: account,
      create: account,
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
