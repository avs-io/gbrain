import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import { configDir } from '../config.ts';
import type { ClaimLedgerRecord } from '../claims/claim-ledger.ts';
import type { ContextPackV2Compiled } from '../context/context-pack-v2.ts';
import type { WorldExtractionReport } from '../world/extractor.ts';
import type { TopicStateSurface } from '../world/topic-state.ts';

export const SURFACING_CANDIDATE_SCHEMA = 'gbrain.radar.surfacing_candidate.v1';
export const SURFACING_DECISION_SCHEMA = 'gbrain.radar.surfacing_decision.v1';

export type SurfacingSourceKind = 'scout_claim' | 'scout_event' | 'bookmark' | 'saved_post' | 'opportunity_memory' | 'meeting_context' | 'topic_delta';
export type SurfacingStatus = 'review' | 'brief' | 'archived' | 'cooldown' | 'accepted' | 'dismissed';
export type SurfacingRecommendedAction = 'review' | 'brief' | 'investigate' | 'monitor' | 'archive';

export interface ChiefRadarContext {
  active_projects?: string[];
  current_focus?: string[];
  interests?: string[];
  upcoming_meetings?: Array<{ id?: string; person?: string; title?: string; starts_at?: string; topic?: string }>;
  now?: string;
}

export interface SurfacingEvidenceRef {
  ref: string;
  quote?: string;
  source_item_id?: string;
  url?: string;
  observed_at?: string;
}

export interface SurfacingCandidateInput {
  source_kind: SurfacingSourceKind;
  source_id: string;
  title: string;
  summary: string;
  observed_at?: string;
  topic?: string;
  url?: string;
  evidence: SurfacingEvidenceRef[];
  suggested_action?: SurfacingRecommendedAction;
  relevance_hint?: number;
  novelty_hint?: number;
  confidence_hint?: number;
}

export interface SurfacingScores {
  relevance: number;
  evidence_strength: number;
  timing: number;
  novelty: number;
  actionability: number;
  personal_fit: number;
  distraction_risk: number;
  final: number;
}

export interface SurfacingCandidate {
  schema: typeof SURFACING_CANDIDATE_SCHEMA;
  id: string;
  fingerprint: string;
  generated_at: string;
  source_kind: SurfacingSourceKind;
  source_id: string;
  title: string;
  summary: string;
  topic?: string;
  url?: string;
  status: SurfacingStatus;
  triage: 'review' | 'brief' | 'archive' | 'cooldown';
  scores: SurfacingScores;
  evidence: SurfacingEvidenceRef[];
  recommended_action: {
    type: SurfacingRecommendedAction;
    rationale: string;
  };
  cooldown?: {
    duplicate_of?: string;
    until: string;
    reason: string;
  };
  guardrails: {
    review_only: true;
    external_messages_sent: false;
    trusted_pages_edited: false;
    public_posts_sent: false;
    action_proposal_created: false;
  };
}

export interface SurfacingDecisionRecord {
  schema: typeof SURFACING_DECISION_SCHEMA;
  id: string;
  candidate_id: string;
  decided_at: string;
  status: 'accepted' | 'dismissed';
  action?: string;
  reason?: string;
}

export interface SurfacingStoreRecord {
  record_type: 'candidate' | 'decision';
  candidate?: SurfacingCandidate;
  decision?: SurfacingDecisionRecord;
}

