import { describe, expect, test } from 'bun:test';
import { buildQueryFrame, classifyEvidenceSignals, type EvidenceWindow } from '../../src/core/answer/index.ts';

function ev(id: string, quote: string): EvidenceWindow {
  return { id: `gbs1:default:sources/test/${id}#compiled_truth:L1-L3`, source: { id: 'default', slug: `sources/test/${id}`, section: 'compiled_truth', lineRange: { start: 1, end: 3 } }, quote, quoteHash: id.repeat(8).slice(0, 64) };
}

describe('evidence signal classifier', () => {
  test('classifies relationship positive and friction signals', () => {
    const frame = buildQueryFrame('What was my relationship with Person Alpha like and what friction incidents existed?');
    const signals = classifyEvidenceSignals([
      ev('aaaa', 'Person Alpha placed trust in me and shaped my rigor. The workplace was high friction and toxic.'),
    ], frame);
    expect(signals.map(s => s.role)).toEqual(expect.arrayContaining(['relationship_positive_signal', 'relationship_friction_signal']));
    expect(signals.some(s => s.confidence === 'high' || s.confidence === 'medium')).toBe(true);
  });

  test('classifies decision rationale, deprioritization, protocol change and measurement', () => {
    const frame = buildQueryFrame('Why was Rail X not pursued and when did the protocol shift? What was ferritin?');
    const signals = classifyEvidenceSignals([
      ev('bbbb', 'Rail X was rejected due to low network leverage. The stack shifted to 100mg ferrous ascorbate. Ferritin was 19.9 ng/mL.'),
    ], frame);
    expect(signals.map(s => s.role)).toEqual(expect.arrayContaining(['deprioritization_signal', 'protocol_change', 'measurement']));
  });

  test('marks unrelated windows as distractors', () => {
    const frame = buildQueryFrame('Why did Project Atlas change?');
    const signals = classifyEvidenceSignals([ev('cccc', 'Green tea tastes bitter in the morning.')], frame);
    expect(signals.every(s => s.role === 'distractor' || s.confidence === 'low')).toBe(true);
  });
});
