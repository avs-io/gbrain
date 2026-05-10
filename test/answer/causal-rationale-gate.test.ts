import { describe, expect, test } from 'bun:test';
import { buildDeterministicAnswerEnvelope } from '../../src/core/answer/index.ts';
import type { RecallEvidence, RecallResult } from '../../src/core/evidence/recall.ts';

function evidence(slug: string, quote: string): RecallEvidence {
  return {
    span_id: `gbs1:default:${slug}#compiled_truth:L1-L2`,
    source_id: 'default',
    slug,
    title: slug.split('/').pop(),
    section: 'compiled_truth',
    start_line: 1,
    end_line: 2,
    quote,
    quote_hash: 'c'.repeat(64),
    line_basis: 'stored_section',
    matched_by: 'exact',
    score: 0.9,
  };
}

function recall(query: string, rows: RecallEvidence[]): RecallResult {
  return { query, status: 'hit', evidence: rows, warnings: [], integration: { search_source: 'direct' } };
}

describe('causal / why rationale gate', () => {
  test('why answers require explicit rationale cues before emitting causal claims', () => {
    const noRationale = buildDeterministicAnswerEnvelope(recall('Why was Project Atlas paused?', [
      evidence('sources/test/atlas-status', 'Project Atlas used React. It launched in 2025.'),
    ]));
    expect(noRationale.status).toBe('partial');
    expect(noRationale.missingSlots).toContain('rationale');
    expect(noRationale.claims.some(claim => claim.slotId === 'rationale' && claim.factual)).toBe(false);
    expect(noRationale.answer).toContain('No high-confidence source-backed evidence was found for Rationale.');

    const withRationale = buildDeterministicAnswerEnvelope(recall('Why was Project Atlas paused?', [
      evidence('sources/test/atlas-rationale', 'Project Atlas was paused because customers lacked urgency.'),
    ]));
    expect(withRationale.status).toBe('hit');
    expect(withRationale.missingSlots).not.toContain('rationale');
    expect(withRationale.claims.some(claim => claim.slotId === 'rationale' && claim.factual && /because/i.test(claim.text))).toBe(true);
  });
});
