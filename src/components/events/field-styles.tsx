import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Native <select> and <textarea> styled like the shadcn <Input>. Native
 * controls are deliberate here: they work without JavaScript inside plain GET
 * filter forms and give mobile users their platform pickers.
 */
const CONTROL =
  'w-full rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30';

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(CONTROL, 'h-8 py-0', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(CONTROL, 'min-h-24 py-2', className)} {...props} />;
}
