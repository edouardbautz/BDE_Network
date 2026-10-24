import { prisma } from '@/lib/prisma';

/**
 * Who the messages for the school's staff are for: the members whose role **lists** the right to publish on the intra (the staff,
 * given the right on purpose), and, only when there are none, the owners. A role that holds every right (the Admin role) is not
 * the staff: it holds the right by holding everything, and would get every request the BDE sends. Same rule for the e-mails, and for the
 * people the `{@staff}` mention pings on Discord and Slack (those who gave their id on their profile).
 */

/** The right of the staff (`events.intra_publish`, named `EVENTS_INTRA_PUBLISH` in `access.ts`; `intra-audience.test.ts` ties the two). */
export const STAFF_RIGHT = 'events.intra_publish';

export interface StaffAudience {
  /** The accounts' e-mail addresses. */
  emails: string[];
  /** The Discord user ids and the Slack member ids the people gave, for the mention. */
  discordIds: string[];
  slackIds: string[];
  /** The staff is nobody in particular: the owners are asked instead. */
  fallsBackOnOwners: boolean;
}

const select = { email: true, discordUserId: true, slackUserId: true } as const;

function audienceOf(
  people: { email: string; discordUserId: string | null; slackUserId: string | null }[],
  fallsBackOnOwners: boolean,
): StaffAudience {
  const ids = (key: 'discordUserId' | 'slackUserId') => [
    ...new Set(people.flatMap((person) => (person[key] ? [person[key]] : []))),
  ];
  return {
    emails: [...new Set(people.map((person) => person.email))],
    discordIds: ids('discordUserId'),
    slackIds: ids('slackUserId'),
    fallsBackOnOwners,
  };
}

export async function staffAudience(): Promise<StaffAudience> {
  const staff = await prisma.user.findMany({
    where: { status: 'MEMBER', role: { permissions: { has: STAFF_RIGHT } } },
    select,
  });
  if (staff.length > 0) return audienceOf(staff, false);
  const owners = await prisma.user.findMany({ where: { status: 'OWNER' }, select });
  return audienceOf(owners, true);
}
