import { existsSync } from 'node:fs';
import { access, constants, readdir, stat } from 'node:fs/promises';

/**
 * What is wrong with the folder of the backups, told with the path that was checked. One look at the folder as the application sees it
 * (its user, the rights, the file system), never a change: the Settings page asks for it, and so does a backup that cannot be written.
 *
 * - `missing`: nothing at that path (the folder was not made, or the host folder is not mounted where the image looks);
 * - `notDirectory`: something that is not a folder is there;
 * - `unreadable`: the folder exists and the application's user cannot list it. This is what a rootless Docker gives when the host folder
 *   belongs to the host user, with rights for them alone, and the file system refuses to hand it to the application;
 * - `notWritable`: it can be listed, not written (rights, or a disk mounted read-only);
 * - `notMounted`: in a container, the path is on the container's own disk, not on a folder of the server: the backups would be lost the
 *   next time the container is made again.
 */
export type FolderProblem =
  'missing' | 'notDirectory' | 'unreadable' | 'notWritable' | 'notMounted';

export interface FolderDiagnosis {
  /** Null when the folder is fine. */
  problem: FolderProblem | null;
  /** The path that was checked, as the application sees it. */
  path: string;
  /** The same folder on the server (`BDE_BACKUP_HOST_DIR`, handed over by docker-compose.yml), when known. */
  hostPath: string | null;
  /** The user the application runs as (a number of the container), when the system tells it. */
  uid: number | null;
  /** Who owns the folder and with which rights (`700`), when it exists. */
  owner: { uid: number; gid: number; mode: string } | null;
  /** The system's code for what failed (`EACCES`, `ENOENT`, `EROFS`), when it gave one. */
  code: string | null;
}

export interface FolderTools {
  stat: typeof stat;
  readdir: typeof readdir;
  access: typeof access;
  inContainer: () => boolean;
  uid: () => number | null;
}

const real: FolderTools = {
  stat,
  readdir,
  access,
  inContainer: () => existsSync('/.dockerenv'),
  uid: () => (typeof process.getuid === 'function' ? process.getuid() : null),
};

const codeOf = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;

export async function diagnoseFolder(
  dir: string,
  env: Record<string, string | undefined> = process.env,
  tools: FolderTools = real,
): Promise<FolderDiagnosis> {
  const base: FolderDiagnosis = {
    problem: null,
    path: dir,
    hostPath: env.BDE_BACKUP_HOST_DIR?.trim() || null,
    uid: tools.uid(),
    owner: null,
    code: null,
  };

  let info;
  try {
    info = await tools.stat(dir);
  } catch (error) {
    return { ...base, problem: 'missing', code: codeOf(error) };
  }
  const owner = { uid: info.uid, gid: info.gid, mode: (info.mode & 0o7777).toString(8) };
  if (!info.isDirectory()) return { ...base, problem: 'notDirectory', owner };

  try {
    await tools.readdir(dir);
  } catch (error) {
    return { ...base, problem: 'unreadable', owner, code: codeOf(error) };
  }
  try {
    await tools.access(dir, constants.W_OK | constants.X_OK);
  } catch (error) {
    return { ...base, problem: 'notWritable', owner, code: codeOf(error) };
  }
  if (tools.inContainer()) {
    const root = await tools.stat('/').catch(() => null);
    if (root && root.dev === info.dev) return { ...base, problem: 'notMounted', owner };
  }
  return { ...base, owner };
}

/** The same diagnosis on one line, for the logs (French, like the rest of what the platform logs). */
export function describeFolder(diagnosis: FolderDiagnosis): string {
  const who = diagnosis.uid === null ? '' : `, utilisateur de la plateforme ${diagnosis.uid}`;
  const owner = diagnosis.owner
    ? `, propriétaire ${diagnosis.owner.uid}:${diagnosis.owner.gid}, droits ${diagnosis.owner.mode}`
    : '';
  const code = diagnosis.code ? `, code ${diagnosis.code}` : '';
  const host = diagnosis.hostPath ? `, sur le serveur : ${diagnosis.hostPath}` : '';
  const what: Record<FolderProblem, string> = {
    missing: "n'existe pas",
    notDirectory: "n'est pas un dossier",
    unreadable: 'ne peut pas être lu',
    notWritable: 'ne peut pas être écrit',
    notMounted: "n'est pas un dossier du serveur (il est dans le conteneur)",
  };
  return `${diagnosis.path} ${diagnosis.problem ? what[diagnosis.problem] : 'est utilisable'}${who}${owner}${code}${host}`;
}
