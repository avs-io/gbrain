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

  test('splits dense protocol lists from measurement rationale in the same source window', () => {
    const frame = buildQueryFrame('What supplements were in the stack and what was ferritin?');
    const signals = classifyEvidenceSignals([
      ev('dddd', 'Maternal Supplementation Stack: Vitamin C + Quercetin 500mg, NMN 500mg, NAC 600mg, Magnesium Glycinate, Metformin. At 31-32 w with ferritin 19.9 ng/mL and FGR, the job is fetal iron endowment.'),
    ], frame);

    expect(signals.some(s => s.role === 'protocol_item' && /nmn|nac|magnesium|metformin/i.test(s.text))).toBe(true);
    expect(signals.some(s => s.role === 'measurement' && /ferritin|fgr|31-32 w/i.test(s.text))).toBe(true);
  });

  test('marks unrelated windows as distractors', () => {
    const frame = buildQueryFrame('Why did Project Atlas change?');
    const signals = classifyEvidenceSignals([ev('cccc', 'Green tea tastes bitter in the morning.')], frame);
    expect(signals.every(s => s.role === 'distractor' || s.confidence === 'low')).toBe(true);
  });

  test('requires query/aspect overlap or safe-listed measurement for non-distractor roles', () => {
    const rationaleFrame = buildQueryFrame('Why did Project Atlas change?');
    const rationaleSignals = classifyEvidenceSignals([
      ev('eeee', 'A random vendor was risky because its docs were unclear. Project Atlas changed because the old design was too static.'),
    ], rationaleFrame);

    expect(rationaleSignals.find(s => s.text.includes('random vendor'))?.role).toBe('decision_rationale');
    expect(rationaleSignals.find(s => s.text.includes('random vendor'))?.aspectOverlap).toContain('rationale');
    expect(rationaleSignals.find(s => s.text.includes('Project Atlas'))?.queryOverlapTerms).toEqual(expect.arrayContaining(['atlas', 'project']));

    const summaryFrame = buildQueryFrame('What changed in Project Atlas?');
    const summarySignals = classifyEvidenceSignals([ev('ffff', 'A random vendor was risky because its docs were unclear.')], summaryFrame);
    expect(summarySignals.every(s => s.role === 'distractor')).toBe(true);

    const measurementSignals = classifyEvidenceSignals([ev('gggg', 'Ferritin was 19.9 ng/mL.')], buildQueryFrame('What was the lab measurement?'));
    expect(measurementSignals[0].role).toBe('measurement');
    expect(measurementSignals[0].safeListed).toBe(true);
  });
});
