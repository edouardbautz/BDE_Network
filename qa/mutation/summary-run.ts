import { appendFileSync, readFileSync } from 'node:fs';
import { markdown, type Report } from './summary';

/** `tsx qa/mutation/summary-run.ts [mutation-report/report.json]`: the table, on the screen and in the summary of the job. */
const path = process.argv[2] ?? 'mutation-report/report.json';
const text = markdown(JSON.parse(readFileSync(path, 'utf8')) as Report);
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
