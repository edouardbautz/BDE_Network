// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  inspectSelf,
  mountPath,
  planStart,
  projectName,
  startArguments,
  startPlatform,
  tail,
  waitHealthy,
  type RunResult,
  type Runner,
} from './docker';

const labels = {
  'com.docker.compose.project': 'bde_network',
  'com.docker.compose.project.working_dir': 'C:\\Users\\Edouard Bautz\\Desktop\\BDE_Network',
};
const inspectJson = (over: Record<string, string> = {}, image = 'bde-network-setup') =>
  JSON.stringify([{ Config: { Labels: { ...labels, ...over }, Image: image } }]);

/** A Docker that answers each command from a table of `[first words, result]`. */
function docker(table: Array<[string, RunResult]>): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (args) => {
    calls.push(args);
    const line = args.join(' ');
    return table.find(([prefix]) => line.startsWith(prefix))?.[1] ?? { code: 1, stdout: '' };
  };
  return { run, calls };
}
const ok = (stdout = ''): RunResult => ({ code: 0, stdout });

describe('mountPath', () => {
  it('turns a Windows path into the /c/... form Docker Desktop accepts', () => {
    expect(mountPath('C:\\Users\\Edouard Bautz\\Desktop\\BDE_Network')).toBe(
      '/c/Users/Edouard Bautz/Desktop/BDE_Network',
    );
    expect(mountPath('d:\\code\\bde')).toBe('/d/code/bde');
    expect(mountPath('C:/Users/me/bde')).toBe('/c/Users/me/bde');
    expect(mountPath('C:\\')).toBe('/c');
    expect(mountPath('C:\\Users\\me\\')).toBe('/c/Users/me');
  });

  it('keeps a POSIX path, without a trailing slash', () => {
    expect(mountPath('/home/me/BDE_Network')).toBe('/home/me/BDE_Network');
    expect(mountPath('/Users/me/My Projects/bde/')).toBe('/Users/me/My Projects/bde');
  });

  it.each(['', 'relative/path', 'BDE_Network', '\\\\server\\share\\bde'])('refuses %j', (path) => {
    expect(mountPath(path)).toBeNull();
  });
});

describe('inspectSelf', () => {
  it('reads the compose project, the project folder on the host and the image', async () => {
    const { run, calls } = docker([['inspect abc123', ok(inspectJson())]]);
    await expect(inspectSelf(run, 'abc123')).resolves.toEqual({
      workingDir: 'C:\\Users\\Edouard Bautz\\Desktop\\BDE_Network',
      image: 'bde-network-setup',
    });
    expect(calls).toEqual([['inspect', 'abc123']]);
  });

  it('gives null when the container was not started by compose, or Docker cannot be asked', async () => {
    expect(
      await inspectSelf(
        docker([['inspect', ok(JSON.stringify([{ Config: { Labels: {}, Image: 'x' } }]))]]).run,
        'a',
      ),
    ).toBeNull();
    expect(await inspectSelf(docker([]).run, 'a')).toBeNull();
    expect(await inspectSelf(docker([['inspect', ok('not json')]]).run, 'a')).toBeNull();
    expect(await inspectSelf(docker([['inspect', ok('[]')]]).run, 'a')).toBeNull();
  });
});

