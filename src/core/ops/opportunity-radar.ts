import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { configDir } from '../config.ts';

export const OPS_OPPORTUNITY_CANDIDATE_SCHEMA = 'gbrain.ops.opportunity_candidate.v1';
export const OPS_OPPORTUNITY_RADAR_REPORT_SCHEMA = 'gbrain.ops.opportunity_radar.v1';
export const OPS_OPPORTUNITY_FEEDBACK_SCHEMA = 'gbrain.ops.opportunity_feedback.v1';
export const OPS_OPPORTUNITY_BRIEF_READY_SCHEMA = 'gbrain.ops.opportunity_brief_ready.v1';

export type OpportunityFeedbackValue = 'useful' | 'not_useful';
export type OpportunityCandidateStatus = 'candidate' | 'brief_ready' | 'useful' | 'not_useful' | 'false_positive';

export interface OpportunityEvidenceRef {
  ref: string;
  quote?: string;
  source_item_id?: string;
  url?: string;
  observed_at?: string;
}

export interface OpportunitySignal {
  id: string;
  kind: 'world_delta' | 'old_memory' | 'active_project';
  title: string;
  summary: string;
  topic?: string;
  observed_at?: string;
  url?: string;
  evidence: OpportunityEvidenceRef[];
  confidence?: number;
}

export interface OpportunityScores {
  relevance_to_active_bets: number;
  novelty: number;
  timing: number;
  actionability: number;
  network_leverage: number;
  asymmetric_upside: number;
  confidence: number;
  privacy_safety: number;
  distraction_penalty: number;
  final: number;
}

export interface OpsOpportunityCandidate {
  schema: typeof OPS_OPPORTUNITY_CANDIDATE_SCHEMA;
  id: string;
  fingerprint: string;
  generated_at: string;
  title: string;
  summary: string;
  status: OpportunityCandidateStatus;
  topic?: string;
  source_delta: OpportunitySignal;
  matched_memories: OpportunitySignal[];
  matched_projects: OpportunitySignal[];
  scores: OpportunityScores;
  why_now: string;
  recommended_action: string;
  evidence: OpportunityEvidenceRef[];
  feedback?: { value: OpportunityFeedbackValue; reason?: string; decided_at: string; false_positive: boolean };
  guardrails: {
    review_only: true;
    external_action_taken: false;
    trusted_personal_memory_mutated: false;
    ops_state_only: true;
  };
}

export interface OpportunityFeedbackRecord {
  schema: typeof OPS_OPPORTUNITY_FEEDBACK_SCHEMA;
  id: string;
  candidate_id: string;
  value: OpportunityFeedbackValue;
  reason?: string;
  decided_at: string;
  false_positive: boolean;
}

export interface OpportunityRadarReport {
  schema: typeof OPS_OPPORTUNITY_RADAR_REPORT_SCHEMA;
  ok: true;
  generated_at: string;
  candidate_count: number;
  candidates: OpsOpportunityCandidate[];
  top_candidates: OpsOpportunityCandidate[];
  brief_ready: OpportunityBriefReadySurface;
  store_path: string;
  safety: OpsOpportunityCandidate['guardrails'];
}

export interface OpportunityBriefReadySurface {
  schema: typeof OPS_OPPORTUNITY_BRIEF_READY_SCHEMA;
  ok: true;
  generated_at: string;
  top_candidates: OpsOpportunityCandidate[];
  useful_count: number;
  not_useful_count: number;
  false_positive_count: number;
  false_positives: OpportunityFeedbackRecord[];
  guardrails: OpsOpportunityCandidate['guardrails'];
}

export interface RunOpportunityRadarOptions {
  worldDeltas?: OpportunitySignal[];
  oldMemories?: OpportunitySignal[];
  activeProjects?: OpportunitySignal[];
  existingCandidates?: OpsOpportunityCandidate[];
  now?: Date;
  storePath?: string;
  topN?: number;
}

