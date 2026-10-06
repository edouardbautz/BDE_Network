import { spawn } from 'node:child_process';

/**
 * Starting the platform from inside the assistant's own container. The container talks to the host's
 * Docker through its socket, and `docker compose up` must then see the project at the **path it has on
 * the host** (the compose file mounts `./bde.config.yml`, and the daemon reads host paths). So the
 * start is made by a sibling container of the same image, which mounts the project at that very path.
 * Everything here is optional: when something is missing, the assistant says which command to run.
 */

export interface RunResult {
  code: number;
  stdout: string;
}

export interface RunOptions {
  /** Also collect what the command writes on its error output (a build writes its log there). */
  merge?: boolean;
  /** Called every ten seconds while the command runs: a sign of life for a long build. */
  onTick?: () => void;
}

/** Runs `docker <args>` and gives its exit code and what it wrote. */
export type Runner = (args: string[], options?: RunOptions) => Promise<RunResult>;

const TICK_MS = 10_000;

export const realRunner: Runner = (args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn('docker', args, {
      stdio: ['ignore', 'pipe', options.merge ? 'pipe' : 'ignore'],
    });
    let output = '';
    const collect = (chunk: Buffer) => (output += chunk.toString('utf8'));
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const timer = options.onTick ? setInterval(options.onTick, TICK_MS) : undefined;
    const finish = (code: number) => {
      if (timer) clearInterval(timer);
      resolve({ code, stdout: output });
    };
    child.on('error', () => finish(127));
    child.on('close', (code) => finish(code ?? 1));
  });

export interface SelfInfo {
  /** The project folder as the host knows it (`C:\Users\me\BDE_Network`, `/home/me/BDE_Network`). */
  workingDir: string;
  /** The image of the assistant, reused for the sibling container. */
  image: string;
}

/** The labels docker compose put on the assistant's own container, which say where the project is. */
export async function inspectSelf(run: Runner, containerId: string): Promise<SelfInfo | null> {
  const result = await run(['inspect', containerId]);
  if (result.code !== 0) return null;
  try {
    const [container] = JSON.parse(result.stdout) as Array<{
      Config?: { Labels?: Record<string, string>; Image?: string };
    }>;
    const labels = container?.Config?.Labels ?? {};
    const workingDir = labels['com.docker.compose.project.working_dir'];
    const image = container?.Config?.Image;
    return workingDir && image ? { workingDir, image } : null;
  } catch {
    return null;
  }
}

/**
 * The path to mount the project at, in a form the Docker daemon accepts as a host path and a Linux
 * container accepts as a path: `C:\Users\me\x` becomes `/c/Users/me/x` (Docker Desktop on Windows),
 * a POSIX path stays as it is, anything else is not usable.
 */
export function mountPath(workingDir: string): string | null {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(workingDir);
  if (drive?.[1]) {
    const rest = (drive[2] ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    return `/${drive[1].toLowerCase()}${rest ? `/${rest}` : ''}`;
  }
  return workingDir.startsWith('/') ? workingDir.replace(/\/+$/, '') || '/' : null;
}

/**
 * The name docker compose gives the platform's project when it is run from `workingDir`: the name of
 * the folder, in lower case, without the characters compose does not allow. `override` is a
 * COMPOSE_PROJECT_NAME written in .env, which wins. (The assistant has a project of its own, so that
 * compose does not take the platform's containers for orphans of the assistant's.)
 */
export function projectName(workingDir: string, override?: string): string {
  const explicit = override?.trim();
  if (explicit) return explicit;
  const folder =
    workingDir
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? '';
  return folder.toLowerCase().replace(/[^-_a-z0-9]/g, '');
}

export type StartPlan =
  { ok: true; project: string; mount: string; image: string } | { ok: false; detail: string };

/** Whether the platform can be started from here, and how. */
export async function planStart(
  run: Runner,
  containerId: string | undefined,
  projectOverride?: string,
): Promise<StartPlan> {
  if (!containerId) return { ok: false, detail: 'not in a container' };
  if ((await run(['version', '--format', '{{.Server.Version}}'])).code !== 0) {
    return { ok: false, detail: 'Docker is not reachable from the assistant' };
  }
  const self = await inspectSelf(run, containerId);
  if (!self) return { ok: false, detail: 'the project folder of the host is unknown' };
  const mount = mountPath(self.workingDir);
  if (!mount) return { ok: false, detail: 'the project folder path is not usable' };
  const project = projectName(self.workingDir, projectOverride);
  if (!project) return { ok: false, detail: 'the project name cannot be worked out' };
  return { ok: true, project, mount, image: self.image };
}

/** The arguments of `docker run` for the sibling container that runs `docker compose up`. */
export function startArguments(plan: { project: string; mount: string; image: string }): string[] {
  return [
    'run',
    '--rm',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    '-v',
    `${plan.mount}:${plan.mount}`,
    '-w',
    plan.mount,
    '--entrypoint',
    'docker',
    plan.image,
    'compose',
    '-p',
    plan.project,
    '--project-directory',
    plan.mount,
    '-f',
    `${plan.mount}/docker-compose.yml`,
    'up',
    '--build',
    '-d',
  ];
}

/**
 * Builds and starts the platform. The first build is long and its log is long too: it is collected, not
 * shown (a dot every ten seconds says it is alive), and the end of it is given back for a failure.
 */
export function startPlatform(
  run: Runner,
  plan: { project: string; mount: string; image: string },
  onTick?: () => void,
): Promise<RunResult> {
  return run(startArguments(plan), { merge: true, ...(onTick && { onTick }) });
}

/** The last lines of a command's output, for the message of a failure. */
export function tail(output: string, lines = 15): string {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(-lines)
    .join('\n');
}

export interface WaitOptions {
  timeoutMs: number;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Waits until the `app` container of the project reports itself healthy. */
export async function waitHealthy(
  run: Runner,
  project: string,
  options: WaitOptions,
): Promise<boolean> {
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;
  for (;;) {
    const listed = await run([
      'ps',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--filter',
      'label=com.docker.compose.service=app',
    ]);
    const id = listed.stdout.trim().split(/\s+/)[0];
    if (id) {
      const state = await run(['inspect', '--format', '{{.State.Health.Status}}', id]);
      if (state.stdout.trim() === 'healthy') return true;
    }
    if (now() >= deadline) return false;
    await options.sleep(options.intervalMs);
  }
}
