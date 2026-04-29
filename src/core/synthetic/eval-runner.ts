import { readSyntheticCasesJsonl } from './jsonl.ts';
import { validateSyntheticQueryCase } from './validator.ts';
import type { SyntheticQueryCase } from './types.ts';

export interface SyntheticEvalRunSummary {
  ok: boolean;
  count: number;
  abstain_count: number;
  hard_negative_count: number;
  invalid_count: number;
  shape_counts: Record<string, number>;
  issues: Array<{ id?: string; issues: string[] }>;
}

export function summarizeSyntheticCases(cases: SyntheticQueryCase[]): SyntheticEvalRunSummary {
  const summary: SyntheticEvalRunSummary = {
    ok: true,
    count: cases.length,
    abstain_count: 0,
    hard_negative_count: 0,
    invalid_count: 0,
    shape_counts: {},
    issues: [],
  };
  for (const c of cases) {
    summary.abstain_count += c.expected_abstain ? 1 : 0;
    summary.hard_negative_count += c.hard_negative ? 1 : 0;
    summary.shape_counts[c.query_shape] = (summary.shape_counts[c.query_shape] || 0) + 1;
    const issues = validateSyntheticQueryCase(c).map(issue => issue.message);
    if (issues.length) {
      summary.ok = false;
      summary.invalid_count += 1;
      summary.issues.push({ id: c.id, issues });
    }
  }
  return summary;
}

export function runSyntheticEvalCases(cases: SyntheticQueryCase[]): SyntheticEvalRunSummary {
  return summarizeSyntheticCases(cases);
}

export function runSyntheticEvalJsonl(path: string): SyntheticEvalRunSummary {
  const parsed = readSyntheticCasesJsonl(path);
  const summary = summarizeSyntheticCases(parsed.items);
  if (parsed.errors.length) {
    summary.ok = false;
    summary.invalid_count += parsed.errors.length;
    for (const issue of parsed.errors) summary.issues.push({ issues: [String(issue)] });
  }
  return summary;
}
