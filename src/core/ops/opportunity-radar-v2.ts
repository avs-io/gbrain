import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import type { BookmarkDeepRadarReport, BookmarkDeepDecision } from './bookmark-deep-radar.ts';
import { enqueueWorkPacket, type OpsWorkItem } from './kernel.ts';
import type { TopicClaimReductionReport, ReducedTopicClaim } from '../topics/claim-reducer.ts';
import type { TopicCurrentStateSurface, TopicDailyDeltaSurface } from '../topics/state-delta.ts';

export const OPS_OPPORTUNITY_RADAR_V2_REPORT_SCHEMA = 'gbrain.ops.opportunity_radar.v2';
export const OPS_OPPORTUNITY_CANDIDATE_V2_SCHEMA = 'gbrain.ops.opportunity_candidate.v2';
export const OPS_OPPORTUNITY_CONTEXT_MATCH_SCHEMA = 'gbrain.ops.opportunity_context_match.v1';

export type OpportunityV2SourceKind = 'topic_current_state' | 'topic_daily_delta' | 'bookmark_deep_radar' | 'claim_reduction_report';
export type OpportunityV2Class = 'contact_person' | 'start_research' | 'draft_memo' | 'build_small_tool' | 'start_experiment' | 'prepare_meeting' | 'revive_old_idea' | 'watch_only' | 'discard';
export type OpportunityV2Lifecycle = 'new' | 'continuing' | 'stale' | 'archived';

export interface OpportunityV2EvidenceRef { ref: string; quote?: string; source_item_id?: string; url?: string; observed_at?: string; }

export interface OpportunityFreshSignal {
  id: string;
  kind: OpportunityV2SourceKind;
  topic_id: string;
  title: string;
  summary: string;
  observed_at?: string;
  source_refs: OpportunityV2EvidenceRef[];
  confidence?: number;
  tags: string[];
}

export interface OpportunityMemoryContextItem {
  id: string;
  source_ref: string;
  title: string;
  text: string;
  kind: string;
  observed_at?: string;
  confidence?: number;
  tags: string[];
  evidence: OpportunityV2EvidenceRef[];
}

export interface OpportunityContextMatch {
  schema: typeof OPS_OPPORTUNITY_CONTEXT_MATCH_SCHEMA;
  id: string;
  memory_id: string;
  source_ref: string;
  kind: string;
  title: string;
  excerpt: string;
  confidence: number;
  matched_terms: string[];
  evidence: OpportunityV2EvidenceRef[];
  boost_reason: string;
}

export interface OpportunityV2Scores {
  relevance: number;
  novelty: number;
  urgency: number;
  evidence_strength: number;
  source_diversity: number;
  strategic_fit: number;
  actionability: number;
  final: number;
}

export interface OpportunityV2WorkItemCandidate {
  id: string;
  title: string;
  rationale: string;
  priority: 'P1' | 'P2' | 'P3';
  lane: 'opportunity_scoring';
  expected_artifacts: string[];
  source_refs: unknown[];
  approval_requirement: 'human_review_before_external_action';
}

export interface OpportunityV2Candidate {
  schema: typeof OPS_OPPORTUNITY_CANDIDATE_V2_SCHEMA;
  id: string;
  fingerprint: string;
  generated_at: string;
  topic_id: string;
  title: string;
  summary: string;
  candidate_class: OpportunityV2Class;
  lifecycle: OpportunityV2Lifecycle;
  fresh_signal: OpportunityFreshSignal;
  old_memory_matches: OpportunityContextMatch[];
  scores: OpportunityV2Scores;
  why_now: string;
  recommended_next_actions: string[];
  work_items: OpportunityV2WorkItemCandidate[];
  evidence: OpportunityV2EvidenceRef[];
  duplicate_of?: string;
  stale_reason?: string;
  discard_reason?: string;
  approval_requirement: 'human_review_before_external_action';
  guardrails: {
    review_only: true;
    trusted_personal_memory_mutated: false;
    private_memory_read: false;
    memory_context_required_explicit_input: true;
    external_action_taken: false;
    ops_intelligence_only: true;
  };
}

