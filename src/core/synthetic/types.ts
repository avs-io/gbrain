export const SYNTHETIC_TYPES = [
  'query_paraphrase',
  'extraction_label',
  'qa_pair',
  'hard_negative',
  'decision_scenario',
  'style_pair',
  'scout_hypothesis',
] as const;

export const SYNTHETIC_QUERY_SHAPES = [
  'exact_fact',
  'approximate_recall',
  'decision_arc',
  'relationship_arc',
  'timeline',
  'why_not',
  'medical_or_health',
  'opportunity_memory',
] as const;

export type SyntheticType = (typeof SYNTHETIC_TYPES)[number];
export type SyntheticQueryShape = (typeof SYNTHETIC_QUERY_SHAPES)[number];
export type TrustScope = 'eval_only' | 'training_only' | 'proposal_only';

export interface SyntheticRecord {
  id: string;
  synthetic_type: SyntheticType;
  seed_source_ids: string[];
  seed_evidence_span_ids: string[];
  generated_by_model: string;
  generated_at: string;
  reviewer?: string;
  trust_scope: TrustScope;
  eligible_for_memory: false;
}

export interface SyntheticQueryCase {
  id: string;
  seed_source_ids: string[];
  seed_evidence_span_ids: string[];
  query: string;
  query_shape: SyntheticQueryShape;
  topic?: string;
  claim?: string;
  expected_claim_ids: string[];
  expected_abstain: boolean;
  hard_negative?: boolean;
  eval_only: true;
  training_only: false;
  eligible_for_memory: false;
}
