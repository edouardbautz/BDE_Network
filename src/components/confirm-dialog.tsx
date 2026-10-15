'use client';

import {
  useEffect,
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
import { isActionTarget } from '@/lib/action-target';
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

/** One of the ways the action can apply (for a series of events: this date only, or this date and the following). */
export interface ConfirmChoice {
  value: string;
  label: string;
  /** What this choice does, in one short sentence under the label. */
  hint?: ReactNode;
}

interface ConfirmDialogProps {
  /** A short question or statement: "Retirer ce membre ?". */
  title: string;
  /** One sentence on what happens, and what cannot be undone. */
  description: ReactNode;
  /** The action button: a verb ("Retirer", "Supprimer définitivement"), never "OK". */
  confirmLabel: string;
  /** Runs when the person confirms. The dialog stays open, with the button busy, until it
   * settles (including the navigation of a server action that redirects). */
  onConfirm: (choice: string) => unknown | Promise<unknown>;
  /** Asks which way the action applies, with radio buttons between the sentence and the buttons. The first one is
   * selected each time the dialog opens, so the narrowest choice is the default; `onConfirm` receives its value
   * (an empty string when there are no choices). */
  choices?: readonly ConfirmChoice[];
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
  choices,
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
  const [choice, setChoice] = useState(choices?.[0]?.value ?? '');
  const [isPendingNow, startTransition] = useTransition();
  // The action answered with an address to load: busy until the browser replaces the page.
  const [leaving, setLeaving] = useState(false);
  const isPending = isPendingNow || leaving;
  const open = controlledOpen ?? localOpen;
  const firstChoice = choices?.[0]?.value ?? '';

  // Each time the dialog opens, by its button or by its parent, the narrowest choice is the selected one.
  useEffect(() => {
    if (open) setChoice(firstChoice);
  }, [open, firstChoice]);

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
    if (isPending || leaving) return;
    startTransition(async () => {
      try {
        const answer = await onConfirm(choice);
        if (isActionTarget(answer)) {
          // The action stays on the page it was asked on, and says where to look next: load it (see
          // lib/action-target.ts). The dialog stays busy until the page is replaced.
          setLeaving(true);
          window.location.assign(answer.href);
          return;
        }
      } catch (error) {
        setOpen(false);
        throw error;
      }
      setOpen(false);
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
        {choices && choices.length > 0 && (
          <fieldset className="flex flex-col gap-2" disabled={isPending}>
            <legend className="sr-only">{title}</legend>
            {choices.map((option) => (
              <label
                key={option.value}
                className="has-checked:border-primary has-checked:bg-muted flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"
              >
                <input
                  type="radio"
                  name="confirm-choice"
                  value={option.value}
                  checked={choice === option.value}
                  onChange={() => setChoice(option.value)}
                  className="accent-primary mt-0.5 size-4"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{option.label}</span>
                  {option.hint && (
                    <span className="text-muted-foreground text-xs">{option.hint}</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}
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
