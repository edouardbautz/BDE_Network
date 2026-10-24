'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/** Puts the text on the clipboard. The clipboard API needs a secure page (an installation without HTTPS has none): the old way
 * through a hidden field is the fallback. Resolves to whether it worked. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refused (permission, insecure page): try the other way
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/**
 * Copies one value, for the staff who fills the intra's form field by field. The button shows "Copy" and a screen reader hears
 * which field ("Copy Start time": the visible word is part of the name), "Copied" shows for two seconds, and it is a plain button
 * (no navigation, nothing sent).
 */
export function CopyButton({
  value,
  fieldName,
  copyLabel,
  copiedLabel,
  failedLabel,
}: {
  value: string;
  fieldName: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const shown = state === 'copied' ? copiedLabel : state === 'failed' ? failedLabel : copyLabel;

  const copy = async () => {
    const worked = await copyText(value);
    setState(worked ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      // the visible word first, then the field: the name contains what is seen
      aria-label={`${shown} ${fieldName}`}
    >
      {state === 'copied' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      <span aria-live="polite">{shown}</span>
    </Button>
  );
}
