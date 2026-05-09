import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import type { TopicCandidateExtractionReport, TopicEntityCandidate, TopicEventCandidate, TopicProblemSignalCandidate } from './extractor.ts';
import type { ReducedTopicClaim, TopicClaimReductionReport } from './claim-reducer.ts';

export type TopicUnknownKind = 'unverified_claim' | 'low_source_diversity' | 'stale_claim' | 'missing_official_source' | 'contradiction_needs_verification';
export type TopicWorkItemKind = 'verify_claim' | 'find_independent_source' | 'refresh_stale_claim' | 'find_official_source' | 'resolve_contradiction' | 'investigate_opportunity';
export type TopicDeltaKind = 'new' | 'changed' | 'repeated' | 'stale' | 'contradicted';

export interface TopicOpenUnknown {
  id: string;
  kind: TopicUnknownKind;
  severity: 'low' | 'medium' | 'high';
  claim_id?: string;
  summary: string;
  rationale: string;
  source_refs: string[];
}

export interface TopicNextWorkRecommendation {
  id: string;
  kind: TopicWorkItemKind;
  priority: 'P1' | 'P2' | 'P3';
  title: string;
  rationale: string;
  topic_id: string;
  refs: string[];
  expected_output: string;
}

export interface TopicCurrentStateSurfaceClaim {
  id: string;
  claim: string;
  normalized_claim: string;
  status: ReducedTopicClaim['status'];
  support_level: ReducedTopicClaim['support_level'];
  support_score: number;
  authority_score: number;
  source_diversity: number;
  source_refs: string[];
  evidence_refs: ReducedTopicClaim['evidence_refs'];
  observed_at: string;
  reduced_at: string;
  expires_at?: string;
  contested_by?: string[];
  contradicts?: string[];
}

export interface TopicCurrentStateSurface {
  schema: 'gbrain.topics.topic_current_state.v1';
  mode: 'review-only';
  trusted_world_truth: false;
  trusted_personal_memory_mutated: false;
  topic_id: string;
  as_of: string;
  compiled_at: string;
  inputs: {
    reduction_report?: { reduced_at: string; claims: number };
    extraction_report?: { generated_at: string; entities: number; events: number; problem_signals: number };
  };
  confidence: {
    overall: number;
    supported_fraction: number;
    average_support_score: number;
    average_authority_score: number;
    source_diversity: number;
  };
  coverage: {
    claims_seen: number;
    current_claims: number;
    supported_claims: number;
    contested_or_contradicted_claims: number;
    stale_claims: number;
    source_items: number;
    source_spans: number;
    entities: number;
    events: number;
    problem_signals: number;
  };
  current_claims: TopicCurrentStateSurfaceClaim[];
  key_entities: TopicEntityCandidate[];
  key_events: TopicEventCandidate[];
  problem_signals: TopicProblemSignalCandidate[];
  open_unknowns: TopicOpenUnknown[];
  opportunity_implications: string[];
  next_work: TopicNextWorkRecommendation[];
}

export interface TopicDeltaSignal {
  id: string;
  kind: TopicDeltaKind;
  item_type: 'claim' | 'event' | 'problem_signal' | 'entity';
  current_id?: string;
  previous_id?: string;
  summary: string;
  rationale: string;
  source_refs: string[];
  previous_status?: string;
  current_status?: string;
}

