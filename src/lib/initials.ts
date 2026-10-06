/** The letters shown in an avatar without a photo: the first letter of the first two words of
 * the name ("Jean Dupont" → "JD"). */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
