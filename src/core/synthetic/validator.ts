import { SYNTHETIC_TYPES, type SyntheticQueryCase, type SyntheticRecord, type TrustScope } from './types.ts';

export interface ValidationIssue { path: string; message: string; }

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string' && v.trim().length > 0);
}

export function validateSyntheticRecord(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!value || typeof value !== 'object') return [{ path: '', message: 'record must be an object' }];
  const v = value as Partial<SyntheticRecord> & Record<string, unknown>;
  if (typeof v.id !== 'string' || !v.id.trim()) issues.push({ path: 'id', message: 'required string' });
  if (!SYNTHETIC_TYPES.includes(v.synthetic_type as any)) issues.push({ path: 'synthetic_type', message: `must be one of ${SYNTHETIC_TYPES.join(', ')}` });
  if (!isStringArray(v.seed_source_ids)) issues.push({ path: 'seed_source_ids', message: 'required string[]' });
  if (!isStringArray(v.seed_evidence_span_ids)) issues.push({ path: 'seed_evidence_span_ids', message: 'required string[]' });
  if (typeof v.generated_by_model !== 'string' || !v.generated_by_model.trim()) issues.push({ path: 'generated_by_model', message: 'required string' });
  if (typeof v.generated_at !== 'string' || Number.isNaN(Date.parse(v.generated_at))) issues.push({ path: 'generated_at', message: 'required ISO timestamp string' });
  if (v.reviewer !== undefined && typeof v.reviewer !== 'string') issues.push({ path: 'reviewer', message: 'must be string when present' });
  if (!['eval_only', 'training_only', 'proposal_only'].includes(v.trust_scope as TrustScope)) issues.push({ path: 'trust_scope', message: 'must be eval_only|training_only|proposal_only' });
  if (v.eligible_for_memory !== false) issues.push({ path: 'eligible_for_memory', message: 'must be false' });
  return issues;
}

export function validateSyntheticQueryCase(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!value || typeof value !== 'object') return [{ path: '', message: 'case must be an object' }];
  const v = value as Partial<SyntheticQueryCase> & Record<string, unknown>;
  if (!isStringArray(v.seed_evidence_span_ids)) issues.push({ path: 'seed_evidence_span_ids', message: 'required string[]' });
  if (typeof v.query !== 'string' || !v.query.trim()) issues.push({ path: 'query', message: 'required string' });
  if (typeof v.query_shape !== 'string' || !v.query_shape.trim()) issues.push({ path: 'query_shape', message: 'required string' });
  if (!isStringArray(v.expected_claim_ids)) issues.push({ path: 'expected_claim_ids', message: 'required string[]' });
  if (typeof v.expected_abstain !== 'boolean') issues.push({ path: 'expected_abstain', message: 'required boolean' });
  if (v.hard_negative !== undefined && typeof v.hard_negative !== 'boolean') issues.push({ path: 'hard_negative', message: 'must be boolean when present' });
  return issues;
}

