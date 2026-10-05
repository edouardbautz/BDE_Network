'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Read-only value with a copy button (the calendar subscription link). */
export function CopyField({ id, value, label }: { id: string; value: string; label: string }) {
  const t = useTranslations('profile.calendar');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (insecure context, permissions): select the
      // text instead so the user can copy it by hand.
      (document.getElementById(id) as HTMLInputElement | null)?.select();
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        readOnly
        value={value}
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
        className="font-mono text-xs"
      />
      <Button type="button" variant="outline" onClick={copy} className="shrink-0">
        {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
        <span aria-live="polite">{copied ? t('copied') : t('copy')}</span>
      </Button>
    </div>
  );
}