export interface OpportunityRadarV2Report {
  schema: typeof OPS_OPPORTUNITY_RADAR_V2_REPORT_SCHEMA;
  ok: true;
  mode: 'review-only';
  generated_at: string;
  topic_id: string;
  input_summary: Record<OpportunityV2SourceKind | 'memory_context', number>;
  candidates: OpportunityV2Candidate[];
  archived_candidates: OpportunityV2Candidate[];
  created_work_items: OpsWorkItem[];
  artifact_path: string;
  ops_store_path?: string;
  safety: OpportunityV2Candidate['guardrails'];
}

export interface RunOpportunityRadarV2Options {
  topicId: string;
  topicState?: TopicCurrentStateSurface[];
  topicDelta?: TopicDailyDeltaSurface[];
  bookmarkReports?: BookmarkDeepRadarReport[];
  reductionReports?: TopicClaimReductionReport[];
  memoryContext?: unknown;
  artifactPath?: string;
  storePath?: string;
  now?: Date;
  minScore?: number;
  createWorkItems?: boolean;
}

interface StoreRecord { record_type: 'candidate_v2'; candidate: OpportunityV2Candidate; }

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, basis: unknown): string { return `${prefix}_${sha(JSON.stringify(basis)).slice(0, 16)}`; }
function clean(value: unknown): string { return String(value || '').replace(/\s+/g, ' ').trim(); }
function norm(value: unknown): string { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function clamp01(n: number): number { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }
function round3(n: number): number { return Math.round(clamp01(n) * 1000) / 1000; }
function daysSince(value: string | undefined, now: Date): number { const t = value && Date.parse(value); return t && !Number.isNaN(t) ? Math.max(0, (now.getTime() - t) / 86400000) : 999; }
function uniqBy<T>(items: T[], key: (item: T) => string): T[] { const seen = new Set<string>(); const out: T[] = []; for (const item of items) { const k = key(item); if (seen.has(k)) continue; seen.add(k); out.push(item); } return out; }
function words(value: unknown): string[] {
  const stop = new Set(['the','and','for','with','from','that','this','into','about','have','will','chief','aditya','topic','state','signal','claim','source','public','private','memory','context','opportunity','new','old']);
  return norm(value).split(/\s+/).filter(w => w.length >= 4 && !stop.has(w));
}
function textOverlapTerms(a: string, b: string): string[] { const aw = new Set(words(a)); return [...new Set(words(b).filter(w => aw.has(w)))]; }
function overlapScore(a: string, b: string): number { const hits = textOverlapTerms(a, b); return round3(hits.length / Math.min(8, Math.max(1, words(b).length))); }
function safety(): OpportunityV2Candidate['guardrails'] { return { review_only: true, trusted_personal_memory_mutated: false, private_memory_read: false, memory_context_required_explicit_input: true, external_action_taken: false, ops_intelligence_only: true }; }

export function opportunityRadarV2ArtifactPath(baseDir = process.cwd()): string { return join(baseDir, 'ops', 'intelligence', 'opportunity-radar-v2.jsonl'); }

export function readOpportunityRadarV2Store(path = opportunityRadarV2ArtifactPath()): OpportunityV2Candidate[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l) as StoreRecord).map(r => r.candidate).filter(c => c?.schema === OPS_OPPORTUNITY_CANDIDATE_V2_SCHEMA);
}

export function appendOpportunityRadarV2Candidates(candidates: OpportunityV2Candidate[], path = opportunityRadarV2ArtifactPath()): string {
  if (!candidates.length) return path;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, candidates.map(candidate => JSON.stringify({ record_type: 'candidate_v2', candidate } satisfies StoreRecord)).join('\n') + '\n', { mode: 0o600 });
  return path;
}

export function readOpportunityRadarV2JsonFile(path: string): any { return JSON.parse(readFileSync(path, 'utf8')); }
export function readOpportunityRadarV2SurfaceFile<T>(path?: string): T[] { if (!path) return []; const raw = readOpportunityRadarV2JsonFile(path); return Array.isArray(raw) ? raw : Array.isArray(raw.surfaces) ? raw.surfaces : raw.surface ? [raw.surface] : [raw]; }

