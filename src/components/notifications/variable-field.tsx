'use client';

import { useRef } from 'react';
import { Bold, Braces, Italic } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  fromDisplay,
  toDisplay,
  type VariableNames,
} from '@/lib/notifications/templates/variable-names';

export interface VariableChoice {
  id: string;
  /** What the person reads and types between braces. */
  name: string;
  /** What it stands for, in a few words. */
  label: string;
  /** The value in the example, so that the choice is concrete. */
  sample: string;
}

interface VariableFieldProps {
  id: string;
  label: string;
  /** The text as stored (with the identifiers of the variables). */
  value: string;
  onChange: (value: string) => void;
  names: VariableNames;
  choices: VariableChoice[];
  multiline?: boolean;
  placeholder?: string;
  error?: string | null;
  hint?: string;
  disabled?: boolean;
  /** Offers bold and italic (the only formatting a template has). */
  formatting?: boolean;
  /** The text that is not a variable and can be inserted as it is (a mention, say), next to the menu of variables. */
  extra?: React.ReactNode;
}

/**
 * A text of a template: what the person reads is the names of the variables in their own language (`{titre}`), what is stored is
 * the identifiers (`{title}`); the menu inserts a variable where the cursor is, so nobody has to remember a name.
 */
export function VariableField({
  id,
  label,
  value,
  onChange,
  names,
  choices,
  multiline,
  placeholder,
  error,
  hint,
  disabled,
  formatting,
  extra,
}: VariableFieldProps) {
  const t = useTranslations('templates.field');
  const element = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const shown = toDisplay(value, names);

  const write = (text: string, caret: number) => {
    onChange(fromDisplay(text, names));
    // the field now holds the new text: put the cursor after what was inserted
    requestAnimationFrame(() => {
      const field = element.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(caret, caret);
    });
  };

  const insert = (text: string) => {
    const field = element.current;
    const start = field?.selectionStart ?? shown.length;
    const end = field?.selectionEnd ?? shown.length;
    write(shown.slice(0, start) + text + shown.slice(end), start + text.length);
  };

  const wrap = (marker: string) => {
    const field = element.current;
    const start = field?.selectionStart ?? shown.length;
    const end = field?.selectionEnd ?? shown.length;
    const selected = shown.slice(start, end);
    write(
      shown.slice(0, start) + marker + selected + marker + shown.slice(end),
      selected ? end + marker.length * 2 : start + marker.length,
    );
  };

  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  const common = {
    id,
    value: shown,
    disabled,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(fromDisplay(event.target.value, names)),
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea
          {...common}
          ref={(node) => {
            element.current = node;
          }}
          rows={3}
        />
      ) : (
        <Input
          {...common}
          ref={(node) => {
            element.current = node;
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {choices.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={disabled}
              render={<Button type="button" variant="ghost" size="sm" />}
            >
              <Braces aria-hidden="true" />
              {t('insertVariable')}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-72">
              {choices.map((choice) => (
                <DropdownMenuItem
                  key={choice.id}
                  onClick={() => insert(`{${choice.name}}`)}
                  className="flex-col items-start gap-0"
                >
                  <span className="text-body-strong">{`{${choice.name}}`}</span>
                  <span className="text-muted-foreground text-small">
                    {choice.label}
                    {choice.sample ? ` · ${choice.sample}` : ''}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {formatting && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={t('bold')}
              onClick={() => wrap('**')}
            >
              <Bold aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={t('italic')}
              onClick={() => wrap('_')}
            >
              <Italic aria-hidden="true" />
            </Button>
          </>
        )}
        {extra}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-small">
          {hint}
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