export interface GenerateSurfacingInput {
  worldExtractions?: WorldExtractionReport[];
  topicStates?: TopicStateSurface[];
  claimRecords?: ClaimLedgerRecord[];
  contextPacks?: ContextPackV2Compiled[];
  bookmarks?: any[];
  savedPosts?: any[];
  meetings?: any[];
  chiefContext?: ChiefRadarContext;
  existingCandidates?: SurfacingCandidate[];
  now?: Date;
  cooldownDays?: number;
}

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, basis: unknown): string { return `${prefix}_${sha(JSON.stringify(basis)).slice(0, 14)}`; }
function clamp01(n: number): number { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }
function round3(n: number): number { return Math.round(clamp01(n) * 1000) / 1000; }
function norm(v: unknown): string { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function words(v: unknown): string[] {
  const stop = new Set(['the','and','for','with','from','that','this','into','about','your','chief','are','was','were','has','have','new','post','article']);
  return norm(v).split(/\s+/).filter(w => w.length >= 3 && !stop.has(w));
}
function unique<T>(items: T[]): T[] { return [...new Set(items)]; }
function ts(value?: string): number { return value && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : 0; }
function daysSince(value: string | undefined, now: Date): number { const t = ts(value); return t ? Math.max(0, (now.getTime() - t) / 86400000) : 999; }

function overlapScore(text: string, context: ChiefRadarContext): number {
  const needles = unique([...(context.active_projects || []), ...(context.current_focus || []), ...(context.interests || []), ...(context.upcoming_meetings || []).flatMap(m => [m.person, m.title, m.topic].filter(Boolean) as string[])]);
  if (!needles.length) return 0.35;
  const hay = norm(text);
  let hits = 0;
  for (const n of needles) {
    const toks = words(n);
    if (toks.length && toks.some(t => hay.includes(t))) hits++;
  }
  return round3(Math.min(1, hits / Math.min(3, needles.length)));
}

function evidenceStrength(evidence: SurfacingEvidenceRef[]): number {
  if (!evidence.length) return 0;
  const cited = evidence.filter(e => e.ref || e.url).length;
  const quoted = evidence.filter(e => e.quote && e.quote.length >= 12).length;
  return round3(Math.min(1, 0.25 + cited * 0.22 + quoted * 0.18));
}

function timingScore(input: SurfacingCandidateInput, context: ChiefRadarContext, now: Date): number {
  const age = daysSince(input.observed_at, now);
  let score = age <= 1 ? 0.9 : age <= 7 ? 0.72 : age <= 30 ? 0.45 : 0.18;
  const text = `${input.title} ${input.summary} ${input.topic || ''}`;
  if ((context.upcoming_meetings || []).some(m => overlapScore(`${text} ${m.person || ''} ${m.title || ''} ${m.topic || ''}`, { active_projects: [m.person || '', m.title || '', m.topic || ''].filter(Boolean) }) > 0.2)) score = Math.max(score, 0.78);
  return round3(score);
}

function actionabilityScore(input: SurfacingCandidateInput): number {
  if (input.suggested_action === 'investigate') return 0.82;
  if (input.suggested_action === 'brief') return 0.76;
  if (input.suggested_action === 'review') return 0.68;
  if (input.suggested_action === 'monitor') return 0.42;
  if (input.suggested_action === 'archive') return 0.08;
  if (/\b(apply|adopt|brief|meet|deadline|launch|funding|decision|opportunity|introduc|investigate)\b/i.test(`${input.title} ${input.summary}`)) return 0.7;
  return 0.38;
}

function fingerprintFor(input: SurfacingCandidateInput): string {
  const basis = input.url || input.source_id || `${input.source_kind}:${input.title}:${input.topic || ''}`;
  return sha(norm(`${input.source_kind}:${basis}:${input.summary}`).slice(0, 500)).slice(0, 24);
}

export function scoreSurfacingCandidate(input: SurfacingCandidateInput, chiefContext: ChiefRadarContext = {}, opts: { now?: Date } = {}): SurfacingScores {
  const now = opts.now || (chiefContext.now ? new Date(chiefContext.now) : new Date());
  const text = `${input.title} ${input.summary} ${input.topic || ''}`;
  const personal_fit = overlapScore(text, chiefContext);
  const evidence_strength = evidenceStrength(input.evidence);
  const timing = timingScore(input, chiefContext, now);
  const actionability = actionabilityScore(input);
  const novelty = round3(input.novelty_hint ?? (input.source_kind === 'topic_delta' || input.source_kind === 'scout_event' ? 0.72 : input.source_kind === 'bookmark' || input.source_kind === 'saved_post' ? 0.52 : 0.6));
  const relevance = round3(Math.max(input.relevance_hint ?? 0, personal_fit * 0.75 + (input.topic ? 0.12 : 0.05)));
  const confidence = round3(input.confidence_hint ?? evidence_strength);
  const shinyPenalty = /\b(ai|agent|crypto|viral|hack|breakthrough|ultimate|million|10x|secret)\b/i.test(text) && personal_fit < 0.34 ? 0.24 : 0;
  const distraction_risk = round3((1 - relevance) * 0.34 + (1 - evidence_strength) * 0.2 + (1 - actionability) * 0.18 + shinyPenalty);
  const final = round3(relevance * 0.25 + evidence_strength * 0.16 + timing * 0.14 + novelty * 0.12 + actionability * 0.16 + personal_fit * 0.17 + confidence * 0.08 - distraction_risk * 0.14);
  return { relevance, evidence_strength, timing, novelty, actionability, personal_fit, distraction_risk, final };
}

export function triageForSurfacingScore(scores: SurfacingScores): SurfacingCandidate['triage'] {
  if (scores.final >= 0.68 && scores.distraction_risk < 0.55) return 'review';
  if (scores.final >= 0.5 && scores.distraction_risk < 0.68) return 'brief';
  return 'archive';
}

function actionFor(input: SurfacingCandidateInput, triage: SurfacingCandidate['triage']): SurfacingRecommendedAction {
  if (input.suggested_action) return input.suggested_action;
  if (triage === 'review') return input.source_kind === 'meeting_context' ? 'brief' : 'investigate';
  if (triage === 'brief') return 'brief';
  return 'archive';
}

function makeCandidate(input: SurfacingCandidateInput, context: ChiefRadarContext, opts: { now: Date; existingCandidates?: SurfacingCandidate[]; cooldownDays: number }): SurfacingCandidate {
  const scores = scoreSurfacingCandidate(input, context, { now: opts.now });
  let triage = triageForSurfacingScore(scores);
  let status: SurfacingStatus = triage === 'archive' ? 'archived' : triage;
  const fingerprint = fingerprintFor(input);
  const duplicate = (opts.existingCandidates || []).find(c => c.fingerprint === fingerprint && c.status !== 'dismissed' && daysSince(c.generated_at, opts.now) <= opts.cooldownDays);
  let cooldown: SurfacingCandidate['cooldown'];
  if (duplicate) {
    triage = 'cooldown';
    status = 'cooldown';
    cooldown = { duplicate_of: duplicate.id, until: new Date(opts.now.getTime() + opts.cooldownDays * 86400000).toISOString(), reason: 'duplicate fingerprint seen within radar cooldown window' };
  }
  const action = actionFor(input, triage);
  return {
    schema: SURFACING_CANDIDATE_SCHEMA,
    id: stableId('surface', { fingerprint, generated_at_day: opts.now.toISOString().slice(0, 10), source_id: input.source_id }),
    fingerprint,
    generated_at: opts.now.toISOString(),
    source_kind: input.source_kind,
    source_id: input.source_id,
    title: input.title,
    summary: input.summary,
    topic: input.topic,
    url: input.url,
    status,
    triage,
    scores,
    evidence: input.evidence,
    recommended_action: { type: action, rationale: rationaleFor(input, scores, triage) },
    cooldown,
    guardrails: { review_only: true, external_messages_sent: false, trusted_pages_edited: false, public_posts_sent: false, action_proposal_created: false },
  };
}

function rationaleFor(input: SurfacingCandidateInput, scores: SurfacingScores, triage: SurfacingCandidate['triage']): string {
  if (triage === 'cooldown') return 'Same candidate already exists recently; keep it out of interruptions.';
  if (triage === 'archive') return `Low fit (${scores.personal_fit}) or weak evidence/actionability; archive unless reviewed manually.`;
  return `${input.source_kind} has fit=${scores.personal_fit}, evidence=${scores.evidence_strength}, timing=${scores.timing}; review before any action.`;
}

function refsFromSourceRefs(refs: any[] | undefined): SurfacingEvidenceRef[] {
  return (refs || []).map(r => ({ ref: r.source_span_id || r.ref || r.span_id || r.id || r.url, quote: r.quote, source_item_id: r.source_item_id, url: r.url, observed_at: r.observed_at })).filter(r => r.ref || r.url);
}

export function surfacingInputsFromSources(input: GenerateSurfacingInput): SurfacingCandidateInput[] {
  const out: SurfacingCandidateInput[] = [];
  for (const report of input.worldExtractions || []) {
    for (const c of report.claims || []) out.push({ source_kind: 'scout_claim', source_id: c.id, title: c.topic, summary: c.text, observed_at: c.observed_at, topic: c.topic, evidence: refsFromSourceRefs(c.source_refs), confidence_hint: c.confidence, suggested_action: c.support_status === 'supported' ? 'review' : 'monitor' });
    for (const e of report.events || []) out.push({ source_kind: 'scout_event', source_id: e.id, title: e.title, summary: e.title, observed_at: e.event_at || e.observed_at, topic: e.topic, evidence: refsFromSourceRefs(e.source_refs), confidence_hint: e.confidence, novelty_hint: 0.78, suggested_action: e.support_status === 'supported' ? 'brief' : 'monitor' });
  }
  for (const s of input.topicStates || []) {
    for (const d of [...(s.recent_deltas?.new || []), ...(s.recent_deltas?.changed || [])].slice(0, 20)) out.push({ source_kind: 'topic_delta', source_id: d.id, title: `${s.title}: ${d.kind}`, summary: d.summary, observed_at: d.observed_at, topic: s.topic, evidence: refsFromSourceRefs(d.source_refs), novelty_hint: d.bucket === 'new' ? 0.76 : 0.62, suggested_action: 'review' });
  }
  for (const b of input.bookmarks || []) out.push({ source_kind: 'bookmark', source_id: String(b.id || b.url || b.title), title: String(b.title || b.url || 'bookmark'), summary: String(b.summary || b.excerpt || b.description || b.title || ''), observed_at: b.saved_at || b.created_at || b.observed_at, topic: b.topic, url: b.url, evidence: refsFromSourceRefs(b.evidence || b.source_refs || [{ ref: b.url, url: b.url, quote: b.excerpt }]), suggested_action: 'review' });
  for (const b of input.savedPosts || []) out.push({ source_kind: 'saved_post', source_id: String(b.id || b.url || b.title), title: String(b.title || b.author || 'saved post'), summary: String(b.summary || b.text || b.excerpt || ''), observed_at: b.saved_at || b.created_at || b.observed_at, topic: b.topic, url: b.url, evidence: refsFromSourceRefs(b.evidence || b.source_refs || [{ ref: b.url || b.id, url: b.url, quote: b.text || b.excerpt }]), suggested_action: 'review' });
  for (const r of input.claimRecords || []) if (String((r as any).type) === 'opportunity_memory' || (r as any).atom_type === 'opportunity_memory') out.push({ source_kind: 'opportunity_memory', source_id: r.id, title: String((r as any).type || 'opportunity_memory'), summary: r.claim, observed_at: r.observed_at, topic: r.namespace, evidence: refsFromSourceRefs(r.evidence), confidence_hint: r.confidence, suggested_action: 'investigate' });
  for (const p of input.contextPacks || []) if (p.pack_type === 'meeting_brief' && p.status === 'hit') out.push({ source_kind: 'meeting_context', source_id: stableId('meeting', p.request), title: `Meeting brief: ${String(p.request.person || p.request.slug || 'unknown')}`, summary: Object.values(p.sections).flat().map(i => i.summary).slice(0, 4).join(' '), observed_at: p.compiled_at, topic: String(p.request.person || ''), evidence: p.evidence_index.map(e => ({ ref: e.ref, quote: e.quote, source_item_id: e.source_item_id, observed_at: e.observed_at })), suggested_action: 'brief' });
  for (const m of input.meetings || []) out.push({ source_kind: 'meeting_context', source_id: String(m.id || m.title || m.person), title: String(m.title || `Meeting: ${m.person || 'unknown'}`), summary: String(m.summary || m.description || m.topic || m.person || ''), observed_at: m.starts_at || m.date, topic: m.topic || m.person, evidence: refsFromSourceRefs(m.evidence || m.source_refs || [{ ref: `calendar:${m.id || m.title || m.person}`, quote: m.summary || m.description }]), suggested_action: 'brief' });
  return out;
}

export function generateSurfacingCandidates(input: GenerateSurfacingInput): SurfacingCandidate[] {
  const now = input.now || (input.chiefContext?.now ? new Date(input.chiefContext.now) : new Date());
  const existing = input.existingCandidates || [];
  return surfacingInputsFromSources(input).map(raw => makeCandidate(raw, input.chiefContext || {}, { now, existingCandidates: existing, cooldownDays: input.cooldownDays ?? 14 })).sort((a, b) => b.scores.final - a.scores.final || a.id.localeCompare(b.id));
}

export function surfacingCandidatesPath(): string { return join(configDir(), 'surfacing-candidates.jsonl'); }

export function appendSurfacingCandidates(candidates: SurfacingCandidate[], path = surfacingCandidatesPath()): string {
  if (!candidates.length) return path;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, candidates.map(candidate => JSON.stringify({ record_type: 'candidate', candidate } satisfies SurfacingStoreRecord)).join('\n') + '\n', { mode: 0o600 });
  return path;
}