export function runOpportunityRadarV2(options: RunOpportunityRadarV2Options): OpportunityRadarV2Report {
  const now = options.now || new Date();
  const artifactPath = options.artifactPath || opportunityRadarV2ArtifactPath();
  const existing = readOpportunityRadarV2Store(artifactPath);
  const signals = uniqBy([
    ...signalsFromTopicStates(options.topicState || [], options.topicId),
    ...signalsFromTopicDeltas(options.topicDelta || [], options.topicId),
    ...signalsFromBookmarkReports(options.bookmarkReports || [], options.topicId),
    ...signalsFromReductionReports(options.reductionReports || [], options.topicId),
  ], s => s.id);
  const memoryItems = parseMemoryContext(options.memoryContext);
  const minScore = options.minScore ?? 0.46;
  const built = signals.map(signal => candidateFromSignal(signal, memoryItems, now, existing, minScore));
  const candidates = built.filter(c => c.lifecycle !== 'archived').sort((a, b) => b.scores.final - a.scores.final || a.id.localeCompare(b.id));
  const archived = built.filter(c => c.lifecycle === 'archived').sort((a, b) => b.scores.final - a.scores.final || a.id.localeCompare(b.id));
  appendOpportunityRadarV2Candidates([...candidates, ...archived], artifactPath);
  const createdWorkItems = options.createWorkItems === false ? [] : createOpsWorkItems(candidates, options.storePath, now);
  return {
    schema: OPS_OPPORTUNITY_RADAR_V2_REPORT_SCHEMA,
    ok: true,
    mode: 'review-only',
    generated_at: now.toISOString(),
    topic_id: options.topicId,
    input_summary: {
      topic_current_state: options.topicState?.length || 0,
      topic_daily_delta: options.topicDelta?.length || 0,
      bookmark_deep_radar: options.bookmarkReports?.length || 0,
      claim_reduction_report: options.reductionReports?.length || 0,
      memory_context: memoryItems.length,
    },
    candidates,
    archived_candidates: archived,
    created_work_items: createdWorkItems,
    artifact_path: artifactPath,
    ops_store_path: options.storePath,
    safety: safety(),
  };
}

function candidateFromSignal(signal: OpportunityFreshSignal, memoryItems: OpportunityMemoryContextItem[], now: Date, existing: OpportunityV2Candidate[], minScore: number): OpportunityV2Candidate {
  const matches = matchMemoryContext(signal, memoryItems);
  const scores = scoreOpportunityV2(signal, matches, now);
  const fingerprint = sha(norm(`${signal.topic_id}:${signal.title}:${matches.map(m => m.memory_id).join(',')}`)).slice(0, 24);
  const prior = existing.find(c => c.fingerprint === fingerprint && c.lifecycle !== 'archived');
  const age = daysSince(signal.observed_at, now);
  const stale = age > 45 || (prior ? daysSince(prior.generated_at, now) > 45 : false);
  const lowFit = scores.final < minScore && matches.length === 0;
  const lifecycle: OpportunityV2Lifecycle = lowFit ? 'archived' : stale ? 'stale' : prior ? 'continuing' : 'new';
  const candidateClass = classifyOpportunity(signal, matches, scores, lowFit);
  const evidence = uniqBy([...signal.source_refs, ...matches.flatMap(m => m.evidence)].filter(e => e.ref || e.url), e => `${e.ref}:${e.url || ''}`).slice(0, 12);
  return {
    schema: OPS_OPPORTUNITY_CANDIDATE_V2_SCHEMA,
    id: stableId('ops_opp_v2', { fingerprint, lifecycle, day: now.toISOString().slice(0, 10) }),
    fingerprint,
    generated_at: now.toISOString(),
    topic_id: signal.topic_id,
    title: opportunityTitle(signal, matches),
    summary: signal.summary,
    candidate_class: candidateClass,
    lifecycle,
    fresh_signal: signal,
    old_memory_matches: matches,
    scores,
    why_now: whyNow(signal, matches, scores, now),
    recommended_next_actions: recommendedActions(candidateClass, scores, matches),
    work_items: lifecycle === 'archived' || scores.final < 0.58 ? [] : [workItemCandidate(signal, matches, scores, candidateClass)],
    evidence,
    duplicate_of: prior?.id,
    stale_reason: stale ? `fresh signal is ${Math.round(age)} days old or prior opportunity exceeded freshness window` : undefined,
    discard_reason: lowFit ? 'low relevance/actionability and no explicit old-memory/context match' : undefined,
    approval_requirement: 'human_review_before_external_action',
    guardrails: safety(),
  };
}

