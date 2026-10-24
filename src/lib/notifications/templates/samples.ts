import { causeText, intraChangeLines, intraFacts, intraFieldLines } from '@/lib/events/intra-facts';
import type { IntraContent } from '@/lib/events/intra-request';
import type { NotificationEventData, Translate } from '@/lib/events/messages';
import type { MemberFacts } from '@/lib/members/messages';
import type { TemplateType } from './types';

/**
 * The example a template is shown with: what the editor's preview draws and what a template is tried against before it is saved.
 * Invented, in the language of the BDE, with every fact present so that nothing a template asks to show is missing from the preview.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The example event: in three days, at 20:00 in the BDE's own zone is the editor's concern; the instant here is fixed by `now`. */
export function sampleEvent(
  locale: 'fr' | 'en',
  now: Date,
  type: TemplateType,
  t: Translate,
  timeZone = 'UTC',
): NotificationEventData {
  const fr = locale === 'fr';
  const start = new Date(now.getTime() + 3 * DAY);
  const data: NotificationEventData = {
    eventId: 'sample',
    title: fr ? 'Soirée de rentrée' : 'Back-to-school party',
    description: fr
      ? 'DJ set, photomaton et buffet pour accueillir les nouveaux. Entrée libre pour les membres.'
      : 'DJ set, photo booth and buffet to welcome the new students. Free entry for members.',
    location: fr ? 'Foyer des étudiants' : 'Student lounge',
    categoryLabel: fr ? 'Soirée' : 'Party',
    categoryColor: '#db2777',
    assigneeNames: fr
      ? ['Paula Présidente', 'Sam Secrétaire']
      : ['Paula President', 'Sam Secretary'],
    start,
    end: new Date(start.getTime() + 3.5 * HOUR),
    repeat: fr ? 'Chaque semaine le samedi' : 'Every week on Saturday',
    url: null,
  };
  if (type === 'eventProposed') {
    return { ...data, review: { authorName: 'Camille Martin', reviewerName: null, comment: null } };
  }
  if (type === 'eventApproved') {
    return {
      ...data,
      review: { authorName: 'Camille Martin', reviewerName: 'Paula Martin', comment: null },
    };
  }
  if (type === 'eventRefused') {
    return {
      ...data,
      review: {
        authorName: 'Camille Martin',
        reviewerName: 'Paula Martin',
        comment: fr
          ? 'Le foyer est déjà réservé ce soir-là. Merci de proposer une autre date.'
          : 'The lounge is already booked that evening. Please suggest another date.',
      },
    };
  }
  if (type.startsWith('intra')) {
    const content = sampleIntraContent(data);
    const staff = fr ? 'Sophie Durand' : 'Sophie Dupont';
    switch (type) {
      case 'intraRequested':
        return {
          ...data,
          intra: intraFacts({
            requestedByName: 'Camille Martin',
            fields: intraFieldLines(content, t),
          }),
        };
      case 'intraChanged': {
        const earlier: IntraContent = {
          ...content,
          title: fr ? 'Soirée de rentrée des nouveaux' : 'Welcome party for the new students',
          fields: { ...content.fields, maxPeople: 60 },
        };
        return {
          ...data,
          intra: intraFacts({
            actorName: 'Paula Martin',
            changes: intraChangeLines(earlier, content, t, timeZone),
          }),
        };
      }
      case 'intraCancelled':
        return {
          ...data,
          intra: intraFacts({ actorName: 'Paula Martin', cause: causeText('draft', t) }),
        };
      case 'intraPublished':
        return {
          ...data,
          intra: intraFacts({
            actorName: staff,
            intraUrl: 'https://profile.intra.42.fr/events/12345',
          }),
        };
      default:
        return {
          ...data,
          intra: intraFacts({
            actorName: staff,
            comment: fr
              ? "Le foyer n'est pas disponible sur l'intra ce soir-là. Merci de choisir une autre salle."
              : 'The lounge is not available on the intra that evening. Please choose another room.',
          }),
        };
    }
  }
  return data;
}

/** What the example event is, as the staff is asked to publish it. */
function sampleIntraContent(data: NotificationEventData): IntraContent {
  return {
    title: data.title,
    description: data.description ?? '',
    location: data.location ?? '',
    fields: {
      organizerLogin: 'cmartin',
      audience: 'BOTH',
      maxPeople: 80,
      waitingList: true,
      kind: 'Association',
      unsubscribeHours: 24,
      keywords: ['bde', 'soirée'],
    },
    dates: [{ start: data.start.toISOString(), end: data.end.toISOString() }],
  };
}

/** The example member. */
export function sampleMember(locale: 'fr' | 'en'): MemberFacts {
  return {
    login: 'jdupont',
    fullName: 'Jean Dupont',
    campus: 'Nice',
    photoUrl: null,
    roleName: locale === 'fr' ? 'Trésorier' : 'Treasurer',
    actorName: 'Paula Martin',
  };
}
