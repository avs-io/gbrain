import { describe, expect, test } from 'bun:test';
import { buildQueryFrame, classifyEvidenceSignals, clusterSignalsBySlot, selectAnswerShape, type EvidenceWindow } from '../../src/core/answer/index.ts';

function ev(id: string, quote: string, date?: string): EvidenceWindow {
  return { id: `gbs1:default:sources/test/${id}#compiled_truth:L1-L4`, source: { id: 'default', slug: `sources/test/${id}`, section: 'compiled_truth', date }, quote, quoteHash: id.repeat(16).slice(0, 64) };
}

describe('signal slot clustering', () => {
  test('assigns generic signals to selected shape slots with stable dedupe', () => {
    const frame = buildQueryFrame('What supplements were in the stack and when did the protocol shift? What was the measurement?');
    const shape = selectAnswerShape(frame);
    const signals = classifyEvidenceSignals([
      ev('a', 'Supplement stack: Vitamin C 500mg, NAC 600mg, Metformin. The protocol shifted to iron. Ferritin 19.9 ng/mL.'),
      ev('b', 'The protocol shifted to iron. Ferritin 19.9 ng/mL.'),
    ], frame);
    const clusters = clusterSignalsBySlot(signals, shape);

    expect(shape.id).toBe('protocol_or_stack_change');
    expect(clusters.find(c => c.slotId === 'stack')?.signals.length).toBeGreaterThan(0);
    expect(clusters.find(c => c.slotId === 'change')?.signals.length).toBeGreaterThan(0);
    expect(clusters.find(c => c.slotId === 'measurement')?.signals.map(s => s.text)).toEqual(['Ferritin 19.9 ng/mL.']);
  });

  test('builds deterministic groups by slot/entity/source/date/role', () => {
    const frame = buildQueryFrame('What changed in the Eonic direction and why?');
    const shape = selectAnswerShape(frame);
    const signals = classifyEvidenceSignals([
      ev('2026-05-01-eonic', 'Eonic shifted to a warmer Android health direction because trust mattered.', '2026-05-01'),
      ev('2026-05-02-eonic', 'Eonic shifted to a warmer Android health direction because trust mattered.', '2026-05-02'),
    ], frame);
    const clusters = clusterSignalsBySlot(signals, shape);
    const rationale = clusters.find(c => c.slotId === 'rationale');

    expect(rationale?.groups.length).toBe(2);
    expect(rationale?.groups.map(g => g.key)).toEqual([
      expect.objectContaining({ slotId: 'rationale', normalizedEntityOrConcept: 'eonic', sourceEpisode: 'sources/test/2026-05-01-eonic', sourceDate: '2026-05-01', role: 'decision_rationale' }),
      expect.objectContaining({ slotId: 'rationale', normalizedEntityOrConcept: 'eonic', sourceEpisode: 'sources/test/2026-05-02-eonic', sourceDate: '2026-05-02', role: 'decision_rationale' }),
    ]);
  });
});
