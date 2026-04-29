import { describe, expect, test } from 'bun:test';
import { buildRegressionPackArtifact } from '../../src/core/answer/regression-pack.ts';
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
    evidence: [],
    claims: [],
    citations: [],
    warnings: [],
    missingSlots: [],
    conflicts: [],
    bounds: { deterministic: true, abstain_if_no_exact_span: true, max_evidence: 4, max_quote_chars: 420 },
    validation: { ok: true, errors: [] },
    integration: { search_source: 'direct' } as any,
    ...overrides,
  };
}

describe('answer-v2 regression pack', () => {
  test('omits envelopes by default and preserves pack summary', () => {
    const artifact = buildRegressionPackArtifact(
      { schema: 'gbrain.answer_promotion_eval.v1', ok: true, pass_count: 1, fail_count: 0, failures: [], gate_version: 'answer-v2-promotion-gate.v1', recommendation: 'eligible_for_limited_exposure' },
      [{ id: 'case-1', query: 'q', envelope: makeEnvelope({ warnings: ['w1'] }), recall_diagnostics: { schema: 'gbrain.recall_diagnostics.v1', ok: true, query: 'q', evidence_count: 2, gbs1_count: 2, non_gbs1_count: 0, duplicate_span_count: 0, source_count: 1, top_sources: [], warnings: ['diag'], recommendation: 'good_for_synthesis' } }],
      { generatedAt: '2026-04-30T00:00:00.000Z', commit: 'abc123' },
    );

    expect(artifact.schema).toBe('gbrain.answer_v2_regression_pack.v1');
    expect(artifact.cases[0].envelope).toBeUndefined();
    expect(artifact.cases[0].promotion_pass).toBe(true);
    expect(artifact.cases[0].recall_diagnostics?.recommendation).toBe('good_for_synthesis');
  });

  test('includes envelopes only when requested', () => {
    const artifact = buildRegressionPackArtifact(
      { schema: 'gbrain.answer_promotion_eval.v1', ok: false, pass_count: 0, fail_count: 1, failures: [{ case_id: 'case-1', reasons: ['x'] }], gate_version: 'answer-v2-promotion-gate.v1', recommendation: 'keep_hidden' },
      [{ id: 'case-1', query: 'q', envelope: makeEnvelope({ status: 'abstain', warnings: [] }), warnings: ['x'] }],
      { generatedAt: '2026-04-30T00:00:00.000Z', includeEnvelopes: true },
    );

    expect(artifact.cases[0].envelope).toMatchObject({ status: 'abstain', warnings: [] });
    expect(artifact.cases[0].promotion_pass).toBe(false);
  });
});
