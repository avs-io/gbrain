import { describe, expect, test } from 'bun:test';
import { analyzeRecallForAnswer } from '../../src/core/evidence/recall-diagnostics.ts';
import type { RecallResult } from '../../src/core/evidence/recall.ts';

function makeRecall(overrides: Partial<RecallResult> = {}): RecallResult {
  return {
    query: 'why did the thing change?',
    status: 'hit',
    evidence: [],
    warnings: [],
    integration: { search_source: 'direct' },
    ...overrides,
  };
}

const goodEvidence: RecallResult['evidence'] = [
  {
    span_id: 'gbs1:a#L1-L2',
    source_id: 'a',
    slug: 'sources/a',
    section: 'compiled_truth',
    start_line: 1,
    end_line: 2,
    quote: 'The thing changed because the previous path was too static.',
    quote_hash: '1'.repeat(64),
    line_basis: 'stored_section',
    matched_by: 'exact',
    score: 0.9,
  },
  {
    span_id: 'gbs1:b#L3-L4',
    source_id: 'b',
    slug: 'sources/b',
    section: 'compiled_truth',
    start_line: 3,
    end_line: 4,
    quote: 'A second source confirmed the same direction.',
    quote_hash: '2'.repeat(64),
    line_basis: 'stored_section',
    matched_by: 'exact',
    score: 0.8,
  },
];

describe('recall diagnostics', () => {
  test('marks clean gbs1 evidence as good for synthesis', () => {
    const report = analyzeRecallForAnswer(makeRecall({ evidence: goodEvidence }));

    expect(report.ok).toBe(true);
    expect(report.recommendation).toBe('good_for_synthesis');
    expect(report.gbs1_count).toBe(2);
    expect(report.non_gbs1_count).toBe(0);
  });

  test('flags no evidence as needs more evidence', () => {
    const report = analyzeRecallForAnswer(makeRecall());

    expect(report.ok).toBe(false);
    expect(report.recommendation).toBe('needs_more_evidence');
    expect(report.warnings).toContain('no_recall_evidence');
  });

  test('marks non-gbs1 or synthetic evidence unsafe', () => {
    const report = analyzeRecallForAnswer(makeRecall({ evidence: [
      { ...goodEvidence[0], span_id: 'chunk:a#L1-L2' },
      { ...goodEvidence[1], source_id: 'syn:fake' },
    ] }));

    expect(report.ok).toBe(false);
    expect(report.recommendation).toBe('unsafe_for_synthesis');
    expect(report.warnings).toContain('contains_non_gbs1_evidence');
  });

  test('warns on duplicate span overlap', () => {
    const report = analyzeRecallForAnswer(makeRecall({ evidence: [goodEvidence[0], { ...goodEvidence[0], source_id: 'a2' }] }));

    expect(report.duplicate_span_count).toBeGreaterThan(0);
    expect(report.warnings).toContain('duplicate_span_overlap');
  });
});
