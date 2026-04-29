import { describe, expect, test } from 'bun:test';
import { pruneEvidenceForSynthesis } from '../../src/core/answer/evidence-prune.ts';
import { buildDeterministicAnswerEnvelope } from '../../src/core/answer/index.ts';
import type { RecallEvidence, RecallResult } from '../../src/core/evidence/recall.ts';

function evidence(span: string, quote: string, sourceSlug = 'sources/test/a', hash = span.slice(-8)): RecallEvidence {
  return {
    span_id: span,
    source_id: 'default',
    slug: sourceSlug,
    title: sourceSlug.split('/').pop(),
    section: 'compiled_truth',
    start_line: 1,
    end_line: 2,
    quote,
    quote_hash: hash,
    line_basis: 'stored_section',
    matched_by: 'exact',
    score: 0.9,
  };
}

function recall(query: string, evidenceRows: RecallEvidence[]): RecallResult {
  return { query, status: 'hit', evidence: evidenceRows, warnings: [], integration: { search_source: 'direct' } };
}

describe('evidence prune for synthesis', () => {
  test('duplicate span removed', () => {
    const one = evidence('gbs1:default:s1#compiled_truth:L1-L2', 'alpha');
    const dup = { ...one };
    const result = pruneEvidenceForSynthesis([one as any, dup as any], { preferExactGbs1: false });
    expect(result.evidence).toHaveLength(1);
    expect(result.stats.removedDuplicateSpan).toBe(1);
  });

  test('duplicate quote removed', () => {
    const one = evidence('gbs1:default:s1#compiled_truth:L1-L2', 'same quote', 'sources/test/a', 'hash-a');
    const dup = evidence('gbs1:default:s2#compiled_truth:L3-L4', 'same quote', 'sources/test/b', 'hash-b');
    const result = pruneEvidenceForSynthesis([one as any, dup as any], { preferExactGbs1: false });
    expect(result.evidence).toHaveLength(1);
    expect(result.stats.removedDuplicateQuoteText).toBe(1);
  });

  test('non-gbs1 and syn excluded', () => {
    const syn = evidence('syn:foo', 'synthetic');
    const non = evidence('turn1search1', 'web');
    const exact = evidence('gbs1:default:s1#compiled_truth:L1-L2', 'real');
    const result = pruneEvidenceForSynthesis([syn as any, non as any, exact as any], { preferExactGbs1: false });
    expect(result.evidence.map(item => item.id)).toEqual([exact.span_id]);
    expect(result.stats.removedNonExact).toBe(2);
  });

  test('per-source cap enforced deterministically', () => {
    const rows = [
      evidence('gbs1:default:s1#compiled_truth:L1-L2', 'a', 'sources/test/a', '1'),
      evidence('gbs1:default:s2#compiled_truth:L3-L4', 'b', 'sources/test/a', '2'),
      evidence('gbs1:default:s3#compiled_truth:L5-L6', 'c', 'sources/test/a', '3'),
      evidence('gbs1:default:s4#compiled_truth:L7-L8', 'd', 'sources/test/b', '4'),
    ];
    const result = pruneEvidenceForSynthesis(rows as any, { maxEvidence: 10, maxPerSource: 2, preferExactGbs1: false });
    expect(result.evidence.filter(item => item.source.slug === 'sources/test/a')).toHaveLength(2);
    expect(result.stats.removedPerSource).toBe(1);
  });

  test('deterministic ordering prefers higher score then stable input order', () => {
    const low = { ...evidence('gbs1:default:s1#compiled_truth:L1-L2', 'low'), score: 0.1 };
    const high = { ...evidence('gbs1:default:s2#compiled_truth:L3-L4', 'high'), score: 0.9 };
    const same = { ...evidence('gbs1:default:s3#compiled_truth:L5-L6', 'same'), score: 0.9 };
    const one = pruneEvidenceForSynthesis([low as any, high as any, same as any], { preferExactGbs1: false });
    const two = pruneEvidenceForSynthesis([same as any, low as any, high as any], { preferExactGbs1: false });
    expect(one.evidence.map(item => item.id)).toEqual(two.evidence.map(item => item.id));
  });

  test('claim compiler still works with pruned evidence', () => {
    const envelope = buildDeterministicAnswerEnvelope(recall(
      'What was the idea before Rail X and why was Rail X not pursued?',
      [
        evidence('gbs1:default:rail#compiled_truth:L1-L2', 'The prior option was Agent Commerce Clearinghouse. Rail X was rejected due to low network leverage.'),
        evidence('gbs1:default:rail#compiled_truth:L3-L4', 'The prior option was Agent Commerce Clearinghouse. Rail X was rejected due to low network leverage.'),
        evidence('syn:rail', 'synthetic distraction'),
      ],
    ));

    expect(envelope.status).toBe('hit');
    expect(envelope.answer).toContain('Agent Commerce Clearinghouse');
    expect(envelope.answer).toContain('low network leverage');
    expect(envelope.evidence.every(item => item.id.startsWith('gbs1:'))).toBe(true);
  });
});
