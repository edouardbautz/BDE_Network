import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventFormState } from '@/app/[locale]/(app)/events/actions';
import type { RawEventInput } from '@/lib/events/input';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
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
  recurrence: 'NONE',
  recurrenceUntil: '',
  status: 'DRAFT',
  assigneeLogins: [],
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

function renderForm(initial: RawEventInput) {
  const view = render(
    <EventForm
      action={action}
      initial={initial}
      categories={categories}
      members={members}
      timeZone="Europe/Paris"
      submitLabel="Créer"
      cancelHref="/events"
      isEditing={false}
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

  it('keeps the members in charge, status and recurrence optional', () => {
    renderForm(empty);
    expect(screen.getByLabelText(/form.status/)).not.toBeRequired();
    expect(screen.getByLabelText(/form.recurrence$/)).not.toBeRequired();
    expect(screen.getByRole('checkbox', { name: /Alice A/ })).not.toBeRequired();
    expect(screen.getByText('(form.optional)')).toBeInTheDocument();
  });

  it('requires the series end date only once a recurrence is chosen', () => {
    renderForm(complete);
    expect(screen.queryByLabelText(/form.recurrenceUntil/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/form.recurrence$/), { target: { value: 'WEEKLY' } });
    expect(screen.getByLabelText(/form.recurrenceUntil/)).toBeRequired();
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
