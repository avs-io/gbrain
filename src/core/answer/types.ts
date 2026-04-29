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
    lineRange?: {
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
  integration: RecallResult['integration'];
}
