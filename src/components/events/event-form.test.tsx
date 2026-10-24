import type { ComponentProps, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventFormState } from '@/app/[locale]/(app)/events/actions';
import type { RawEventInput } from '@/lib/events/input';
import { rawIntraOf } from '@/lib/events/intra';
import { NO_REPEAT } from '@/lib/events/repeat-input';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
  useLocale: () => 'fr',
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { EventForm } = await import('./event-form');

const categories = [
  { key: 'soiree', label: 'Soirée' },
  { key: 'sport', label: 'Sport' },
];
const members = [{ login: 'alice', name: 'Alice A' }];

const empty: RawEventInput = {
  title: '',
  description: '',
  location: '',
  categoryKey: 'soiree',
  startsAt: '',
  endsAt: '',
  ...NO_REPEAT,
  status: 'DRAFT',
  assigneeLogins: [],
  ...rawIntraOf(null, 'alice'),
};
const complete: RawEventInput = {
  ...empty,
  title: 'Soirée de rentrée',
  description: 'Venez nombreux',
  location: 'Salle B',
  startsAt: '2026-10-10T20:00',
  endsAt: '2026-10-10T23:00',
};

const action = vi.fn(async (): Promise<EventFormState> => ({}));

function renderForm(
  initial: RawEventInput,
  statusChoices: ComponentProps<typeof EventForm>['statusChoices'] = ['DRAFT', 'CONFIRMED'],
  intra = false,
) {
  const view = render(
    <EventForm
      action={action}
      initial={initial}
      categories={categories}
      members={members}
      timeZone="Europe/Paris"
      submitLabel="Créer"
      cancelHref="/events"
      statusChoices={statusChoices}
      isEditing={false}
      intra={intra}
    />,
  );
  return { ...view, form: view.container.querySelector('form') as HTMLFormElement };
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value } });

beforeEach(() => {
  action.mockClear();
});
afterEach(cleanup);

describe('EventForm — required fields', () => {
  it('flags the six required fields, and only those, with a quiet asterisk and aria-required', () => {
    renderForm(empty);

    for (const label of [
      'form.title',
      'form.category',
      'form.startsAt',
      'form.endsAt',
      'form.location',
      'form.description',
    ]) {
      const input = screen.getByLabelText(new RegExp(label));
      expect(input).toBeRequired();
      expect(input).toHaveAttribute('aria-required', 'true');
    }
    // 6 asterisks, decorative (hidden from assistive technology)
    const marks = screen.getAllByText('*', { selector: 'span' });
    expect(marks).toHaveLength(6);
    marks.forEach((mark) => expect(mark).toHaveAttribute('aria-hidden', 'true'));
    expect(screen.getByText('form.requiredLegend')).toBeInTheDocument();
  });

  it('keeps the members in charge, status and repetition optional', () => {
    renderForm(empty);
    expect(screen.getByLabelText(/form.status/)).not.toBeRequired();
    expect(screen.getByLabelText('label')).not.toBeRequired();
    expect(screen.getByRole('checkbox', { name: /Alice A/ })).not.toBeRequired();
    expect(screen.getByText('(form.optional)')).toBeInTheDocument();
  });

  it('asks how the series ends only once a repetition is chosen, and requires the date by default', () => {
    renderForm(complete);
    expect(screen.queryByLabelText('untilLabel')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('label'), { target: { value: 'WEEKLY' } });
    expect(screen.getByLabelText('untilLabel')).toBeEnabled();
    expect(screen.getByLabelText('countLabel')).toBeDisabled();
  });
});

