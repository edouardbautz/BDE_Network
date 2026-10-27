import type { Layer, Usage } from './docker';
import type { Spread } from './stats';
import type { StatementSummary } from './sql';

/** What `qa/optim/measure.ts` writes: one file per run, the "before" and the "after" of the optimisation campaign are two of them. */

export interface PageMeasure {
  name: string;
  who: string;
  path: string;
  status: number;
  /** Milliseconds from the request to the first byte, and to the last one. */
  firstByteMs: Spread;
  totalMs: Spread;
  /** Bytes on the wire (compressed) of the HTML. */
  htmlBytes: number;
  /** The scripts the page loads at once, and every script it refers to, with what they weigh on the wire. */
  scripts: { count: number; bytes: number };
  referencedScripts: { count: number; bytes: number };
  stylesheets: { count: number; bytes: number };
}

export interface DbMeasure {
  name: string;
  /** Statements sent for one request of the page (the median of the repetitions). */
  queries: number;
  controls: number;
  totalMs: number;
  repeated: StatementSummary['repeated'];
  slowest: StatementSummary['slowest'];
}

export interface TableScan {
  table: string;
  rows: number;
  seqScans: number;
  seqTuplesRead: number;
  indexScans: number;
}

export interface TableSize {
  table: string;
  rows: number;
  bytes: number;
}

export interface ImageMeasure {
  name: string;
  /** The sum of the layers. */
  bytes: number;
  /** What `docker image inspect` says, which depends on the image store of the Docker that measured. */
  inspectedBytes: number;
  layers: Layer[];
  /** The biggest folders of the image, and of its node_modules, in kibibytes. */
  folders: { path: string; kib: number }[];
  packages: { path: string; kib: number }[];
}

export interface LoadMeasure {
  vus: number;
  seconds: number;
  requests: number;
  perSecond: number;
  failedRate: number;
  p95Ms: number;
  pages: { page: string; requests: number; averageMs: number; p95Ms: number }[];
  app: { peakMemoryMiB: number; meanCpu: number };
  database: { peakMemoryMiB: number; meanCpu: number };
  /** Bytes the application wrote to its log during the load. */
  logBytes: number;
}

export interface ServerMeasure {
  /** From `docker start` to a healthy `/api/health`. (The "Ready in" Next.js prints says 0 ms: it comes before the application starts.) */
  restartMs: Spread;
  idle: { app: Usage; database: Usage };
  load: LoadMeasure | null;
}

export interface GrowthMeasure {
  databaseBytes: number;
  tables: TableSize[];
  /** Rows written per calendar year in the tables that grow with time. */
  perYear: { table: string; year: number; rows: number }[];
}

export interface Measurement {
  label: string;
  takenAt: string;
  environment: { platform: string; cpus: number; memoryGiB: number; node: string };
  dataset: Record<string, number>;
  /** Things to know when reading these numbers. */
  notes?: string[];
  image?: ImageMeasure;
  pages?: PageMeasure[];
  db?: DbMeasure[];
  scans?: TableScan[];
  server?: ServerMeasure;
  growth?: GrowthMeasure;
}