interface StoreRecord { record_type: 'candidate' | 'feedback'; candidate?: OpsOpportunityCandidate; feedback?: OpportunityFeedbackRecord }

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, basis: unknown): string { return `${prefix}_${sha(JSON.stringify(basis)).slice(0, 14)}`; }
function clamp01(n: number): number { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }
function round3(n: number): number { return Math.round(clamp01(n) * 1000) / 1000; }
function clean(value: unknown): string { return String(value || '').replace(/\s+/g, ' ').trim(); }
function norm(value: unknown): string { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function words(value: unknown): string[] {
  const stop = new Set(['the','and','for','with','from','that','this','into','about','your','chief','aditya','new','old','project','memory','world','update','signal']);
  return norm(value).split(/\s+/).filter(w => w.length >= 3 && !stop.has(w));
}
function uniqBy<T>(items: T[], key: (item: T) => string): T[] { const seen = new Set<string>(); return items.filter(i => { const k = key(i); if (seen.has(k)) return false; seen.add(k); return true; }); }
function daysSince(value: string | undefined, now: Date): number { const t = value && Date.parse(value); return t && !Number.isNaN(t) ? Math.max(0, (now.getTime() - t) / 86400000) : 999; }

export function opportunityStorePath(): string { return join(configDir(), 'ops-opportunity-radar.jsonl'); }

export function readOpportunityRadarInputFile(path: string): RunOpportunityRadarOptions {
  return parseOpportunityRadarInput(JSON.parse(readFileSync(path, 'utf8')));
}

export function parseOpportunityRadarInput(raw: any): RunOpportunityRadarOptions {
  const worldDeltas = [
    ...(raw.world_deltas || raw.worldDeltas || []),
    ...signalsFromTopicStates(raw.topic_states || raw.topicStates || raw.surfaces || []),
    ...signalsFromWorldExtractions(raw.world_extractions || raw.worldExtractions || raw.extractions || []),
  ];
  const oldMemories = [
    ...(raw.old_memories || raw.oldMemories || raw.memories || []),
    ...signalsFromClaimRecords(raw.claim_records || raw.claimRecords || raw.claims || []),
  ];
  const activeProjects = [
    ...(raw.active_projects || raw.activeProjects || raw.projects || []),
    ...((raw.chief_context?.active_projects || raw.chiefContext?.active_projects || []).map((p: any) => ({ title: String(p), summary: String(p), topic: String(p) }))),
    ...((raw.chief_context?.current_focus || raw.chiefContext?.current_focus || []).map((p: any) => ({ title: String(p), summary: String(p), topic: String(p) }))),
  ];
  return {
    worldDeltas: worldDeltas.map((s: any, i: number) => normalizeSignal(s, 'world_delta', i)),
    oldMemories: oldMemories.map((s: any, i: number) => normalizeSignal(s, 'old_memory', i)),
    activeProjects: activeProjects.map((s: any, i: number) => normalizeSignal(s, 'active_project', i)),
    topN: Number(raw.top_n || raw.topN || 5) || 5,
  };
}

export function runOpportunityRadar(options: RunOpportunityRadarOptions): OpportunityRadarReport {
  const now = options.now || new Date();
  const storePath = options.storePath || opportunityStorePath();
  const existing = options.existingCandidates || readOpportunityStore(storePath).candidates;
  const candidates = (options.worldDeltas || [])
    .map(delta => candidateFromDelta(delta, options.oldMemories || [], options.activeProjects || [], now, existing))
    .filter((c): c is OpsOpportunityCandidate => !!c)
    .sort((a, b) => b.scores.final - a.scores.final || a.id.localeCompare(b.id));
  appendOpportunityCandidates(candidates, storePath);
  const briefReady = buildOpportunityBriefReadySurface({ storePath, now, topN: options.topN });
  return {
    schema: OPS_OPPORTUNITY_RADAR_REPORT_SCHEMA,
    ok: true,
    generated_at: now.toISOString(),
    candidate_count: candidates.length,
    candidates,
    top_candidates: candidates.filter(c => c.status === 'brief_ready').slice(0, options.topN || 5),
    brief_ready: briefReady,
    store_path: storePath,
    safety: safety(),
  };
}

function candidateFromDelta(delta: OpportunitySignal, memories: OpportunitySignal[], projects: OpportunitySignal[], now: Date, existing: OpsOpportunityCandidate[]): OpsOpportunityCandidate | null {
  const matchedMemories = memories.map(m => ({ signal: m, score: textOverlap(`${delta.title} ${delta.summary} ${delta.topic || ''}`, `${m.title} ${m.summary} ${m.topic || ''}`) })).filter(m => m.score >= 0.12).sort((a, b) => b.score - a.score).slice(0, 5).map(m => m.signal);
  const matchedProjects = projects.map(p => ({ signal: p, score: textOverlap(`${delta.title} ${delta.summary} ${delta.topic || ''}`, `${p.title} ${p.summary} ${p.topic || ''}`) })).filter(p => p.score >= 0.08).sort((a, b) => b.score - a.score).slice(0, 5).map(p => p.signal);
  const scores = scoreOpportunity(delta, matchedMemories, matchedProjects, now);
  if (!matchedMemories.length && !matchedProjects.length && scores.final < 0.42) return null;
  const fingerprint = sha(norm(`${delta.id}:${delta.title}:${delta.topic || ''}:${matchedMemories.map(m => m.id).join(',')}:${matchedProjects.map(p => p.id).join(',')}`)).slice(0, 24);
  if (existing.some(c => c.fingerprint === fingerprint && c.status !== 'not_useful' && c.status !== 'false_positive' && daysSince(c.generated_at, now) <= 14)) return null;
  const evidence = uniqBy([...delta.evidence, ...matchedMemories.flatMap(m => m.evidence), ...matchedProjects.flatMap(p => p.evidence)].filter(e => e.ref || e.url), e => `${e.ref || ''}:${e.url || ''}`).slice(0, 8);
  const status: OpportunityCandidateStatus = scores.final >= 0.55 ? 'brief_ready' : 'candidate';
  return {
    schema: OPS_OPPORTUNITY_CANDIDATE_SCHEMA,
    id: stableId('ops_opp', { fingerprint, day: now.toISOString().slice(0, 10) }),
    fingerprint,
    generated_at: now.toISOString(),
    title: opportunityTitle(delta, matchedMemories, matchedProjects),
    summary: delta.summary,
    status,
    topic: delta.topic,
    source_delta: delta,
    matched_memories: matchedMemories,
    matched_projects: matchedProjects,
    scores,
    why_now: whyNow(delta, matchedMemories, matchedProjects, scores),
    recommended_action: recommendedAction(scores, matchedMemories, matchedProjects),
    evidence,
    guardrails: safety(),
  };
}

export function scoreOpportunity(delta: OpportunitySignal, memories: OpportunitySignal[], projects: OpportunitySignal[], now = new Date()): OpportunityScores {
  const text = `${delta.title} ${delta.summary} ${delta.topic || ''}`;
  const relevance = round3(Math.max(...projects.map(p => textOverlap(text, `${p.title} ${p.summary} ${p.topic || ''}`)), projects.length ? 0.25 : 0.05));
  const memoryOverlap = round3(Math.max(...memories.map(m => textOverlap(text, `${m.title} ${m.summary} ${m.topic || ''}`)), memories.length ? 0.2 : 0));
  const novelty = round3(0.35 + (memories.length ? 0.2 : 0) + (delta.kind === 'world_delta' ? 0.18 : 0));
  const timing = round3(daysSince(delta.observed_at, now) <= 2 ? 0.9 : daysSince(delta.observed_at, now) <= 14 ? 0.68 : 0.42);
  const actionability = round3(/\b(apply|adopt|launch|deadline|intro|introduc|meet|fund|investigate|build|ship|pilot|partner|proposal)\b/i.test(text) ? 0.82 : projects.length ? 0.64 : 0.38);
  const network_leverage = round3(Math.min(1, entityCount(text) * 0.08 + projects.length * 0.1 + memories.length * 0.08));
  const asymmetric_upside = round3(0.22 + novelty * 0.28 + relevance * 0.22 + memoryOverlap * 0.18 + actionability * 0.1);
  const confidence = round3(delta.confidence ?? evidenceStrength(delta.evidence));
  const privacy_safety = round3(delta.evidence.some(e => /^https?:\/\//.test(e.url || e.ref)) ? 0.9 : 0.78);
  const distraction_penalty = round3((1 - relevance) * 0.22 + (1 - actionability) * 0.14 + (/\b(viral|10x|secret|crypto|hack|breakthrough)\b/i.test(text) && relevance < 0.35 ? 0.24 : 0));
  const final = round3(
    0.20 * relevance +
    0.15 * novelty +
    0.15 * timing +
    0.15 * actionability +
    0.10 * network_leverage +
    0.10 * asymmetric_upside +
    0.08 * confidence +
    0.07 * privacy_safety -
    0.15 * distraction_penalty,
  );
  return { relevance_to_active_bets: relevance, novelty, timing, actionability, network_leverage, asymmetric_upside, confidence, privacy_safety, distraction_penalty, final };
}

export function appendOpportunityCandidates(candidates: OpsOpportunityCandidate[], path = opportunityStorePath()): string {
  if (!candidates.length) return path;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, candidates.map(candidate => JSON.stringify({ record_type: 'candidate', candidate } satisfies StoreRecord)).join('\n') + '\n', { mode: 0o600 });
  return path;
}

export function readOpportunityStore(path = opportunityStorePath()): { candidates: OpsOpportunityCandidate[]; feedback: OpportunityFeedbackRecord[]; false_positives: OpportunityFeedbackRecord[] } {
  if (!existsSync(path)) return { candidates: [], feedback: [], false_positives: [] };
  const rows = readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l) as StoreRecord);
  const byId = new Map<string, OpsOpportunityCandidate>();
  const feedback: OpportunityFeedbackRecord[] = [];
  for (const row of rows) {
    if (row.record_type === 'candidate' && row.candidate) byId.set(row.candidate.id, row.candidate);
    if (row.record_type === 'feedback' && row.feedback) {
      feedback.push(row.feedback);
      const candidate = byId.get(row.feedback.candidate_id);
      if (candidate) {
        candidate.status = row.feedback.false_positive ? 'false_positive' : row.feedback.value;
        candidate.feedback = { value: row.feedback.value, reason: row.feedback.reason, decided_at: row.feedback.decided_at, false_positive: row.feedback.false_positive };
      }
    }
  }
  return { candidates: [...byId.values()], feedback, false_positives: feedback.filter(f => f.false_positive) };
}

