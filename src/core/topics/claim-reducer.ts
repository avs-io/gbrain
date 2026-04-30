import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import type { AuthorityTier, SupportLevel } from '../intelligence/policy.ts';
import { validateTopicCandidateSupport, type TopicCandidateEvidenceRef, type TopicCandidateExtractionReport, type TopicClaimCandidate } from './extractor.ts';

export type ReducedTopicClaimStatus = 'draft' | 'supported' | 'contested' | 'contradicted' | 'stale' | 'superseded' | 'rejected';
export type ReducedTopicClaimSupportLevel = SupportLevel;

export interface ReducedTopicClaimEvidenceRef extends TopicCandidateEvidenceRef {
  authority_tier?: AuthorityTier | string;
}

export interface ReducedTopicClaim {
  schema: 'gbrain.topics.reduced_claim.v1';
  id: string;
  topic_id: string;
  claim: string;
  normalized_claim: string;
  status: ReducedTopicClaimStatus;
  support_level: ReducedTopicClaimSupportLevel;
  support_status: 'supported' | 'unsupported' | 'contradicted';
  support_score: number;
  authority_score: number;
  source_diversity: number;
  source_item_ids: string[];
  source_span_ids: string[];
  evidence_refs: ReducedTopicClaimEvidenceRef[];
  candidate_ids: string[];
  duplicate_of?: string;
  contested_by?: string[];
  contradicts?: string[];
  stale_reason?: string;
  rejected_reason?: string;
  observed_at: string;
  reduced_at: string;
  expires_at?: string;
}

export interface TopicClaimReductionReport {
  schema: 'gbrain.topics.claim_reduction_report.v1';
  mode: 'review-only';
  trusted_world_truth: false;
  trusted_personal_memory_mutated: false;
  topic_id: string;
  reduced_at: string;
  source?: TopicCandidateExtractionReport['source'];
  diagnostics: {
    candidates_seen: number;
    claims_emitted: number;
    supported_claims: number;
    draft_claims: number;
    contested_claims: number;
    contradicted_claims: number;
    stale_claims: number;
    rejected_claims: number;
    duplicate_merges: number;
    warnings: string[];
  };
  claims: ReducedTopicClaim[];
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, input: unknown): string { return `${prefix}_${sha256(JSON.stringify(input)).slice(0, 18)}`; }
function norm(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function uniq<T>(items: T[]): T[] { return [...new Set(items.filter(Boolean))]; }

const AUTHORITY_SCORE: Record<string, number> = {
  accepted_memory: 1.0,
  raw_source: 0.92,
  source_span: 0.9,
  observation: 0.75,
  claim: 0.65,
  compiled_surface: 0.5,
  recommendation: 0.35,
  action_proposal: 0.3,
  executed_action: 0.25,
  primary: 1.0,
  high: 0.82,
  medium: 0.58,
  low: 0.32,
  unknown: 0.2,
};

function authorityTier(candidate: TopicClaimCandidate, ref?: TopicCandidateEvidenceRef): string | undefined {
  const c = candidate as any;
  const r = ref as any;
  return r?.authority_tier || r?.authority || c.authority_tier || c.authority || c.source_authority;
}

function authorityScore(candidate: TopicClaimCandidate): number {
  const scores = candidate.evidence_refs.map(ref => AUTHORITY_SCORE[authorityTier(candidate, ref) || 'source_span'] ?? 0.2);
  return scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3)) : 0;
}

function supportLevel(candidate: TopicClaimCandidate): ReducedTopicClaimSupportLevel {
  const support = validateTopicCandidateSupport(candidate.claim, candidate.evidence_refs);
  if (candidate.support_status !== 'supported' || support.status !== 'supported') return 'unsupported';
  const quoteNorm = norm(candidate.evidence_refs.map(r => r.quote).join(' '));
  return quoteNorm.includes(norm(candidate.claim)) ? 'direct_quote' : 'strong_inference';
}

function expiresAt(candidate: TopicClaimCandidate): string | undefined {
  const c = candidate as any;
  const raw = c.expires_at || c.metadata?.expires_at || c.event_at || c.candidate_date;
  return typeof raw === 'string' && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : undefined;
}

function isExpired(candidate: TopicClaimCandidate, now: Date): string | undefined {
  const c = candidate as any;
  const raw = c.expires_at || c.metadata?.expires_at;
  if (typeof raw === 'string' && !Number.isNaN(Date.parse(raw)) && new Date(raw).getTime() < now.getTime()) return `expires_at ${new Date(raw).toISOString()} is before reduction time`;
  return undefined;
}

