// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { blockingResults } from './sarif-gate.mjs';

const report = (rules: object[], results: object[]) => ({
  runs: [{ tool: { driver: { rules } }, results }],
});
const at = (file: string, line: number) => [
  { physicalLocation: { artifactLocation: { uri: file }, region: { startLine: line } } },
];

describe('the gate of the CodeQL report', () => {
  it('is empty for a clean report, or one without runs', () => {
    expect(blockingResults({})).toEqual([]);
    expect(blockingResults(report([], []))).toEqual([]);
  });

  it('stops on an error, wherever it is', () => {
    const found = blockingResults(
      report(
        [{ id: 'js/xss' }],
        [
          {
            ruleId: 'js/xss',
            level: 'error',
            message: { text: 'Cross-site scripting' },
            locations: at('src/a.ts', 12),
          },
        ],
      ),
    );
    expect(found).toEqual([
      {
        rule: 'js/xss',
        level: 'error',
        severity: 0,
        message: 'Cross-site scripting',
        file: 'src/a.ts',
        line: 12,
      },
    ]);
  });

  it('stops on a warning whose security severity is high, and not on a lower one', () => {
    const rules = [
      { id: 'js/high', properties: { 'security-severity': '8.1' } },
      { id: 'js/medium', properties: { 'security-severity': '5.3' } },
    ];
    const results = [
      {
        ruleId: 'js/high',
        level: 'warning',
        message: { text: 'high' },
        locations: at('src/b.ts', 1),
      },
      {
        ruleId: 'js/medium',
        level: 'warning',
        message: { text: 'medium' },
        locations: at('src/c.ts', 2),
      },
    ];
    expect(blockingResults(report(rules, results)).map((item) => item.rule)).toEqual(['js/high']);
  });

  it('reads the level of the rule when the result has none', () => {
    const rules = [{ id: 'js/x', defaultConfiguration: { level: 'error' } }];
    expect(
      blockingResults(report(rules, [{ ruleId: 'js/x', message: { text: 'm' } }])).map(
        (item) => item.rule,
      ),
    ).toEqual(['js/x']);
  });

  it('does not stop on a note or a plain warning, and copes with a result that has no location', () => {
    const results = [
      { ruleId: 'a', level: 'note', message: { text: 'n' } },
      { ruleId: 'b', level: 'warning', message: { text: 'w' } },
    ];
    expect(blockingResults(report([], results))).toEqual([]);
    expect(blockingResults(report([], [{ ruleId: 'c', level: 'error' }]))).toEqual([
      { rule: 'c', level: 'error', severity: 0, message: '', file: '?', line: 0 },
    ]);
  });
});