export function matchMemoryContext(signal: OpportunityFreshSignal, items: OpportunityMemoryContextItem[]): OpportunityContextMatch[] {
  return items.map(item => {
    const terms = textOverlapTerms(`${signal.title} ${signal.summary} ${signal.tags.join(' ')}`, `${item.title} ${item.text} ${item.tags.join(' ')}`);
    const explicitBoost = /opportunity|open_loop|parked|project|thesis|relationship|meeting|bookmark|task/i.test(item.kind) ? 0.12 : 0;
    const confidence = round3(overlapScore(`${signal.title} ${signal.summary} ${signal.tags.join(' ')}`, `${item.title} ${item.text} ${item.tags.join(' ')}`) + explicitBoost + (item.confidence || 0) * 0.18);
    return { item, terms, confidence };
  }).filter(m => m.confidence >= 0.22 || m.terms.length >= 2).sort((a, b) => b.confidence - a.confidence || a.item.id.localeCompare(b.item.id)).slice(0, 6).map(m => ({
    schema: OPS_OPPORTUNITY_CONTEXT_MATCH_SCHEMA,
    id: stableId('opp_context_match', { signal: signal.id, memory: m.item.id, terms: m.terms }),
    memory_id: m.item.id,
    source_ref: m.item.source_ref,
    kind: m.item.kind,
    title: m.item.title,
    excerpt: m.item.text.slice(0, 260),
    confidence: m.confidence,
    matched_terms: m.terms,
    evidence: m.item.evidence,
    boost_reason: m.terms.length ? `matched terms: ${m.terms.join(', ')}` : `kind=${m.item.kind} provided explicit context boost`,
  }));
}

export function scoreOpportunityV2(signal: OpportunityFreshSignal, matches: OpportunityContextMatch[], now = new Date()): OpportunityV2Scores {
  const text = `${signal.title} ${signal.summary} ${signal.tags.join(' ')}`;
  const memoryBoost = Math.max(0, ...matches.map(m => m.confidence));
  const relevance = round3(Math.max(memoryBoost, /\b(chief|gbrain|openclaw|sovereign|india|agent|memory|meeting|compute|partnership|capital|family)\b/i.test(text) ? 0.62 : 0.24));
  const novelty = round3(signal.kind === 'topic_daily_delta' || signal.kind === 'bookmark_deep_radar' ? 0.72 : matches.length ? 0.64 : 0.42);
  const urgency = round3(daysSince(signal.observed_at, now) <= 2 ? 0.92 : daysSince(signal.observed_at, now) <= 14 ? 0.68 : daysSince(signal.observed_at, now) <= 45 ? 0.45 : 0.18);
  const evidence_strength = round3((signal.confidence ?? 0.45) * 0.45 + Math.min(1, signal.source_refs.length * 0.18) + (signal.source_refs.some(r => (r.quote || '').length > 20) ? 0.22 : 0));
  const source_diversity = round3(new Set(signal.source_refs.map(r => r.source_item_id || r.url || r.ref.split(':').slice(0, 3).join(':'))).size / 3);
  const strategic_fit = round3(Math.max(relevance, /\b(policy|compute|local-first|evidence|agent|workflow|open loop|meeting brief|sovereign ai|india ai)\b/i.test(text) ? 0.72 : 0.22));
  const actionability = round3(/\b(build|pilot|apply|deadline|launch|adopt|draft|meet|partner|investigate|experiment|proposal|brief|contact|intro|prepare)\b/i.test(text) ? 0.86 : matches.length ? 0.64 : 0.31);
  const final = round3(0.18 * relevance + 0.13 * novelty + 0.13 * urgency + 0.14 * evidence_strength + 0.10 * source_diversity + 0.17 * strategic_fit + 0.15 * actionability);
  return { relevance, novelty, urgency, evidence_strength, source_diversity, strategic_fit, actionability, final };
}

