/**
 * The name of an automatic backup. It carries the moment it was made, in UTC with its `Z` (the machine's zone and the BDE's say
 * nothing at a change of clock), so that the rotation can group the backups by the days of the BDE without opening a file.
 * `bde-auto-` apart from the `bde-backup-` of scripts/backup.sh: that script's `--keep` must never throw away an automatic backup,
 * nor the rotation one made by hand.
 */
export const ARCHIVE_PREFIX = 'bde-auto-';
export const ARCHIVE_SUFFIX = '.tar.gz';

const NAME = /^bde-auto-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})Z\.tar\.gz$/;

const two = (value: number): string => String(value).padStart(2, '0');

export function archiveName(at: Date): string {
  const date = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`;
  const time = `${two(at.getUTCHours())}-${two(at.getUTCMinutes())}-${two(at.getUTCSeconds())}`;
  return `${ARCHIVE_PREFIX}${date}_${time}Z${ARCHIVE_SUFFIX}`;
}

/** The moment in a name, or null for anything that is not the name of an automatic backup (a download, a foreign file, a path). */
export function parseArchiveName(name: string): Date | null {
  const match = NAME.exec(name);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // `new Date(Date.UTC(...))` rolls a 31 February over to March: such a name is not one we made.
  return archiveName(at) === name ? at : null;
}
