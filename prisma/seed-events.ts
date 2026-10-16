import type { PrismaClient } from '../src/generated/prisma/client';
import { getConfig } from '../src/config';
import { bdeConfigSchema, type BdeConfig } from '../src/config/schema';
import { allOccurrences } from '../src/lib/events/recurrence';
import { addDays, fromLocalDateTime, schoolYearOf, toLocalDateTime } from '../src/lib/events/time';

/**
 * `SEED_LOCALE=en` writes the demo events in English (the default is French). Used to take the screenshots of the
 * documentation in both languages; see docs/en/contributing.md.
 */
const ENGLISH: Record<string, string> = {
  'Pot de bienvenue': 'Welcome drinks',
  'Accueil des nouveaux membres du bureau.': 'A warm welcome for the new board members.',
  Foyer: 'Student lounge',
  'Soirée jeux de société': 'Board game night',
  'Jeux de cartes et de plateau. Le bureau apporte les snacks.':
    'Card games and board games. The board brings the snacks.',
  'Salle commune': 'Common room',
  'Rendez-vous partenaire — Café du Coin': 'Partner meeting — Café du Coin',
  'Négociation de la remise étudiante pour la saison.':
    'Negotiating the student discount for the season.',
  'Café du Coin': 'Café du Coin',
  'Grande soirée de rentrée': 'Big back-to-school party',
  'DJ set, bar sans alcool et photobooth. Prévoir 4 personnes pour le montage dès 17h.':
    'DJ set, alcohol-free bar and photo booth. We need 4 people for the set-up from 5 pm.',
  'Salle des fêtes': 'Party hall',
  'Tournoi de foot inter-promos': 'Inter-year football tournament',
  'Huit équipes, élimination directe. Inscriptions des équipes sur place dès 13h30.':
    'Eight teams, knockout rounds. Teams register on the spot from 1:30 pm.',
  'Stade municipal': 'Municipal stadium',
  'Séance de sport hebdomadaire': 'Weekly workout',
  'Footing ou renforcement musculaire, ouvert à tous. La 3ᵉ séance est annulée (salle indisponible).':
    'Jogging or strength training, open to all. The 3rd session is cancelled (room unavailable).',
  Gymnase: 'Gym',
  'Stade de la Plaine': 'Plaine stadium',
  'Match amical contre les anciens': 'Friendly match against the alumni',
  'Permanence du bureau': 'Board office hours',
  'Le bureau reçoit les questions des étudiants et distribue les goodies.':
    'The board answers students’ questions and hands out goodies.',
  'Local du BDE': 'BDE office',
  "Week-end d'intégration (WEI)": 'Integration weekend (WEI)',
  'Départ du parking à 18h le vendredi, retour le dimanche en fin d’après-midi.':
    'Departure from the car park at 6 pm on Friday, back on Sunday late afternoon.',
  'Gîte de la Vallée': 'Valley lodge',
  'Assemblée mensuelle du bureau': 'Monthly board meeting',
  'Point sur le budget, les prochains événements et la répartition des tâches.':
    'Budget review, upcoming events and who does what.',
  'Gala de fin d’année': 'End-of-year gala',
  'Brouillon : lieu et traiteur à confirmer avant de prévenir les membres.':
    'Draft: venue and caterer to confirm before telling the members.',
  'À définir (salle des fêtes ou péniche)': 'To be decided (party hall or river barge)',
  'Sortie ski — à confirmer': 'Ski trip — to be confirmed',
  'Brouillon : en attente du devis du car.': 'Draft: waiting for the coach quote.',
  'Station à définir, départ du parking du campus':
    'Resort to be decided, leaving from the campus car park',
  'Tournoi de jeux vidéo': 'Video game tournament',
  'Proposition du pôle Events : quatre jeux, huit équipes, finale en public.':
    'Proposed by the events team: four games, eight teams, a public final.',
  'Salle informatique': 'Computer room',
  'Soirée karaoké': 'Karaoke night',
  'Proposition du pôle Events : une soirée karaoké au foyer.':
    'Proposed by the events team: a karaoke night in the lounge.',
  'Date trop proche de la soirée de rentrée : propose plutôt le mois suivant.':
    'Too close to the back-to-school party: please suggest the following month.',
};
const tr = (text: string): string =>
  process.env.SEED_LOCALE === 'en' ? (ENGLISH[text] ?? text) : text;

