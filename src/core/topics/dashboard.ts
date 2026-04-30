import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import type { OpportunityV2Candidate, OpportunityRadarV2Report } from '../ops/opportunity-radar-v2.ts';
import type { BookmarkDeepRadarReport } from '../ops/bookmark-deep-radar.ts';
import type { AuditUnreducedReport, ReportReductionReport } from '../ops/report-reducer.ts';
import type { OpsWorkItem } from '../ops/kernel.ts';
import type { TopicAnswerPack } from './answer-pack.ts';
import type { TopicCurrentStateSurface, TopicDailyDeltaSurface, TopicNextWorkRecommendation, TopicOpenUnknown } from './state-delta.ts';

export const TOPIC_DASHBOARD_SCHEMA = 'gbrain.topics.dashboard.v1';

export interface TopicDashboardRisk {
  kind: 'stale_claim' | 'contradicted_claim' | 'unreduced_artifact' | 'answer_not_ready' | 'low_coverage';
  severity: 'low' | 'medium' | 'high';
  count: number;
  summary: string;
  refs: string[];
}

export interface TopicDashboardNextAction {
  id: string;
  source: 'topic_state' | 'topic_delta' | 'opportunity_radar' | 'answer_pack' | 'report_audit' | 'ops_work_item';
  priority: 'P1' | 'P2' | 'P3';
  title: string;
  rationale: string;
  refs: string[];
}

export interface TopicDashboard {
  schema: typeof TOPIC_DASHBOARD_SCHEMA;
  mode: 'review-only';
  trusted_world_truth: false;
  trusted_personal_memory_mutated: false;
  topic_id: string;
  generated_at: string;
  status: 'healthy' | 'watch' | 'needs_review' | 'blocked';
  inputs: {
    state: boolean;
    delta: boolean;
    opportunities: boolean;
    answer_pack: boolean;
    bookmark_deep_radar: boolean;
    report_reduction_or_audit: boolean;
    work_items: number;
  };
  coverage: {
    confidence_overall: number;
    supported_fraction: number;
    source_diversity: number;
    claims_seen: number;
    current_claims: number;
    supported_claims: number;
    stale_claims: number;
    contested_or_contradicted_claims: number;
    entities: number;
    events: number;
    problem_signals: number;
  };
  latest_material_deltas: {
    new: string[];
    changed: string[];
    stale: string[];
    contradicted: string[];
  };
  top_opportunities: Array<{ id: string; title: string; score: number; lifecycle: string; why_now: string; recommended_next_actions: string[]; evidence_refs: string[] }>;
  answer_readiness: {
    status: 'missing' | TopicAnswerPack['readiness']['status'];
    answerable: boolean;
    citation_coverage: number;
    supported_claims: number;
    unsupported_claims: number;
    excluded_sources: number;
    caveats: string[];
  };
  unresolved_unknowns: TopicOpenUnknown[];
  next_actions: TopicDashboardNextAction[];
  risks: TopicDashboardRisk[];
  bookmark_radar: { decisions: number; surfaced_candidates: number; archived_decisions: number; topic_links: number; source_spans: number };
  reduction_health: { unreduced_artifact_count: number; reduced_records: number; discarded_records: number; covered_artifacts: number };
  diagnostics: { warnings: string[]; missing_optional_inputs: string[] };
}

export interface CompileTopicDashboardInput {
  topic_id: string;
  state?: TopicCurrentStateSurface;
  delta?: TopicDailyDeltaSurface;
  opportunities?: OpportunityRadarV2Report;
  answerPack?: TopicAnswerPack;
  bookmarkRadar?: BookmarkDeepRadarReport;
  reportReduction?: ReportReductionReport;
  reportAudit?: AuditUnreducedReport;
  workItems?: OpsWorkItem[];
  now?: Date;
}

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, basis: unknown): string { return `${prefix}_${sha(JSON.stringify(basis)).slice(0, 16)}`; }
function uniq<T>(items: T[]): T[] { return [...new Set(items.filter(Boolean))]; }
function clamp01(n: number): number { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)); }
function refsFromUnknown(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  const v = value as any;
  return uniq([v.ref, v.source_span_id, v.source_item_id, v.id].filter(Boolean).map(String));
}
function unwrap(raw: any): any {
  if (raw?.surface) return raw.surface;
  if (raw?.report) return raw.report;
  if (raw?.pack) return raw.pack;
  if (raw?.audit) return raw.audit;
  return raw;
}
function readJson(path?: string): any | undefined { return path ? unwrap(JSON.parse(readFileSync(path, 'utf8'))) : undefined; }
function asTopicState(value: any): TopicCurrentStateSurface | undefined { return value?.schema === 'gbrain.topics.topic_current_state.v1' ? value : undefined; }
function asDelta(value: any): TopicDailyDeltaSurface | undefined { return value?.schema === 'gbrain.topics.topic_daily_delta.v1' ? value : undefined; }
function asAnswerPack(value: any): TopicAnswerPack | undefined { return value?.schema === 'gbrain.topics.answer_pack.v1' ? value : undefined; }
function asOpportunities(value: any): OpportunityRadarV2Report | undefined { return value?.schema === 'gbrain.ops.opportunity_radar.v2' ? value : undefined; }
function asBookmarkRadar(value: any): BookmarkDeepRadarReport | undefined { return value?.schema === 'gbrain.ops.bookmark_deep_radar.v1' ? value : undefined; }
function asReportReduction(value: any): ReportReductionReport | undefined { return value?.schema === 'gbrain.ops.report_reduction_report.v1' ? value : undefined; }
function asReportAudit(value: any): AuditUnreducedReport | undefined { return value?.schema === 'gbrain.ops.unreduced_artifact_audit.v1' ? value : undefined; }

