import { Loader2 } from 'lucide-react';

/** The busy indicator of a button (docs/design.md, "Buttons"): a circle of 16 px, 2 px stroke, a turn in 800 ms, in the colour of the text. */
export function Spinner() {
  return (
    <Loader2
      className="size-4 animate-spin [animation-duration:800ms]"
      strokeWidth={2}
      data-icon="inline-start"
      aria-hidden
    />
  );
}
