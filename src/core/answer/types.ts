import type { RecallResult } from '../evidence/recall.ts';
import type { AnswerShapeId, QueryFrame } from './synthesis-dsl.ts';

export const ANSWER_ENVELOPE_SCHEMA = 'gbrain.answer_envelope.v2' as const;

export type AnswerStatus = 'hit' | 'partial' | 'abstain' | 'invalid';

export type ClaimKind =
  | 'direct_quote'
  | 'normalized_fact'
  | 'timeline_event'
  | 'list_aggregate'
  | 'contrast_synthesis'
  | 'absence_notice'
  | 'conflict_notice';

export interface CitationRef {
  id: string;
  label: string;
  quoteHash?: string;
}

export interface EvidenceWindow {
  id: string;
  source: {
    id: string;
    slug: string;
    title?: string;
    section: string;
    date?: string;
    speaker?: 'user' | 'assistant' | 'system' | 'unknown';
    authority?: 'user_statement' | 'assistant_proposal' | 'accepted_assistant_claim' | 'system' | 'unknown';
    lineRange?: {
      start: number;
      end: number;
    };
    turnRange?: {
      start: number;
      end: number;
    };
  };
  quote: string;
  quoteHash?: string;
  score?: number;
  reason?: string;
  matchedBy?: string;
  searchSource?: RecallResult['integration']['search_source'];
}

export interface ClaimAtom {
  id: string;
  kind: ClaimKind;
  text: string;
  factual: boolean;
  citations: CitationRef[];
  slotId?: string;
  supportSignalIds?: string[];
  listItems?: Array<{ text: string; citations: CitationRef[]; supportSignalIds: string[] }>;
}

export interface LlmAssistedAnswerMetadata {
  enabled: boolean;
  route: 'mock' | 'disabled';
  status: 'disabled' | 'accepted' | 'partial' | 'rejected' | 'failed';
  failOnUnsupported: boolean;
  bounds: {
    llm_outside_trust_boundary: true;
    deterministic_claim_atoms_authority: true;
    citation_verifier_authority: true;
    trusted_mutations_allowed: false;
    llm_citations_allowed: false;
  };
  validation: {
    ok: boolean;
    errors: string[];
  };
  rejectedSentences: number;
  rejectedLlmCitations: number;
  trustedMutationsRejected: number;
}

export interface AnswerSection {
  id: string;
  title: string;
  claimIds: string[];
}

export interface AnswerEnvelope {
  schema: typeof ANSWER_ENVELOPE_SCHEMA;
  query: string;
  status: AnswerStatus;
  synthesis: 'deterministic-v2';
  shape: AnswerShapeId;
  queryFrame: QueryFrame;
  answer: string;
  sections: AnswerSection[];
  claims: ClaimAtom[];
  citations: Array<CitationRef & { evidenceId: string; source: EvidenceWindow['source'] }>;
  evidence: EvidenceWindow[];
  missingSlots: string[];
  conflicts: string[];
  warnings: string[];
  bounds: {
    deterministic: true;
    abstain_if_no_exact_span: true;
    max_evidence: number;
    max_quote_chars: number;
  };
  validation: {
    ok: boolean;
    errors: string[];
  };
  diagnostics?: {
    evidence_window_count: number;
    classified_signal_count: number;
    top_unclassified_windows: Array<{ evidenceId: string; reason: string }>;
  };
  llm_assisted?: LlmAssistedAnswerMetadata;
  integration: RecallResult['integration'];
}
