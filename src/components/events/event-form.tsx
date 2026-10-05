'use client';

import { useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/navigation';
import type { EventFormState } from '@/app/[locale]/(app)/events/actions';
import {
  DESCRIPTION_MAX_LENGTH,
  LOCATION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  parseEventInput,
  type EventFormErrors,
  type EventFormField,
  type RawEventInput,
} from '@/lib/events/input';
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

function readRawInput(form: HTMLFormElement): RawEventInput {
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) ?? '');
  return {
    title: text('title'),
    description: text('description'),
    location: text('location'),
    categoryKey: text('categoryKey'),
    startsAt: text('startsAt'),
    endsAt: text('endsAt'),
    recurrence: text('recurrence'),
    recurrenceUntil: text('recurrenceUntil'),
    status: text('status'),
    assigneeLogins: data.getAll('assignees').map(String),
  };
}

/** Label of a required field: a quiet asterisk, hidden from screen readers
 * (the input itself carries `required`), explained by the legend above the form. */
function FieldLabel({
  htmlFor,
  required = false,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor}>
      {children}
      {required && (
        <span aria-hidden className="text-muted-foreground -ml-1">
          *
        </span>
      )}
    </Label>
  );
}

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
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(action, {});
  const values = state.values ?? initial;
  const [recurrence, setRecurrence] = useState(values.recurrence);
  // Errors found in the browser before sending; null until a first failed attempt.
  const [clientErrors, setClientErrors] = useState<EventFormErrors | null>(null);
  const [attempt, setAttempt] = useState(0);

  const validate = (form: HTMLFormElement): EventFormErrors => {
    const result = parseEventInput(readRawInput(form), {
      timeZone,
      categoryKeys: categories.map((category) => category.key),
    });
    return result.ok ? {} : result.errors;
  };

  // Same rules as the server (which re-checks everything): stop here if invalid.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const errors = validate(event.currentTarget);
    if (Object.keys(errors).length > 0) {
      event.preventDefault();
      setClientErrors(errors);
      setAttempt((count) => count + 1);
    } else {
      setClientErrors(null);
    }
  };

  // After a refused submit, put the cursor on the first field to fix.
  useEffect(() => {
    if (attempt > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [attempt]);

  const errors = clientErrors ?? state.errors ?? {};

  const error = (field: EventFormField) => {
    const code = errors[field];
    return code ? t(`form.errors.${code}`) : null;
  };

  const field = (name: EventFormField, required = false) => {
    const message = error(name);
    return {
      required,
      'aria-required': required || undefined,
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
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      // Once a first attempt failed, keep the messages in step with what is typed.
      onChange={(event) => clientErrors && setClientErrors(validate(event.currentTarget))}
      className="flex flex-col gap-6"
      noValidate
    >
      {state.formError && (
        <Alert variant="destructive">
          <AlertDescription>{t(`form.formErrors.${state.formError}`)}</AlertDescription>
        </Alert>
      )}

      <p className="text-muted-foreground text-xs">{t('form.requiredLegend')}</p>

      <Card>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <FieldLabel htmlFor="title" required>
              {t('form.title')}
            </FieldLabel>
            <Input
              id="title"
              name="title"
              defaultValue={values.title}
              maxLength={TITLE_MAX_LENGTH}
              {...field('title', true)}
            />
            {fieldError('title')}
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="categoryKey" required>
              {t('form.category')}
            </FieldLabel>
            <NativeSelect
              id="categoryKey"
              name="categoryKey"
              defaultValue={values.categoryKey}
              {...field('categoryKey', true)}
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
            <FieldLabel htmlFor="status">{t('form.status')}</FieldLabel>
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
            <FieldLabel htmlFor="startsAt" required>
              {t('form.startsAt')}
            </FieldLabel>
            <Input
              id="startsAt"
              name="startsAt"
              type="datetime-local"
              defaultValue={values.startsAt}
              {...field('startsAt', true)}
            />
            {fieldError('startsAt')}
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="endsAt" required>
              {t('form.endsAt')}
            </FieldLabel>
            <Input
              id="endsAt"
              name="endsAt"
              type="datetime-local"
              defaultValue={values.endsAt}
              {...field('endsAt', true)}
            />
            {fieldError('endsAt')}
          </div>
          <p className="text-muted-foreground text-xs sm:col-span-2">
            {t('form.timeZoneHelp', { timeZone })}
          </p>

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="recurrence">{t('form.recurrence')}</FieldLabel>
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
              <FieldLabel htmlFor="recurrenceUntil" required>
                {t('form.recurrenceUntil')}
              </FieldLabel>
              <Input
                id="recurrenceUntil"
                name="recurrenceUntil"
                type="date"
                defaultValue={values.recurrenceUntil}
                {...field('recurrenceUntil', true)}
              />
              <p className="text-muted-foreground text-xs">{t('form.recurrenceUntilHelp')}</p>
              {fieldError('recurrenceUntil')}
            </div>
          )}
          {isEditing && recurrence !== 'NONE' && (
            <p className="text-muted-foreground text-xs sm:col-span-2">{t('form.seriesHelp')}</p>
          )}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <FieldLabel htmlFor="location" required>
              {t('form.location')}
            </FieldLabel>
            <Input
              id="location"
              name="location"
              defaultValue={values.location}
              maxLength={LOCATION_MAX_LENGTH}
              {...field('location', true)}
            />
            {fieldError('location')}
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <FieldLabel htmlFor="description" required>
              {t('form.description')}
            </FieldLabel>
            <Textarea
              id="description"
              name="description"
              defaultValue={values.description}
              maxLength={DESCRIPTION_MAX_LENGTH}
              {...field('description', true)}
            />
            {fieldError('description')}
          </div>

          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">
              {t('form.inCharge')}{' '}
              <span className="text-muted-foreground font-normal">({t('form.optional')})</span>
            </legend>
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
