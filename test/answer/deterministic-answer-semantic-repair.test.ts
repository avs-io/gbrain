import { describe, expect, test } from 'bun:test';
import { buildDeterministicAnswerEnvelope, validateClaimCitations, validateRenderedAnswerCitations, type ClaimAtom, type EvidenceWindow } from '../../src/core/answer/index.ts';
import type { RecallEvidence, RecallResult } from '../../src/core/evidence/recall.ts';

function evidence(slug: string, quote: string, score = 0.9): RecallEvidence {
  return {
    span_id: `gbs1:default:${slug}#compiled_truth:L1-L3`,
    source_id: 'default',
    slug,
    title: slug.split('/').pop(),
    section: 'compiled_truth',
    start_line: 1,
    end_line: 3,
    quote,
    quote_hash: slug.replace(/[^a-z0-9]/gi, 'a').padEnd(64, 'a').slice(0, 64),
    line_basis: 'stored_section',
    matched_by: 'exact',
    score,
  };
}

function recall(query: string, rows: RecallEvidence[]): RecallResult {
  return { query, status: 'hit', evidence: rows, warnings: [], integration: { search_source: 'direct' } };
}

describe('deterministic-v2 semantic repair invariants', () => {
  test('rendered factual sentences carry exact gbs1 citations and metadata-rich source refs', () => {
    const envelope = buildDeterministicAnswerEnvelope(recall('What was the idea before Rail X and why was Rail X not pursued?', [
      evidence('sources/chatgpt/full-export-all/2025-09-11-rail-x', 'The prior option was Agent Commerce Clearinghouse. Rail X was rejected because network leverage was low. Later it became a module.'),
    ]), { maxEvidence: 5 });

    expect(envelope.validation.ok).toBe(true);
    expect(envelope.answer).toContain('[S1]');
    expect(envelope.claims.filter(claim => claim.factual).every(claim => claim.citations.every(citation => citation.id.startsWith('gbs1:')))).toBe(true);
    expect(envelope.citations[0].source).toMatchObject({ slug: 'sources/chatgpt/full-export-all/2025-09-11-rail-x', date: '2025-09-11', lineRange: { start: 1, end: 3 } });
    expect(validateRenderedAnswerCitations(envelope.answer, envelope.claims).ok).toBe(true);
  });

  test('assistant-only proposals are not treated as user belief while user acceptance remains eligible', () => {
    const assistantOnly = buildDeterministicAnswerEnvelope(recall('Why was Project Nova not pursued?', [
      evidence('sources/test/assistant-only', 'Assistant: Project Nova was rejected because the market was too small.'),
    ]));
    const userAccepted = buildDeterministicAnswerEnvelope(recall('Why was Project Nova not pursued?', [
      evidence('sources/test/user-accepted', 'User: Project Nova was rejected because the market was too small.'),
    ]));

    expect(assistantOnly.answer).not.toContain('market was too small');
    expect(assistantOnly.diagnostics?.top_unclassified_windows[0]?.reason).toContain('no non-distractor');
    expect(userAccepted.answer).toContain('market was too small');
  });

  test('conflicting current-status evidence renders a conflict notice and freshness caveat', () => {
    const envelope = buildDeterministicAnswerEnvelope(recall('Is Eonic currently active?', [
      evidence('sources/test/2026-04-26-eonic-active', 'Eonic is currently active and ongoing.'),
      evidence('sources/test/2026-04-20-eonic-dormant', 'Eonic is dormant and no longer active.'),
    ]), { maxEvidence: 5 });

    expect(envelope.status).toBe('partial');
    expect(envelope.conflicts.length).toBeGreaterThan(0);
    expect(envelope.claims.some(claim => claim.kind === 'conflict_notice')).toBe(true);
    expect(envelope.answer).toContain('Conflicting source-backed evidence');
    expect(envelope.answer).toContain('Freshness caveat');
    expect(envelope.warnings.join(' ')).toContain('historical recall');
  });

  test('requested marker/aspect with no matching slot evidence becomes a partial missing slot', () => {
    const envelope = buildDeterministicAnswerEnvelope(recall('What was the ferritin marker in the protocol?', [
      evidence('sources/test/protocol-only', 'The protocol stack listed Vitamin C and Magnesium Glycinate.'),
    ]));

    expect(envelope.status).toBe('partial');
    expect(envelope.missingSlots).toContain('measurement');
  });

  test('citation validator fails closed on unsupported literal values and unsafe rendered citation gaps', () => {
    const ev: EvidenceWindow = { id: 'gbs1:default:sources/test/a#compiled_truth:L1-L1', source: { id: 'default', slug: 'sources/test/a', section: 'compiled_truth' }, quote: 'Ferritin was 19.9 ng/mL.', quoteHash: 'a'.repeat(64) };
    const badClaim: ClaimAtom = { id: 'claim_bad', kind: 'normalized_fact', text: 'Ferritin was 99.9 ng/mL.', factual: true, citations: [{ id: ev.id, label: 'S1', quoteHash: ev.quoteHash }] };

    expect(validateClaimCitations([badClaim], [ev]).ok).toBe(false);
    expect(validateRenderedAnswerCitations('- Ferritin was 99.9 ng/mL.', [badClaim]).ok).toBe(false);
  });
});
