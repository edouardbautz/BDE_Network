'use client';

import { useState, useTransition } from 'react';
import { AtSign, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { addMention, removeMention } from '@/app/[locale]/(app)/notifications/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MentionView } from '@/lib/notifications/templates/editor-data';
import { mentionKeyFor } from '@/lib/notifications/templates/mention-keys';
import type { TemplateChannel } from '@/lib/notifications/templates/types';

type MentionPlatform = 'discord' | 'slack';

interface MentionToolsProps {
  /** The tab: a template for all channels can only mention everybody (the people belong to one platform). */
  scope: 'all' | TemplateChannel;
  mentions: MentionView[];
  onMentionsChange: (mentions: MentionView[]) => void;
  /** Inserts the text of a mention where the cursor is. */
  onInsert: (token: string) => void;
  disabled?: boolean;
}

const KINDS: Record<MentionPlatform, Array<MentionView['kind']>> = {
  discord: ['role', 'user'],
  slack: ['group', 'user'],
};

/**
 * What a message above a card can ping: everybody, and the people, roles and groups the BDE put in its directory. The directory
 * holds a name and an identifier of the chat platform (Discord shows that identifier in developer mode, Slack in a profile or a
 * group), and the templates only ever spell the name.
 */
export function MentionTools({
  scope,
  mentions,
  onMentionsChange,
  onInsert,
  disabled,
}: MentionToolsProps) {
  const t = useTranslations('templates.mentions');
  const [open, setOpen] = useState(false);
  const platform: MentionPlatform | null = scope === 'discord' || scope === 'slack' ? scope : null;
  const known = platform ? mentions.filter((mention) => mention.platform === platform) : [];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={<Button type="button" variant="ghost" size="sm" />}
        >
          <AtSign aria-hidden="true" />
          {t('insert')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-72">
          <DropdownMenuItem onClick={() => onInsert('{@everyone}')}>
            {t('everyone')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onInsert('{@here}')}>{t('here')}</DropdownMenuItem>
          {scope === 'slack' && (
            <DropdownMenuItem onClick={() => onInsert('{@channel}')}>
              {t('channel')}
            </DropdownMenuItem>
          )}
          {known.map((mention) => (
            <DropdownMenuItem
              key={mention.id}
              onClick={() => onInsert(`{@${mention.kind}:${mention.key}}`)}
            >
              {mention.label}
              <span className="text-muted-foreground text-small ms-auto">
                {t(`kinds.${mention.kind}`)}
              </span>
            </DropdownMenuItem>
          ))}
          {platform && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setOpen(true)}>{t('manage')}</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {platform && (
        <DirectoryDialog
          open={open}
          onOpenChange={setOpen}
          platform={platform}
          mentions={mentions}
          onMentionsChange={onMentionsChange}
        />
      )}
    </>
  );
}

function DirectoryDialog({
  open,
  onOpenChange,
  platform,
  mentions,
  onMentionsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: MentionPlatform;
  mentions: MentionView[];
  onMentionsChange: (mentions: MentionView[]) => void;
}) {
  const t = useTranslations('templates.mentions');
  const tCodes = useTranslations('templates.codes');
  const [kind, setKind] = useState<MentionView['kind']>(KINDS[platform][0]!);
  const [label, setLabel] = useState('');
  const [externalId, setExternalId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const entries = mentions.filter((mention) => mention.platform === platform);

  const add = () =>
    startTransition(async () => {
      setError(null);
      const key = mentionKeyFor(label, new Set(entries.map((entry) => entry.key)));
      const result = await addMention({ platform, kind, key, label: label.trim(), externalId });
      if (!result.ok) {
        setError(tCodes.has(result.code) ? tCodes(result.code) : tCodes('unknown'));
        return;
      }
      onMentionsChange([
        ...mentions,
        { id: result.id, key, platform, kind, label: label.trim(), externalId: externalId.trim() },
      ]);
      setLabel('');
      setExternalId('');
      toast.success(t('added'));
    });

  const remove = (entry: MentionView) =>
    startTransition(async () => {
      setError(null);
      const result = await removeMention({ id: entry.id });
      if (!result.ok) {
        setError(
          result.code === 'mentionInUse'
            ? t('inUse', { where: result.detail ?? '' })
            : tCodes.has(result.code)
              ? tCodes(result.code)
              : tCodes('unknown'),
        );
        return;
      }
      onMentionsChange(mentions.filter((mention) => mention.id !== entry.id));
      toast.success(t('removed'));
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { platform: t(`platforms.${platform}`) })}</DialogTitle>
          <DialogDescription>{t(`help.${platform}`)}</DialogDescription>
        </DialogHeader>

        {entries.length === 0 ? (
          <p className="text-muted-foreground text-body">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t('listLabel')}>
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="bg-surface-2 flex items-center justify-between gap-3 rounded-lg p-3"
              >
                <div className="min-w-0">
                  <div className="text-body-strong truncate">{entry.label}</div>
                  <div className="text-muted-foreground text-small">
                    {t(`kinds.${entry.kind}`)} · {entry.externalId}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  aria-label={t('remove', { name: entry.label })}
                  onClick={() => remove(entry)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <fieldset className="flex flex-wrap gap-2">
            <legend className="text-body-strong mb-1.5">{t('kindLabel')}</legend>
            {KINDS[platform].map((value) => (
              <label
                key={value}
                className="bg-surface-2 has-checked:bg-accent-soft text-body flex cursor-pointer items-center gap-2 rounded-pill px-4 py-2.5"
              >
                <input
                  type="radio"
                  name="mention-kind"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {t(`kinds.${value}`)}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mention-label">{t('nameLabel')}</Label>
            <Input
              id="mention-label"
              value={label}
              maxLength={60}
              autoComplete="off"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mention-id">{t('idLabel')}</Label>
            <Input
              id="mention-id"
              value={externalId}
              inputMode={platform === 'discord' ? 'numeric' : 'text'}
              autoComplete="off"
              aria-describedby="mention-id-hint"
              onChange={(event) => setExternalId(event.target.value)}
            />
            <p id="mention-id-hint" className="text-muted-foreground text-small">
              {t(`idHint.${platform}`)}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-destructive text-body">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('close')}
            </Button>
            <Button type="submit" disabled={pending || !label.trim() || !externalId.trim()}>
              {t('add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
