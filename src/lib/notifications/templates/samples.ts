import type { NotificationEventData } from '@/lib/events/messages';
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
  return data;
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
