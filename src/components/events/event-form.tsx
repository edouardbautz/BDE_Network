'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/navigation';
import type { EventFormState } from '@/app/[locale]/(app)/events/actions';
import type { RawEventInput, EventFormField } from '@/lib/events/input';
import { NativeSelect, Textarea } from './field-styles';

export interface FormCategory {
  key: string;
  label: string;
}

export interface FormMember {
  login: string;
  name: string;
}

interface EventFormProps {
  action: (state: EventFormState, formData: FormData) => Promise<EventFormState>;
  initial: RawEventInput;
  categories: FormCategory[];
  members: FormMember[];
  timeZone: string;
  submitLabel: string;
  cancelHref: string;
  /** Editing: changes apply to every occurrence of a series. */
  isEditing: boolean;
}

const RECURRENCES = ['NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;

export function EventForm({
  action,
  initial,
  categories,
  members,
  timeZone,
  submitLabel,
  cancelHref,
  isEditing,
}: EventFormProps) {
  const t = useTranslations('events');
  const [state, formAction, isPending] = useActionState(action, {});
  const values = state.values ?? initial;
  const [recurrence, setRecurrence] = useState(values.recurrence);

  const error = (field: EventFormField) => {
    const code = state.errors?.[field];
    return code ? t(`form.errors.${code}`) : null;
  };

  const field = (name: EventFormField) => {
    const message = error(name);
    return {
      'aria-invalid': message ? true : undefined,
      'aria-describedby': message ? `${name}-error` : undefined,
    };
  };

  const fieldError = (name: EventFormField) => {
    const message = error(name);
    return message ? (
      <p id={`${name}-error`} className="text-destructive text-xs">
        {message}
      </p>
    ) : null;
  };

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.formError && (
        <Alert variant="destructive">
          <AlertDescription>{t(`form.formErrors.${state.formError}`)}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="title">{t('form.title')}</Label>
            <Input
              id="title"
              name="title"
              defaultValue={values.title}
              maxLength={120}
              required
              {...field('title')}
            />
            {fieldError('title')}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="categoryKey">{t('form.category')}</Label>
            <NativeSelect
              id="categoryKey"
              name="categoryKey"
              defaultValue={values.categoryKey}
              {...field('categoryKey')}
            >
              {categories.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </NativeSelect>
            {fieldError('categoryKey')}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status">{t('form.status')}</Label>
            <NativeSelect
              id="status"
              name="status"
              defaultValue={values.status}
              {...field('status')}
            >
              <option value="DRAFT">{t('status.DRAFT')}</option>
              <option value="CONFIRMED">{t('status.CONFIRMED')}</option>
            </NativeSelect>
            <p className="text-muted-foreground text-xs">{t('form.statusHelp')}</p>
            {fieldError('status')}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startsAt">{t('form.startsAt')}</Label>
            <Input
              id="startsAt"
              name="startsAt"
              type="datetime-local"
              defaultValue={values.startsAt}
              required
              {...field('startsAt')}
            />
            {fieldError('startsAt')}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="endsAt">{t('form.endsAt')}</Label>
            <Input
              id="endsAt"
              name="endsAt"
              type="datetime-local"
              defaultValue={values.endsAt}
              required
              {...field('endsAt')}
            />
            {fieldError('endsAt')}
          </div>
          <p className="text-muted-foreground text-xs sm:col-span-2">
            {t('form.timeZoneHelp', { timeZone })}
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="recurrence">{t('form.recurrence')}</Label>
            <NativeSelect
              id="recurrence"
              name="recurrence"
              value={recurrence}
              onChange={(event) => setRecurrence(event.target.value)}
              {...field('recurrence')}
            >
              {RECURRENCES.map((value) => (
                <option key={value} value={value}>
                  {t(`recurrence.${value}`)}
                </option>
              ))}
            </NativeSelect>
            {fieldError('recurrence')}
          </div>

          {recurrence !== 'NONE' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="recurrenceUntil">{t('form.recurrenceUntil')}</Label>
              <Input
                id="recurrenceUntil"
                name="recurrenceUntil"
                type="date"
                defaultValue={values.recurrenceUntil}
                required
                {...field('recurrenceUntil')}
              />
              <p className="text-muted-foreground text-xs">{t('form.recurrenceUntilHelp')}</p>
              {fieldError('recurrenceUntil')}
            </div>
          )}
          {isEditing && recurrence !== 'NONE' && (
            <p className="text-muted-foreground text-xs sm:col-span-2">{t('form.seriesHelp')}</p>
          )}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="location">{t('form.location')}</Label>
            <Input
              id="location"
              name="location"
              defaultValue={values.location}
              maxLength={200}
              {...field('location')}
            />
            {fieldError('location')}
          </div>

          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">{t('form.inCharge')}</legend>
            <p className="text-muted-foreground text-xs">{t('form.inChargeHelp')}</p>
            <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
              {members.map((member) => (
                <li key={member.login}>
                  <label className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="assignees"
                      value={member.login}
                      defaultChecked={values.assigneeLogins.includes(member.login)}
                      className="accent-primary size-4"
                    />
                    <span className="truncate">{member.name}</span>
                    <span className="text-muted-foreground truncate text-xs">{member.login}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="description">{t('form.description')}</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={values.description}
              maxLength={5000}
              {...field('description')}
            />
            {fieldError('description')}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? t('form.saving') : submitLabel}
        </Button>
        <Button variant="ghost" render={<Link href={cancelHref} />}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}
