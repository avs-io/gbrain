export type RequestedAspect =
  | 'summary'
  | 'definition'
  | 'timeline'
  | 'incidents'
  | 'rationale'
  | 'change'
  | 'measurement'
  | 'list_stack'
  | 'relationship'
  | 'current_state'
  | 'prior_state'
  | 'later_state';

export interface QueryEntity {
  text: string;
  kind: 'quoted' | 'capitalized' | 'acronym' | 'term';
  source: 'query' | 'alias';
}

export interface QuerySubquestion {
  id: string;
  text: string;
  aspects: RequestedAspect[];
}

export interface QueryFrame {
  query: string;
  normalizedQuery: string;
  requestedAspects: RequestedAspect[];
  entities: QueryEntity[];
  subquestions: QuerySubquestion[];
  cues: {
    multiPart: boolean;
    comparative: boolean;
    temporal: boolean;
  };
}

export type AnswerShapeId =
  | 'relationship_recall'
  | 'decision_arc'
  | 'protocol_or_stack_change'
  | 'concept_evolution'
  | 'general_multi_part_recall';

export interface SlotDef {
  id: string;
  title: string;
  aspects: RequestedAspect[];
  required: boolean;
}

export interface AnswerShapeDef {
  id: AnswerShapeId;
  title: string;
  description: string;
  slots: SlotDef[];
}

export const ANSWER_SHAPES: Record<AnswerShapeId, AnswerShapeDef> = {
  relationship_recall: {
    id: 'relationship_recall',
    title: 'Relationship recall',
    description: 'Reconstructs relationship framing plus concrete positive/friction incidents.',
    slots: [
      { id: 'relationship_frame', title: 'Relationship frame', aspects: ['relationship', 'summary'], required: true },
      { id: 'incidents', title: 'Incidents', aspects: ['incidents'], required: false },
      { id: 'rationale_or_context', title: 'Context / why it mattered', aspects: ['rationale'], required: false },
      { id: 'state_over_time', title: 'State over time', aspects: ['prior_state', 'later_state', 'current_state', 'timeline'], required: false },
    ],
  },
  decision_arc: {
    id: 'decision_arc',
    title: 'Decision arc',
    description: 'Explains what came before, why a decision changed, and what came after.',
    slots: [
      { id: 'prior_option', title: 'Prior option', aspects: ['prior_state'], required: false },
      { id: 'decision_or_shift', title: 'Decision / shift', aspects: ['change'], required: true },
      { id: 'rationale', title: 'Rationale', aspects: ['rationale'], required: true },
      { id: 'later_state', title: 'Later state', aspects: ['later_state', 'current_state'], required: false },
      { id: 'timeline', title: 'Timeline', aspects: ['timeline'], required: false },
    ],
  },
  protocol_or_stack_change: {
    id: 'protocol_or_stack_change',
    title: 'Protocol or stack change',
    description: 'Lists a protocol/stack, measurements, and changes over time.',
    slots: [
      { id: 'stack', title: 'Stack / list', aspects: ['list_stack'], required: true },
      { id: 'change', title: 'Change', aspects: ['change'], required: false },
      { id: 'measurement', title: 'Measurement', aspects: ['measurement'], required: false },
      { id: 'timeline', title: 'Timeline', aspects: ['timeline'], required: false },
      { id: 'rationale', title: 'Rationale', aspects: ['rationale'], required: false },
    ],
  },
  concept_evolution: {
    id: 'concept_evolution',
    title: 'Concept evolution',
    description: 'Defines a concept and traces how its meaning or implementation changed.',
    slots: [
      { id: 'definition', title: 'Definition', aspects: ['definition', 'summary'], required: true },
      { id: 'evolution', title: 'Evolution', aspects: ['change', 'timeline'], required: false },
      { id: 'rationale', title: 'Rationale', aspects: ['rationale'], required: false },
      { id: 'current_state', title: 'Current state', aspects: ['current_state', 'later_state'], required: false },
    ],
  },
  general_multi_part_recall: {
    id: 'general_multi_part_recall',
    title: 'General multi-part recall',
    description: 'Generic deterministic shape for questions with mixed or unclear requested aspects.',
    slots: [
      { id: 'summary', title: 'Summary', aspects: ['summary'], required: false },
      { id: 'requested_details', title: 'Requested details', aspects: ['definition', 'timeline', 'incidents', 'rationale', 'change', 'measurement', 'list_stack', 'relationship', 'current_state', 'prior_state', 'later_state'], required: false },
    ],
  },
};
