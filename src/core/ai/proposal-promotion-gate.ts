import type { MemoryAtomProposal, MemoryAtomProposalRecord, MemoryAtomSupportLevel } from './memory-atom-proposal.ts';
import { verifyClaimSupport } from './claim-support-verifier.ts';

export type ProposalPromotionDecision = 'promote' | 'reject' | 'needs_review';

export interface ProposalPromotionSupport {
  requested_support_level?: MemoryAtomSupportLevel;
  verified_support_level: MemoryAtomSupportLevel | 'contradicted';
  confidence: number;
  evidence_span_ids: string[];
  matched_entities: string[];
  matched_dates: string[];
  matched_numbers: string[];
}

export interface ProposalPromotionGuardrails {
  exact_quotes_required: true;
  synthetic_evidence_rejected: true;
  gbs1_only: true;
  trusted_write_blocked: true;
}

export interface ProposalPromotionGateEnvelope {
  schema: 'gbrain.ai.proposal-promotion-gate.v1';
  ok: boolean;
  decision: ProposalPromotionDecision;
  reasons: string[];
  support: ProposalPromotionSupport;
  guardrails: ProposalPromotionGuardrails;
  proposal_id?: string;
}

export interface PromotionEvidenceSpan { span_id: string; quote: string; source_item_id?: string }

export interface ProposalEvidenceLookup {
  getEvidenceSpans?: (proposal: MemoryAtomProposal) => PromotionEvidenceSpan[];
  allowStrongInference?: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSyntheticSpanId(spanId: string): boolean {
  return spanId.startsWith('syn:') || spanId.startsWith('non-gbs1:');
}

export function validateProposalForPromotion(proposal: unknown, evidenceLookup: ProposalEvidenceLookup = {}): ProposalPromotionGateEnvelope {
  const guardrails: ProposalPromotionGuardrails = { exact_quotes_required: true, synthetic_evidence_rejected: true, gbs1_only: true, trusted_write_blocked: true };
  const reasons: string[] = [];
  if (!isObject(proposal)) {
    return { schema: 'gbrain.ai.proposal-promotion-gate.v1', ok: false, decision: 'reject', reasons: ['proposal must be an object'], support: { verified_support_level: 'unsupported', confidence: 0, evidence_span_ids: [], matched_entities: [], matched_dates: [], matched_numbers: [] }, guardrails };
  }

  const record = proposal as Partial<MemoryAtomProposalRecord>;
  const spanIds = Array.isArray(record.evidence_span_ids) ? record.evidence_span_ids.filter((s): s is string => typeof s === 'string') : [];
  if (spanIds.some(isSyntheticSpanId)) reasons.push('synthetic or non-gbs1 evidence is not promotable');
  if (spanIds.some(spanId => !spanId.startsWith('gbs1:'))) reasons.push('promotion requires gbs1 evidence only');

  const embeddedEvidence: PromotionEvidenceSpan[] = Array.isArray((record as any).evidence_spans)
    ? (record as any).evidence_spans.filter((span: any): span is PromotionEvidenceSpan => span && typeof span.span_id === 'string' && typeof span.quote === 'string')
    : [];
  const evidence_spans = evidenceLookup.getEvidenceSpans ? evidenceLookup.getEvidenceSpans(record as MemoryAtomProposal) : embeddedEvidence;
  if (!evidence_spans.length) reasons.push('exact evidence quotes are required for promotion');
  const quotedSpanIds = new Set(evidence_spans.map(span => span.span_id));
  for (const spanId of spanIds) {
    if (spanId.startsWith('gbs1:') && !quotedSpanIds.has(spanId)) reasons.push(`missing exact quote for evidence span ${spanId}`);
  }
  const support = verifyClaimSupport({ claim: typeof record.claim === 'string' ? record.claim : '', evidence_spans: evidence_spans.filter(span => span.span_id.startsWith('gbs1:')) });
  const requestedStrongInference = record.support_level === 'strong_inference';
  if (!support.ok) reasons.push(...support.reasons);
  if (support.support_level === 'weak_inference' || support.support_level === 'unsupported' || support.support_level === 'contradicted') reasons.push(`support level ${support.support_level} is not eligible for direct promotion`);
  if ((support.support_level === 'strong_inference' || requestedStrongInference) && !evidenceLookup.allowStrongInference) reasons.push('strong inference requires review unless allowStrongInference is set');

  const decision: ProposalPromotionDecision = reasons.length ? ((support.support_level === 'strong_inference' || requestedStrongInference) && !evidenceLookup.allowStrongInference ? 'needs_review' : 'reject') : 'promote';
  const ok = decision === 'promote';
  return {
    schema: 'gbrain.ai.proposal-promotion-gate.v1',
    ok,
    decision,
    reasons: reasons.length ? reasons : ['proposal cleared promotion gate'],
    support: {
      requested_support_level: record.support_level as MemoryAtomSupportLevel | undefined,
      verified_support_level: support.support_level,
      confidence: support.confidence,
      evidence_span_ids: support.evidence_span_ids,
      matched_entities: support.matched_entities,
      matched_dates: support.matched_dates,
      matched_numbers: support.matched_numbers,
    },
    guardrails,
    proposal_id: record.proposal_id,
  };
}
