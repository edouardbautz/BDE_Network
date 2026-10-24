import { CircleCheck, CircleX, Clock, RefreshCw } from 'lucide-react';
import type { IntraRequestStatus } from '@/generated/prisma/client';
import { Badge } from '@/components/ui/badge';

const STATUS_LOOK = {
  PENDING: { variant: 'warning', Icon: Clock },
  PUBLISHED: { variant: 'success', Icon: CircleCheck },
  OUTDATED: { variant: 'warning', Icon: RefreshCw },
  REFUSED: { variant: 'destructive', Icon: CircleX },
} as const satisfies Record<IntraRequestStatus, unknown>;

/** Where the publication of an event on the intra stands, as a badge (the word is the caller's: it is translated). */
export function IntraStatusBadge({
  status,
  label,
}: {
  status: IntraRequestStatus;
  label: string;
}) {
  const { variant, Icon } = STATUS_LOOK[status];
  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" aria-hidden />
      {label}
    </Badge>
  );
}
