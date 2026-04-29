import { describe, expect, test } from 'bun:test';
import { proposeMemoryAtomFromSpan } from '../../src/core/ai/memory-atom-proposal.ts';

describe('memory atom proposal claim support', () => {
  test('direct_quote proposals verify the quote against evidence', () => {
    const result = proposeMemoryAtomFromSpan({
      span_id: 'gbs1:src:page#section:L1-L2',
      quote: 'Chief prefers review-only proposal flows for memory atoms.',
      claim: 'Chief prefers review-only proposal flows for memory atoms.',
      atom_type: 'semantic_fact',
      suggested_namespace: 'personal',
      sensitivity: 'P1',
    });
    expect(result.ok).toBe(true);
    expect(result.proposal?.support_level).toBe('direct_quote');
  });
});