export function readTopicDashboardInputs(paths: { state?: string; delta?: string; opportunities?: string; answerPack?: string; bookmarkRadar?: string; reportAudit?: string; reportReduction?: string; workItems?: string }): Omit<CompileTopicDashboardInput, 'topic_id'> {
  const workRaw = readJson(paths.workItems);
  const workItems = Array.isArray(workRaw) ? workRaw : Array.isArray(workRaw?.work_items) ? workRaw.work_items : Array.isArray(workRaw?.items) ? workRaw.items : undefined;
  return {
    state: asTopicState(readJson(paths.state)),
    delta: asDelta(readJson(paths.delta)),
    opportunities: asOpportunities(readJson(paths.opportunities)),
    answerPack: asAnswerPack(readJson(paths.answerPack)),
    bookmarkRadar: asBookmarkRadar(readJson(paths.bookmarkRadar)),
    reportAudit: asReportAudit(readJson(paths.reportAudit)),
    reportReduction: asReportReduction(readJson(paths.reportReduction)),
    workItems,
  };
}

function opportunityActions(candidates: OpportunityV2Candidate[]): TopicDashboardNextAction[] {
  return candidates.slice(0, 5).map(c => ({
    id: stableId('dashboard_action', ['opp', c.id]),
    source: 'opportunity_radar',
    priority: c.work_items?.[0]?.priority || (c.scores.final >= 0.75 ? 'P1' : c.scores.final >= 0.58 ? 'P2' : 'P3'),
    title: c.recommended_next_actions?.[0] || `Review opportunity: ${c.title}`,
    rationale: c.why_now || c.summary,
    refs: c.evidence.flatMap(refsFromUnknown),
  }));
}

function workItemActions(topicId: string, items: OpsWorkItem[]): TopicDashboardNextAction[] {
  return items.filter(w => (w as any).topic_id === topicId || JSON.stringify(w.source_refs || []).includes(topicId) || w.program_id === topicId || w.title?.includes(topicId)).slice(0, 8).map(w => ({
    id: stableId('dashboard_action', ['work_item', w.id]),
    source: 'ops_work_item',
    priority: w.priority <= 1 ? 'P1' : w.priority <= 3 ? 'P2' : 'P3',
    title: w.title,
    rationale: w.description || w.last_state_reason || `Ops WorkItem state=${w.state}`,
    refs: refsFromUnknown(w.id),
  }));
}

function stateActions(items: TopicNextWorkRecommendation[] = [], source: 'topic_state' | 'topic_delta'): TopicDashboardNextAction[] {
  return items.slice(0, 8).map(w => ({ id: stableId('dashboard_action', [source, w.id]), source, priority: w.priority, title: w.title, rationale: w.rationale, refs: w.refs || [] }));
}