function stripNegation(value: string): string {
  return norm(value).replace(/\b(not|no|never|denied|deny|does not|do not|did not|will not|cannot|can't|false|untrue|unsupported)\b/g, '').replace(/\s+/g, ' ').trim();
}

function hasNegation(value: string): boolean {
  return /\b(no|not|never|denied|denies|does not|do not|did not|will not|cannot|can't|false|untrue|unsupported|contradict)\b/i.test(value);
}

function contradictionKey(value: string): string {
  const stripped = stripNegation(value);
  return stripped.split(/\s+/).filter(t => t.length > 2).slice(0, 14).join(' ');
}

function similarEnough(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aa = new Set(a.split(/\s+/));
  const bb = new Set(b.split(/\s+/));
  const overlap = [...aa].filter(t => bb.has(t)).length;
  return overlap / Math.max(aa.size, bb.size) >= 0.72;
}

function initialReducedClaim(candidate: TopicClaimCandidate, reducedAt: string, now: Date): ReducedTopicClaim {
  const refs = candidate.evidence_refs as ReducedTopicClaimEvidenceRef[];
  for (const ref of refs) {
    const tier = authorityTier(candidate, ref);
    if (tier && !ref.authority_tier) ref.authority_tier = tier;
  }
  const directSupport = supportLevel(candidate);
  const staleReason = isExpired(candidate, now);
  let status: ReducedTopicClaimStatus = directSupport === 'unsupported' ? 'draft' : 'supported';
  let support_status: ReducedTopicClaim['support_status'] = directSupport === 'unsupported' ? 'unsupported' : 'supported';
  let rejected_reason: string | undefined;
  if (!refs.length || !candidate.source_span_ids.length) {
    status = 'rejected';
    support_status = 'unsupported';
    rejected_reason = 'claim candidate lacks source-span evidence';
  }
  if (staleReason && status !== 'rejected') status = 'stale';
  return {
    schema: 'gbrain.topics.reduced_claim.v1',
    id: stableId('topic_reduced_claim', { topic_id: candidate.topic_id, claim: norm(candidate.claim), sources: uniq(candidate.evidence_refs.map(r => r.source_item_id)).sort() }),
    topic_id: candidate.topic_id,
    claim: candidate.claim,
    normalized_claim: norm(candidate.claim),
    status,
    support_level: status === 'rejected' ? 'unsupported' : directSupport,
    support_status,
    support_score: candidate.confidence || 0,
    authority_score: authorityScore(candidate),
    source_diversity: uniq(candidate.evidence_refs.map(r => r.source_item_id)).length,
    source_item_ids: uniq(candidate.evidence_refs.map(r => r.source_item_id)),
    source_span_ids: uniq(candidate.source_span_ids),
    evidence_refs: refs,
    candidate_ids: [candidate.id],
    stale_reason: staleReason,
    rejected_reason,
    observed_at: candidate.observed_at,
    reduced_at: reducedAt,
    expires_at: expiresAt(candidate),
  };
}

function mergeClaim(target: ReducedTopicClaim, incoming: ReducedTopicClaim): void {
  target.candidate_ids = uniq([...target.candidate_ids, ...incoming.candidate_ids]);
  target.source_item_ids = uniq([...target.source_item_ids, ...incoming.source_item_ids]);
  target.source_span_ids = uniq([...target.source_span_ids, ...incoming.source_span_ids]);
  const existingRefs = new Set(target.evidence_refs.map(r => `${r.source_span_id}:${r.quote_hash || r.quote}`));
  for (const ref of incoming.evidence_refs) {
    const key = `${ref.source_span_id}:${ref.quote_hash || ref.quote}`;
    if (!existingRefs.has(key)) target.evidence_refs.push(ref);
  }
  target.source_diversity = target.source_item_ids.length;
  target.support_score = Math.max(target.support_score, incoming.support_score);
  target.authority_score = Number(Math.max(target.authority_score, incoming.authority_score).toFixed(3));
  if (target.support_level === 'unsupported' && incoming.support_level !== 'unsupported') target.support_level = incoming.support_level;
  if (target.status === 'draft' && incoming.status === 'supported') target.status = 'supported';
}

export function reduceTopicClaimsFromExtraction(report: TopicCandidateExtractionReport, input: { topic_id?: string; now?: Date } = {}): TopicClaimReductionReport {
  if (report.schema !== 'gbrain.topics.candidate_extraction_report.v1') throw new Error('claim reducer requires gbrain.topics.candidate_extraction_report.v1');
  const topicId = input.topic_id || report.topic_id;
  if (!topicId) throw new Error('claim reducer requires topic_id');
  if (report.topic_id !== topicId) throw new Error(`extraction topic_id ${report.topic_id} does not match reducer topic_id ${topicId}`);
  const now = input.now || new Date();
  const reducedAt = now.toISOString();
  const emitted: ReducedTopicClaim[] = [];
  let duplicateMerges = 0;

  for (const candidate of report.topic_claims || []) {
    const next = initialReducedClaim(candidate, reducedAt, now);
    const duplicate = emitted.find(c => c.topic_id === next.topic_id && similarEnough(c.normalized_claim, next.normalized_claim) && c.source_item_ids.some(id => next.source_item_ids.includes(id)));
    if (duplicate) {
      next.duplicate_of = duplicate.id;
      mergeClaim(duplicate, next);
      duplicateMerges++;
      continue;
    }
    emitted.push(next);
  }

  for (let i = 0; i < emitted.length; i++) {
    for (let j = i + 1; j < emitted.length; j++) {
      const a = emitted[i]!;
      const b = emitted[j]!;
      const sameSubject = similarEnough(contradictionKey(a.claim), contradictionKey(b.claim));
      if (!sameSubject || hasNegation(a.claim) === hasNegation(b.claim)) continue;
      a.contested_by = uniq([...(a.contested_by || []), b.id]);
      b.contested_by = uniq([...(b.contested_by || []), a.id]);
      a.contradicts = uniq([...(a.contradicts || []), b.id]);
      b.contradicts = uniq([...(b.contradicts || []), a.id]);
      if (a.status === 'supported') a.status = 'contested';
      if (b.status === 'supported') b.status = 'contested';
      if (a.support_level === 'unsupported') a.support_level = 'contradicted';
      if (b.support_level === 'unsupported') b.support_level = 'contradicted';
      if (a.support_status === 'unsupported') a.support_status = 'contradicted';
      if (b.support_status === 'unsupported') b.support_status = 'contradicted';
    }
  }

  const counts = (status: ReducedTopicClaimStatus) => emitted.filter(c => c.status === status).length;
  return {
    schema: 'gbrain.topics.claim_reduction_report.v1',
    mode: 'review-only',
    trusted_world_truth: false,
    trusted_personal_memory_mutated: false,
    topic_id: topicId,
    reduced_at: reducedAt,
    source: report.source,
    diagnostics: {
      candidates_seen: report.topic_claims.length,
      claims_emitted: emitted.length,
      supported_claims: counts('supported'),
      draft_claims: counts('draft'),
      contested_claims: counts('contested'),
      contradicted_claims: counts('contradicted'),
      stale_claims: counts('stale'),
      rejected_claims: counts('rejected'),
      duplicate_merges: duplicateMerges,
      warnings: [
        'review-only claim reducer output; trusted memory/world truth is not mutated',
        'supported claims require direct source-span quote evidence; uncited or unsupported claims remain draft/unsupported or rejected',
        'contradictions are represented as contested/contradicted links and never overwrite prior claims',
      ],
    },
    claims: emitted,
  };
}

export function validateTopicClaimReductionReport(report: TopicClaimReductionReport): string[] {
  const errors: string[] = [];
  if (report.schema !== 'gbrain.topics.claim_reduction_report.v1') errors.push('schema must be gbrain.topics.claim_reduction_report.v1');
  if (report.mode !== 'review-only') errors.push('mode must be review-only');
  if (report.trusted_personal_memory_mutated !== false) errors.push('trusted_personal_memory_mutated must be false');
  const ids = new Set<string>();
  for (const claim of report.claims) {
    if (claim.topic_id !== report.topic_id) errors.push(`${claim.id} topic_id must match report.topic_id`);
    if (ids.has(claim.id)) errors.push(`duplicate claim id: ${claim.id}`);
    ids.add(claim.id);
    if (claim.status === 'supported' && (claim.support_level === 'unsupported' || claim.evidence_refs.length === 0)) errors.push(`${claim.id} supported claims require evidence and non-unsupported support_level`);
    if (claim.status === 'supported' && !claim.evidence_refs.some(r => r.quote?.trim())) errors.push(`${claim.id} supported claims require direct quote evidence`);
    if (!claim.source_span_ids.length && claim.status !== 'rejected') errors.push(`${claim.id} non-rejected claims require source_span_ids`);
    if ((claim.status === 'draft' || claim.status === 'rejected') && claim.support_level !== 'unsupported' && claim.support_level !== 'contradicted') errors.push(`${claim.id} draft/rejected claims must not claim strong support`);
  }
  return errors;
}

export function readTopicCandidateExtractionReportFile(path: string): TopicCandidateExtractionReport {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const report = raw?.report || raw;
  if (report?.schema !== 'gbrain.topics.candidate_extraction_report.v1') throw new Error('input file must contain gbrain.topics.candidate_extraction_report.v1 or { report } wrapper');
  return report as TopicCandidateExtractionReport;
}

export function defaultTopicClaimReductionArtifactPath(baseDir = process.cwd()): string {
  return join(baseDir, 'ops', 'intelligence', 'topic-claim-reductions.jsonl');
}

export function appendTopicClaimReductionArtifact(report: TopicClaimReductionReport, path = defaultTopicClaimReductionArtifactPath()): string {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ record_type: 'topic_claim_reduction', report }) + '\n', { mode: 0o600 });
  return path;
}
