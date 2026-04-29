import { describe, expect, test } from 'bun:test';
import { buildQueryFrame, classifyEvidenceSignals, clusterSignalsBySlot, compileClaims, renderDeterministicAnswer, selectAnswerShape, type EvidenceWindow } from '../../src/core/answer/index.ts';

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
});
