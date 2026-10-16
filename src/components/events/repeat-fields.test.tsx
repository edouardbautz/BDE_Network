import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import fr from '../../../messages/fr.json';
import { NO_REPEAT, type RawRepeat, type RepeatField } from '@/lib/events/repeat-input';
import { RepeatFields } from './repeat-fields';

afterEach(cleanup);

// The real messages, the real formatter: what a member reads is what is tested.
function renderFields({
  locale = 'fr',
  values = NO_REPEAT,
  startsAt = '2026-10-10T20:00',
  endsAt = '2026-10-10T22:00',
  error = () => null,
}: {
  locale?: 'fr' | 'en';
  values?: RawRepeat;
  startsAt?: string;
  endsAt?: string;
  error?: (field: RepeatField) => string | null;
} = {}) {
  const view = render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      <form data-testid="form">
        <RepeatFields
          values={values}
          startsAt={startsAt}
          endsAt={endsAt}
          timeZone="Europe/Paris"
          error={error}
        />
      </form>
    </NextIntlClientProvider>,
  );
  return {
    ...view,
    select: () => screen.getByLabelText('Répétition') as HTMLSelectElement,
    choose: (value: string) =>
      fireEvent.change(screen.getByLabelText(locale === 'fr' ? 'Répétition' : 'Repeat'), {
        target: { value },
      }),
    posted: () => {
      const data = new FormData(screen.getByTestId('form') as HTMLFormElement);
      return Object.fromEntries(
        [...new Set([...data.keys()])].map((key) => {
          const all = data.getAll(key).map(String);
          return [key, all.length === 1 ? all[0] : all];
        }),
      );
    },
  };
}

const labels = (select: HTMLSelectElement) =>
  [...select.options].map((option) => [option.value, option.textContent]);

