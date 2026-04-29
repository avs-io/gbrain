import { describe, expect, test } from 'bun:test';
import { validateClaimCitations, type ClaimAtom, type EvidenceWindow } from '../../src/core/answer/index.ts';

const evidence: EvidenceWindow[] = [
  {
    id: 'gbs1:default:sources/test/page#compiled_truth:L1-L2',
    source: { id: 'default', slug: 'sources/test/page', section: 'compiled_truth', lineRange: { start: 1, end: 2 } },
    quote: 'Supported quote.',
    quoteHash: 'b'.repeat(64),
    score: 0.9,
  },
];

function claim(overrides: Partial<ClaimAtom> = {}): ClaimAtom {
  return {
    id: 'claim_1',
    kind: 'direct_quote',
    text: 'Supported quote.',
    factual: true,
    citations: [{ id: evidence[0].id, label: 'S1', quoteHash: evidence[0].quoteHash }],
    ...overrides,
  };
}

describe('validateClaimCitations', () => {
  test('accepts factual claims supported by present gbs1 evidence', () => {
    expect(validateClaimCitations([claim()], evidence)).toEqual({ ok: true, errors: [] });
  });

  test('rejects factual claims without support citations', () => {
    const result = validateClaimCitations([claim({ citations: [] })], evidence);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('no support citations');
  });

  test('rejects non-gbs1 citations', () => {
    const result = validateClaimCitations([claim({ citations: [{ id: 'chunk:abc', label: 'S1' }] })], evidence);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('non-gbs1');
  });

  test('rejects citations missing from normalized evidence', () => {
    const result = validateClaimCitations([claim({ citations: [{ id: 'gbs1:default:sources/other#compiled_truth:L1-L1', label: 'S1' }] })], evidence);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('not present');
  });

  test('rejects quote-hash mismatches when both sides provide a hash', () => {
    const result = validateClaimCitations([claim({ citations: [{ id: evidence[0].id, label: 'S1', quoteHash: 'c'.repeat(64) }] })], evidence);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('quote-hash mismatch');
  });
});