describe('EventForm — validation before sending', () => {
  it('shows an error under every empty required field and does not submit', () => {
    const { form } = renderForm(empty);
    fireEvent.submit(form);

    expect(action).not.toHaveBeenCalled();
    for (const id of ['title', 'description', 'location', 'startsAt', 'endsAt']) {
      const input = document.getElementById(id) as HTMLElement;
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription('form.errors.required');
    }
    // the optional/valid ones are not flagged
    expect(screen.getByLabelText(/form.category/)).not.toHaveAttribute('aria-invalid');
  });

  it('moves the focus to the first field to fix', () => {
    const { form } = renderForm(empty);
    fireEvent.submit(form);
    expect(document.activeElement).toBe(document.getElementById('title'));
  });

  it('treats whitespace-only text as empty', () => {
    const { form } = renderForm({ ...complete, description: '   ', location: '  ' });
    fireEvent.submit(form);

    expect(action).not.toHaveBeenCalled();
    expect(document.getElementById('description')).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('location')).toHaveAttribute('aria-invalid', 'true');
  });

  it('explains an end that is not after the start', () => {
    const { form } = renderForm({ ...complete, endsAt: '2026-10-10T19:00' });
    fireEvent.submit(form);
    expect(document.getElementById('endsAt')).toHaveAccessibleDescription(
      'form.errors.endBeforeStart',
    );
  });

  it('clears each message as soon as the field is fixed', () => {
    const { form } = renderForm(empty);
    fireEvent.submit(form);
    expect(document.getElementById('title')).toHaveAttribute('aria-invalid', 'true');

    type('form.title', 'Soirée');
    expect(document.getElementById('title')).not.toHaveAttribute('aria-invalid');
    expect(document.getElementById('description')).toHaveAttribute('aria-invalid', 'true');
  });

  it('submits once everything required is filled in', () => {
    const { form } = renderForm(complete);
    fireEvent.submit(form);
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('allows submitting without any member in charge', () => {
    const { form } = renderForm({ ...complete, assigneeLogins: [] });
    fireEvent.submit(form);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe('EventForm — the statuses a person may choose', () => {
  const options = () =>
    [...screen.getByLabelText(/form.status/).querySelectorAll('option')].map((o) => o.value);

  it('offers a validator draft and confirmed, with the help that says confirming notifies', () => {
    renderForm(complete);
    expect(options()).toEqual(['DRAFT', 'CONFIRMED']);
    expect(screen.getByText('form.statusHelp')).toBeTruthy();
  });

  it('offers somebody who only proposes draft and proposed, never confirmed, with its own help', () => {
    renderForm({ ...complete, status: 'PROPOSED' }, ['DRAFT', 'PROPOSED']);
    expect(options()).toEqual(['DRAFT', 'PROPOSED']);
    expect((screen.getByLabelText(/form.status/) as HTMLSelectElement).value).toBe('PROPOSED');
    expect(screen.getByText('form.statusHelpProposer')).toBeTruthy();
    expect(screen.queryByText('form.statusHelp')).toBeNull();
  });
});

describe('EventForm — the intra fields', () => {
  const filled = {
    ...complete,
    intraOrganizerLogin: 'alice',
    intraAudience: 'BOTH',
    intraMaxPeople: '60',
    intraWaitingList: 'yes',
    intraKind: 'Meet/meet_up',
    intraUnsubscribeHours: '24',
    intraKeywords: ['bde'],
  };

  it('are not in the form unless the platform publishes on the intra', () => {
    renderForm(complete);
    expect(document.getElementById('intraKind')).toBeNull();
    expect(screen.queryByText('title')).toBeNull();
  });

  it('asks for all of them, each marked required, with the author as organizer', () => {
    renderForm(complete, undefined, true);
    expect(screen.getByText('title')).toBeInTheDocument();
    expect(screen.getByLabelText(/organizer/)).toHaveValue('alice');
    for (const id of [
      'intraOrganizerLogin',
      'intraMaxPeople',
      'intraKind',
      'intraUnsubscribeHours',
      'intraKeywords',
    ]) {
      expect(document.getElementById(id)).toHaveAttribute('aria-required', 'true');
    }
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });

  it('refuses to submit without them and puts the focus on the first one that is missing', () => {
    const { form } = renderForm(complete, undefined, true);
    fireEvent.submit(form);
    expect(action).not.toHaveBeenCalled();
    expect(document.getElementById('intraMaxPeople')).toHaveAccessibleDescription(
      'form.errors.required',
    );
    expect(document.getElementById('intraKind')).toHaveAccessibleDescription(
      'form.errors.required',
    );
    expect(document.querySelector('input[name="intraAudience"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('submits when they are there', () => {
    const { form } = renderForm(filled, undefined, true);
    fireEvent.submit(form);
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('offers the kinds of the intra, grouped, and the audience and waiting list as choices', () => {
    renderForm(filled, undefined, true);
    const select = document.getElementById('intraKind') as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toContain('Speed working/Hackathon');
    expect([...select.querySelectorAll('optgroup')].map((group) => group.label)).toEqual([
      'Pedago',
      'Meet',
      'Speed working',
    ]);
    expect(screen.getByRole('radio', { name: 'audiences.BOTH' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'yes' })).toBeChecked();
  });

  it('adds a keyword with Enter or a comma, once, and removes it with its button', () => {
    renderForm({ ...filled, intraKeywords: [] }, undefined, true);
    const input = document.getElementById('intraKeywords') as HTMLInputElement;
    const hidden = () =>
      [
        ...document.querySelectorAll<HTMLInputElement>(
          'input[name="intraKeywords"][type="hidden"]',
        ),
      ].map((field) => field.value);

    fireEvent.change(input, { target: { value: 'jeux' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'Jeux' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'soirée' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(hidden()).toEqual(['jeux', 'soirée']);

    fireEvent.click(screen.getByRole('button', { name: 'keywordRemove{"word":"jeux"}' }));
    expect(hidden()).toEqual(['soirée']);
  });

  it('tells an event written before them that they are asked now', () => {
    renderForm({ ...complete }, undefined, true);
    expect(screen.queryByText('legacy')).toBeNull();
    cleanup();
    render(
      <EventForm
        action={action}
        initial={complete}
        categories={categories}
        members={members}
        timeZone="Europe/Paris"
        submitLabel="Enregistrer"
        cancelHref="/events"
        statusChoices={['DRAFT']}
        isEditing
        intra
      />,
    );
    expect(screen.getByText('legacy')).toBeInTheDocument();
  });
});

describe('EventForm — the description in Markdown', () => {
  it('previews what is typed as the pages will show it, and keeps the text as typed', () => {
    renderForm({ ...complete, description: '## Titre\n\nUn **mot**' });
    const preview = screen.getByRole('region', { name: 'preview' });
    expect(preview.querySelector('h3')?.textContent).toBe('Titre');
    expect(preview.querySelector('strong')?.textContent).toBe('mot');
    expect(document.getElementById('description')).toHaveValue('## Titre\n\nUn **mot**');

    fireEvent.change(document.getElementById('description') as HTMLElement, {
      target: { value: '<script>x</script>' },
    });
    expect(preview.querySelector('script')).toBeNull();
    expect(preview.textContent).toContain('<script>x</script>');
  });
});