function parseMemoryContext(raw: unknown): OpportunityMemoryContextItem[] {
  if (!raw) return [];
  const root: any = raw;
  const items = Array.isArray(root) ? root : [
    ...(root.items || []), ...(root.memories || []), ...(root.memory_context || []), ...(root.records || []), ...(root.context_pack?.items || []),
    ...Object.values(root.sections || {}).flatMap((v: any) => Array.isArray(v) ? v : []),
  ];
  return items.map((r: any, i: number) => {
    const text = clean(r.text || r.claim || r.summary || r.excerpt || r.content || r.title || '');
    const title = clean(r.title || r.name || r.type || r.atom_type || text.slice(0, 80) || `memory ${i + 1}`);
    const id = clean(r.id || r.memory_id || r.source_ref || stableId('memory_context', [title, text, i]));
    const sourceRef = clean(r.source_ref || r.ref || r.span_id || r.source_span_id || r.url || id);
    return { id, source_ref: sourceRef, title, text, kind: clean(r.kind || r.type || r.atom_type || r.memory_type || 'context'), observed_at: clean(r.observed_at || r.created_at || r.updated_at || r.date) || undefined, confidence: typeof r.confidence === 'number' ? r.confidence : undefined, tags: stringArray(r.tags || r.entities || r.namespaces), evidence: refsFromAny(r.evidence || r.source_refs || [{ ref: sourceRef, quote: text.slice(0, 220) }]) };
  }).filter(i => i.text || i.title);
}

function signalsFromTopicStates(states: TopicCurrentStateSurface[], topicId: string): OpportunityFreshSignal[] {
  return states.filter(s => !s.topic_id || s.topic_id === topicId).flatMap(s => [
    ...(s.problem_signals || []).map((p: any) => signal({ id: p.id, kind: 'topic_current_state', topicId, title: `Problem signal: ${p.signal || p.title || p.problem_type}`, summary: p.signal || p.summary || p.text, observed_at: p.observed_at || s.as_of, refs: p.evidence_refs || p.source_refs || p.source_span_ids, confidence: p.confidence, tags: [p.problem_type, ...(p.entities || [])] })),
    ...(s.opportunity_implications || []).map((text: string, ix: number) => signal({ id: stableId('state_implication', [s.topic_id, text, ix]), kind: 'topic_current_state', topicId, title: `Opportunity implication: ${text}`, summary: text, observed_at: s.as_of, refs: [], confidence: s.confidence?.overall, tags: ['opportunity_implication'] })),
    ...(s.next_work || []).filter((w: any) => w.kind === 'investigate_opportunity').map((w: any) => signal({ id: w.id, kind: 'topic_current_state', topicId, title: w.title, summary: w.rationale, observed_at: s.as_of, refs: w.refs, confidence: s.confidence?.overall, tags: [w.kind, w.priority] })),
  ]);
}
function signalsFromTopicDeltas(deltas: TopicDailyDeltaSurface[], topicId: string): OpportunityFreshSignal[] {
  return deltas.filter(d => !d.topic_id || d.topic_id === topicId).flatMap(d => [...(d.material_new || []), ...(d.changed || [])].map((x: any) => signal({ id: x.id, kind: 'topic_daily_delta', topicId, title: `${x.item_type || 'delta'}: ${x.summary}`, summary: `${x.summary}. ${x.rationale || ''}`, observed_at: d.as_of, refs: x.source_refs, tags: [x.kind, x.item_type].filter(Boolean) })));
}
function signalsFromBookmarkReports(reports: BookmarkDeepRadarReport[], topicId: string): OpportunityFreshSignal[] {
  return reports.flatMap(r => (r.decisions || []).filter((d: BookmarkDeepDecision) => ['investigate','act','interrupt'].includes(d.decision) && (!d.topic_links?.length || d.topic_links.some(t => t.topic_id === topicId))).map(d => signal({ id: d.id, kind: 'bookmark_deep_radar', topicId, title: d.title, summary: d.summary || d.reason || d.recommended_action || d.title, observed_at: d.captured_at || r.generated_at, refs: d.evidence_refs || [{ ref: d.canonical_url || d.url, url: d.canonical_url || d.url, quote: d.summary }], confidence: d.score, tags: [d.decision, d.source_class, ...(d.topic_links || []).flatMap(t => t.matched_terms || [])] })));
}
function signalsFromReductionReports(reports: TopicClaimReductionReport[], topicId: string): OpportunityFreshSignal[] {
  return reports.filter(r => !r.topic_id || r.topic_id === topicId).flatMap(r => (r.claims || []).filter((c: ReducedTopicClaim) => ['supported','contested'].includes(c.status) && /\b(opportunity|bottleneck|gap|need|pilot|launch|partnership|compute|policy|deadline|problem|pain)\b/i.test(c.claim)).map(c => signal({ id: c.id, kind: 'claim_reduction_report', topicId, title: `Claim: ${c.claim}`, summary: c.claim, observed_at: c.observed_at || r.reduced_at, refs: c.evidence_refs || c.source_span_ids, confidence: c.support_score, tags: [c.status, c.support_level] })));
}
function signal(input: { id: string; kind: OpportunityV2SourceKind; topicId: string; title: string; summary: string; observed_at?: string; refs?: any; confidence?: number; tags?: string[] }): OpportunityFreshSignal {
  return { id: input.id, kind: input.kind, topic_id: input.topicId, title: clean(input.title), summary: clean(input.summary || input.title), observed_at: clean(input.observed_at) || undefined, source_refs: refsFromAny(input.refs || []), confidence: input.confidence, tags: stringArray(input.tags) };
}
function refsFromAny(refs: any): OpportunityV2EvidenceRef[] {
  const arr = Array.isArray(refs) ? refs : refs ? [refs] : [];
  return arr.map((r: any) => typeof r === 'string' ? { ref: r } : { ref: clean(r?.source_span_id || r?.span_id || r?.ref || r?.id || r?.url), quote: clean(r?.quote || r?.excerpt || r?.text) || undefined, source_item_id: clean(r?.source_item_id) || undefined, url: clean(r?.url) || undefined, observed_at: clean(r?.observed_at || r?.created_at) || undefined }).filter(r => r.ref || r.url);
}
function stringArray(value: unknown): string[] { return (Array.isArray(value) ? value : value ? [value] : []).map(clean).filter(Boolean); }