type DemoLogin = 'demo-owner' | 'demo-admin' | 'demo-member1' | 'demo-member2' | 'demo-member3';
type Recurrence = 'NONE' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

interface DemoEvent {
  id: string;
  title: string;
  // Both are required by the event form, so the demo data respects the same rule.
  description: string;
  location: string;
  /** Index into the BDE's configured categories (wraps around). */
  category: number;
  status: 'DRAFT' | 'PROPOSED' | 'CONFIRMED';
  /** A proposal a validator refused: the comment its author reads (the event is then a draft). */
  refusal?: string;
  /** [days from today, hour, minute] on the BDE wall clock. */
  start: [number, number, number];
  end: [number, number, number];
  recurrence?: Recurrence;
  /** Days from today the series runs until (inclusive). */
  repeatUntilDays?: number;
  assignees: DemoLogin[];
  /** 0-based indexes of occurrences to cancel. */
  cancel?: number[];
  /** Dates of a series that were edited on their own (what "only this one" stores). */
  own?: { index: number; title?: string; location?: string; status?: 'DRAFT' | 'CONFIRMED' }[];
  author: DemoLogin;
}

/**
 * The configuration of the BDE: the one saved in the database once the platform is installed (what the
 * installer and the Settings page wrote), the configuration files before that (`npm run dev`).
 */
async function platformConfig(prisma: PrismaClient): Promise<BdeConfig> {
  const row = await prisma.platformSettings.findUnique({ where: { id: 'platform' } });
  const parsed = row ? bdeConfigSchema.safeParse(row.config) : null;
  return parsed?.success ? parsed.data : getConfig();
}

/** Offset (in days) to the next occurrence of `weekday` (0 = Sunday), never today. */
function daysUntilWeekday(weekdayNow: number, weekday: number): number {
  return (weekday - weekdayNow + 7) % 7 || 7;
}

/**
 * Demo events, all relative to the day the seed runs so the calendar always
 * looks alive: one past event, some this week, a weekly series with a
 * cancelled date, a biweekly and a monthly series, a multi-day weekend, two
 * drafts, and two events the events team proposed (one waits, one was refused). Re-running the seed rewrites them (stable ids) instead of
 * duplicating.
 */
