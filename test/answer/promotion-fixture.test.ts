import { describe, expect, test } from 'bun:test';
import { evaluateAnswerPromotionCases } from '../../src/core/answer/promotion-eval.ts';
import { analyzeRecallForAnswer } from '../../src/core/evidence/recall-diagnostics.ts';
import type { AnswerEnvelope } from '../../src/core/answer/types.ts';

function makeEnvelope(overrides: Partial<AnswerEnvelope> = {}): AnswerEnvelope {
  return {
    schema: 'gbrain.answer_envelope.v2',
    query: 'q',
    status: 'hit',
    synthesis: 'deterministic-v2',
    shape: 'general_multi_part_recall',
    queryFrame: { query: 'q', normalizedQuery: 'q', requestedAspects: [], entities: [], subquestions: [], cues: { multiPart: false, comparative: false, temporal: false } },
    answer: 'clean answer',
    sections: [],
    evidence: [{ id: 'gbs1:source#L1-L2', source: { id: 'source', slug: 'slug', section: 'compiled_truth' }, quote: 'x' } as any],
    claims: [{ id: 'claim-1', kind: 'direct_quote', text: 'clean answer', factual: true, citations: [{ id: 'gbs1:source#L1-L2', label: 'gbs1:source#L1-L2' }] } as any],
    citations: [{ id: 'gbs1:source#L1-L2', label: 'gbs1:source#L1-L2', evidenceId: 'gbs1:source#L1-L2', source: { id: 'source', slug: 'slug', section: 'compiled_truth' } } as any],
    warnings: [],
    missingSlots: [],
    conflicts: [],
    bounds: { deterministic: true, abstain_if_no_exact_span: true, max_evidence: 4, max_quote_chars: 420 },
    validation: { ok: true, errors: [] },
    integration: { search_source: 'direct' } as any,
    ...overrides,
  };
}

describe('answer-v2 promotion fixture/report formatting', () => {
  test('stable report shape for canonical fixtures', () => {
    const diagnostics = analyzeRecallForAnswer({ query: 'q', evidence: [{ span_id: 'gbs1:source#L1-L2', source_id: 'source', quote: 'x' }] } as any);
    expect(diagnostics.recommendation).toBe('good_for_synthesis');
    expect(diagnostics.schema).toBe('gbrain.recall_diagnostics.v1');
    const report = evaluateAnswerPromotionCases([
      { id: 'a', query: 'q', envelope: makeEnvelope() },
      { id: 'b', query: 'q2', envelope: makeEnvelope({ answer: 'clean answer 2' }) },
    ]);

    expect(report.schema).toBe('gbrain.answer_promotion_eval.v1');
    expect(report.ok).toBe(true);
    expect(report.pass_count).toBe(2);
    expect(report.fail_count).toBe(0);
    expect(report.gate_version).toBe('answer-v2-promotion-gate.v1');
    expect(report.recommendation).toBe('eligible_for_limited_exposure');
  });

  test('rejects non-gbs1 evidence in fixtures', () => {
    const report = evaluateAnswerPromotionCases([
      { id: 'bad', query: 'q', envelope: makeEnvelope({ evidence: [{ id: 'chunk:1' } as any] }) },
    ]);

    expect(report.ok).toBe(false);
    expect(report.failures[0].reasons).toContain('non-gbs1 evidence present');
  });
});