export function recordOpportunityFeedback(input: { candidateId: string; value: OpportunityFeedbackValue; reason?: string; storePath?: string; now?: Date }): OpportunityFeedbackRecord {
  const path = input.storePath || opportunityStorePath();
  const store = readOpportunityStore(path);
  if (!store.candidates.some(c => c.id === input.candidateId)) throw new Error(`opportunity candidate not found: ${input.candidateId}`);
  const reason = clean(input.reason);
  const falsePositive = input.value === 'not_useful' && /\b(false positive|wrong|irrelevant|noise|not relevant|bad match)\b/i.test(reason);
  const decidedAt = (input.now || new Date()).toISOString();
  const feedback: OpportunityFeedbackRecord = { schema: OPS_OPPORTUNITY_FEEDBACK_SCHEMA, id: stableId('ops_opp_feedback', { candidateId: input.candidateId, value: input.value, reason, decidedAt }), candidate_id: input.candidateId, value: input.value, reason: reason || undefined, decided_at: decidedAt, false_positive: falsePositive };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ record_type: 'feedback', feedback } satisfies StoreRecord) + '\n', { mode: 0o600 });
  return feedback;
}

export function buildOpportunityBriefReadySurface(input: { storePath?: string; now?: Date; topN?: number } = {}): OpportunityBriefReadySurface {
  const store = readOpportunityStore(input.storePath || opportunityStorePath());
  const top = store.candidates
    .filter(c => c.status === 'brief_ready' || c.status === 'useful')
    .sort((a, b) => b.scores.final - a.scores.final || a.id.localeCompare(b.id))
    .slice(0, input.topN || 5);
  return {
    schema: OPS_OPPORTUNITY_BRIEF_READY_SCHEMA,
    ok: true,
    generated_at: (input.now || new Date()).toISOString(),
    top_candidates: top,
    useful_count: store.feedback.filter(f => f.value === 'useful').length,
    not_useful_count: store.feedback.filter(f => f.value === 'not_useful').length,
    false_positive_count: store.false_positives.length,
    false_positives: store.false_positives,
    guardrails: safety(),
  };
}

