import { SYNTHETIC_TYPES, SYNTHETIC_QUERY_SHAPES, type SyntheticQueryCase, type SyntheticRecord, type TrustScope } from './types.ts';

export interface ValidationIssue { path: string; message: string; }

export interface SyntheticTrainingMixReport {
  ok: boolean;
  total_records: number;
  real_seeded_records: number;
  synthetic_seeded_records: number;
  recursive_synthetic_output_records: number;
  real_seed_ratio: number;
  min_real_seed_ratio: number;
  issues: ValidationIssue[];
}

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
  if (typeof v.id !== 'string' || !v.id.trim()) issues.push({ path: 'id', message: 'required string' });
  if (!isStringArray(v.seed_source_ids)) issues.push({ path: 'seed_source_ids', message: 'required string[]' });
  if (v.seed_source_ids?.some(id => id.startsWith('syn:'))) issues.push({ path: 'seed_source_ids', message: 'synthetic ids are not allowed' });
  if (!isStringArray(v.seed_evidence_span_ids)) issues.push({ path: 'seed_evidence_span_ids', message: 'required string[]' });
  if (v.seed_evidence_span_ids?.some(id => !id.startsWith('gbs1:'))) issues.push({ path: 'seed_evidence_span_ids', message: 'must contain real gbs1 ids' });
  if (typeof v.query !== 'string' || !v.query.trim()) issues.push({ path: 'query', message: 'required string' });
  if (typeof v.query_shape !== 'string' || !SYNTHETIC_QUERY_SHAPES.includes(v.query_shape as any)) issues.push({ path: 'query_shape', message: `must be one of ${SYNTHETIC_QUERY_SHAPES.join(', ')}` });
  if (!isStringArray(v.expected_claim_ids)) issues.push({ path: 'expected_claim_ids', message: 'required string[]' });
  if (typeof v.expected_abstain !== 'boolean') issues.push({ path: 'expected_abstain', message: 'required boolean' });
  if (typeof v.eval_only !== 'boolean' || v.eval_only !== true) issues.push({ path: 'eval_only', message: 'must be true' });
  if (typeof v.training_only !== 'boolean' || v.training_only !== false) issues.push({ path: 'training_only', message: 'must be false' });
  if (typeof v.eligible_for_memory !== 'boolean' || v.eligible_for_memory !== false) issues.push({ path: 'eligible_for_memory', message: 'must be false' });
  if (v.hard_negative !== undefined && typeof v.hard_negative !== 'boolean') issues.push({ path: 'hard_negative', message: 'must be boolean when present' });
  return issues;
}

function hasSyntheticSeedIds(record: Partial<SyntheticRecord> & Record<string, unknown>): boolean {
  const sourceIds = Array.isArray(record.seed_source_ids) ? record.seed_source_ids : [];
  const spanIds = Array.isArray(record.seed_evidence_span_ids) ? record.seed_evidence_span_ids : [];
  return [...sourceIds, ...spanIds].some(id => typeof id === 'string' && /^(?:syn:|synthetic:|model-output:)/i.test(id));
}

function hasRecursiveSyntheticOutput(record: Partial<SyntheticRecord> & Record<string, unknown>): boolean {
  const metadata = record.metadata;
  const lineage = record.lineage;
  const serialized = JSON.stringify({ metadata, lineage, generated_by_model: record.generated_by_model, seed_source_ids: record.seed_source_ids, seed_evidence_span_ids: record.seed_evidence_span_ids }).toLowerCase();
  return /(?:synthetic_self_output|recursive_synthetic|self[-_ ]generated|model-output:|synthetic-output:)/.test(serialized);
}

export function validateSyntheticTrainingMix(records: unknown[], opts: { minRealSeedRatio?: number } = {}): SyntheticTrainingMixReport {
  const minRealSeedRatio = opts.minRealSeedRatio ?? 0.7;
  const issues: ValidationIssue[] = [];
  if (!Array.isArray(records)) {
    return { ok: false, total_records: 0, real_seeded_records: 0, synthetic_seeded_records: 0, recursive_synthetic_output_records: 0, real_seed_ratio: 0, min_real_seed_ratio: minRealSeedRatio, issues: [{ path: '', message: 'records must be an array' }] };
  }

  let realSeeded = 0;
  let syntheticSeeded = 0;
  let recursive = 0;
  records.forEach((record, index) => {
    const row = (record && typeof record === 'object' && !Array.isArray(record)) ? record as Partial<SyntheticRecord> & Record<string, unknown> : {};
    const baseIssues = validateSyntheticRecord(row).map(issue => ({ path: `records[${index}].${issue.path}`.replace(/\.$/, ''), message: issue.message }));
    issues.push(...baseIssues);
    if (hasSyntheticSeedIds(row)) syntheticSeeded += 1;
    else realSeeded += 1;
    if (hasRecursiveSyntheticOutput(row)) recursive += 1;
  });

  const total = records.length;
  const realSeedRatio = total ? Number((realSeeded / total).toFixed(3)) : 0;
  if (total === 0) issues.push({ path: 'records', message: 'training mix must contain at least one record' });
  if (realSeedRatio < minRealSeedRatio) issues.push({ path: 'real_seed_ratio', message: `real seeded material ratio ${realSeedRatio} is below required ${minRealSeedRatio}` });
  if (syntheticSeeded > 0) issues.push({ path: 'seed_source_ids', message: 'synthetic/model-output seed ids are not allowed in training mix' });
  if (recursive > 0) issues.push({ path: 'lineage', message: 'recursive synthetic self-output is not allowed in training mix' });

  return { ok: issues.length === 0, total_records: total, real_seeded_records: realSeeded, synthetic_seeded_records: syntheticSeeded, recursive_synthetic_output_records: recursive, real_seed_ratio: realSeedRatio, min_real_seed_ratio: minRealSeedRatio, issues };
}
