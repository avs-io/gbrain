import { describe, expect, test } from 'bun:test';
import { buildQueryFrame, classifyEvidenceSignals, clusterSignalsBySlot, compileClaims, renderDeterministicAnswer, selectAnswerShape, validateRenderedAnswerCitations, type EvidenceWindow } from '../../src/core/answer/index.ts';

function ev(id: string, quote: string): EvidenceWindow {
  return { id: `gbs1:default:sources/test/${id}#compiled_truth:L1-L4`, source: { id: 'default', slug: `sources/test/${id}`, section: 'compiled_truth', lineRange: { start: 1, end: 4 } }, quote, quoteHash: id.repeat(16).slice(0, 64) };
}

describe('deterministic renderer', () => {
  test('renders sectioned text from claim atoms with citation labels and missing slots', () => {
    const frame = buildQueryFrame('Why did Project Atlas change?');
    const evidence = [ev('a', 'Project Atlas was too static. The better direction was living memory.')];
    const shape = selectAnswerShape(frame);
    const clusters = clusterSignalsBySlot(classifyEvidenceSignals(evidence, frame), shape);
    const compiled = compileClaims(clusters, evidence, frame);
    const rendered = renderDeterministicAnswer(compiled.claims, clusters, shape, evidence, compiled.missingSlots);

    expect(rendered.answer).toContain('Decision arc:');
    expect(rendered.answer).toContain('[S1]');
    expect(rendered.sections.length).toBeGreaterThan(0);
    expect(rendered.citations.every(c => c.id.startsWith('gbs1:'))).toBe(true);
  });

  test('suppresses empty sections and avoids orphan section ids when claims dedupe away', () => {
    const frame = buildQueryFrame('Why did Project Atlas change?');
    const evidence = [ev('a', 'Project Atlas was too static. The better direction was living memory.')];
    const shape = selectAnswerShape(frame);
    const clusters = clusterSignalsBySlot(classifyEvidenceSignals(evidence, frame), shape);
    const compiled = compileClaims(clusters, evidence, frame);

    const patchedClaims = compiled.claims.map(claim => claim.slotId === 'rationale' ? { ...claim, text: '', citations: [] } : claim);
    const rendered = renderDeterministicAnswer(patchedClaims, clusters, shape, evidence, compiled.missingSlots);

    expect(rendered.sections.some(section => section.id === 'rationale')).toBe(false);
    expect(rendered.answer).not.toContain('Rationale:');
    expect(rendered.sections.every(section => section.claimIds.length > 0)).toBe(true);
  });

  test('renders stack aggregates as item-level cited bullets', () => {
    const frame = buildQueryFrame('What supplements were in the stack?');
    const evidence = [
      ev('b', 'Vitamin C 500mg and Folic acid 5mg.'),
      ev('c', 'NAC 600mg and Magnesium Glycinate.'),
    ];
    const shape = selectAnswerShape(frame);
    const clusters = clusterSignalsBySlot(classifyEvidenceSignals(evidence, frame), shape);
    const compiled = compileClaims(clusters, evidence, frame);
    const rendered = renderDeterministicAnswer(compiled.claims, clusters, shape, evidence, compiled.missingSlots);

    expect(rendered.answer).toContain('- Vitamin C 500mg and Folic acid 5mg. [S1]');
    expect(rendered.answer).toContain('- NAC 600mg and Magnesium Glycinate. [S2]');
    expect(validateRenderedAnswerCitations(rendered.answer, compiled.claims).ok).toBe(true);
  });
});