describe('planStart', () => {
  const table: Array<[string, RunResult]> = [
    ['version', ok('29.3.1')],
    ['inspect abc', ok(inspectJson())],
  ];

  it('plans the start with the project, the path to mount and the image', async () => {
    await expect(planStart(docker(table).run, 'abc')).resolves.toEqual({
      ok: true,
      project: 'bde_network',
      mount: '/c/Users/Edouard Bautz/Desktop/BDE_Network',
      image: 'bde-network-setup',
    });
  });

  it('says why it cannot, outside a container', async () => {
    expect(await planStart(docker(table).run, undefined)).toEqual({
      ok: false,
      detail: 'not in a container',
    });
  });

  it('says why it cannot when Docker is not reachable', async () => {
    const plan = await planStart(docker([['inspect abc', ok(inspectJson())]]).run, 'abc');
    expect(plan).toEqual({ ok: false, detail: 'Docker is not reachable from the assistant' });
  });

  it('says why it cannot when the host folder is unknown or unusable', async () => {
    expect(await planStart(docker([['version', ok('29')]]).run, 'abc')).toEqual({
      ok: false,
      detail: 'the project folder of the host is unknown',
    });
    const odd = docker([
      ['version', ok('29')],
      [
        'inspect abc',
        ok(inspectJson({ 'com.docker.compose.project.working_dir': 'relative/dir' })),
      ],
    ]);
    expect(await planStart(odd.run, 'abc')).toEqual({
      ok: false,
      detail: 'the project folder path is not usable',
    });
  });
});

describe('startArguments', () => {
  const plan = {
    project: 'bde_network',
    mount: '/c/Users/me/BDE_Network',
    image: 'bde-network-setup',
  };

  it('runs docker compose up in a sibling container that sees the project at its host path', () => {
    const args = startArguments(plan);
    expect(args.slice(0, 2)).toEqual(['run', '--rm']);
    expect(args).toContain('/var/run/docker.sock:/var/run/docker.sock');
    expect(args).toContain('/c/Users/me/BDE_Network:/c/Users/me/BDE_Network');
    expect(args[args.indexOf('-w') + 1]).toBe('/c/Users/me/BDE_Network');
    expect(args[args.indexOf('--entrypoint') + 1]).toBe('docker');
    expect(args.slice(args.indexOf('bde-network-setup'))).toEqual([
      'bde-network-setup',
      'compose',
      '-p',
      'bde_network',
      '--project-directory',
      '/c/Users/me/BDE_Network',
      '-f',
      '/c/Users/me/BDE_Network/docker-compose.yml',
      'up',
      '--build',
      '-d',
    ]);
  });

  it('keeps a path with spaces as one argument', () => {
    const args = startArguments({ ...plan, mount: '/c/Users/Edouard Bautz/BDE' });
    expect(args).toContain('/c/Users/Edouard Bautz/BDE:/c/Users/Edouard Bautz/BDE');
  });
});

describe('startPlatform', () => {
  it('collects the log of the build instead of showing it, and returns the exit code', async () => {
    const run = vi.fn<Runner>(async () => ({ code: 0, stdout: '' }));
    const result = await startPlatform(run, { project: 'p', mount: '/p', image: 'i' });

    expect(result.code).toBe(0);
    expect(run).toHaveBeenCalledWith(expect.arrayContaining(['up', '--build', '-d']), {
      merge: true,
    });
  });

  it('passes the sign-of-life callback to the command', async () => {
    const run = vi.fn<Runner>(async () => ({ code: 0, stdout: '' }));
    const onTick = vi.fn();
    await startPlatform(run, { project: 'p', mount: '/p', image: 'i' }, onTick);
    expect(run).toHaveBeenCalledWith(expect.anything(), { merge: true, onTick });
  });

  it('returns the failure code of a failed start', async () => {
    const run: Runner = async () => ({ code: 1, stdout: '' });
    expect((await startPlatform(run, { project: 'p', mount: '/p', image: 'i' })).code).toBe(1);
  });
});

