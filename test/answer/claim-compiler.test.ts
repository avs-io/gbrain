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

  test('prefers formative relationship sentences and avoids later-state clutter', () => {
    const frame = buildQueryFrame('What was my relationship with Archana like?');
    const evidence = [
      ev('d', 'Archana was formative and trusted. Later, things became more transactional and messy.'),
    ];
    const shape = selectAnswerShape(frame);
    const clusters = clusterSignalsBySlot(classifyEvidenceSignals(evidence, frame), shape);
    const compiled = compileClaims(clusters, evidence, frame);

    const frameClaim = compiled.claims.find(claim => claim.slotId === 'relationship_frame');
    expect(frameClaim?.text).toContain('formative');
    expect(frameClaim?.text).toContain('trusted');
    expect(frameClaim?.text).not.toContain('Later, things became more transactional and messy');
  });

  test('prefers rationale sentences with because/why/incumbent framing', () => {
    const frame = buildQueryFrame('Why was ACC not pursued?');
    const evidence = [
      ev('e', 'ACC was not pursued because incumbents already bundled escrow and chargeback tooling, so the reason was zero lock-in and low leverage.'),
    ];
    const shape = selectAnswerShape(frame);
    const clusters = clusterSignalsBySlot(classifyEvidenceSignals(evidence, frame), shape);
    const compiled = compileClaims(clusters, evidence, frame);

    const rationale = compiled.claims.find(claim => claim.slotId === 'rationale');
    expect(rationale?.text).toContain('because');
    expect(rationale?.text).toContain('incumbents');
    expect(rationale?.text).toContain('zero lock-in');
  });

  test('aggregates stack item signals across windows instead of keeping only one window', () => {
    const frame = buildQueryFrame('What supplements was Anu taking?');
    const evidence = [
      ev('f', 'Maternal Supplementation Stack (Already Taken Daily): Vitamin C + Quercetin 500mg, Folic acid 5mg, Methylfolate + Methylcobalamin.'),
      ev('g', 'NMN 500mg, NAC 600mg, Phosphatidylcholine 2g, Magnesium Glycinate, Metformin.'),
    ];
    const shape = selectAnswerShape(frame);
    const clusters = clusterSignalsBySlot(classifyEvidenceSignals(evidence, frame), shape);
    const compiled = compileClaims(clusters, evidence, frame, { maxQuoteChars: 320 });

    const stack = compiled.claims.find(claim => claim.slotId === 'stack');
    expect(stack?.text).toContain('NMN 500mg');
    expect(stack?.text).toContain('NAC 600mg');
    expect(stack?.text).toContain('Phosphatidylcholine 2g');
    expect(stack?.text).toContain('Magnesium Glycinate');
    expect(stack?.text).toContain('Metformin');
  });
});
