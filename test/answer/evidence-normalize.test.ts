import { describe, expect, test } from 'bun:test';
import type { RecallResult } from '../../src/core/evidence/recall.ts';
import { isExactEvidenceWindow, normalizeRecallEvidence } from '../../src/core/answer/index.ts';

const recall: RecallResult = {
  query: 'what happened?',
  status: 'hit',
  evidence: [
    {
      span_id: 'gbs1:default:sources/test/page#compiled_truth:L3-L5',
      source_id: 'default',
      slug: 'sources/test/page',
      title: 'Test Page',
      section: 'compiled_truth',
      start_line: 3,
      end_line: 5,
      quote: 'Exact source-backed quote.',
      quote_hash: 'a'.repeat(64),
      line_basis: 'stored_section',
      matched_by: 'exact',
      score: 0.91,
    },
  ],
  warnings: [],
  integration: { search_source: 'direct' },
};

describe('normalizeRecallEvidence', () => {
  test('preserves exact gbs1 evidence identity and source metadata', () => {
    const [window] = normalizeRecallEvidence(recall);

    expect(window.id).toBe(recall.evidence[0].span_id);
    expect(window.source).toEqual({
      id: 'default',
      slug: 'sources/test/page',
      title: 'Test Page',
      section: 'compiled_truth',
      lineRange: { start: 3, end: 5 },
    });
    expect(window.quote).toBe('Exact source-backed quote.');
    expect(window.quoteHash).toBe('a'.repeat(64));
    expect(window.score).toBe(0.91);
    expect(window.matchedBy).toBe('exact');
    expect(window.searchSource).toBe('direct');
    expect(isExactEvidenceWindow(window)).toBe(true);
  });

  test('deduplicates evidence by stable span id', () => {
    const windows = normalizeRecallEvidence({ ...recall, evidence: [recall.evidence[0], { ...recall.evidence[0], quote: 'Duplicate' }] });
    expect(windows).toHaveLength(1);
    expect(windows[0].quote).toBe('Exact source-backed quote.');
  });
});