export function readSurfacingStore(path = surfacingCandidatesPath()): { candidates: SurfacingCandidate[]; decisions: SurfacingDecisionRecord[] } {
  if (!existsSync(path)) return { candidates: [], decisions: [] };
  const rows = readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l) as SurfacingStoreRecord);
  const byId = new Map<string, SurfacingCandidate>();
  const decisions: SurfacingDecisionRecord[] = [];
  for (const row of rows) {
    if (row.record_type === 'candidate' && row.candidate) byId.set(row.candidate.id, row.candidate);
    if (row.record_type === 'decision' && row.decision) {
      decisions.push(row.decision);
      const candidate = byId.get(row.decision.candidate_id);
      if (candidate) candidate.status = row.decision.status;
    }
  }
  return { candidates: [...byId.values()], decisions };
}

export function recordSurfacingDecision(input: { candidateId: string; status: 'accepted' | 'dismissed'; action?: string; reason?: string; now?: Date; path?: string }): SurfacingDecisionRecord {
  const path = input.path || surfacingCandidatesPath();
  const store = readSurfacingStore(path);
  if (!store.candidates.some(c => c.id === input.candidateId)) throw new Error(`surfacing candidate not found: ${input.candidateId}`);
  const decision: SurfacingDecisionRecord = { schema: SURFACING_DECISION_SCHEMA, id: stableId('surface_decision', { candidateId: input.candidateId, status: input.status, at: (input.now || new Date()).toISOString() }), candidate_id: input.candidateId, decided_at: (input.now || new Date()).toISOString(), status: input.status, action: input.action, reason: input.reason };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ record_type: 'decision', decision } satisfies SurfacingStoreRecord) + '\n', { mode: 0o600 });
  return decision;
}

