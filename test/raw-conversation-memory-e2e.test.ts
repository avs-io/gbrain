import { describe, expect, test } from 'bun:test';
import { proposeMemoryAtomFromSpan } from '../src/core/ai/memory-atom-proposal.ts';
import { verifyClaimSupport } from '../src/core/ai/claim-support-verifier.ts';
import { buildSyntheticQueryCase } from '../src/core/synthetic/cluster-factory.ts';
import { buildDeterministicAnswerEnvelope } from '../src/core/answer/index.ts';
import type { RecallEvidence, RecallResult } from '../src/core/evidence/recall.ts';

const spanId = 'gbs1:default:sources/chatgpt/full-export-all/2026-05-08-memory-e2e#compiled_truth:L1-L2';
const quote = 'Chief: Project Lotus was paused because the wedge lacked urgency.';
const claim = 'Project Lotus was paused because the wedge lacked urgency.';

function recall(query: string, rows: RecallEvidence[]): RecallResult {
  return { query, status: 'hit', evidence: rows, warnings: [], integration: { search_source: 'direct' } };
}

describe('raw conversation to atom/eval/answer chain', () => {
  test('turns one raw conversation span into verified proposal, eval case, and cited deterministic answer', () => {
    const support = verifyClaimSupport({ claim, evidence_spans: [{ span_id: spanId, quote, source_item_id: 'default:sources/chatgpt/full-export-all/2026-05-08-memory-e2e' }] });
    expect(support.ok).toBe(true);
    expect(support.support_level).toBe('direct_quote');

    const proposalResult = proposeMemoryAtomFromSpan({
      span_id: spanId,
      quote,
      claim,
      atom_type: 'semantic_fact',
      subject_entities: ['Project Lotus'],
      suggested_namespace: 'personal',
      sensitivity: 'P2',
      now: new Date('2026-05-08T09:45:00.000Z'),
    });
    expect(proposalResult.ok).toBe(true);
    expect(proposalResult.proposal?.review_only).toBe(true);
    expect(proposalResult.proposal?.support_level).toBe('direct_quote');

    const evalCase = buildSyntheticQueryCase({
      seed: { span_id: spanId, quote, claim, source_item_id: 'default:sources/chatgpt/full-export-all/2026-05-08-memory-e2e', topic: 'Project Lotus' },
      shape: 'why_not',
      topic: 'Project Lotus',
    });
    expect(evalCase.eval_only).toBe(true);
    expect(evalCase.training_only).toBe(false);
    expect(evalCase.eligible_for_memory).toBe(false);
    expect(evalCase.seed_evidence_span_ids).toEqual([spanId]);

    const envelope = buildDeterministicAnswerEnvelope(recall('Why was Project Lotus paused?', [{
      span_id: spanId,
      source_id: 'default',
      slug: 'sources/chatgpt/full-export-all/2026-05-08-memory-e2e',
      title: 'memory e2e',
      section: 'compiled_truth',
      start_line: 1,
      end_line: 2,
      quote,
      quote_hash: 'e'.repeat(64),
      line_basis: 'stored_section',
      matched_by: 'exact',
      score: 0.99,
    }]));

    expect(envelope.validation.ok).toBe(true);
    expect(envelope.answer).toContain('wedge lacked urgency');
    expect(envelope.answer).toContain('[S1]');
    expect(envelope.claims.filter(c => c.factual).every(c => c.citations.every(ref => ref.id === spanId))).toBe(true);
  });
});
