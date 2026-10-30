'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * What a field that takes a secret, or the identifier of a service, must say to a browser and to a password manager: nothing of
 * it is a login. Chrome, Firefox, Safari, Edge and the managers that live in them (and the extensions of 1Password, Bitwarden,
 * LastPass, Dashlane) offer to fill what looks like a login (a text field followed by a password field) and to save what is typed in
 * a password field. A field here is never of the type `password`, so there is no login on the page to fill or to save, and each
 * carries the attributes that tell the managers who read them to leave it alone. `autocomplete="off"` alone was not enough: Chrome
 * and Firefox ignore it on a password field, and the first field of the e-mail (the user) was filled with an address of another site
 * and a saved password put in the webhook of Discord.
 */
export const NO_AUTOFILL = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  spellCheck: false,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

/** A secret typed, drawn as dots by the browser (a text field in the style `-webkit-text-security`, which the three engines have). */
export function MaskedInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      type="text"
      className={cn('font-mono text-small [-webkit-text-security:disc]', className)}
      {...NO_AUTOFILL}
      {...props}
    />
  );
}

/**
 * A secret that may already be saved. Saved, it is not a field at all: the page shows that it is "Configured", with the end of it
 * when the server sent that (never the secret: it does not leave the server), and two buttons, "Replace" (an empty field, to type a new
 * one) and, where there is something to remove, "Remove". Not saved, or being replaced, it is an empty masked field. **Left empty it
 * changes nothing**: the server keeps what it has.
 */
export function SecretField({
  id,
  label,
  saved,
  tail,
  value,
  onChange,
  hint,
  error,
  invalid,
  disabled,
  placeholder,
  onRemove,
  removeLabel,
  children,
}: {
  id: string;
  label: string;
  /** Something is saved (the page only knows whether). */
  saved: boolean;
  /** The last characters of what is saved, when the server judged it safe to say. */
  tail?: string | null;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** "Remove": marks the secret (or its channel) for removal; nothing is forgotten before the Save button. */
  onRemove?: () => void;
  /** What the button is called for a screen reader ("Remove the Discord address"). */
  removeLabel?: string;
  children?: ReactNode;
}) {
  const t = useTranslations('secretField');
  const [replacing, setReplacing] = useState(false);
  // Typed text keeps the field open (a page drawn again with the field filled must not hide what was typed).
  const editing = !saved || replacing || value !== '';
  // Being replaced, the field says what an empty one does; not saved, it says what the caller says.
  const shownHint = saved && editing ? t('leaveEmpty') : hint;
  const hintId = shownHint ? `${id}-hint` : undefined;
  const statusId = `${id}-status`;

  return (
    <div className="flex flex-col gap-1.5">
      {editing ? (
        <Label htmlFor={id}>{label}</Label>
      ) : (
        <span id={`${id}-label`} className="text-body-strong">
          {label}
        </span>
      )}

      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <MaskedInput
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            placeholder={placeholder}
            aria-invalid={invalid}
            aria-describedby={
              [hintId, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined
            }
            className="bg-surface min-w-0 flex-1"
          />
          {saved && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={t('keepLabel', { label })}
              onClick={() => {
                setReplacing(false);
                onChange('');
              }}
            >
              {t('keep')}
            </Button>
          )}
        </div>
      ) : (
        <div
          role="group"
          aria-labelledby={`${id}-label`}
          aria-describedby={statusId}
          className="bg-surface flex flex-wrap items-center justify-between gap-2 rounded-pill px-4 py-2"
        >
          <p id={statusId} className="text-body">
            {tail ? t('configuredTail', { tail }) : t('configured')}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label={t('replaceLabel', { label })}
              onClick={() => setReplacing(true)}
            >
              {t('replace')}
            </Button>
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={removeLabel ?? t('removeLabel', { label })}
                onClick={onRemove}
              >
                {t('remove')}
              </Button>
            )}
          </div>
        </div>
      )}

      {children}
      {shownHint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-small">
          {shownHint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-destructive text-body">
          {error}
        </p>
      )}
    </div>
  );
}
