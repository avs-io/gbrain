import { describe, expect, test } from 'bun:test';
import { buildQueryFrame, requiredSlotIdsForFrame, selectAnswerShape } from '../../src/core/answer/index.ts';

describe('generic answer shape selector', () => {
  test('selects relationship_recall for relationship and incident questions', () => {
    const frame = buildQueryFrame('What was my relationship with Person Alpha like and what high friction incidents existed?');
    const shape = selectAnswerShape(frame);

    expect(shape.id).toBe('relationship_recall');
    expect(requiredSlotIdsForFrame(frame, shape)).toEqual(expect.arrayContaining(['relationship_frame', 'incidents']));
  });

  test('selects decision_arc for prior option plus why/change questions', () => {
    const frame = buildQueryFrame('What was the idea before Rail X and why was Rail X not pursued?');
    const shape = selectAnswerShape(frame);

    expect(shape.id).toBe('decision_arc');
    expect(requiredSlotIdsForFrame(frame, shape)).toEqual(expect.arrayContaining(['decision_or_shift', 'rationale', 'prior_option']));
  });

  test('selects protocol_or_stack_change for stack, shift, and measurement questions', () => {
    const frame = buildQueryFrame('What supplements was Patient Z using and when did the stack shift? What was the ferritin measurement?');
    const shape = selectAnswerShape(frame);

    expect(shape.id).toBe('protocol_or_stack_change');
    expect(requiredSlotIdsForFrame(frame, shape)).toEqual(expect.arrayContaining(['stack', 'change', 'measurement', 'timeline']));
  });

  test('selects concept_evolution for definition plus evolution questions', () => {
    const frame = buildQueryFrame('What was North Star and how did the concept evolve into a world model?');
    const shape = selectAnswerShape(frame);

    expect(shape.id).toBe('concept_evolution');
    expect(requiredSlotIdsForFrame(frame, shape)).toEqual(expect.arrayContaining(['definition', 'evolution']));
  });

  test('selects general_multi_part_recall for unknown or weakly-signaled queries', () => {
    const frame = buildQueryFrame('Tell me about the January notes');

    expect(selectAnswerShape(frame).id).toBe('general_multi_part_recall');
  });

  test('Chief-style fixture questions route by generic aspects, not production name rules', () => {
    expect(selectAnswerShape(buildQueryFrame('What was my relationship with Archana like and what high friction incidents existed?')).id).toBe('relationship_recall');
    expect(selectAnswerShape(buildQueryFrame('What was the idea before MWAL and why was MWAL not pursued?')).id).toBe('decision_arc');
    expect(selectAnswerShape(buildQueryFrame('What supplements was Anu using during pregnancy and when did we shift to ferrous ascorbate? What was ferritin?')).id).toBe('protocol_or_stack_change');
  });
});
