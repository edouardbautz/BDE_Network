'use client';

import {
  useRef,
  useState,
  useTransition,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type ButtonProps = ComponentProps<typeof Button>;

interface ConfirmDialogProps {
  /** A short question or statement: "Retirer ce membre ?". */
  title: string;
  /** One sentence on what happens, and what cannot be undone. */
  description: ReactNode;
  /** The action button: a verb ("Retirer", "Supprimer définitivement"), never "OK". */
  confirmLabel: string;
  /** Runs when the person confirms. The dialog stays open, with the button busy, until it
   * settles (including the navigation of a server action that redirects). */
  onConfirm: () => unknown | Promise<unknown>;
  /** `destructive` (default) for what cannot be undone; `default` for a change that can. */
  tone?: 'destructive' | 'default';

  /** The content of the button that opens the dialog. Omit it to control the dialog yourself. */
  children?: ReactNode;
  triggerVariant?: ButtonProps['variant'];
  triggerSize?: ButtonProps['size'];
  triggerClassName?: string;
  triggerLabel?: string;

  /** Controlled mode (a menu, a select: there is no button to click). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called when the dialog is dismissed without confirming (Cancel, Escape, a click outside). */
  onCancel?: () => void;
  /** Where focus goes back on close when there is no trigger button (controlled mode). */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * The one confirmation for every destructive or irreversible action (docs/design.md,
 * "Confirmations"): a dialog centered over the page, so the question is never out of view.
 * Focus starts on Cancel, is trapped inside, and returns to where it was on close; Escape and a
 * click outside cancel; while the action runs the confirm button is busy and cannot be pressed
 * twice, and the dialog cannot be dismissed (the request is on its way).
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  tone = 'destructive',
  children,
  triggerVariant = 'destructive',
  triggerSize = 'sm',
  triggerClassName,
  triggerLabel,
  open: controlledOpen,
  onOpenChange,
  onCancel,
  returnFocusRef,
}: ConfirmDialogProps) {
  const t = useTranslations('confirmDialog');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const open = controlledOpen ?? localOpen;

  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  };

  const handleOpenChange = (next: boolean) => {
    if (isPending) return; // the request is on its way: nothing to cancel any more
    if (!next) onCancel?.();
    setOpen(next);
  };

  const confirm = () => {
    if (isPending) return;
    startTransition(async () => {
      try {
        await onConfirm();
      } finally {
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {children !== undefined && (
        <DialogTrigger
          render={
            <Button
              variant={triggerVariant}
              size={triggerSize}
              className={triggerClassName}
              aria-label={triggerLabel}
            />
          }
        >
          {children}
        </DialogTrigger>
      )}
      <DialogContent initialFocus={cancelRef} finalFocus={returnFocusRef}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button ref={cancelRef} variant="outline" disabled={isPending} />}>
            {t('cancel')}
          </DialogClose>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            onClick={confirm}
            disabled={isPending}
            focusableWhenDisabled
            aria-busy={isPending || undefined}
          >
            {isPending && <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />}
            {confirmLabel}
            {isPending && <span className="sr-only"> — {t('working')}</span>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