export function compileTopicDashboard(input: CompileTopicDashboardInput): TopicDashboard {
  const topicId = input.topic_id?.trim();
  if (!topicId) throw new Error('topic dashboard requires topic_id');
  for (const [label, obj] of Object.entries({ state: input.state, delta: input.delta, answer_pack: input.answerPack, opportunities: input.opportunities, bookmark_radar: input.bookmarkRadar })) {
    if (obj && (obj as any).topic_id && (obj as any).topic_id !== topicId) throw new Error(`${label} topic_id ${(obj as any).topic_id} does not match ${topicId}`);
  }
  const now = input.now || new Date();
  const state = input.state;
  const delta = input.delta;
  const answer = input.answerPack;
  const opportunities = input.opportunities?.candidates || [];
  const warnings: string[] = ['review-only dashboard; no trusted memory/world truth mutation'];
  const missing = ['state','delta','opportunities','answer_pack','bookmark_deep_radar','report_reduction_or_audit'].filter(name => {
    if (name === 'state') return !state;
    if (name === 'delta') return !delta;
    if (name === 'opportunities') return !input.opportunities;
    if (name === 'answer_pack') return !answer;
    if (name === 'bookmark_deep_radar') return !input.bookmarkRadar;
    return !input.reportAudit && !input.reportReduction;
  });
  if (missing.length) warnings.push(`missing optional inputs: ${missing.join(', ')}`);

  const coverage = {
    confidence_overall: clamp01(state?.confidence.overall || 0),
    supported_fraction: clamp01(state?.confidence.supported_fraction || 0),
    source_diversity: state?.confidence.source_diversity || 0,
    claims_seen: state?.coverage.claims_seen || 0,
    current_claims: state?.coverage.current_claims || 0,
    supported_claims: state?.coverage.supported_claims || 0,
    stale_claims: state?.coverage.stale_claims || 0,
    contested_or_contradicted_claims: state?.coverage.contested_or_contradicted_claims || 0,
    entities: state?.coverage.entities || 0,
    events: state?.coverage.events || 0,
    problem_signals: state?.coverage.problem_signals || 0,
  };
  const topOpportunities = opportunities.slice().sort((a, b) => b.scores.final - a.scores.final).slice(0, 5).map(c => ({ id: c.id, title: c.title, score: c.scores.final, lifecycle: c.lifecycle, why_now: c.why_now, recommended_next_actions: c.recommended_next_actions || [], evidence_refs: c.evidence.flatMap(refsFromUnknown) }));
  const unresolved = uniq([...(state?.open_unknowns || []), ...(delta?.open_unknowns || [])]);
  const unreducedCount = input.reportAudit?.unreduced_count || 0;
  const reducedRecords = input.reportReduction?.diagnostics.reduced_records || input.reportAudit?.covered_count || 0;
  const discardedRecords = input.reportReduction?.diagnostics.discarded_records || input.reportReduction?.discard_records?.length || 0;
  const risks: TopicDashboardRisk[] = [];
  if (coverage.stale_claims || delta?.stale?.length) risks.push({ kind: 'stale_claim', severity: 'medium', count: Math.max(coverage.stale_claims, delta?.stale?.length || 0), summary: 'Topic contains stale/expired claims that need refresh', refs: (delta?.stale || []).flatMap(s => s.source_refs).slice(0, 12) });
  if (coverage.contested_or_contradicted_claims || delta?.contradicted?.length) risks.push({ kind: 'contradicted_claim', severity: 'high', count: Math.max(coverage.contested_or_contradicted_claims, delta?.contradicted?.length || 0), summary: 'Topic contains contested or contradicted claims that need adjudication', refs: (delta?.contradicted || []).flatMap(s => s.source_refs).slice(0, 12) });
  if (unreducedCount) risks.push({ kind: 'unreduced_artifact', severity: unreducedCount > 5 ? 'high' : 'medium', count: unreducedCount, summary: 'Report artifacts remain unreduced into structured state/discard records', refs: (input.reportAudit?.unreduced_artifacts || []).map(a => a.path).slice(0, 12) });
  if (answer && !answer.readiness.answerable) risks.push({ kind: 'answer_not_ready', severity: 'medium', count: answer.readiness.unsupported_claims + answer.readiness.excluded_sources, summary: `Answer readiness is ${answer.readiness.status}`, refs: answer.unsupported_claims.flatMap(c => c.source_refs).slice(0, 12) });
  if (state && (coverage.supported_fraction < 0.5 || coverage.source_diversity < 2)) risks.push({ kind: 'low_coverage', severity: 'medium', count: coverage.current_claims, summary: 'Topic state has low support coverage or source diversity', refs: state.current_claims.flatMap(c => c.source_refs).slice(0, 12) });

  const nextActions = uniq([
    ...stateActions(state?.next_work, 'topic_state'),
    ...stateActions(delta?.next_work, 'topic_delta'),
    ...opportunityActions(opportunities),
    ...workItemActions(topicId, input.workItems || []),
    ...(answer && !answer.readiness.answerable ? [{ id: stableId('dashboard_action', ['answer', topicId]), source: 'answer_pack' as const, priority: 'P2' as const, title: 'Improve answer readiness with supported citations', rationale: `Answer pack status=${answer.readiness.status}; citation coverage=${answer.readiness.citation_coverage}`, refs: answer.unsupported_claims.flatMap(c => c.source_refs) }] : []),
    ...(unreducedCount ? [{ id: stableId('dashboard_action', ['audit', topicId]), source: 'report_audit' as const, priority: 'P2' as const, title: `Reduce ${unreducedCount} unreduced topic artifact(s)`, rationale: 'No report is complete until reduced into state, opportunity/action, or discard record', refs: (input.reportAudit?.unreduced_artifacts || []).map(a => a.path) }] : []),
  ].map(a => JSON.stringify(a))).map(s => JSON.parse(s)).slice(0, 20);

  const status: TopicDashboard['status'] = risks.some(r => r.severity === 'high') ? 'needs_review' : answer?.readiness.unanswerable ? 'blocked' : risks.length || missing.includes('state') ? 'watch' : 'healthy';

  return {
    schema: TOPIC_DASHBOARD_SCHEMA,
    mode: 'review-only',
    trusted_world_truth: false,
    trusted_personal_memory_mutated: false,
    topic_id: topicId,
    generated_at: now.toISOString(),
    status,
    inputs: { state: !!state, delta: !!delta, opportunities: !!input.opportunities, answer_pack: !!answer, bookmark_deep_radar: !!input.bookmarkRadar, report_reduction_or_audit: !!(input.reportAudit || input.reportReduction), work_items: input.workItems?.length || 0 },
    coverage,
    latest_material_deltas: { new: (delta?.material_new || []).map(s => s.summary).slice(0, 10), changed: (delta?.changed || []).map(s => s.summary).slice(0, 10), stale: (delta?.stale || []).map(s => s.summary).slice(0, 10), contradicted: (delta?.contradicted || []).map(s => s.summary).slice(0, 10) },
    top_opportunities: topOpportunities,
    answer_readiness: answer ? { status: answer.readiness.status, answerable: answer.readiness.answerable, citation_coverage: answer.readiness.citation_coverage, supported_claims: answer.readiness.supported_claims, unsupported_claims: answer.readiness.unsupported_claims, excluded_sources: answer.readiness.excluded_sources, caveats: answer.caveats } : { status: 'missing', answerable: false, citation_coverage: 0, supported_claims: 0, unsupported_claims: 0, excluded_sources: 0, caveats: ['no answer-pack input provided'] },
    unresolved_unknowns: unresolved.slice(0, 25),
    next_actions: nextActions,
    risks,
    bookmark_radar: { decisions: input.bookmarkRadar?.decisions.length || 0, surfaced_candidates: input.bookmarkRadar?.surfaced_candidates.length || 0, archived_decisions: input.bookmarkRadar?.archived_decisions.length || 0, topic_links: (input.bookmarkRadar?.decisions || []).flatMap(d => d.topic_links || []).filter(l => l.topic_id === topicId).length, source_spans: input.bookmarkRadar?.source_spans.length || 0 },
    reduction_health: { unreduced_artifact_count: unreducedCount, reduced_records: reducedRecords, discarded_records: discardedRecords, covered_artifacts: input.reportAudit?.covered_count || 0 },
    diagnostics: { warnings, missing_optional_inputs: missing },
  };
}