export async function seedDemoEvents(
  prisma: PrismaClient,
  users: ReadonlyMap<string, { id: string }>,
): Promise<void> {
  const config = await platformConfig(prisma);
  const categories = config.events?.categories;
  if (!config.modules.enabled.includes('events') || !categories || categories.length === 0) {
    console.log('Events module is not enabled in the config: skipping demo events.');
    return;
  }

  const timeZone = config.bde.timezone;
  const now = new Date();
  const today = toLocalDateTime(now, timeZone);
  const weekdayNow = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  const nextTuesday = daysUntilWeekday(weekdayNow, 2);
  const nextFriday = daysUntilWeekday(weekdayNow, 5);

  const demoEvents: DemoEvent[] = [
    {
      id: 'demo-event-pot',
      title: 'Pot de bienvenue',
      description: 'Accueil des nouveaux membres du bureau.',
      location: 'Foyer',
      category: 0,
      status: 'CONFIRMED',
      start: [-10, 18, 0],
      end: [-10, 21, 0],
      assignees: ['demo-admin'],
      author: 'demo-owner',
    },
    {
      id: 'demo-event-jeux',
      title: 'Soirée jeux de société',
      description: 'Jeux de cartes et de plateau. Le bureau apporte les snacks.',
      location: 'Salle commune',
      category: 0,
      status: 'CONFIRMED',
      start: [1, 19, 0],
      end: [1, 22, 30],
      assignees: ['demo-member1', 'demo-member2'],
      author: 'demo-admin',
    },
    {
      id: 'demo-event-partenaire',
      title: 'Rendez-vous partenaire — Café du Coin',
      description: 'Négociation de la remise étudiante pour la saison.',
      location: 'Café du Coin',
      category: 3,
      status: 'CONFIRMED',
      start: [3, 18, 30],
      end: [3, 19, 30],
      assignees: ['demo-admin'],
      author: 'demo-admin',
    },
    {
      id: 'demo-event-soiree',
      title: 'Grande soirée de rentrée',
      description:
        'DJ set, bar sans alcool et photobooth. Prévoir 4 personnes pour le montage dès 17h.',
      location: 'Salle des fêtes',
      category: 0,
      status: 'CONFIRMED',
      start: [5, 21, 0],
      end: [6, 2, 0],
      assignees: ['demo-member1', 'demo-admin', 'demo-owner'],
      author: 'demo-owner',
    },
    {
      id: 'demo-event-foot',
      title: 'Tournoi de foot inter-promos',
      description:
        'Huit équipes, élimination directe. Inscriptions des équipes sur place dès 13h30.',
      location: 'Stade municipal',
      category: 1,
      status: 'CONFIRMED',
      start: [9, 14, 0],
      end: [9, 18, 0],
      assignees: ['demo-member2'],
      author: 'demo-member1',
    },
    {
      id: 'demo-event-sport',
      title: 'Séance de sport hebdomadaire',
      description:
        'Footing ou renforcement musculaire, ouvert à tous. La 3ᵉ séance est annulée (salle indisponible).',
      location: 'Gymnase',
      category: 1,
      status: 'CONFIRMED',
      start: [nextTuesday, 18, 0],
      end: [nextTuesday, 19, 30],
      recurrence: 'WEEKLY',
      repeatUntilDays: nextTuesday + 7 * 7,
      assignees: ['demo-member2'],
      cancel: [2],
      // The 5th session has its own title and place; the 7th is still a draft.
      own: [
        { index: 4, title: 'Match amical contre les anciens', location: 'Stade de la Plaine' },
        { index: 6, status: 'DRAFT' },
      ],
      author: 'demo-member1',
    },
    {
      id: 'demo-event-permanence',
      title: 'Permanence du bureau',
      description: 'Le bureau reçoit les questions des étudiants et distribue les goodies.',
      location: 'Local du BDE',
      category: 3,
      status: 'CONFIRMED',
      start: [2, 12, 30],
      end: [2, 13, 30],
      recurrence: 'BIWEEKLY',
      repeatUntilDays: 2 + 14 * 4,
      assignees: ['demo-admin', 'demo-member1'],
      author: 'demo-admin',
    },
    {
      id: 'demo-event-wei',
      title: "Week-end d'intégration (WEI)",
      description: 'Départ du parking à 18h le vendredi, retour le dimanche en fin d’après-midi.',
      location: 'Gîte de la Vallée',
      category: 2,
      status: 'CONFIRMED',
      start: [nextFriday + 14, 18, 0],
      end: [nextFriday + 16, 17, 0],
      assignees: ['demo-owner', 'demo-admin', 'demo-member1', 'demo-member2'],
      author: 'demo-owner',
    },
    {
      id: 'demo-event-assemblee',
      title: 'Assemblée mensuelle du bureau',
      description: 'Point sur le budget, les prochains événements et la répartition des tâches.',
      location: 'Local du BDE',
      category: 3,
      status: 'CONFIRMED',
      start: [12, 19, 0],
      end: [12, 20, 30],
      recurrence: 'MONTHLY',
      repeatUntilDays: 12 + 31 * 5,
      assignees: ['demo-owner', 'demo-admin'],
      author: 'demo-owner',
    },
    {
      id: 'demo-event-gala',
      title: 'Gala de fin d’année',
      description: 'Brouillon : lieu et traiteur à confirmer avant de prévenir les membres.',
      location: 'À définir (salle des fêtes ou péniche)',
      category: 0,
      status: 'DRAFT',
      start: [75, 20, 0],
      end: [76, 1, 0],
      assignees: ['demo-owner'],
      author: 'demo-owner',
    },
    {
      id: 'demo-event-ski',
      title: 'Sortie ski — à confirmer',
      description: 'Brouillon : en attente du devis du car.',
      location: 'Station à définir, départ du parking du campus',
      category: 1,
      status: 'DRAFT',
      start: [40, 6, 30],
      end: [40, 19, 0],
      assignees: ['demo-member1'],
      author: 'demo-member1',
    },
    {
      id: 'demo-event-tournoi',
      title: 'Tournoi de jeux vidéo',
      description: 'Proposition du pôle Events : quatre jeux, huit équipes, finale en public.',
      location: 'Salle informatique',
      category: 0,
      status: 'PROPOSED',
      start: [21, 18, 0],
      end: [21, 23, 0],
      assignees: ['demo-member3'],
      author: 'demo-member3',
    },
    {
      id: 'demo-event-karaoke',
      title: 'Soirée karaoké',
      description: 'Proposition du pôle Events : une soirée karaoké au foyer.',
      location: 'Foyer',
      category: 0,
      status: 'DRAFT',
      refusal: 'Date trop proche de la soirée de rentrée : propose plutôt le mois suivant.',
      start: [9, 20, 0],
      end: [9, 23, 30],
      assignees: ['demo-member3'],
      author: 'demo-member3',
    },
  ];

  const at = (offset: [number, number, number]) =>
    fromLocalDateTime(
      { ...addDays(today, offset[0]), hour: offset[1], minute: offset[2] },
      timeZone,
    );

  for (const demo of demoEvents) {
    const category = categories[demo.category % categories.length];
    const author = users.get(demo.author);
    if (!category || !author) continue;

    const startsAt = at(demo.start);
    const endsAt = at(demo.end);
    const recurrence = demo.recurrence ?? 'NONE';
    const recurrenceUntil =
      recurrence !== 'NONE' && demo.repeatUntilDays !== undefined
        ? fromLocalDateTime(
            { ...addDays(today, demo.repeatUntilDays), hour: 23, minute: 59 },
            timeZone,
          )
        : null;

    const data = {
      title: tr(demo.title),
      description: tr(demo.description),
      location: tr(demo.location),
      categoryKey: category.key,
      status: demo.status,
      startsAt,
      endsAt,
      recurrence,
      recurrenceUntil,
      schoolYear: schoolYearOf(startsAt, timeZone),
      // Pretend confirmed events were announced days ago, so the day-before
      // reminder is eligible for the ones starting tomorrow.
      confirmationNotifiedAt:
        demo.status === 'CONFIRMED' ? new Date(now.getTime() - 3 * 86_400_000) : null,
      // A proposal waits since two days; a refused one carries its comment (and never both).
      proposedAt: demo.status === 'PROPOSED' ? new Date(now.getTime() - 2 * 86_400_000) : null,
      refusalComment: demo.refusal ? tr(demo.refusal) : null,
      refusedByLogin: demo.refusal ? 'demo-member1' : null,
      refusedAt: demo.refusal ? new Date(now.getTime() - 86_400_000) : null,
      authorLogin: demo.author,
      authorId: author.id,
    };

    await prisma.event.upsert({
      where: { id: demo.id },
      update: data,
      create: { id: demo.id, ...data },
    });

    await prisma.eventAssignee.deleteMany({ where: { eventId: demo.id } });
    await prisma.eventAssignee.createMany({
      data: demo.assignees.flatMap((login) => {
        const user = users.get(login);
        return user ? [{ eventId: demo.id, login, userId: user.id }] : [];
      }),
    });

    await prisma.eventOccurrence.deleteMany({ where: { eventId: demo.id } });
    if (demo.own && demo.own.length > 0) {
      const occurrences = allOccurrences(
        { startsAt, endsAt, recurrence, recurrenceUntil },
        timeZone,
      );
      for (const own of demo.own) {
        const occurrence = occurrences[own.index];
        if (!occurrence) continue;
        await prisma.eventOccurrence.create({
          data: {
            eventId: demo.id,
            occurrenceStart: occurrence.start,
            title: own.title ? tr(own.title) : null,
            location: own.location ? tr(own.location) : null,
            status: own.status ?? null,
          },
        });
      }
    }

    await prisma.eventCancellation.deleteMany({ where: { eventId: demo.id } });
    if (demo.cancel && demo.cancel.length > 0) {
      const occurrences = allOccurrences(
        { startsAt, endsAt, recurrence, recurrenceUntil },
        timeZone,
      );
      const cancelled = demo.cancel.flatMap((index) => {
        const occurrence = occurrences[index];
        return occurrence
          ? [
              {
                eventId: demo.id,
                occurrenceStart: occurrence.start,
                cancelledByLogin: demo.author,
                cancelledById: author.id,
              },
            ]
          : [];
      });
      await prisma.eventCancellation.createMany({ data: cancelled });
    }
  }

  console.log(`Seeded ${demoEvents.length} demo events.`);
}
