'use client';

import { useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { RoleFormState } from '@/app/[locale]/(app)/roles/actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/events/field-styles';
import { Link } from '@/i18n/navigation';
import {
  DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  parseRoleInput,
  type RawRoleInput,
  type RoleInputErrors,
} from '@/lib/roles/input';

export interface PermissionOption {
  key: string;
  label: string;
  description: string;
  /** Ticking this one also ticks these (managing a module includes viewing it). */
  implies: string[];
  /** The person editing does not hold it, so cannot give it. */
  locked: boolean;
}

export interface PermissionGroup {
  /** `core` or a module key. */
  section: string;
  title: string;
  options: PermissionOption[];
}

interface RoleFormProps {
  action: (state: RoleFormState, formData: FormData) => Promise<RoleFormState>;
  initial: RawRoleInput;
  groups: PermissionGroup[];
  /** Whether the person editing holds every permission, so may give "all permissions". */
  canGrantAll: boolean;
  submitLabel: string;
  cancelHref: string;
}

function readRawInput(form: HTMLFormElement): RawRoleInput {
  const data = new FormData(form);
  return {
    name: String(data.get('name') ?? ''),
    description: String(data.get('description') ?? ''),
    allPermissions: data.get('allPermissions') === 'on',
    permissions: data.getAll('permissions').map(String),
  };
}

/** Unticking a permission also unticks the ones that include it. */
function untick(checked: Set<string>, key: string, options: PermissionOption[]): Set<string> {
  const next = new Set(checked);
  next.delete(key);
  for (const option of options) {
    if (option.implies.includes(key)) next.delete(option.key);
  }
  return next;
}

export function RoleForm({
  action,
  initial,
  groups,
  canGrantAll,
  submitLabel,
  cancelHref,
}: RoleFormProps) {
  const t = useTranslations('roles');
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(action, {});
  const values = state.values ?? initial;
  const options = groups.flatMap((group) => group.options);

  const [allPermissions, setAllPermissions] = useState(values.allPermissions);
  const [checked, setChecked] = useState(() => new Set(values.permissions));
  const [clientErrors, setClientErrors] = useState<RoleInputErrors | null>(null);
  const [attempt, setAttempt] = useState(0);

  const definitions = groups.flatMap((group) =>
    group.options.map((option) => ({
      key: option.key,
      section: group.section,
      implies: option.implies,
    })),
  );

  const validate = (form: HTMLFormElement): RoleInputErrors => {
    const result = parseRoleInput(readRawInput(form), definitions);
    return result.ok ? {} : result.errors;
  };

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

  useEffect(() => {
    if (attempt > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [attempt]);

  const errors = clientErrors ?? state.fieldErrors ?? {};
  const nameError = errors.name ? t(`form.errors.name.${errors.name}`) : null;
  const descriptionError = errors.description
    ? t(`form.errors.description.${errors.description}`)
    : null;

  const toggle = (option: PermissionOption, on: boolean) => {
    setChecked((current) => {
      if (!on) return untick(current, option.key, options);
      const next = new Set(current);
      next.add(option.key);
      for (const implied of option.implies) next.add(implied);
      return next;
    });
  };

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      onChange={(event) => clientErrors && setClientErrors(validate(event.currentTarget))}
      className="flex flex-col gap-6"
      noValidate
    >
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
        </Alert>
      )}
      {errors.permissions && (
        <Alert variant="destructive">
          <AlertDescription>{t('form.errors.permissions.unknown')}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="grid gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">{t('form.name')}</Label>
            <Input
              id="name"
              name="name"
              defaultValue={values.name}
              maxLength={NAME_MAX_LENGTH}
              required
              aria-required
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'name-error' : 'name-help'}
            />
            <p id="name-help" className="text-muted-foreground text-xs">
              {t('form.nameHelp')}
            </p>
            {nameError && (
              <p id="name-error" className="text-destructive text-xs">
                {nameError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">
              {t('form.description')}{' '}
              <span className="text-muted-foreground font-normal">({t('form.optional')})</span>
            </Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={values.description}
              maxLength={DESCRIPTION_MAX_LENGTH}
              rows={2}
              className="min-h-16"
              aria-invalid={descriptionError ? true : undefined}
              aria-describedby={descriptionError ? 'description-error' : undefined}
            />
            {descriptionError && (
              <p id="description-error" className="text-destructive text-xs">
                {descriptionError}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('form.permissions')}</CardTitle>
          <CardDescription>{t('form.permissionsHelp')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="rounded-lg border p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name="allPermissions"
                checked={allPermissions}
                disabled={!canGrantAll}
                onChange={(event) => setAllPermissions(event.target.checked)}
                aria-describedby="all-help"
                className="accent-primary mt-0.5 size-4"
              />
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t('form.allPermissions')}</span>
                <span id="all-help" className="text-muted-foreground text-xs">
                  {t('form.allPermissionsHelp')}
                </span>
                {!canGrantAll && (
                  <span className="text-muted-foreground text-xs">
                    {t('form.allPermissionsLocked')}
                  </span>
                )}
              </span>
            </label>
          </div>

          {groups.map((group) => (
            <fieldset key={group.section} className="flex flex-col gap-2" disabled={allPermissions}>
              <legend className="mb-1 text-sm font-semibold">{group.title}</legend>
              <ul className="flex flex-col gap-1">
                {group.options.map((option) => {
                  const id = `permission-${option.key.replace(/\W/g, '-')}`;
                  const isChecked = allPermissions || checked.has(option.key);
                  return (
                    <li key={option.key}>
                      <label
                        htmlFor={id}
                        className="hover:bg-muted flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5"
                      >
                        <input
                          id={id}
                          type="checkbox"
                          name="permissions"
                          value={option.key}
                          checked={isChecked}
                          disabled={allPermissions || option.locked}
                          onChange={(event) => toggle(option, event.target.checked)}
                          aria-describedby={`${id}-help`}
                          className="accent-primary mt-0.5 size-4"
                        />
                        <span className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{option.label}</span>
                          <span id={`${id}-help`} className="text-muted-foreground text-xs">
                            {option.description}
                            {option.locked && ` ${t('form.permissionLocked')}`}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
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