export function validateTopicDashboard(d: TopicDashboard): string[] {
  const errors: string[] = [];
  if (d.schema !== TOPIC_DASHBOARD_SCHEMA) errors.push(`schema must be ${TOPIC_DASHBOARD_SCHEMA}`);
  if (d.mode !== 'review-only') errors.push('mode must be review-only');
  if (d.trusted_world_truth !== false) errors.push('trusted_world_truth must be false');
  if (d.trusted_personal_memory_mutated !== false) errors.push('trusted_personal_memory_mutated must be false');
  if (!d.topic_id) errors.push('topic_id is required');
  if (!['healthy','watch','needs_review','blocked'].includes(d.status)) errors.push('status invalid');
  return errors;
}

export function defaultTopicDashboardArtifactPath(baseDir = process.cwd()): string { return join(baseDir, 'ops', 'intelligence', 'topic-dashboards.jsonl'); }

export function appendTopicDashboardArtifact(surface: TopicDashboard, path = defaultTopicDashboardArtifactPath()): string {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ record_type: 'topic_dashboard', surface }) + '\n', { mode: 0o600 });
  return path;
}

export function readTopicDashboardStore(path = defaultTopicDashboardArtifactPath()): TopicDashboard[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l).surface).filter(s => s?.schema === TOPIC_DASHBOARD_SCHEMA);
}
