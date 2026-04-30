import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import { configDir } from '../config.ts';
import { parseSourceSpanRef } from '../evidence/source-bridge.ts';
import { readClaimLedgerFile, readWorldExtractionFile, synthesisSurfacesPath, type TopicStateSurface } from '../world/topic-state.ts';
import type { CandidateSourceRef, WorldExtractionReport } from '../world/extractor.ts';
import { claimLedgerPath, type ClaimLedgerRecord } from '../claims/claim-ledger.ts';
import { surfacingCandidatesPath, type SurfacingCandidate } from '../radar/surfacing.ts';
import { actionProposalsPath, type ActionProposal } from '../actions/proposals.ts';

export const TIMELINE_ENTRY_SCHEMA = 'gbrain.timeline.entry.v1';

export interface TimelineEntry {
  schema: typeof TIMELINE_ENTRY_SCHEMA;
  id: string;
  topic: string;
  title: string;
  event_type: string;
  status: 'candidate';
  mode: 'review-only';
  trusted_world_truth: false;
  observed_at: string;
  event_at?: string;
  entities: string[];
  source_refs: CandidateSourceRef[];
}

export interface IntelligenceHygieneStorePaths {
  timeline?: string;
  claims?: string;
  synthesis?: string;
  surfacing?: string;
  actions?: string;
}

export interface IntelligenceHygieneOptions {
  paths?: IntelligenceHygieneStorePaths;
  now?: Date;
  staleTopicDays?: number;
  timelineMinimumEntries?: number;
  minSourceSpanCoverage?: number;
}

export interface HygieneCheckResult {
  name: 'timeline_coverage' | 'source_span_resolution_coverage' | 'claim_evidence_coverage' | 'stale_topic_surfaces' | 'privacy_route_violations';
  status: 'ok' | 'warn' | 'fail';
  message: string;
  metrics: Record<string, number>;
  rationale?: string;
}

