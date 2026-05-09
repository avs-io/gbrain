import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import { configDir } from '../config.ts';
import type { ClaimLedgerRecord, ClaimStatus } from '../claims/claim-ledger.ts';
import { BUILTIN_SCOUT_RECIPES, scoutRecipeById, type ScoutRecipe } from '../scout/pipeline.ts';
import type { CandidateEntityUpdate, CandidateSourceRef, CandidateTimelineEvent, CandidateWorldClaim, WorldExtractionReport } from './extractor.ts';

export type TopicInputKind = 'candidate_claim' | 'verified_claim' | 'candidate_event' | 'entity_update';
export type DeltaBucket = 'new' | 'changed' | 'repeated';

export interface TopicStateClaimRef {
  id: string;
  kind: 'candidate' | 'verified';
  text: string;
  status: 'candidate' | ClaimStatus;
  support_status?: 'supported' | 'unsupported';
  confidence: number;
  observed_at: string;
  stale: boolean;
  stale_reason?: string;
  source_refs: CandidateSourceRef[];
}

export interface TopicStateEventRef {
  id: string;
  title: string;
  event_type: CandidateTimelineEvent['event_type'];
  status: 'candidate';
  support_status: 'supported' | 'unsupported';
  confidence: number;
  observed_at: string;
  event_at?: string;
  entities: string[];
  stale: boolean;
  stale_reason?: string;
  source_refs: CandidateSourceRef[];
}

export interface TopicEntityState {
  entity: string;
  mention_count: number;
  latest_observed_at?: string;
  claim_ids: string[];
  event_ids: string[];
  source_refs: CandidateSourceRef[];
  watchlisted: boolean;
}

export interface TopicDeltaItem {
  bucket: DeltaBucket;
  id: string;
  kind: TopicInputKind;
  summary: string;
  observed_at: string;
  source_refs: CandidateSourceRef[];
  reason: string;
}

export interface TopicStateSurface {
  schema: 'gbrain.synthesis_surface.topic_state.v1';
  surface_type: 'topic_state';
  id: string;
  topic: string;
  title: string;
  compiled_at: string;
  mode: 'review-only';
  trusted_world_truth: false;
  inputs: { extraction_reports: number; candidate_claims: number; verified_claims: number; events: number; entity_updates: number };
  current_state: TopicStateClaimRef[];
  recent_deltas: { since: string; new: TopicDeltaItem[]; changed: TopicDeltaItem[]; repeated: TopicDeltaItem[] };
  entity_map: TopicEntityState[];
  unresolved_questions: string[];
  watchlist: Array<{ entity: string; status: 'active' | 'quiet'; mention_count: number; latest_observed_at?: string; source_refs: CandidateSourceRef[] }>;
  relevance_to_active_projects: Array<{ project: string; relevance_score: number; reasons: string[]; claim_ids: string[]; source_refs: CandidateSourceRef[] }>;
  diagnostics: { stale_claims: number; uncited_rejected: number; warnings: string[] };
}

export interface CompileTopicStateInput {
  topic: string;
  extractions?: WorldExtractionReport[];
  claims?: ClaimLedgerRecord[];
  activeProjects?: string[];
  since?: string;
  staleAfterDays?: number;
  now?: Date;
}

