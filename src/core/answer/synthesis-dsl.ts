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
  privacyMode?: 'standard' | 'sensitive_personal';
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
  | 'person_or_meeting_prebrief'
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
  /** Inspectable routing hints; selector code remains deterministic but the DSL owns the intent. */
  matchRules: {
    aspects?: RequestedAspect[];
    queryPatterns?: string[];
  };
  slots: SlotDef[];
  synthesisRules: {
    directFactsOnly?: boolean;
    allowPatternSynthesis?: boolean;
    preserveSpeakerAuthority?: boolean;
    conflictPolicy: 'render_notice' | 'abstain';
  };
  abstainPolicy: {
    requireExactGbs1: true;
    missingRequiredSlot: 'partial_with_notice' | 'abstain';
    unsupportedCitation: 'invalid';
  };
}

const DEFAULT_RULES = {
  synthesisRules: {
    directFactsOnly: false,
    allowPatternSynthesis: true,
    preserveSpeakerAuthority: true,
    conflictPolicy: 'render_notice' as const,
  },
  abstainPolicy: {
    requireExactGbs1: true as const,
    missingRequiredSlot: 'partial_with_notice' as const,
    unsupportedCitation: 'invalid' as const,
  },
};

export const ANSWER_SHAPES: Record<AnswerShapeId, AnswerShapeDef> = {
  relationship_recall: {
    id: 'relationship_recall',
    title: 'Relationship recall',
    description: 'Reconstructs relationship framing plus concrete positive/friction incidents.',
    matchRules: { aspects: ['relationship', 'incidents', 'rationale'], queryPatterns: ['relationship', 'friction', 'with'] },
    slots: [
      { id: 'relationship_frame', title: 'Relationship frame', aspects: ['relationship', 'summary', 'rationale'], required: true },
      { id: 'incidents', title: 'Incidents', aspects: ['incidents'], required: false },
      { id: 'rationale_or_context', title: 'Context / why it mattered', aspects: ['rationale'], required: false },
      { id: 'state_over_time', title: 'State over time', aspects: ['prior_state', 'later_state', 'current_state', 'timeline'], required: false },
    ],
    ...DEFAULT_RULES,
  },
  decision_arc: {
    id: 'decision_arc',
    title: 'Decision arc',
    description: 'Explains what came before, why a decision changed, and what came after.',
    matchRules: { aspects: ['prior_state', 'change', 'rationale', 'later_state'], queryPatterns: ['why', 'before', 'not pursued', 'changed'] },
    slots: [
      { id: 'prior_option', title: 'Prior option', aspects: ['prior_state'], required: false },
      { id: 'decision_or_shift', title: 'Decision / shift', aspects: ['change'], required: true },
      { id: 'rationale', title: 'Rationale', aspects: ['rationale', 'summary'], required: true },
      { id: 'later_state', title: 'Later state', aspects: ['later_state', 'current_state'], required: false },
      { id: 'timeline', title: 'Timeline', aspects: ['timeline'], required: false },
    ],
    ...DEFAULT_RULES,
  },
  protocol_or_stack_change: {
    id: 'protocol_or_stack_change',
    title: 'Protocol or stack change',
    description: 'Lists a protocol/stack, measurements, and changes over time.',
    matchRules: { aspects: ['list_stack', 'measurement', 'change', 'timeline'], queryPatterns: ['stack', 'protocol', 'regimen', 'supplement'] },
    slots: [
      { id: 'stack', title: 'Stack / list', aspects: ['list_stack'], required: true },
      { id: 'change', title: 'Change', aspects: ['change'], required: false },
      { id: 'measurement', title: 'Measurement', aspects: ['measurement'], required: false },
      { id: 'timeline', title: 'Timeline', aspects: ['timeline'], required: false },
      { id: 'rationale', title: 'Rationale', aspects: ['rationale', 'summary'], required: false },
    ],
    ...DEFAULT_RULES,
  },
  concept_evolution: {
    id: 'concept_evolution',
    title: 'Concept evolution',
    description: 'Defines a concept and traces how its meaning or implementation changed.',
    matchRules: { aspects: ['definition', 'change', 'timeline', 'current_state'], queryPatterns: ['define', 'meaning', 'evolved'] },
    slots: [
      { id: 'definition', title: 'Definition', aspects: ['definition', 'summary'], required: true },
      { id: 'evolution', title: 'Evolution', aspects: ['change', 'timeline'], required: false },
      { id: 'rationale', title: 'Rationale', aspects: ['rationale'], required: false },
      { id: 'current_state', title: 'Current state', aspects: ['current_state', 'later_state'], required: false },
    ],
    ...DEFAULT_RULES,
  },
  person_or_meeting_prebrief: {
    id: 'person_or_meeting_prebrief',
    title: 'Person or meeting prebrief',
    description: 'Source-backed prebrief for a named person/meeting: role, relationship, relevant incidents, and current caveats.',
    matchRules: { aspects: ['relationship', 'current_state', 'incidents', 'summary'], queryPatterns: ['prebrief', 'meeting', 'person', 'walked in', 'who is'] },
    slots: [
      { id: 'person_context', title: 'Person / meeting context', aspects: ['summary', 'relationship'], required: true },
      { id: 'relationship_frame', title: 'Relationship frame', aspects: ['relationship'], required: false },
      { id: 'incidents', title: 'Relevant incidents', aspects: ['incidents'], required: false },
      { id: 'current_state', title: 'Current state caveat', aspects: ['current_state'], required: false },
    ],
    ...DEFAULT_RULES,
  },
  general_multi_part_recall: {
    id: 'general_multi_part_recall',
    title: 'General multi-part recall',
    description: 'Generic deterministic shape for questions with mixed or unclear requested aspects.',
    matchRules: { aspects: ['summary'], queryPatterns: [] },
    slots: [
      { id: 'summary', title: 'Summary', aspects: ['summary'], required: false },
      { id: 'requested_details', title: 'Requested details', aspects: ['definition', 'timeline', 'incidents', 'rationale', 'change', 'measurement', 'list_stack', 'relationship', 'current_state', 'prior_state', 'later_state'], required: false },
    ],
    ...DEFAULT_RULES,
  },
};
