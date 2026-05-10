import { describe, expect, test } from 'bun:test';
import { buildDeterministicAnswerEnvelope } from '../../src/core/answer/index.ts';
import type { RecallEvidence, RecallResult } from '../../src/core/evidence/recall.ts';

function evidence(id: string, quote: string, score = 0.9): RecallEvidence {
  return {
    span_id: `gbs1:default:sources/test/${id}#compiled_truth:L1-L3`,
    source_id: 'default',
    slug: `sources/test/${id}`,
    title: id,
    section: 'compiled_truth',
    start_line: 1,
    end_line: 3,
    quote,
    quote_hash: id.padEnd(64, id[0] ?? 'a').slice(0, 64),
    line_basis: 'stored_section',
    matched_by: 'exact',
    score,
  };
}

function recall(query: string, rows: RecallEvidence[]): RecallResult {
  return { query, status: 'hit', evidence: rows, warnings: [], integration: { search_source: 'direct' } };
}

function claimSignature(result: ReturnType<typeof buildDeterministicAnswerEnvelope>): unknown {
  return result.claims.map(claim => ({
    kind: claim.kind,
    slotId: claim.slotId,
    text: claim.text,
    citations: claim.citations.map(citation => citation.id).sort(),
  }));
}

describe('deterministic-v2 metamorphic behavior', () => {
  test('high-rank distractors are not cited or rendered when they do not match the requested slot', () => {
    const query = 'Why was Rail Z not pursued?';
    const relevant = evidence('rail-z', 'Rail Z was rejected because distribution risk was too high. Later the stronger direction was a service layer.', 0.7);
    const distractor = evidence('high-rank-distractor', 'Green tea dosage had unrelated lab notes and should not be used for the rail decision.', 0.99);
    const result = buildDeterministicAnswerEnvelope(recall(query, [distractor, relevant]), { maxEvidence: 5 });

    expect(result.validation.ok).toBe(true);
    expect(result.answer).toContain('distribution risk');
    expect(result.answer).not.toContain('Green tea');
    expect(JSON.stringify(result.claims)).not.toContain(distractor.span_id);
  });

  test('synthetic renamed entities preserve shape and supported answer behavior', () => {
    const a = buildDeterministicAnswerEnvelope(recall('What was the idea before Rail Z and why was Rail Z not pursued?', [
      evidence('rail-z', 'The prior option was Ledger Bridge. Rail Z was rejected because customer risk was too high. Later it became a smaller module.'),
    ]));
    const b = buildDeterministicAnswerEnvelope(recall('What was the idea before Project Nova and why was Project Nova not pursued?', [
      evidence('project-nova', 'The prior option was Signal Hub. Project Nova was rejected because customer risk was too high. Later it became a smaller module.'),
    ]));

    expect(a.shape).toBe('decision_arc');
    expect(b.shape).toBe('decision_arc');
    expect(a.validation.ok).toBe(true);
    expect(b.validation.ok).toBe(true);
    expect(b.answer).toContain('Signal Hub');
  });

  test('stable relevant evidence plus distractor produces the same claim signature under evidence shuffle', () => {
    const query = 'What was the idea before Rail X and why was Rail X not pursued?';
    const relevant = evidence('rail-x', 'The prior option was Agent Commerce Clearinghouse. Rail X was rejected due to low network leverage. Later it became a module on the stronger base rail.');
    const distractor = evidence('distractor', 'Green tea safety research was unrelated to the rail decision.', 0.99);
    const one = buildDeterministicAnswerEnvelope(recall(query, [relevant, distractor]), { maxEvidence: 5 });
    const two = buildDeterministicAnswerEnvelope(recall(query, [distractor, relevant]), { maxEvidence: 5 });

    expect(claimSignature(two)).toEqual(claimSignature(one));
  });
});