function sha(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 16); }
function ts(value?: string): number { return value && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : 0; }
function readJsonl<T = any>(path: string | undefined): T[] {
  if (!path || !existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  return raw.split(/\n+/).map(line => JSON.parse(line) as T);
}
function isObject(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function refValue(ref: unknown): string | undefined {
  if (typeof ref === 'string') return ref;
  if (isObject(ref)) return typeof ref.source_span_id === 'string' ? ref.source_span_id : typeof ref.ref === 'string' ? ref.ref : undefined;
  return undefined;
}
function hasQuote(ref: unknown): boolean { return isObject(ref) && typeof ref.quote === 'string' && ref.quote.trim().length > 0; }
function unique<T>(items: T[]): T[] { return [...new Set(items)]; }

export function timelineEntriesPath(): string { return join(configDir(), 'timeline-entries.jsonl'); }

export function timelineEntriesFromExtraction(report: WorldExtractionReport): TimelineEntry[] {
  return (report.events || []).filter(e => e.source_refs?.length).map(e => ({
    schema: TIMELINE_ENTRY_SCHEMA,
    id: `tl_${sha(JSON.stringify({ topic: e.topic, title: e.title, refs: e.source_refs.map(r => r.source_span_id).sort() }))}`,
    topic: e.topic,
    title: e.title,
    event_type: e.event_type,
    status: 'candidate',
    mode: 'review-only',
    trusted_world_truth: false,
    observed_at: e.observed_at,
    event_at: e.event_at,
    entities: e.entities || [],
    source_refs: e.source_refs,
  }));
}

export function backfillTimelineEntriesFromExtractions(reports: WorldExtractionReport[], opts: { path?: string; dryRun?: boolean } = {}): { path: string; before: number; added: number; after: number; entries: TimelineEntry[] } {
  const path = opts.path || timelineEntriesPath();
  const existing = readJsonl<TimelineEntry>(path).filter(r => r?.schema === TIMELINE_ENTRY_SCHEMA);
  const seen = new Set(existing.map(e => e.id));
  const entries = reports.flatMap(timelineEntriesFromExtraction).filter(e => !seen.has(e.id));
  if (!opts.dryRun && entries.length) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
  }
  return { path, before: existing.length, added: entries.length, after: existing.length + entries.length, entries };
}

function readTopicSurfaces(path?: string): TopicStateSurface[] {
  return readJsonl<TopicStateSurface>(path).filter(r => r?.schema === 'gbrain.synthesis_surface.topic_state.v1');
}
function readClaims(path?: string): ClaimLedgerRecord[] { return path && existsSync(path) ? readClaimLedgerFile(path) : []; }
function readSurfacing(path?: string): SurfacingCandidate[] {
  return readJsonl<any>(path).map(r => r?.candidate || r).filter(r => r?.schema === 'gbrain.radar.surfacing_candidate.v1');
}
function readActions(path?: string): ActionProposal[] {
  return readJsonl<any>(path).map(r => r?.proposal || r).filter(r => r?.schema === 'gbrain.actions.action_proposal.v1');
}

function collectRefs(input: { timeline: TimelineEntry[]; claims: ClaimLedgerRecord[]; topics: TopicStateSurface[]; surfacing: SurfacingCandidate[]; actions: ActionProposal[] }): unknown[] {
  return [
    ...input.timeline.flatMap(r => r.source_refs || []),
    ...input.claims.flatMap(r => r.evidence || []),
    ...input.topics.flatMap(t => [...(t.current_state || []).flatMap(c => c.source_refs || []), ...(t.recent_deltas?.new || []).flatMap(d => d.source_refs || []), ...(t.recent_deltas?.changed || []).flatMap(d => d.source_refs || []), ...(t.recent_deltas?.repeated || []).flatMap(d => d.source_refs || [])]),
    ...input.surfacing.flatMap(c => c.evidence || []),
    ...input.actions.flatMap(a => a.evidence || []),
  ];
}

export function analyzeIntelligenceSubstrateStores(opts: IntelligenceHygieneOptions = {}): HygieneCheckResult[] {
  const paths = {
    timeline: opts.paths?.timeline || timelineEntriesPath(),
    claims: opts.paths?.claims || claimLedgerPath(),
    synthesis: opts.paths?.synthesis || synthesisSurfacesPath(),
    surfacing: opts.paths?.surfacing || surfacingCandidatesPath(),
    actions: opts.paths?.actions || actionProposalsPath(),
  };
  const now = opts.now || new Date();
  const timeline = readJsonl<TimelineEntry>(paths.timeline).filter(r => r?.schema === TIMELINE_ENTRY_SCHEMA);
  const claims = readClaims(paths.claims);
  const topics = readTopicSurfaces(paths.synthesis);
  const surfacing = readSurfacing(paths.surfacing);
  const actions = readActions(paths.actions);
  const results: HygieneCheckResult[] = [];

  const topicEventInputs = topics.reduce((n, t) => n + (t.inputs?.events || 0), 0);
  const topicDeltaInputs = topics.reduce((n, t) => n + (t.recent_deltas?.new?.length || 0) + (t.recent_deltas?.changed?.length || 0) + (t.recent_deltas?.repeated?.length || 0), 0);
  const minTimeline = opts.timelineMinimumEntries ?? Math.min(10, Math.max(1, topicEventInputs || Math.ceil(topicDeltaInputs / 2) || 1));
  if (timeline.length >= minTimeline) results.push({ name: 'timeline_coverage', status: 'ok', message: `${timeline.length} timeline entr${timeline.length === 1 ? 'y' : 'ies'} available (threshold ${minTimeline})`, metrics: { entries: timeline.length, threshold: minTimeline, topic_event_inputs: topicEventInputs } });
  else results.push({ name: 'timeline_coverage', status: 'warn', message: `${timeline.length} timeline entr${timeline.length === 1 ? 'y' : 'ies'} below threshold ${minTimeline}. Run: gbrain world timeline backfill --from-extraction <world-extraction.json>`, metrics: { entries: timeline.length, threshold: minTimeline, topic_event_inputs: topicEventInputs }, rationale: 'warning is deterministic because local timeline store has fewer entries than topic/event evidence implies' });

  const refs = collectRefs({ timeline, claims, topics, surfacing, actions });
  const refStrings = refs.map(refValue).filter(Boolean) as string[];
  let parseable = 0;
  for (const ref of refStrings) { try { parseSourceSpanRef(ref); parseable++; } catch { /* counted below */ } }
  const quoted = refs.filter(hasQuote).length;
  const coverage = refStrings.length ? parseable / refStrings.length : 1;
  const quoteCoverage = refs.length ? quoted / refs.length : 1;
  const minSourceSpanCoverage = opts.minSourceSpanCoverage ?? 0.9;
  const sourceOk = coverage >= minSourceSpanCoverage && quoteCoverage >= 0.75;
  results.push({ name: 'source_span_resolution_coverage', status: sourceOk ? 'ok' : 'warn', message: refStrings.length === 0 ? 'No source-span refs in local candidate stores yet' : `${parseable}/${refStrings.length} refs parse as gbs1/srcspan1; ${quoted}/${refs.length} cited refs include quotes`, metrics: { refs: refStrings.length, parseable, quoted, coverage: Number(coverage.toFixed(3)), quote_coverage: Number(quoteCoverage.toFixed(3)) }, rationale: sourceOk ? undefined : 'source refs must be exact source spans with enough quote material for later evidence resolution' });

  const claimsWithEvidence = claims.filter(c => Array.isArray(c.evidence) && c.evidence.some(e => e.role === 'supports' && e.span_id && e.quote)).length;
  const claimCoverage = claims.length ? claimsWithEvidence / claims.length : 1;
  results.push({ name: 'claim_evidence_coverage', status: claimCoverage >= 1 ? 'ok' : 'warn', message: claims.length === 0 ? 'No claim ledger records in local store yet' : `${claimsWithEvidence}/${claims.length} claim(s) include supporting source-span evidence`, metrics: { claims: claims.length, with_supporting_evidence: claimsWithEvidence, coverage: Number(claimCoverage.toFixed(3)) }, rationale: claimCoverage >= 1 ? undefined : 'claims without supporting evidence remain review-only but should not be promoted' });

  const staleDays = opts.staleTopicDays ?? 14;
  const staleTopics = topics.filter(t => {
    const compiledAgeDays = ts(t.compiled_at) ? (now.getTime() - ts(t.compiled_at)) / 86400000 : Infinity;
    const noRecentDeltas = (t.recent_deltas?.new?.length || 0) + (t.recent_deltas?.changed?.length || 0) + (t.recent_deltas?.repeated?.length || 0) === 0;
    return compiledAgeDays > staleDays || ((t.diagnostics?.stale_claims || 0) > 0 && noRecentDeltas);
  });
  results.push({ name: 'stale_topic_surfaces', status: staleTopics.length === 0 ? 'ok' : 'warn', message: topics.length === 0 ? 'No topic-state surfaces in local store yet' : `${staleTopics.length}/${topics.length} topic surface(s) are stale or lack refresh deltas`, metrics: { topics: topics.length, stale: staleTopics.length, stale_days_threshold: staleDays }, rationale: staleTopics.length ? `refresh stale surfaces with gbrain world topic state ... --since <iso>; threshold=${staleDays}d` : undefined });

  const privacyViolations: string[] = [];
  for (const c of surfacing) {
    if (c.guardrails?.external_messages_sent || c.guardrails?.trusted_pages_edited || c.guardrails?.public_posts_sent) privacyViolations.push(`surfacing:${c.id}`);
    for (const e of c.evidence || []) if (typeof e.ref === 'string' && e.ref.startsWith('gbs1:') && c.url?.startsWith('http')) privacyViolations.push(`surfacing-public-url-personal-ref:${c.id}`);
  }
  for (const a of actions) {
    if (a.execution_policy?.external_send_allowed || a.execution_policy?.external_schedule_allowed || a.execution_policy?.trusted_memory_write_allowed || a.guardrails?.actions_performed || a.guardrails?.external_messages_sent || a.guardrails?.calendar_events_created || a.guardrails?.trusted_pages_edited) privacyViolations.push(`action:${a.id}`);
  }
  const personalPublicClaims = claims.filter(c => c.namespace === 'personal' && c.privacy === 'public').map(c => c.id);
  privacyViolations.push(...personalPublicClaims.map(id => `claim:${id}`));
  const uniqueViolations = unique(privacyViolations);
  results.push({ name: 'privacy_route_violations', status: uniqueViolations.length ? 'fail' : 'ok', message: uniqueViolations.length ? `${uniqueViolations.length} privacy/action route violation(s): ${uniqueViolations.slice(0, 3).join(', ')}` : 'No privacy-route or governed-action violations in local candidate stores', metrics: { violations: uniqueViolations.length }, rationale: uniqueViolations.length ? 'candidate/review-only stores must never record external sends, trusted edits, or personal-as-public routes' : undefined });

  return results;
}

export function readWorldExtractionReports(path: string): WorldExtractionReport[] { return readWorldExtractionFile(path); }
