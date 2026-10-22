'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  type NotificationEvent,
} from '@/config/schema';
import {
  MATRIX_GROUPS,
  clearRows,
  columnState,
  isOffered,
  isTickable,
  setCell,
  setColumn,
  type Configured,
  type MatrixGroup,
} from '@/lib/setup/notification-matrix';
import type { NotificationMatrix } from '@/lib/setup/notifications';

/**
 * The table of the notifications: one row per type, one column per channel, a box where a type goes through a channel. A column
 * can only be ticked when its channel is configured; a type with no box ticked sends nothing. Above it, the shortcuts that tick
 * (or clear) a whole column. Under 640 px the table is a list (the `Table` primitive): each type is a block and its boxes
 * are lines of at least 44 px, so nothing scrolls sideways on a phone.
 */
export function NotificationTable({
  matrix,
  onChange,
  configured,
  events,
}: {
  matrix: NotificationMatrix;
  onChange: (matrix: NotificationMatrix) => void;
  configured: Configured;
  /** Whether the events module is on: its types are shown only then (what they hold is kept). */
  events: boolean;
}) {
  const t = useTranslations('setup.notifications');
  const groups = (Object.keys(MATRIX_GROUPS) as MatrixGroup[]).filter(
    (group) => group === 'members' || events,
  );
  const rows = groups.flatMap((group) => MATRIX_GROUPS[group]) as NotificationEvent[];

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t('shortcuts')} className="flex flex-wrap items-center gap-2">
        <span className="text-small text-muted-foreground">{t('shortcuts')}</span>
        {NOTIFICATION_CHANNELS.map((channel) => {
          const state = columnState(matrix, channel, rows, configured);
          const all = state === 'all';
          return (
            <Button
              key={channel}
              type="button"
              variant="secondary"
              size="sm"
              disabled={!configured[channel]}
              onClick={() => onChange(setColumn(matrix, channel, rows, configured, !all))}
            >
              {t(all ? 'uncheckColumn' : 'checkColumn', { channel: t(`channelNames.${channel}`) })}
            </Button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(clearRows(matrix, rows))}
          disabled={rows.every((event) => matrix[event].length === 0)}
        >
          {t('clearAll')}
        </Button>
      </div>

      <Table aria-describedby="setup-notifications-matrix-help">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('typeColumn')}</TableHead>
            {NOTIFICATION_CHANNELS.map((channel) => (
              <TableHead key={channel} scope="col" className="text-center">
                <span className="block">{t(`channelNames.${channel}`)}</span>
                {!configured[channel] && (
                  <span className="text-small text-muted-foreground block font-normal">
                    {t('notConfigured')}
                  </span>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        {groups.map((group) => (
          <TableBody key={group}>
            <TableRow>
              <TableCell
                colSpan={1 + NOTIFICATION_CHANNELS.length}
                className="text-caption text-muted-foreground pt-4 pb-1 sm:h-9"
              >
                {t(`types.groups.${group}`)}
              </TableCell>
            </TableRow>
            {MATRIX_GROUPS[group].map((event) => (
              <TableRow key={event}>
                <TableCell className="whitespace-normal">
                  <span className="text-body-strong block">{t(`types.${event}.name`)}</span>
                  <span className="text-muted-foreground text-small block font-normal">
                    {t(`types.${event}.hint`)}
                  </span>
                </TableCell>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <Cell
                    key={channel}
                    event={event}
                    channel={channel}
                    checked={matrix[event].includes(channel)}
                    tickable={isTickable(event, channel, configured)}
                    onToggle={(on) => onChange(setCell(matrix, event, channel, on))}
                  />
                ))}
              </TableRow>
            ))}
          </TableBody>
        ))}
      </Table>
    </div>
  );
}

function Cell({
  event,
  channel,
  checked,
  tickable,
  onToggle,
}: {
  event: NotificationEvent;
  channel: NotificationChannel;
  checked: boolean;
  tickable: boolean;
  onToggle: (on: boolean) => void;
}) {
  const t = useTranslations('setup.notifications');
  const channelName = t(`channelNames.${channel}`);

  // The e-mail of a member who was just removed does not exist: a sentence says why instead of a box.
  if (!isOffered(event, channel)) {
    return (
      <TableCell className="text-center">
        <span className="text-muted-foreground text-small max-sm:block">
          <span className="sm:sr-only">{channelName} : </span>
          {t('types.memberRemovedNoEmail')}
        </span>
      </TableCell>
    );
  }

  return (
    <TableCell className="text-center">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 sm:justify-center">
        <input
          type="checkbox"
          aria-label={`${t(`types.${event}.name`)} — ${channelName}`}
          checked={checked && tickable}
          disabled={!tickable}
          onChange={(change) => onToggle(change.target.checked)}
          className="accent-accent-fill size-5 shrink-0"
        />
        {/* On a phone the channel is written next to its box; on a computer the column header says it. */}
        <span className="text-body sm:sr-only" aria-hidden="true">
          {channelName}
          {!tickable && <span className="text-muted-foreground"> · {t('notConfigured')}</span>}
        </span>
      </label>
    </TableCell>
  );
}
