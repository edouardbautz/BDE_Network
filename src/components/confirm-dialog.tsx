'use client';

import {
  useId,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import { Textarea } from '@/components/events/field-styles';
import { Spinner } from '@/components/galets/spinner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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

/** A text the person writes before confirming (the reason of a refusal). */
export interface ConfirmField {
  label: string;
  /** What to write, in one short sentence under the label. */
  hint?: ReactNode;
  maxLength: number;
  /** The confirm button stays disabled until something other than spaces is written. */
  required?: boolean;
}

interface ConfirmDialogProps {
  /** A short question or statement: "Retirer ce membre ?". */
  title: string;
  /** One sentence on what happens, and what cannot be undone. */
  description: ReactNode;
  /** The action button: a verb ("Retirer", "Supprimer définitivement"), never "OK". */
  confirmLabel: string;
  /** Runs when the person confirms. The dialog stays open, with the button busy, until it
   * settles (including the navigation of a server action that redirects). `text` is what was written in the
   * `field` (an empty string when there is none). */
  onConfirm: (choice: string, text: string) => unknown | Promise<unknown>;
  /** Asks for a text between the sentence and the buttons, empty each time the dialog opens. */
  field?: ConfirmField;
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
  field,
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
  const [text, setText] = useState('');
  const fieldId = useId();
  const [isPendingNow, startTransition] = useTransition();
  // The action answered with an address to load: busy until the browser replaces the page.
  const [leaving, setLeaving] = useState(false);
  const isPending = isPendingNow || leaving;
  const open = controlledOpen ?? localOpen;
  const firstChoice = choices?.[0]?.value ?? '';

  // Each time the dialog opens, by its button or by its parent, the narrowest choice is the selected one. (Done while
  // rendering, the way React asks for a state that follows another: an effect would draw the old choice first.)
  const resetKey = open ? firstChoice : null;
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    if (open) {
      setChoice(firstChoice);
      setText('');
    }
  }

  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  };

  const handleOpenChange = (next: boolean) => {
    if (isPending) return; // the request is on its way: nothing to cancel any more
    if (!next) onCancel?.();
    setOpen(next);
  };

  const missingText = !!field?.required && text.trim() === '';

  const confirm = () => {
    if (isPending || leaving || missingText) return;
    startTransition(async () => {
      try {
        const answer = await onConfirm(choice, text);
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
      <DialogContent initialFocus={cancelRef} finalFocus={returnFocusRef} closeLabel={t('close')}>
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
                className="bg-surface-2 has-checked:bg-accent-soft text-body flex cursor-pointer items-start gap-3 rounded-lg p-3.5 transition-colors duration-(--dur-fast)"
              >
                <input
                  type="radio"
                  name="confirm-choice"
                  value={option.value}
                  checked={choice === option.value}
                  onChange={() => setChoice(option.value)}
                  className="accent-accent-fill mt-0.5 size-5"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-body-strong">{option.label}</span>
                  {option.hint && (
                    <span className="text-small text-muted-foreground">{option.hint}</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {field && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId}>{field.label}</Label>
            {field.hint && <p className="text-small text-muted-foreground">{field.hint}</p>}
            <Textarea
              id={fieldId}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={field.maxLength}
              required={field.required}
              disabled={isPending}
              rows={4}
            />
          </div>
        )}
        <DialogFooter>
          <DialogClose render={<Button ref={cancelRef} variant="secondary" disabled={isPending} />}>
            {t('cancel')}
          </DialogClose>
          <Button
            variant={tone === 'destructive' ? 'confirm' : 'default'}
            onClick={confirm}
            disabled={isPending || missingText}
            focusableWhenDisabled
            aria-busy={isPending || undefined}
          >
            {isPending && <Spinner />}
            {confirmLabel}
            {isPending && <span className="sr-only"> — {t('working')}</span>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