function classifyOpportunity(signal: OpportunityFreshSignal, matches: OpportunityContextMatch[], scores: OpportunityV2Scores, lowFit: boolean): OpportunityV2Class {
  const text = `${signal.title} ${signal.summary} ${matches.map(m => `${m.kind} ${m.title}`).join(' ')}`;
  if (lowFit) return 'discard';
  if (/\b(contact|intro|introduc|relationship|person|founder|investor|partner)\b/i.test(text)) return 'contact_person';
  if (/\b(meeting|brief|prepare)\b/i.test(text)) return 'prepare_meeting';
  if (/\b(tool|build|prototype|script|automation)\b/i.test(text)) return 'build_small_tool';
  if (/\b(experiment|pilot|test|trial)\b/i.test(text)) return 'start_experiment';
  if (/\b(memo|strategy|thesis|write|draft)\b/i.test(text)) return 'draft_memo';
  if (matches.some(m => /opportunity|parked|open_loop|project|thesis/i.test(m.kind))) return 'revive_old_idea';
  if (scores.actionability >= 0.55) return 'start_research';
  return 'watch_only';
}
function opportunityTitle(signal: OpportunityFreshSignal, matches: OpportunityContextMatch[]): string { return matches[0] ? `${signal.title} ↔ ${matches[0].title}`.slice(0, 180) : signal.title.slice(0, 180); }
function whyNow(signal: OpportunityFreshSignal, matches: OpportunityContextMatch[], scores: OpportunityV2Scores, now: Date): string {
  const parts = [`fresh ${signal.kind} signal scored ${scores.final}`];
  if (daysSince(signal.observed_at, now) <= 14) parts.push('recent enough to be timely');
  if (matches[0]) parts.push(`matches old context ${matches[0].source_ref} with confidence ${matches[0].confidence}`);
  if (scores.actionability >= 0.7) parts.push('has a concrete next action');
  return `${parts.join('; ')}.`;
}
function recommendedActions(cls: OpportunityV2Class, scores: OpportunityV2Scores, matches: OpportunityContextMatch[]): string[] {
  if (cls === 'discard') return ['Archive as low-fit noise; revisit only if stronger evidence appears.'];
  const base = cls === 'draft_memo' ? 'Draft a one-page internal memo with evidence and decision ask.' : cls === 'build_small_tool' ? 'Create a bounded internal tool/prototype spike.' : cls === 'prepare_meeting' ? 'Prepare a meeting brief from the matched context.' : cls === 'contact_person' ? 'Draft an outreach or intro request, but do not send without approval.' : cls === 'start_experiment' ? 'Define a small reversible experiment.' : cls === 'revive_old_idea' ? 'Open a review note explaining why the old idea is newly timed.' : 'Run a focused research pass and produce keep/kill recommendation.';
  return [base, matches.length ? 'Include old-memory match refs and confidence in the review packet.' : 'Seek explicit memory/context fixture before escalating.', scores.final >= 0.72 ? 'Consider governed action proposal after human review.' : 'Keep review-only until Chief marks useful.'];
}
function workItemCandidate(signal: OpportunityFreshSignal, matches: OpportunityContextMatch[], scores: OpportunityV2Scores, cls: OpportunityV2Class): OpportunityV2WorkItemCandidate {
  return { id: stableId('opp_v2_work_candidate', [signal.id, cls]), title: `Review opportunity: ${signal.title}`.slice(0, 140), rationale: `Opportunity radar v2 scored ${scores.final}; class=${cls}; old_memory_matches=${matches.length}.`, priority: scores.final >= 0.72 ? 'P1' : scores.final >= 0.62 ? 'P2' : 'P3', lane: 'opportunity_scoring', expected_artifacts: ['opportunity_review_packet.json', 'keep_kill_or_action_proposal.md'], source_refs: [{ kind: 'opportunity_radar_v2', signal_id: signal.id, memory_match_ids: matches.map(m => m.id) }], approval_requirement: 'human_review_before_external_action' };
}
function createOpsWorkItems(candidates: OpportunityV2Candidate[], storePath: string | undefined, now: Date): OpsWorkItem[] {
  const actionable = candidates.filter(c => c.work_items.length && c.lifecycle !== 'stale');
  if (!actionable.length) return [];
  const generatedAt = now.toISOString();
  const packet = {
    programs: [{ id: 'opportunity-radar-v2', title: 'Opportunity Radar v2', status: 'active', priority: 78, objective: 'Turn topic/bookmark/reduction signals plus explicit context fixtures into review-only opportunity work.', lanes: ['opportunity_scoring'], cadence: { trigger: 'topic_reducer' }, budgets: { max_external_actions: 0, max_live_fetches: 0 }, autonomy: { internal_ops_only: true, can_contact_people: false, can_mutate_trusted_memory: false }, approval_gates: ['human_review_before_external_action', 'trusted_memory_mutation', 'external_send'], outputs: ['opportunity_candidates', 'review_packets', 'action_proposal_candidates'], created_at: generatedAt, updated_at: generatedAt }],
    work_items: actionable.flatMap(c => c.work_items.map(w => ({ id: w.id, program_id: 'opportunity-radar-v2', title: w.title, description: w.rationale, state: 'approved', priority: w.priority === 'P1' ? 90 : w.priority === 'P2' ? 72 : 55, lane: w.lane, lanes: [w.lane], worker_kind: 'script', privacy_tier: 'P2_LIMITED_CLOUD', source_refs: [...w.source_refs, { kind: 'candidate', id: c.id, fingerprint: c.fingerprint }], dependencies: [], acceptance_criteria: ['Use only cited fresh signal and explicit old-memory/context fixture refs.', 'Produce keep/kill/action-proposal recommendation.', 'Do not mutate trusted memory, send externally, or crawl broadly.'], expected_artifacts: w.expected_artifacts, guardrails: ['review_only', 'no_external_action', 'no_trusted_memory_mutation'], approval_gates: ['human_review_before_external_action'], budget: {}, created_by: 'opportunity-radar-v2', created_at: generatedAt, updated_at: generatedAt, last_state_reason: 'opportunity radar v2 created review-only work item' }))),
  };
  return enqueueWorkPacket(packet, { path: storePath, now }).work_items;
}

export function writeOpportunityRadarV2Report(path: string, report: OpportunityRadarV2Report): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2) + '\n'); }