export function writeOpportunityReport(path: string, report: OpportunityRadarReport | OpportunityBriefReadySurface): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
}

function normalizeSignal(input: any, kind: OpportunitySignal['kind'], index: number): OpportunitySignal {
  const title = clean(input.title || input.name || input.topic || input.claim || input.text || `${kind} ${index + 1}`);
  const summary = clean(input.summary || input.description || input.claim || input.text || title);
  const id = clean(input.id || input.source_id || input.ref || stableId(kind, [title, summary, index]));
  return {
    id,
    kind,
    title,
    summary,
    topic: clean(input.topic || input.namespace || input.project || input.slug) || undefined,
    observed_at: clean(input.observed_at || input.created_at || input.updated_at || input.event_at || input.date) || undefined,
    url: clean(input.url || input.source_url) || undefined,
    evidence: refsFromAny(input.evidence || input.source_refs || input.refs || [{ ref: input.url || input.ref || id, quote: input.excerpt || input.quote || summary, url: input.url }]),
    confidence: typeof input.confidence === 'number' ? input.confidence : typeof input.confidence_hint === 'number' ? input.confidence_hint : undefined,
  };
}

function signalsFromTopicStates(states: any[]): any[] {
  return states.flatMap(s => [...(s?.recent_deltas?.new || []), ...(s?.recent_deltas?.changed || [])].map((d: any) => ({ ...d, title: `${s.title || s.topic || 'Topic'}: ${d.kind || 'delta'}`, topic: s.topic || d.topic, summary: d.summary || d.text, source_refs: d.source_refs })));
}
function signalsFromWorldExtractions(reports: any[]): any[] {
  return reports.flatMap(r => [...(r?.claims || []), ...(r?.events || [])].map((x: any) => ({ ...x, title: x.title || x.topic || x.text, summary: x.summary || x.text || x.title, source_refs: x.source_refs })));
}
function signalsFromClaimRecords(records: any[]): any[] {
  return records.filter(r => String(r?.type || r?.atom_type || '').includes('opportunity') || r?.claim).map((r: any) => ({ ...r, title: r.title || r.type || r.atom_type || 'old opportunity memory', summary: r.summary || r.claim || r.text, source_refs: r.evidence || r.source_refs }));
}
function refsFromAny(refs: any[]): OpportunityEvidenceRef[] {
  return (Array.isArray(refs) ? refs : [refs]).map((r: any) => ({ ref: clean(r?.source_span_id || r?.span_id || r?.ref || r?.id || r?.url), quote: clean(r?.quote || r?.excerpt || r?.text) || undefined, source_item_id: clean(r?.source_item_id) || undefined, url: clean(r?.url) || undefined, observed_at: clean(r?.observed_at || r?.created_at) || undefined })).filter(r => r.ref || r.url);
}
function textOverlap(a: string, b: string): number {
  const aw = new Set(words(a));
  const bw = words(b);
  if (!aw.size || !bw.length) return 0;
  const hits = bw.filter(w => aw.has(w)).length;
  return round3(hits / Math.min(8, Math.max(1, bw.length)));
}
function evidenceStrength(evidence: OpportunityEvidenceRef[]): number {
  if (!evidence.length) return 0.2;
  return round3(Math.min(1, 0.35 + evidence.filter(e => e.ref || e.url).length * 0.15 + evidence.filter(e => (e.quote || '').length > 12).length * 0.1));
}
function entityCount(text: string): number { return (text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || []).length; }
function opportunityTitle(delta: OpportunitySignal, memories: OpportunitySignal[], projects: OpportunitySignal[]): string {
  const project = projects[0]?.title;
  const memory = memories[0]?.title;
  if (project && memory) return `${delta.title} ↔ ${project} / ${memory}`.slice(0, 160);
  if (project) return `${delta.title} ↔ ${project}`.slice(0, 160);
  return delta.title.slice(0, 160);
}
function whyNow(delta: OpportunitySignal, memories: OpportunitySignal[], projects: OpportunitySignal[], scores: OpportunityScores): string {
  const parts = [`Fresh world delta score=${scores.final}`];
  if (projects.length) parts.push(`matches active project: ${projects[0].title}`);
  if (memories.length) parts.push(`revives old memory/open loop: ${memories[0].title}`);
  if (daysSince(delta.observed_at, new Date()) <= 7) parts.push('timing is recent');
  return `${parts.join('; ')}.`;
}
function recommendedAction(scores: OpportunityScores, memories: OpportunitySignal[], projects: OpportunitySignal[]): string {
  if (scores.final >= 0.68) return 'Include in the next daily brief and open a governed internal investigation/action proposal if Chief marks useful.';
  if (projects.length || memories.length) return 'Include in brief-ready surface for review; do not act externally without approval.';
  return 'Monitor only; likely weak fit unless more evidence arrives.';
}
function safety(): OpsOpportunityCandidate['guardrails'] { return { review_only: true, external_action_taken: false, trusted_personal_memory_mutated: false, ops_state_only: true }; }