function sha(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 16); }
function norm(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function unique<T>(items: T[]): T[] { return [...new Set(items)]; }
function ts(value?: string): number { return value && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : 0; }
function latest(a?: string, b?: string): string | undefined { return ts(a) >= ts(b) ? a : b; }
function hasRefs(refs: CandidateSourceRef[]): boolean { return Array.isArray(refs) && refs.length > 0 && refs.every(r => r.source_span_id && r.source_item_id && r.quote); }
function daysAgo(now: Date, value?: string): number { const t = ts(value); return t ? (now.getTime() - t) / 86400000 : Infinity; }

function recipeFor(topic: string): ScoutRecipe | undefined { return scoutRecipeById(topic) || BUILTIN_SCOUT_RECIPES.find(r => r.topic === topic); }

function staleInfo(input: { status?: string; valid_to?: string; observed_at?: string; now: Date; staleAfterDays: number }): { stale: boolean; reason?: string } {
  if (input.status === 'stale' || input.status === 'superseded' || input.status === 'contradicted') return { stale: true, reason: `claim status is ${input.status}` };
  if (input.valid_to && ts(input.valid_to) < input.now.getTime()) return { stale: true, reason: `valid_to ${input.valid_to} is in the past` };
  if (daysAgo(input.now, input.observed_at) > input.staleAfterDays) return { stale: true, reason: `observed_at is older than ${input.staleAfterDays} days` };
  return { stale: false };
}

function ledgerRefs(record: ClaimLedgerRecord): CandidateSourceRef[] {
  return (record.evidence || []).filter(e => e.role !== 'contradicts').map(e => ({ source_span_id: e.span_id, source_item_id: e.source_item_id, quote: e.quote, quote_hash: e.quote_hash }));
}

function entityHits(text: string, recipe?: ScoutRecipe, explicit: string[] = []): string[] {
  const hay = norm(text);
  return unique([...(recipe?.watch_entities || []), ...explicit].filter(e => hay.includes(norm(e))));
}

export function compileTopicState(input: CompileTopicStateInput): TopicStateSurface {
  const now = input.now || new Date();
  const compiledAt = now.toISOString();
  const staleAfterDays = input.staleAfterDays ?? 30;
  const since = input.since || new Date(now.getTime() - 7 * 86400000).toISOString();
  const sinceMs = ts(since);
  const topic = input.topic;
  const recipe = recipeFor(topic);
  const warnings: string[] = ['review-only topic state surface; does not mutate trusted personal memory'];
  const claims: TopicStateClaimRef[] = [];
  const events: TopicStateEventRef[] = [];
  const entityUpdates: CandidateEntityUpdate[] = [];
  let uncitedRejected = 0;

  for (const report of input.extractions || []) {
    if (report.topic !== topic) warnings.push(`included extraction topic ${report.topic} while compiling ${topic}`);
    for (const c of report.claims || []) {
      if (!hasRefs(c.source_refs)) { uncitedRejected++; continue; }
      const stale = staleInfo({ status: c.support_status === 'unsupported' ? 'stale' : undefined, observed_at: c.observed_at, now, staleAfterDays });
      claims.push({ id: c.id, kind: 'candidate', text: c.text, status: 'candidate', support_status: c.support_status, confidence: c.confidence, observed_at: c.observed_at, stale: stale.stale, stale_reason: c.unsupported_reason || stale.reason, source_refs: c.source_refs });
    }
    for (const e of report.events || []) {
      if (!hasRefs(e.source_refs)) { uncitedRejected++; continue; }
      const stale = staleInfo({ status: e.support_status === 'unsupported' ? 'stale' : undefined, observed_at: e.event_at || e.observed_at, now, staleAfterDays });
      events.push({ id: e.id, title: e.title, event_type: e.event_type, status: 'candidate', support_status: e.support_status, confidence: e.confidence, observed_at: e.observed_at, event_at: e.event_at, entities: e.entities, stale: stale.stale, stale_reason: e.unsupported_reason || stale.reason, source_refs: e.source_refs });
    }
    entityUpdates.push(...(report.entity_updates || []).filter(u => hasRefs(u.source_refs)));
  }

  for (const r of input.claims || []) {
    if (r.namespace !== 'world' || (r.type !== 'world' && r.type !== 'world_claim')) continue;
    if (topic && !norm(r.claim).includes(norm(topic).replace(/ /g, ' ').split(' ')[0] || '') && !entityHits(r.claim, recipe).length) continue;
    const refs = ledgerRefs(r);
    if (!hasRefs(refs)) { uncitedRejected++; continue; }
    const stale = staleInfo({ status: r.status, valid_to: r.valid_to, observed_at: r.observed_at, now, staleAfterDays });
    claims.push({ id: r.id, kind: 'verified', text: r.claim, status: r.status, confidence: r.confidence, observed_at: r.observed_at, stale: stale.stale, stale_reason: stale.reason, source_refs: refs });
  }

  const entityMap = new Map<string, TopicEntityState>();
  const touch = (entity: string, patch: Partial<TopicEntityState>, refs: CandidateSourceRef[], observed?: string) => {
    const prev = entityMap.get(entity) || { entity, mention_count: 0, claim_ids: [], event_ids: [], source_refs: [], watchlisted: Boolean(recipe?.watch_entities.some(e => norm(e) === norm(entity))) };
    prev.mention_count += 1;
    prev.latest_observed_at = latest(prev.latest_observed_at, observed);
    prev.claim_ids = unique([...(prev.claim_ids || []), ...(patch.claim_ids || [])]);
    prev.event_ids = unique([...(prev.event_ids || []), ...(patch.event_ids || [])]);
    prev.source_refs = [...prev.source_refs, ...refs].slice(0, 8);
    entityMap.set(entity, prev);
  };
  for (const c of claims) for (const entity of entityHits(c.text, recipe)) touch(entity, { claim_ids: [c.id] }, c.source_refs, c.observed_at);
  for (const e of events) for (const entity of entityHits(e.title, recipe, e.entities)) touch(entity, { event_ids: [e.id] }, e.source_refs, e.event_at || e.observed_at);
  for (const u of entityUpdates) touch(u.entity, { claim_ids: [u.id] }, u.source_refs, u.observed_at);

  const allDeltaCandidates = [
    ...claims.map(c => ({ id: c.id, kind: (c.kind === 'verified' ? 'verified_claim' : 'candidate_claim') as TopicInputKind, text: c.text, observed_at: c.observed_at, refs: c.source_refs })),
    ...events.map(e => ({ id: e.id, kind: 'candidate_event' as TopicInputKind, text: e.title, observed_at: e.event_at || e.observed_at, refs: e.source_refs })),
    ...entityUpdates.map(u => ({ id: u.id, kind: 'entity_update' as TopicInputKind, text: `${u.entity}: ${u.update}`, observed_at: u.observed_at, refs: u.source_refs })),
  ].filter(d => ts(d.observed_at) >= sinceMs);
  const seen = new Map<string, string>();
  const deltas = { new: [] as TopicDeltaItem[], changed: [] as TopicDeltaItem[], repeated: [] as TopicDeltaItem[] };
  for (const d of allDeltaCandidates.sort((a, b) => ts(b.observed_at) - ts(a.observed_at))) {
    const entity = entityHits(d.text, recipe)[0] || norm(d.text).split(' ').slice(0, 3).join(' ');
    const exact = norm(d.text);
    const prior = seen.get(entity);
    const bucket: DeltaBucket = !prior ? 'new' : prior === exact ? 'repeated' : 'changed';
    seen.set(entity, exact);
    deltas[bucket].push({ bucket, id: d.id, kind: d.kind, summary: d.text, observed_at: d.observed_at, source_refs: d.refs, reason: bucket === 'new' ? 'first recent signal for key/entity' : bucket === 'changed' ? 'same key/entity has different recent wording' : 'same normalized signal repeated' });
  }

  const unresolved = unique([
    ...claims.filter(c => c.support_status === 'unsupported').map(c => `Verify unsupported candidate: ${c.text}`),
    ...claims.filter(c => c.stale).slice(0, 5).map(c => `Refresh stale claim: ${c.text}`),
    ...(events.length === 0 ? [`No cited timeline events are available for ${topic}; scout for event evidence before treating state as complete.`] : []),
  ]).slice(0, 12);

  const projects = input.activeProjects?.length ? input.activeProjects : ['GBrain', 'OpenClaw'];
  const relevance = projects.map(project => {
    const p = norm(project);
    const matches = claims.filter(c => norm(c.text).includes(p) || (recipe?.objective && norm(recipe.objective).includes(p)) || (project === 'GBrain' && topic.includes('agent')) || (project === 'OpenClaw' && topic.includes('agent'))).slice(0, 6);
    return { project, relevance_score: matches.length ? 0.75 : (recipe?.action_templates.some(a => norm(a).includes('compare')) ? 0.35 : 0.1), reasons: matches.length ? matches.map(m => `cited claim ${m.id} appears relevant`) : ['topic recipe/action templates may be relevant but no direct cited project claim matched'], claim_ids: matches.map(m => m.id), source_refs: matches.flatMap(m => m.source_refs).slice(0, 6) };
  });

  const stateClaims = claims.sort((a, b) => Number(a.stale) - Number(b.stale) || ts(b.observed_at) - ts(a.observed_at));
  return {
    schema: 'gbrain.synthesis_surface.topic_state.v1',
    surface_type: 'topic_state',
    id: `topic_state_${sha(JSON.stringify({ topic, compiledAt, claims: claims.map(c => c.id), events: events.map(e => e.id) }))}`,
    topic,
    title: recipe?.title || topic,
    compiled_at: compiledAt,
    mode: 'review-only',
    trusted_world_truth: false,
    inputs: { extraction_reports: input.extractions?.length || 0, candidate_claims: claims.filter(c => c.kind === 'candidate').length, verified_claims: claims.filter(c => c.kind === 'verified').length, events: events.length, entity_updates: entityUpdates.length },
    current_state: stateClaims,
    recent_deltas: { since: new Date(sinceMs || Date.parse(since)).toISOString(), ...deltas },
    entity_map: [...entityMap.values()].sort((a, b) => b.mention_count - a.mention_count || a.entity.localeCompare(b.entity)),
    unresolved_questions: unresolved,
    watchlist: (recipe?.watch_entities || [...entityMap.keys()]).map(entity => { const hit = entityMap.get(entity); return { entity, status: hit ? 'active' as const : 'quiet' as const, mention_count: hit?.mention_count || 0, latest_observed_at: hit?.latest_observed_at, source_refs: hit?.source_refs || [] }; }),
    relevance_to_active_projects: relevance,
    diagnostics: { stale_claims: stateClaims.filter(c => c.stale).length + events.filter(e => e.stale).length, uncited_rejected: uncitedRejected, warnings },
  };
}

export function validateTopicStateSurface(surface: TopicStateSurface): string[] {
  const errors: string[] = [];
  if (surface.schema !== 'gbrain.synthesis_surface.topic_state.v1') errors.push('schema must be gbrain.synthesis_surface.topic_state.v1');
  if (surface.surface_type !== 'topic_state') errors.push('surface_type must be topic_state');
  if (surface.trusted_world_truth !== false || surface.mode !== 'review-only') errors.push('topic state must remain review-only and not trusted world truth');
  for (const c of surface.current_state) if (!hasRefs(c.source_refs)) errors.push(`current_state claim ${c.id} must be cited with source refs`);
  for (const bucket of ['new', 'changed', 'repeated'] as const) for (const d of surface.recent_deltas[bucket]) if (!hasRefs(d.source_refs)) errors.push(`recent_deltas.${bucket} ${d.id} must be cited with source refs`);
  return errors;
}

export function synthesisSurfacesPath(): string { return join(configDir(), 'synthesis-surfaces.jsonl'); }

export function appendSynthesisSurface(surface: TopicStateSurface, path = synthesisSurfacesPath()): string {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(path, JSON.stringify(surface) + '\n', { mode: 0o600 });
  return path;
}

export function readWorldExtractionFile(path: string): WorldExtractionReport[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(parsed)) return parsed as WorldExtractionReport[];
  if (parsed?.extraction) return [parsed.extraction as WorldExtractionReport];
  if (parsed?.schema === 'gbrain.world.extraction_report.v1') return [parsed as WorldExtractionReport];
  if (Array.isArray(parsed?.extractions)) return parsed.extractions as WorldExtractionReport[];
  throw new Error(`Unsupported world extraction JSON shape in ${path}`);
}

export function readClaimLedgerFile(path: string): ClaimLedgerRecord[] {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) return JSON.parse(raw) as ClaimLedgerRecord[];
  return raw.split(/\n+/).map(line => JSON.parse(line) as ClaimLedgerRecord);
}