export function overwriteSurfacingStore(candidates: SurfacingCandidate[], path = surfacingCandidatesPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, candidates.map(candidate => JSON.stringify({ record_type: 'candidate', candidate } satisfies SurfacingStoreRecord)).join('\n') + (candidates.length ? '\n' : ''), { mode: 0o600 });
}

export function parseSurfacingFixture(raw: any): GenerateSurfacingInput {
  const worldExtractions = [raw.world_extraction, raw.extraction, ...(raw.world_extractions || []), ...(raw.extractions || [])].filter(Boolean);
  const topicStates = [raw.topic_state, ...(raw.topic_states || []), ...(raw.surfaces || [])].filter((s: any) => s?.schema === 'gbrain.synthesis_surface.topic_state.v1');
  const contextPacks = [raw.context_pack, ...(raw.context_packs || [])].filter(Boolean);
  return {
    worldExtractions,
    topicStates,
    contextPacks,
    claimRecords: raw.claim_records || raw.claims || raw.memories || [],
    bookmarks: raw.bookmarks || [],
    savedPosts: raw.saved_posts || raw.savedPosts || [],
    meetings: raw.meetings || raw.calendar_events || [],
    chiefContext: raw.chief_context || raw.chiefContext || {},
    cooldownDays: raw.cooldown_days,
  };
}
