import { describe, expect, test } from 'bun:test';
import { buildQueryFrame, classifyEvidenceSignals, clusterSignalsBySlot, selectAnswerShape, type EvidenceWindow } from '../../src/core/answer/index.ts';

function ev(id: string, quote: string): EvidenceWindow {
  return { id: `gbs1:default:sources/test/${id}#compiled_truth:L1-L4`, source: { id: 'default', slug: `sources/test/${id}`, section: 'compiled_truth' }, quote, quoteHash: id.repeat(16).slice(0, 64) };
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
});