describe('waitHealthy', () => {
  it('returns true as soon as the app container is healthy', async () => {
    const states = ['starting', 'starting', 'healthy'];
    const run: Runner = async (args) =>
      args[0] === 'ps' ? ok('container-1\n') : ok(`${states.shift() ?? 'healthy'}\n`);
    const sleep = vi.fn(async () => undefined);

    await expect(
      waitHealthy(run, 'bde_network', { timeoutMs: 60_000, intervalMs: 3000, sleep }),
    ).resolves.toBe(true);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("looks for the app service of this project's compose", async () => {
    const calls: string[][] = [];
    const run: Runner = async (args) => {
      calls.push(args);
      return args[0] === 'ps' ? ok('c1') : ok('healthy');
    };
    await waitHealthy(run, 'bde_network', {
      timeoutMs: 1000,
      intervalMs: 1,
      sleep: async () => undefined,
    });

    expect(calls[0]).toEqual([
      'ps',
      '-q',
      '--filter',
      'label=com.docker.compose.project=bde_network',
      '--filter',
      'label=com.docker.compose.service=app',
    ]);
    expect(calls[1]).toEqual(['inspect', '--format', '{{.State.Health.Status}}', 'c1']);
  });

  it('keeps waiting while there is no container yet', async () => {
    let listed = 0;
    const run: Runner = async (args) =>
      args[0] === 'ps' ? ok(++listed < 3 ? '' : 'c1') : ok('healthy');
    await expect(
      waitHealthy(run, 'p', { timeoutMs: 60_000, intervalMs: 1, sleep: async () => undefined }),
    ).resolves.toBe(true);
    expect(listed).toBe(3);
  });

  it('gives up after the timeout when the app never becomes healthy', async () => {
    let clock = 0;
    const run: Runner = async (args) => (args[0] === 'ps' ? ok('c1') : ok('unhealthy'));
    const result = await waitHealthy(run, 'p', {
      timeoutMs: 10_000,
      intervalMs: 3000,
      sleep: async (ms) => void (clock += ms),
      now: () => clock,
    });

    expect(result).toBe(false);
    expect(clock).toBeGreaterThanOrEqual(10_000);
  });
});

describe('tail', () => {
  it('keeps the last lines, without the empty ones', () => {
    const output = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    expect(tail(output, 3)).toBe('line 28\nline 29\nline 30');
    expect(tail('a\n\n  \nb\r\n\n', 5)).toBe('a\nb');
  });

  it('gives fifteen lines by default, and nothing for nothing', () => {
    expect(
      tail(Array.from({ length: 40 }, (_, i) => String(i)).join('\n')).split('\n'),
    ).toHaveLength(15);
    expect(tail('')).toBe('');
  });
});

describe('projectName', () => {
  it('is the name of the folder, in lower case, as docker compose names a project', () => {
    expect(projectName('/home/me/BDE_Network')).toBe('bde_network');
    expect(projectName('C:\\Users\\Edouard Bautz\\Desktop\\BDE_Network')).toBe('bde_network');
    expect(projectName('/home/me/bde-wizard-test')).toBe('bde-wizard-test');
    expect(projectName('/Users/me/My Projects/BDE.Lynx 2026/')).toBe('bdelynx2026');
  });

  it('prefers a COMPOSE_PROJECT_NAME written in .env', () => {
    expect(projectName('/home/me/BDE_Network', 'lynx')).toBe('lynx');
    expect(projectName('/home/me/BDE_Network', '  ')).toBe('bde_network');
  });

  it('is empty when nothing usable is left', () => {
    expect(projectName('/')).toBe('');
    expect(projectName('/home/me/日本語')).toBe('');
  });
});

describe('planStart and the project name', () => {
  const table: Array<[string, RunResult]> = [
    ['version', ok('29')],
    ['inspect abc', ok(inspectJson({ 'com.docker.compose.project': 'bde-network-setup' }))],
  ];

  it("names the platform's project after the folder, not after the assistant's own project", async () => {
    const plan = await planStart(docker(table).run, 'abc');
    expect(plan).toMatchObject({ ok: true, project: 'bde_network' });
  });

  it('uses the project name written in .env when there is one', async () => {
    expect(await planStart(docker(table).run, 'abc', 'lynx')).toMatchObject({
      ok: true,
      project: 'lynx',
    });
  });

  it('says why it cannot when no name can be worked out', async () => {
    const odd = docker([
      ['version', ok('29')],
      [
        'inspect abc',
        ok(inspectJson({ 'com.docker.compose.project.working_dir': '/home/me/日本語' })),
      ],
    ]);
    expect(await planStart(odd.run, 'abc')).toEqual({
      ok: false,
      detail: 'the project name cannot be worked out',
    });
  });
});
