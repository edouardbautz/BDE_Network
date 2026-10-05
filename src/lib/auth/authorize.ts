function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Case- and whitespace-insensitive campus match. An empty allowedCampuses
 * list means "no filter" — every campus is authorized (see
 * bde.config.example.yml and docs/configuration.md).
 */
export function isCampusAllowed(campus: string, allowedCampuses: string[]): boolean {
  if (allowedCampuses.length === 0) {
    return true;
  }
  const normalizedCampus = normalize(campus);
  return allowedCampuses.some((allowed) => normalize(allowed) === normalizedCampus);
}

/** Case- and whitespace-insensitive login match against the owners list. */
export function isOwnerLogin(login: string, owners: string[]): boolean {
  const normalizedLogin = normalize(login);
  return owners.some((owner) => normalize(owner) === normalizedLogin);
}
