'use client';

import { useState, useTransition, type ComponentProps, type ReactNode } from 'react';
import { Spinner } from '@/components/galets/spinner';
import { Button } from '@/components/ui/button';
import { isActionTarget, type ActionTarget } from '@/lib/action-target';

/**
 * A button that runs a server action which stays on the page, then loads the address the action answers (see
 * lib/action-target.ts: a plain form action would leave the page showing its old state, in the production build).
 * For what asks no question; what is destructive goes through `ConfirmDialog`, which does the same.
 */
export function ActionButton({
  action,
  children,
  variant = 'secondary',
  size = 'sm',
}: {
  action: () => Promise<ActionTarget>;
  children: ReactNode;
} & Pick<ComponentProps<typeof Button>, 'variant' | 'size'>) {
  const [isPending, startTransition] = useTransition();
  // Busy until the browser replaces the page, not only until the action answers.
  const [leaving, setLeaving] = useState(false);
  const busy = isPending || leaving;

  const run = () => {
    if (busy) return;
    startTransition(async () => {
      const answer = await action();
      if (isActionTarget(answer)) {
        setLeaving(true);
        window.location.assign(answer.href);
      }
    });
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={run}
      disabled={busy}
      focusableWhenDisabled
      aria-busy={busy || undefined}
    >
      {busy && <Spinner />}
      {children}
    </Button>
  );
}
