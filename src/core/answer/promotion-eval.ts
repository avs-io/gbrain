import type { AnswerEnvelope } from './types.ts';
import { ANSWER_ENVELOPE_SCHEMA } from './types.ts';
import { isExactEvidenceWindow } from './evidence-normalize.ts';

export const ANSWER_PROMOTION_EVAL_SCHEMA = 'gbrain.answer_promotion_eval.v1' as const;
export const ANSWER_PROMOTION_GATE_VERSION = 'answer-v2-promotion-gate.v1' as const;

export type AnswerPromotionRecommendation = 'keep_hidden' | 'eligible_for_limited_exposure';

export interface AnswerPromotionCaseExpectation {
  expected_abstain?: boolean;
  max_length?: number;
  required_terms?: string[];
}

export interface AnswerPromotionCase {
  id: string;
  query?: string;
  expected_abstain?: boolean;
  max_length?: number;
  required_terms?: string[];
  envelope: AnswerEnvelope;
}

export interface AnswerPromotionFailure {
  case_id: string;
  reasons: string[];
}

export interface AnswerPromotionReport {
  schema: typeof ANSWER_PROMOTION_EVAL_SCHEMA;
  ok: boolean;
  pass_count: number;
  fail_count: number;
  failures: AnswerPromotionFailure[];
  gate_version: typeof ANSWER_PROMOTION_GATE_VERSION;
  recommendation: AnswerPromotionRecommendation;
}

const ARTIFACT_PATTERNS = [/citeturn\d+search\d+/i, /turn\d+search\d+/i, /###\s*Claim/i];

function collectReasons(envelope: AnswerEnvelope, expectation: AnswerPromotionCaseExpectation): string[] {
  const reasons: string[] = [];
  if (envelope.schema !== ANSWER_ENVELOPE_SCHEMA) reasons.push(`unexpected envelope schema: ${envelope.schema}`);
  if (!Array.isArray(envelope.evidence) || !envelope.evidence.every(isExactEvidenceWindow)) reasons.push('non-gbs1 evidence present');
  if (!Array.isArray(envelope.claims)) reasons.push('claims array missing');
  else if (envelope.claims.some(claim => !Array.isArray(claim.citations) || claim.citations.some(citation => !citation.id.startsWith('gbs1:')))) reasons.push('non-gbs1 citations present');
  if (envelope.answer && ARTIFACT_PATTERNS.some(pattern => pattern.test(envelope.answer))) reasons.push('artifact strings present in answer');
  if (typeof expectation.max_length === 'number' && envelope.answer.length > expectation.max_length) reasons.push(`answer exceeds max_length ${expectation.max_length}`);
  if (expectation.expected_abstain === true && envelope.status !== 'abstain') reasons.push('expected abstain but envelope did not abstain');
  if (expectation.expected_abstain !== true && envelope.status === 'abstain') reasons.push('unexpected abstain');
  for (const term of expectation.required_terms ?? []) {
    if (term && !envelope.answer.includes(term)) reasons.push(`missing required term: ${term}`);
  }
  return reasons;
}

export function evaluateAnswerPromotionCases(cases: AnswerPromotionCase[]): AnswerPromotionReport {
  const failures: AnswerPromotionFailure[] = [];
  for (const item of cases) {
    const reasons = collectReasons(item.envelope, item);
    if (reasons.length) failures.push({ case_id: item.id, reasons });
  }
  const fail_count = failures.length;
  const pass_count = cases.length - fail_count;
  return {
    schema: ANSWER_PROMOTION_EVAL_SCHEMA,
    ok: fail_count === 0,
    pass_count,
    fail_count,
    failures,
    gate_version: ANSWER_PROMOTION_GATE_VERSION,
    recommendation: fail_count === 0 && cases.length > 0 ? 'eligible_for_limited_exposure' : 'keep_hidden',
  };
}

export function evaluateAnswerPromotionEnvelope(envelope: AnswerEnvelope, expectation: AnswerPromotionCaseExpectation = {}): AnswerPromotionReport {
  return evaluateAnswerPromotionCases([{ id: envelope.query || 'case-1', envelope, ...expectation }]);
}
