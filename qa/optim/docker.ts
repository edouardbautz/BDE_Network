import { mebibytesUsed } from '../perf/report';

/** The parsers of what the `docker` command prints, kept apart from the commands so that they are tested on text. */

export interface Layer {
  bytes: number;
  createdBy: string;
}

/** `docker history --human=false --format '{{.Size}}\t{{.CreatedBy}}'`, newest layer first. */
export function parseHistory(output: string): Layer[] {
  const layers: Layer[] = [];
  for (const line of output.split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const bytes = Number(line.slice(0, tab));
    if (!Number.isFinite(bytes)) continue;
    const createdBy = line
      .slice(tab + 1)
      .replace(/\s+/g, ' ')
      .replace(/^\/bin\/sh -c (#\(nop\) )?/, '')
      .trim();
    layers.push({
      bytes,
      createdBy: createdBy.length > 140 ? `${createdBy.slice(0, 139)}…` : createdBy,
    });
  }
  return layers;
}

export interface DiskUse {
  path: string;
  kib: number;
}

/** `du -k` (one line per folder: the size in kibibytes, a tab, the path), the biggest first. */
export function parseDu(output: string): DiskUse[] {
  const uses: DiskUse[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^(\d+)\s+(.+)$/.exec(line);
    if (match) uses.push({ kib: Number(match[1]), path: match[2]!.trim() });
  }
  return uses.sort((a, b) => b.kib - a.kib);
}

export interface Usage {
  cpu: number;
  memoryMiB: number;
}

/** `docker stats --no-stream --format '{{.CPUPerc}}\t{{.MemUsage}}'` for one container. */
export function parseStats(line: string): Usage {
  const [cpu = '', memory = ''] = line.trim().split('\t');
  const percent = /^([\d.]+)%$/.exec(cpu.trim());
  if (!percent) throw new Error(`cannot read a CPU usage from "${line}"`);
  return { cpu: Number(percent[1]), memoryMiB: mebibytesUsed(memory) };
}
