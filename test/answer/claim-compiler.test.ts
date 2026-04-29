import { describe, expect, test } from 'bun:test';
import { buildQueryFrame, classifyEvidenceSignals, clusterSignalsBySlot, compileClaims, selectAnswerShape, validateClaimCitations, type EvidenceWindow } from '../../src/core/answer/index.ts';

function ev(id: string, quote: string): EvidenceWindow {
  return { id: `gbs1:default:sources/test/${id}#compiled_truth:L1-L4`, source: { id: 'default', slug: `sources/test/${id}`, section: 'compiled_truth' }, quote, quoteHash: id.repeat(16).slice(0, 64) };
}

describe('claim compiler', () => {
  test('compiles factual claims with valid citations and no distractor claims', () => {
    const frame = buildQueryFrame('What was the idea before Rail X and why was Rail X not pursued?');
    const evidence = [
      ev('a', 'The prior option was Agent Commerce Clearinghouse. Rail X was rejected due to low network leverage.'),
      ev('b', 'Green tea safety research was unrelated.'),
    ];
    const shape = selectAnswerShape(frame);
    const clusters = clusterSignalsBySlot(classifyEvidenceSignals(evidence, frame), shape);
    const compiled = compileClaims(clusters, evidence, frame);

    expect(compiled.claims.some(claim => claim.text.includes('Green tea'))).toBe(false);
    expect(compiled.claims.filter(claim => claim.factual).length).toBeGreaterThan(0);
    expect(validateClaimCitations(compiled.claims, evidence).ok).toBe(true);
  });

  test('emits partial missing-slot absence notice for required slots without high/medium evidence', () => {
    const frame = buildQueryFrame('Why did Project Atlas change?');
    const evidence = [ev('c', 'Project Atlas was mentioned once.')];
    const shape = selectAnswerShape(frame);
    const clusters = clusterSignalsBySlot(classifyEvidenceSignals(evidence, frame), shape);
    const compiled = compileClaims(clusters, evidence, frame);

    expect(compiled.missingSlots).toContain('rationale');
    expect(compiled.claims.some(claim => claim.kind === 'absence_notice' && !claim.factual)).toBe(true);
  });
});
