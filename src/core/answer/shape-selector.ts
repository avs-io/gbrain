import type { AnswerShapeDef, AnswerShapeId, QueryFrame, RequestedAspect } from './synthesis-dsl.ts';
import { ANSWER_SHAPES } from './synthesis-dsl.ts';

function has(frame: QueryFrame, aspect: RequestedAspect): boolean {
  return frame.requestedAspects.includes(aspect);
}

function scoreShape(frame: QueryFrame, id: AnswerShapeId): number {
  switch (id) {
    case 'relationship_recall': {
      let score = 0;
      if (has(frame, 'relationship')) score += 6;
      if (has(frame, 'incidents')) score += 2;
      if (has(frame, 'rationale')) score += 1;
      return score;
    }
    case 'protocol_or_stack_change': {
      let score = 0;
      if (has(frame, 'list_stack')) score += 7;
      if (has(frame, 'measurement')) score += 3;
      if (has(frame, 'change')) score += 2;
      if (has(frame, 'timeline')) score += 1;
      return score;
    }
    case 'decision_arc': {
      let score = 0;
      if (has(frame, 'rationale')) score += 4;
      if (has(frame, 'change')) score += 3;
      if (has(frame, 'prior_state')) score += 2;
      if (has(frame, 'later_state') || has(frame, 'current_state')) score += 1;
      if (frame.cues.comparative) score += 1;
      return score;
    }
    case 'concept_evolution': {
      let score = 0;
      if (has(frame, 'definition')) score += 4;
      if (has(frame, 'change')) score += 3;
      if (has(frame, 'timeline')) score += 2;
      if (has(frame, 'current_state')) score += 1;
      return score;
    }
    case 'general_multi_part_recall':
      return frame.cues.multiPart ? 1 : 0;
  }
}

const TIEBREAK_ORDER: AnswerShapeId[] = [
  'relationship_recall',
  'protocol_or_stack_change',
  'decision_arc',
  'concept_evolution',
  'general_multi_part_recall',
];

export function selectAnswerShape(frame: QueryFrame): AnswerShapeDef {
  let best: AnswerShapeId = 'general_multi_part_recall';
  let bestScore = 0;

  for (const id of TIEBREAK_ORDER) {
    const score = scoreShape(frame, id);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }

  if (bestScore === 0) return ANSWER_SHAPES.general_multi_part_recall;
  return ANSWER_SHAPES[best];
}

export function requiredSlotIdsForFrame(frame: QueryFrame, shape = selectAnswerShape(frame)): string[] {
  return shape.slots
    .filter(slot => slot.required || slot.aspects.some(aspect => frame.requestedAspects.includes(aspect)))
    .map(slot => slot.id);
}