export interface TopicDailyDeltaSurface {
  schema: 'gbrain.topics.topic_daily_delta.v1';
  mode: 'review-only';
  trusted_world_truth: false;
  trusted_personal_memory_mutated: false;
  topic_id: string;
  as_of: string;
  compiled_at: string;
  compared_to?: string;
  material_new: TopicDeltaSignal[];
  changed: TopicDeltaSignal[];
  repeated: TopicDeltaSignal[];
  stale: TopicDeltaSignal[];
  contradicted: TopicDeltaSignal[];
  diagnostics: {
    current_items: number;
    previous_items: number;
    warnings: string[];
  };
  next_work: TopicNextWorkRecommendation[];
  open_unknowns: TopicOpenUnknown[];
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, input: unknown): string { return `${prefix}_${sha256(JSON.stringify(input)).slice(0, 18)}`; }
function norm(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function uniq<T>(items: T[]): T[] { return [...new Set(items.filter(Boolean))]; }
function avg(items: number[]): number { return items.length ? Number((items.reduce((a, b) => a + b, 0) / items.length).toFixed(3)) : 0; }

function sourceRefs(claim: Pick<ReducedTopicClaim, 'source_item_ids' | 'source_span_ids'>): string[] {
  return uniq([...(claim.source_item_ids || []), ...(claim.source_span_ids || [])]);
}

function isOfficialish(claim: ReducedTopicClaim | TopicCurrentStateSurfaceClaim): boolean {
  const refs = 'source_item_ids' in claim ? claim.source_item_ids : claim.source_refs;
  const evidence = claim.evidence_refs || [];
  return refs.some(r => /\b(official|gov|meity|indiaai|ministry|department|nic\.in|gov\.in)\b/i.test(r))
    || evidence.some((r: any) => /\b(primary|official|government|gov|high)\b/i.test(String(r.authority_tier || r.authority || '')));
}

function isContradicted(claim: ReducedTopicClaim | TopicCurrentStateSurfaceClaim): boolean {
  return claim.status === 'contested' || claim.status === 'contradicted' || Boolean(claim.contradicts?.length || claim.contested_by?.length);
}

function isStale(claim: ReducedTopicClaim | TopicCurrentStateSurfaceClaim, now: Date): boolean {
  if (claim.status === 'stale') return true;
  if (claim.expires_at && !Number.isNaN(Date.parse(claim.expires_at)) && new Date(claim.expires_at).getTime() < now.getTime()) return true;
  return false;
}

function currentClaim(claim: ReducedTopicClaim): TopicCurrentStateSurfaceClaim {
  return {
    id: claim.id,
    claim: claim.claim,
    normalized_claim: claim.normalized_claim,
    status: claim.status,
    support_level: claim.support_level,
    support_score: claim.support_score,
    authority_score: claim.authority_score,
    source_diversity: claim.source_diversity,
    source_refs: sourceRefs(claim),
    evidence_refs: claim.evidence_refs,
    observed_at: claim.observed_at,
    reduced_at: claim.reduced_at,
    expires_at: claim.expires_at,
    contested_by: claim.contested_by,
    contradicts: claim.contradicts,
  };
}

export function generateTopicUnknownsAndNextWork(input: { topic_id: string; claims: Array<ReducedTopicClaim | TopicCurrentStateSurfaceClaim>; as_of?: Date; problem_signals?: TopicProblemSignalCandidate[] }): { open_unknowns: TopicOpenUnknown[]; next_work: TopicNextWorkRecommendation[] } {
  const now = input.as_of || new Date();
  const open_unknowns: TopicOpenUnknown[] = [];

  for (const claim of input.claims) {
    const refs = 'source_item_ids' in claim ? sourceRefs(claim) : claim.source_refs;
    if (claim.status === 'draft' || claim.status === 'rejected' || claim.support_level === 'unsupported') {
      open_unknowns.push({ id: stableId('topic_unknown', { k: 'unverified', id: claim.id }), kind: 'unverified_claim', severity: 'medium', claim_id: claim.id, summary: `Verify claim: ${claim.claim}`, rationale: 'claim is not yet source-backed enough for current-state confidence', source_refs: refs });
    }
    if (claim.status !== 'rejected' && claim.source_diversity < 2) {
      open_unknowns.push({ id: stableId('topic_unknown', { k: 'diversity', id: claim.id }), kind: 'low_source_diversity', severity: 'low', claim_id: claim.id, summary: `Find independent corroboration for: ${claim.claim}`, rationale: `source_diversity=${claim.source_diversity}; reducer requires more than one source for durable confidence`, source_refs: refs });
    }
    if (isStale(claim, now)) {
      open_unknowns.push({ id: stableId('topic_unknown', { k: 'stale', id: claim.id }), kind: 'stale_claim', severity: 'medium', claim_id: claim.id, summary: `Refresh stale claim: ${claim.claim}`, rationale: 'claim is marked stale or has expired before as_of', source_refs: refs });
    }
    if (claim.status !== 'rejected' && !isOfficialish(claim)) {
      open_unknowns.push({ id: stableId('topic_unknown', { k: 'official', id: claim.id }), kind: 'missing_official_source', severity: 'medium', claim_id: claim.id, summary: `Find official source for: ${claim.claim}`, rationale: 'no official/government/primary source marker was present in evidence refs', source_refs: refs });
    }
    if (isContradicted(claim)) {
      open_unknowns.push({ id: stableId('topic_unknown', { k: 'contradiction', id: claim.id }), kind: 'contradiction_needs_verification', severity: 'high', claim_id: claim.id, summary: `Resolve contradiction: ${claim.claim}`, rationale: 'claim has contested_by/contradicts links and must not be treated as settled', source_refs: refs });
    }
  }

  const workByKind: Record<TopicUnknownKind, { kind: TopicWorkItemKind; priority: 'P1' | 'P2' | 'P3'; expected: string }> = {
    unverified_claim: { kind: 'verify_claim', priority: 'P2', expected: 'source-backed verification note or rejection' },
    low_source_diversity: { kind: 'find_independent_source', priority: 'P3', expected: 'second independent source span' },
    stale_claim: { kind: 'refresh_stale_claim', priority: 'P2', expected: 'fresh source span and revised claim status' },
    missing_official_source: { kind: 'find_official_source', priority: 'P2', expected: 'official/primary source span or explicit not-found note' },
    contradiction_needs_verification: { kind: 'resolve_contradiction', priority: 'P1', expected: 'adjudication packet preserving both sides and source spans' },
  };
  const next_work = open_unknowns.map(u => {
    const spec = workByKind[u.kind];
    return { id: stableId('topic_work', { topic_id: input.topic_id, unknown: u.id }), kind: spec.kind, priority: spec.priority, title: u.summary, rationale: u.rationale, topic_id: input.topic_id, refs: u.source_refs, expected_output: spec.expected };
  });

  for (const signal of input.problem_signals || []) {
    next_work.push({ id: stableId('topic_work', { topic_id: input.topic_id, problem: signal.id }), kind: 'investigate_opportunity', priority: 'P3', title: `Investigate opportunity implied by: ${signal.signal}`, rationale: `problem signal type=${signal.problem_type} may imply an actionable wedge`, topic_id: input.topic_id, refs: signal.source_span_ids, expected_output: 'opportunity implication or discard record' });
  }

  return { open_unknowns, next_work };
}

export function compileTopicCurrentState(input: { topic_id?: string; reduction?: TopicClaimReductionReport; extraction?: TopicCandidateExtractionReport; now?: Date }): TopicCurrentStateSurface {
  const topicId = input.topic_id || input.reduction?.topic_id || input.extraction?.topic_id;
  if (!topicId) throw new Error('topic current-state compiler requires topic_id');
  if (input.reduction && input.reduction.topic_id !== topicId) throw new Error(`reduction topic_id ${input.reduction.topic_id} does not match ${topicId}`);
  if (input.extraction && input.extraction.topic_id !== topicId) throw new Error(`extraction topic_id ${input.extraction.topic_id} does not match ${topicId}`);
  const now = input.now || new Date();
  const asOf = now.toISOString();
  const reducedClaims = input.reduction?.claims || [];
  const currentClaims = reducedClaims.filter(c => c.status !== 'rejected').map(currentClaim).sort((a, b) => (b.support_score + b.authority_score) - (a.support_score + a.authority_score));
  const supported = currentClaims.filter(c => c.status === 'supported');
  const sourceItems = uniq(currentClaims.flatMap(c => c.source_refs.filter(r => !r.startsWith('srcspan1:') && !r.startsWith('gbs1:'))));
  const sourceSpans = uniq(currentClaims.flatMap(c => c.source_refs.filter(r => r.startsWith('srcspan1:') || r.startsWith('gbs1:'))));
  const problemSignals = input.extraction?.topic_problem_signals || [];
  const { open_unknowns, next_work } = generateTopicUnknownsAndNextWork({ topic_id: topicId, claims: currentClaims, as_of: now, problem_signals: problemSignals });
  const supportedFraction = currentClaims.length ? Number((supported.length / currentClaims.length).toFixed(3)) : 0;
  const averageSupport = avg(currentClaims.map(c => c.support_score));
  const averageAuthority = avg(currentClaims.map(c => c.authority_score));
  const overall = Number(((supportedFraction * 0.45) + (averageSupport * 0.25) + (averageAuthority * 0.2) + (Math.min(sourceItems.length, 5) / 5 * 0.1)).toFixed(3));

  return {
    schema: 'gbrain.topics.topic_current_state.v1',
    mode: 'review-only',
    trusted_world_truth: false,
    trusted_personal_memory_mutated: false,
    topic_id: topicId,
    as_of: asOf,
    compiled_at: asOf,
    inputs: {
      reduction_report: input.reduction ? { reduced_at: input.reduction.reduced_at, claims: input.reduction.claims.length } : undefined,
      extraction_report: input.extraction ? { generated_at: input.extraction.generated_at, entities: input.extraction.topic_entities.length, events: input.extraction.topic_events.length, problem_signals: input.extraction.topic_problem_signals.length } : undefined,
    },
    confidence: { overall, supported_fraction: supportedFraction, average_support_score: averageSupport, average_authority_score: averageAuthority, source_diversity: sourceItems.length },
    coverage: {
      claims_seen: reducedClaims.length,
      current_claims: currentClaims.length,
      supported_claims: supported.length,
      contested_or_contradicted_claims: currentClaims.filter(isContradicted).length,
      stale_claims: currentClaims.filter(c => isStale(c, now)).length,
      source_items: sourceItems.length,
      source_spans: sourceSpans.length,
      entities: input.extraction?.topic_entities.length || 0,
      events: input.extraction?.topic_events.length || 0,
      problem_signals: problemSignals.length,
    },
    current_claims: currentClaims,
    key_entities: input.extraction?.topic_entities || [],
    key_events: input.extraction?.topic_events || [],
    problem_signals: problemSignals,
    open_unknowns,
    opportunity_implications: problemSignals.map(s => `${s.problem_type}: ${s.signal}`).slice(0, 20),
    next_work,
  };
}

function claimishFrom(input: TopicClaimReductionReport | TopicCurrentStateSurface): TopicCurrentStateSurfaceClaim[] {
  if ((input as TopicCurrentStateSurface).schema === 'gbrain.topics.topic_current_state.v1') return (input as TopicCurrentStateSurface).current_claims || [];
  return ((input as TopicClaimReductionReport).claims || []).filter(c => c.status !== 'rejected').map(currentClaim);
}

function eventishFrom(input: TopicClaimReductionReport | TopicCurrentStateSurface): TopicEventCandidate[] {
  if ((input as TopicCurrentStateSurface).schema === 'gbrain.topics.topic_current_state.v1') return (input as TopicCurrentStateSurface).key_events || [];
  return [];
}

function similarClaim(a: string, b: string): boolean {
  const na = norm(a); const nb = norm(b);
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const aa = new Set(na.split(/\s+/).filter(Boolean));
  const bb = new Set(nb.split(/\s+/).filter(Boolean));
  const overlap = [...aa].filter(t => bb.has(t)).length;
  return overlap / Math.max(aa.size || 1, bb.size || 1) >= 0.72;
}

function hasNegation(value: string): boolean { return /\b(no|not|never|denied|denies|does not|do not|did not|will not|cannot|can't|false|untrue|unsupported|contradict)\b/i.test(value); }

export function compileTopicDailyDelta(input: { topic_id?: string; current: TopicClaimReductionReport | TopicCurrentStateSurface; previous?: TopicClaimReductionReport | TopicCurrentStateSurface; now?: Date }): TopicDailyDeltaSurface {
  const topicId = input.topic_id || input.current.topic_id || input.previous?.topic_id;
  if (!topicId) throw new Error('topic daily-delta compiler requires topic_id');
  if (input.current.topic_id !== topicId) throw new Error(`current topic_id ${input.current.topic_id} does not match ${topicId}`);
  if (input.previous && input.previous.topic_id !== topicId) throw new Error(`previous topic_id ${input.previous.topic_id} does not match ${topicId}`);
  const now = input.now || new Date();
  const asOf = now.toISOString();
  const currentClaims = claimishFrom(input.current);
  const previousClaims = input.previous ? claimishFrom(input.previous) : [];
  const previousEvents = input.previous ? eventishFrom(input.previous) : [];
  const currentEvents = eventishFrom(input.current);
  const material_new: TopicDeltaSignal[] = [];
  const changed: TopicDeltaSignal[] = [];
  const repeated: TopicDeltaSignal[] = [];
  const stale: TopicDeltaSignal[] = [];
  const contradicted: TopicDeltaSignal[] = [];

  for (const cur of currentClaims) {
    const prev = previousClaims.find(p => similarClaim(p.claim, cur.claim));
    const base = { item_type: 'claim' as const, current_id: cur.id, previous_id: prev?.id, summary: cur.claim, source_refs: cur.source_refs, previous_status: prev?.status, current_status: cur.status };
    if (isStale(cur, now)) stale.push({ id: stableId('topic_delta', { k: 'stale', id: cur.id }), kind: 'stale', rationale: 'current claim is stale or expired', ...base });
    if (isContradicted(cur) || (prev && hasNegation(prev.claim) !== hasNegation(cur.claim) && similarClaim(prev.claim.replace(/\b(no|not|never|denied|denies|does not|do not|did not|will not|cannot|can't)\b/ig, ''), cur.claim.replace(/\b(no|not|never|denied|denies|does not|do not|did not|will not|cannot|can't)\b/ig, '')))) {
      contradicted.push({ id: stableId('topic_delta', { k: 'contradicted', id: cur.id, prev: prev?.id }), kind: 'contradicted', rationale: 'current claim is contested/contradicted or negates a previous matching claim', ...base });
    }
    if (!prev) {
      material_new.push({ id: stableId('topic_delta', { k: 'new', id: cur.id }), kind: 'new', rationale: 'no matching prior claim was found', ...base });
    } else if (prev.status !== cur.status || prev.support_level !== cur.support_level || Math.abs(prev.support_score - cur.support_score) >= 0.15 || prev.claim !== cur.claim) {
      changed.push({ id: stableId('topic_delta', { k: 'changed', id: cur.id, prev: prev.id }), kind: 'changed', rationale: 'matching claim changed text, status, support level, or support score materially', ...base });
    } else {
      repeated.push({ id: stableId('topic_delta', { k: 'repeated', id: cur.id, prev: prev.id }), kind: 'repeated', rationale: 'matching claim repeated without material state change', ...base });
    }
  }

  for (const ev of currentEvents) {
    const prev = previousEvents.find(p => norm(p.title) === norm(ev.title) || similarClaim(p.title, ev.title));
    const signal = { id: stableId('topic_delta', { k: prev ? 'event_repeated' : 'event_new', id: ev.id }), kind: (prev ? 'repeated' : 'new') as TopicDeltaKind, item_type: 'event' as const, current_id: ev.id, previous_id: prev?.id, summary: ev.title, rationale: prev ? 'matching event repeated' : 'new event not present in previous state', source_refs: ev.source_span_ids, current_status: ev.support_status, previous_status: prev?.support_status };
    (prev ? repeated : material_new).push(signal);
  }

  const { open_unknowns, next_work } = generateTopicUnknownsAndNextWork({ topic_id: topicId, claims: currentClaims, as_of: now });
  return {
    schema: 'gbrain.topics.topic_daily_delta.v1',
    mode: 'review-only',
    trusted_world_truth: false,
    trusted_personal_memory_mutated: false,
    topic_id: topicId,
    as_of: asOf,
    compiled_at: asOf,
    compared_to: input.previous ? ((input.previous as TopicCurrentStateSurface).as_of || (input.previous as TopicClaimReductionReport).reduced_at) : undefined,
    material_new,
    changed,
    repeated,
    stale,
    contradicted,
    diagnostics: { current_items: currentClaims.length + currentEvents.length, previous_items: previousClaims.length + previousEvents.length, warnings: ['review-only daily delta; trusted memory/world truth is not mutated', 'delta matching is deterministic and conservative; contradictions are surfaced for review, not adjudicated'] },
    next_work,
    open_unknowns,
  };
}

export function validateTopicCurrentStateSurface(surface: TopicCurrentStateSurface): string[] {
  const errors: string[] = [];
  if (surface.schema !== 'gbrain.topics.topic_current_state.v1') errors.push('schema must be gbrain.topics.topic_current_state.v1');
  if (surface.mode !== 'review-only') errors.push('mode must be review-only');
  if (surface.trusted_world_truth !== false) errors.push('trusted_world_truth must be false');
  if (surface.trusted_personal_memory_mutated !== false) errors.push('trusted_personal_memory_mutated must be false');
  if (!surface.topic_id) errors.push('topic_id is required');
  for (const claim of surface.current_claims) {
    if (!claim.source_refs.length && claim.status !== 'rejected') errors.push(`${claim.id} current claim requires source_refs`);
  }
  return errors;
}

export function validateTopicDailyDeltaSurface(surface: TopicDailyDeltaSurface): string[] {
  const errors: string[] = [];
  if (surface.schema !== 'gbrain.topics.topic_daily_delta.v1') errors.push('schema must be gbrain.topics.topic_daily_delta.v1');
  if (surface.mode !== 'review-only') errors.push('mode must be review-only');
  if (surface.trusted_world_truth !== false) errors.push('trusted_world_truth must be false');
  if (surface.trusted_personal_memory_mutated !== false) errors.push('trusted_personal_memory_mutated must be false');
  if (!surface.topic_id) errors.push('topic_id is required');
  return errors;
}

export function readTopicReductionOrStateFile(path: string): TopicClaimReductionReport | TopicCurrentStateSurface {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const report = raw?.report || raw?.surface || raw;
  if (report?.schema === 'gbrain.topics.claim_reduction_report.v1' || report?.schema === 'gbrain.topics.topic_current_state.v1') return report;
  throw new Error('input file must contain gbrain.topics.claim_reduction_report.v1 or gbrain.topics.topic_current_state.v1 (or wrapper)');
}

export function readTopicCurrentStateFile(path: string): TopicCurrentStateSurface {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const report = raw?.report || raw?.surface || raw;
  if (report?.schema !== 'gbrain.topics.topic_current_state.v1') throw new Error('input file must contain gbrain.topics.topic_current_state.v1 (or wrapper)');
  return report as TopicCurrentStateSurface;
}

export function defaultTopicCurrentStateArtifactPath(baseDir = process.cwd()): string { return join(baseDir, 'ops', 'intelligence', 'topic-current-states.jsonl'); }
export function defaultTopicDailyDeltaArtifactPath(baseDir = process.cwd()): string { return join(baseDir, 'ops', 'intelligence', 'topic-daily-deltas.jsonl'); }

export function appendTopicCurrentStateArtifact(surface: TopicCurrentStateSurface, path = defaultTopicCurrentStateArtifactPath()): string {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ record_type: 'topic_current_state', surface }) + '\n', { mode: 0o600 });
  return path;
}

export function appendTopicDailyDeltaArtifact(surface: TopicDailyDeltaSurface, path = defaultTopicDailyDeltaArtifactPath()): string {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ record_type: 'topic_daily_delta', surface }) + '\n', { mode: 0o600 });
  return path;
}
