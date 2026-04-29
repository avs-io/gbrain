import { describe, expect, test } from 'bun:test';
import { verifyClaimSupport } from '../../src/core/ai/claim-support-verifier.ts';

const span = (span_id: string, quote: string) => ({ span_id, quote });

describe('claim support verifier', () => {
  test('supports direct quote when claim is contained in gbs1 evidence', () => {
    const result = verifyClaimSupport({
      claim: 'Chief prefers review-only proposal flows for memory atoms.',
      evidence_spans: [span('gbs1:src:page#section:L1-L2', 'Chief prefers review-only proposal flows for memory atoms.')],
    });
    expect(result.ok).toBe(true);
    expect(result.support_level).toBe('direct_quote');
    expect(result.evidence_span_ids).toEqual(['gbs1:src:page#section:L1-L2']);
  });

  test('rejects synthetic and non-gbs1 evidence', () => {
    expect(() => verifyClaimSupport({ claim: 'x', evidence_spans: [span('syn:1', 'x')] })).toThrow('gbs1 spans');
  });

  test('unsupported on wrong date/person/number hard negatives', () => {
    const result = verifyClaimSupport({
      claim: 'Chief moved the meeting to 2027 with Anu and 42 people.',
      evidence_spans: [span('gbs1:src:page#section:L1-L2', 'Chief moved the meeting to 2026 with Anu and 4 people.')],
    });
    expect(result.ok).toBe(false);
    expect(result.support_level).toBe('contradicted');
  });

  test('low overlap is unsupported', () => {
    const result = verifyClaimSupport({
      claim: 'This is unrelated.',
      evidence_spans: [span('gbs1:src:page#section:L1-L2', 'Completely different evidence window.')],
    });
    expect(result.ok).toBe(false);
    expect(result.support_level).toBe('unsupported');
  });

  test('strong inference requires explanation and multiple spans', () => {
    const result = verifyClaimSupport({
      claim: 'Chief was moving toward Sovereign AI as the primary track.',
      explanation: 'Two separate windows show the transition and the prioritization.',
      evidence_spans: [
        span('gbs1:src:page#section:L1-L2', 'Sovereign AI became more immediate and actionable.'),
        span('gbs1:src:page#section2:L3-L4', 'Eonic stayed parallel while momentum moved to Sovereign AI.'),
      ],
    });
    expect(result.ok).toBe(true);
    expect(['strong_inference', 'weak_inference']).toContain(result.support_level);
  });
});