describe('RepeatFields — the list of choices', () => {
  it('words each choice from the first date typed (Saturday 10 October, the 2nd of its month)', () => {
    const { select } = renderFields();
    expect(labels(select())).toEqual([
      ['NONE', 'Ne se répète pas'],
      ['DAILY', 'Tous les jours'],
      ['WEEKDAYS', 'Tous les jours de la semaine (du lundi au vendredi)'],
      ['WEEKLY', 'Toutes les semaines le samedi'],
      ['MONTHLY', 'Tous les mois le 10'],
      ['MONTHLY_NTH', 'Tous les mois le 2ᵉ samedi'],
      ['YEARLY', 'Tous les ans le 10 octobre'],
      ['CUSTOM', 'Personnalisée…'],
    ]);
  });

  it('says "the last" for a first date that is a 5th weekday, and follows the date when it changes', () => {
    const { select, rerender } = renderFields({ startsAt: '2026-10-31T20:00' });
    expect(labels(select()).find(([value]) => value === 'MONTHLY_NTH')?.[1]).toBe(
      'Tous les mois le dernier samedi',
    );

    rerender(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <form data-testid="form">
          <RepeatFields
            values={NO_REPEAT}
            startsAt="2026-10-14T20:00"
            endsAt="2026-10-14T22:00"
            timeZone="Europe/Paris"
            error={() => null}
          />
        </form>
      </NextIntlClientProvider>,
    );
    expect(labels(select()).find(([value]) => value === 'WEEKLY')?.[1]).toBe(
      'Toutes les semaines le mercredi',
    );
  });

  it('is in English for an English page', () => {
    renderFields({ locale: 'en' });
    const options = [...(screen.getByLabelText('Repeat') as HTMLSelectElement).options].map(
      (option) => option.textContent,
    );
    expect(options).toEqual([
      'Does not repeat',
      'Every day',
      'Every weekday (Monday to Friday)',
      'Every week on Saturday',
      'Every month on the 10th',
      'Every month on the 2nd Saturday',
      'Every year on October 10th',
      'Custom…',
    ]);
  });

  it('does not ask how it ends, and posts nothing but "does not repeat", until a repetition is chosen', () => {
    const { posted } = renderFields();
    expect(screen.queryByText('Fin de la répétition')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(posted()).toEqual({ repeat: 'NONE' });
  });

  it('starts from the choice of the event being edited', () => {
    const { select } = renderFields({
      values: { ...NO_REPEAT, repeat: 'WEEKLY', recurrenceUntil: '2026-10-31' },
    });
    expect(select().value).toBe('WEEKLY');
    expect(screen.getByLabelText('Date de fin (ce jour est inclus)')).toHaveValue('2026-10-31');
  });
});

describe('RepeatFields — how the series ends', () => {
  it('ends on a date by default, and the number of dates is off until chosen', () => {
    const { choose } = renderFields();
    choose('WEEKLY');

    const until = screen.getByLabelText('Date de fin (ce jour est inclus)');
    const count = screen.getByLabelText("Nombre d'occurrences");
    expect(screen.getByRole('radio', { name: 'Le' })).toBeChecked();
    expect(until).toBeEnabled();
    expect(count).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Après' }));
    expect(until).toBeDisabled();
    expect(count).toBeEnabled();
  });

  it('tells the limit of an event', () => {
    const { choose } = renderFields();
    choose('DAILY');
    expect(screen.getByText(/Au plus 400 dates/)).toBeInTheDocument();
  });

  it('posts what the server reads', () => {
    const { choose, posted } = renderFields();
    choose('WEEKLY');
    fireEvent.change(screen.getByLabelText('Date de fin (ce jour est inclus)'), {
      target: { value: '2026-12-19' },
    });
    expect(posted()).toMatchObject({
      repeat: 'WEEKLY',
      repeatEnd: 'until',
      recurrenceUntil: '2026-12-19',
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Après' }));
    fireEvent.change(screen.getByLabelText("Nombre d'occurrences"), { target: { value: '8' } });
    expect(posted()).toMatchObject({ repeatEnd: 'count', repeatCount: '8' });
  });
});

describe('RepeatFields — the preview', () => {
  it('says the rule, the next dates and how many there are', () => {
    const { choose } = renderFields();
    choose('WEEKLY');
    fireEvent.change(screen.getByLabelText('Date de fin (ce jour est inclus)'), {
      target: { value: '2026-10-31' },
    });

    const preview = screen.getByRole('status', { name: 'Aperçu' });
    expect(
      within(preview).getByText(/Toutes les semaines le samedi, jusqu'au 31 octobre 2026/),
    ).toBeInTheDocument();
    expect(preview).toHaveTextContent(
      'Prochaines dates : samedi 10 octobre 2026 · samedi 17 octobre 2026 · samedi 24 octobre 2026 · 4 dates au total',
    );
    expect(preview).toHaveAttribute('aria-live', 'polite');
  });

  it('says that the first date moves to the first one that fits the rule', () => {
    const { choose } = renderFields();
    choose('CUSTOM');
    // the custom panel starts from the weekday of the first date (Saturday): ask for Monday instead
    fireEvent.click(screen.getByRole('checkbox', { name: 'samedi' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'lundi' }));
    fireEvent.change(screen.getByLabelText('Date de fin (ce jour est inclus)'), {
      target: { value: '2026-11-30' },
    });

    expect(screen.getByRole('status', { name: 'Aperçu' })).toHaveTextContent(
      'La première date devient le lundi 12 octobre 2026, premier jour qui correspond à cette répétition.',
    );
  });

  it('says what is wrong, in the language of the page, instead of dates', () => {
    const { choose } = renderFields();
    choose('WEEKLY');
    fireEvent.change(screen.getByLabelText('Date de fin (ce jour est inclus)'), {
      target: { value: '2026-10-01' },
    });
    expect(screen.getByRole('status', { name: 'Aperçu' })).toHaveTextContent(
      fr.events.form.errors.untilBeforeStart,
    );
  });

  it('shows no preview while the first date is not typed', () => {
    const { choose } = renderFields({ startsAt: '', endsAt: '' });
    choose('WEEKLY');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // and the list is still worded, from a day of reference
    expect(screen.getByLabelText('Répétition')).toBeInTheDocument();
  });
});

describe('RepeatFields — custom', () => {
  it('opens a panel that starts from the weekday of the first date', () => {
    const { choose } = renderFields();
    expect(
      screen.queryByRole('group', { name: 'Répétition personnalisée' }),
    ).not.toBeInTheDocument();
    choose('CUSTOM');

    const panel = screen.getByRole('group', { name: 'Répétition personnalisée' });
    expect(within(panel).getByLabelText(/Répéter tous les/)).toHaveValue(1);
    expect(within(panel).getByLabelText('Unité')).toHaveValue('WEEKLY');
    expect(within(panel).getByRole('checkbox', { name: 'samedi' })).toBeChecked();
    expect(within(panel).getByRole('checkbox', { name: 'lundi' })).not.toBeChecked();
  });

  it('words the unit by the number: "every 1 week", "every 2 weeks"', () => {
    const { choose } = renderFields();
    choose('CUSTOM');
    const unit = screen.getByLabelText('Unité') as HTMLSelectElement;
    const names = () => [...unit.options].map((option) => option.textContent);
    expect(names()).toEqual(['jour', 'semaine', 'mois', 'an']);
    fireEvent.change(screen.getByLabelText(/Répéter tous les/), { target: { value: '2' } });
    expect(names()).toEqual(['jours', 'semaines', 'mois', 'ans']);
  });

  it('offers the days of the week for a week, the day of the month for a month, nothing for a day', () => {
    const { choose } = renderFields();
    choose('CUSTOM');
    expect(screen.getAllByRole('checkbox')).toHaveLength(7);

    fireEvent.change(screen.getByLabelText('Unité'), { target: { value: 'MONTHLY' } });
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getAllByRole('radio', { name: /^(le|Le)/ }).length).toBeGreaterThanOrEqual(4);

    fireEvent.change(screen.getByLabelText('Unité'), { target: { value: 'DAILY' } });
    expect(screen.queryByText('Quel jour')).not.toBeInTheDocument();
    expect(screen.queryByText('Les jours de la semaine')).not.toBeInTheDocument();
  });

  it('offers for a month: the day, the weekday of the month, the last of it, the last day', () => {
    const { choose } = renderFields();
    choose('CUSTOM');
    fireEvent.change(screen.getByLabelText('Unité'), { target: { value: 'MONTHLY' } });
    const legend = screen.getByText('Quel jour');
    const group = legend.closest('fieldset') as HTMLElement;
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['le 10', 'le 2ᵉ samedi', 'le dernier samedi', 'le dernier jour du mois']);
  });

  it('does not offer "the 5th Saturday", which not every month has', () => {
    const { choose } = renderFields({ startsAt: '2026-10-31T20:00' });
    choose('CUSTOM');
    fireEvent.change(screen.getByLabelText('Unité'), { target: { value: 'MONTHLY' } });
    const group = screen.getByText('Quel jour').closest('fieldset') as HTMLElement;
    const options = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.textContent);
    expect(options).toEqual(['le 31', 'le dernier samedi', 'le dernier jour du mois']);
  });

  it('posts the weekdays one by one, and the choices of the panel', () => {
    const { choose, posted } = renderFields();
    choose('CUSTOM');
    fireEvent.click(screen.getByRole('checkbox', { name: 'mercredi' }));
    fireEvent.change(screen.getByLabelText(/Répéter tous les/), { target: { value: '2' } });

    expect(posted()).toMatchObject({
      repeat: 'CUSTOM',
      repeatFreq: 'WEEKLY',
      repeatInterval: '2',
      repeatWeekdays: ['WE', 'SA'],
    });
  });

  it('gives the example of the specification: every 2 weeks on Monday and Wednesday, 10 times', () => {
    const { choose } = renderFields();
    choose('CUSTOM');
    fireEvent.change(screen.getByLabelText(/Répéter tous les/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'samedi' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'lundi' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'mercredi' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Après' }));
    fireEvent.change(screen.getByLabelText("Nombre d'occurrences"), { target: { value: '10' } });

    const preview = screen.getByRole('status', { name: 'Aperçu' });
    expect(preview).toHaveTextContent('Toutes les 2 semaines le lundi et le mercredi, 10 fois');
    expect(preview).toHaveTextContent('10 dates au total');
  });
});

describe('RepeatFields — errors', () => {
  it('shows the error of a field next to it, and marks the field', () => {
    renderFields({
      values: { ...NO_REPEAT, repeat: 'CUSTOM', repeatFreq: 'WEEKLY', repeatInterval: '0' },
      error: (field) => (field === 'repeatInterval' ? 'Intervalle invalide' : null),
    });
    const input = screen.getByLabelText(/Répéter tous les/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Intervalle invalide');
  });

  it('marks nothing when there is no error', () => {
    renderFields({
      values: { ...NO_REPEAT, repeat: 'CUSTOM', repeatFreq: 'WEEKLY', repeatWeekdays: ['SA'] },
    });
    expect(screen.getByLabelText(/Répéter tous les/)).not.toHaveAttribute('aria-invalid');
  });
});
