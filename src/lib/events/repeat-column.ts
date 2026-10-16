import { Prisma } from '@/generated/prisma/client';
import type { RepeatRule } from './repeat';

/**
 * What goes in `Event.repeat` for a rule: the rule itself, or a database NULL for an event that does not repeat
 * (not JSON `null`: a series is told from the others by `repeat IS NULL`, which the database checks).
 */
export function repeatColumn(
  rule: RepeatRule | null,
): Prisma.InputJsonObject | typeof Prisma.DbNull {
  return rule ? { ...rule } : Prisma.DbNull;
}
