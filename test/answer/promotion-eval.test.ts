import { describe, expect, test } from 'bun:test';
import { buildDeterministicAnswerEnvelope } from '../../src/core/answer/index.ts';
import { evaluateAnswerPromotionCases } from '../../src/core/answer/promotion-eval.ts';
import type { RecallResult } from '../../src/core/evidence/recall.ts';

const baseRecall: RecallResult = {
  query: 'why did Citadel change?',
  status: 'hit',
  evidence: [
    {
      span_id: 'gbs1:default:sources/test/citadel#compiled_truth:L10-L11',
      source_id: 'default',
      slug: 'sources/test/citadel',
      title: 'Citadel Note',
      section: 'compiled_truth',
      start_line: 10,
      end_line: 11,
      quote: 'Citadel was too static. The better direction was living memory.',
      quote_hash: 'd'.repeat(64),
      line_basis: 'stored_section',
      matched_by: 'exact',
      score: 0.95,
    },
  ],
  warnings: [],
  integration: { search_source: 'direct' },
};

describe('answer promotion eval', () => {
  test('passes clean exact-evidence envelopes', () => {
    const report = evaluateAnswerPromotionCases([
      { id: 'clean', envelope: buildDeterministicAnswerEnvelope(baseRecall), max_length: 2000 },
    ]);

    expect(report.ok).toBe(true);
    expect(report.recommendation).toBe('eligible_for_limited_exposure');
  });

  test('rejects synthetic citations and artifact strings', () => {
    const bad = buildDeterministicAnswerEnvelope(baseRecall);
    bad.claims[0].citations = [{ id: 'syn:test', label: 'syn:test' } as any];
    bad.answer = '### Claim citeturn1search5';

    const report = evaluateAnswerPromotionCases([{ id: 'bad', envelope: bad }]);
    expect(report.ok).toBe(false);
    expect(report.failures[0].reasons.join(' ')).toContain('non-gbs1 citations present');
    expect(report.failures[0].reasons.join(' ')).toContain('artifact strings present in answer');
  });

  test('enforces abstain correctness and length bounds', () => {
    const abstain = buildDeterministicAnswerEnvelope({
      ...baseRecall,
      evidence: [{ ...baseRecall.evidence[0], span_id: 'chunk:default:sources/test/citadel:1' }],
    });
    const report = evaluateAnswerPromotionCases([
      { id: 'abstain', envelope: abstain, expected_abstain: true },
    ]);

    expect(report.ok).toBe(false);
    expect(report.fail_count).toBe(1);
    expect(report.failures[0].reasons.join(' ')).toContain('non-gbs1 evidence present');
  });
});
