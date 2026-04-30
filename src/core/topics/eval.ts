import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import type { SourceItemRecord, SourceSpanRecord } from '../evidence/source-bridge.ts';
import { runBookmarkDeepRadar, type BookmarkDeepInput, type BookmarkDeepRadarReport } from '../ops/bookmark-deep-radar.ts';
import { runOpportunityRadarV2, type OpportunityRadarV2Report } from '../ops/opportunity-radar-v2.ts';
import { auditUnreducedArtifacts, reduceReportArtifact, type AuditUnreducedReport, type ReportReductionReport } from '../ops/report-reducer.ts';
import { compileTopicAnswerPack, type TopicAnswerPack } from './answer-pack.ts';
import { reduceTopicClaimsFromExtraction, type TopicClaimReductionReport } from './claim-reducer.ts';
import { compileTopicDashboard, type TopicDashboard } from './dashboard.ts';
import { extractTopicCandidatesFromSourceSpans, type TopicCandidateExtractionReport } from './extractor.ts';
import { compileTopicCurrentState, compileTopicDailyDelta, type TopicCurrentStateSurface, type TopicDailyDeltaSurface } from './state-delta.ts';

export const TOPIC_EVAL_SUITE_SCHEMA = 'gbrain.topics.eval_suite.v1';
export const TOPIC_EVAL_REPORT_SCHEMA = 'gbrain.topics.eval_report.v1';

export type TopicEvalCategory =
  | 'candidate_extraction'
  | 'claim_reduction'
  | 'topic_state_delta'
  | 'opportunity_radar_v2'
  | 'answer_pack_guard'
  | 'bookmark_deep_radar'
  | 'report_reducer_audit'
  | 'topic_dashboard';

export interface TopicEvalFixture {
  topic_id?: string;
  domain?: string;
  source_items?: SourceItemRecord[];
  source_spans?: SourceSpanRecord[];
  previous_state?: TopicCurrentStateSurface;
  bookmarks?: BookmarkDeepInput[];
  memory_context?: unknown;
  report_texts?: Array<{ path?: string; filename?: string; text: string }>;
  report_files?: string[];
  now?: string;
}

export interface TopicEvalExpectations {
  min?: Record<string, number>;
  max?: Record<string, number>;
  equals?: Record<string, unknown>;
  contains?: Record<string, unknown>;
  coverage_categories?: TopicEvalCategory[];
}

export interface TopicEvalCase {
  id: string;
  category: TopicEvalCategory;
  fixture?: TopicEvalFixture;
  expect?: TopicEvalExpectations;
}

export interface TopicEvalSuite {
  schema?: typeof TOPIC_EVAL_SUITE_SCHEMA;
  suite_id: string;
  topic_id: string;
  domain?: string;
  fixture?: TopicEvalFixture;
  cases: TopicEvalCase[];
}

export interface TopicEvalCaseReport {
  id: string;
  category: TopicEvalCategory;
  pass: boolean;
  failures: string[];
  metrics: Record<string, number | string | boolean>;
  outputs: Record<string, unknown>;
}

export interface TopicEvalReport {
  schema: typeof TOPIC_EVAL_REPORT_SCHEMA;
  suite_id: string;
  ok: boolean;
  generated_at: string;
  cases: TopicEvalCaseReport[];
  pass_count: number;
  fail_count: number;
  failures: Array<{ case_id: string; category: TopicEvalCategory; message: string }>;
  coverage_categories: TopicEvalCategory[];
  trusted_personal_memory_mutated: false;
  safety: {
    review_only: true;
    trusted_personal_memory_mutated: false;
    external_action_taken: false;
    live_web_fetch_performed: false;
    hidden_memory_reads: false;
    ops_intelligence_only: true;
  };
  artifact_path?: string;
}

export interface RunTopicEvalOptions { artifactDir?: string; artifactPath?: string; now?: Date; writeArtifact?: boolean; }

interface PipelineOutputs {
  extraction: TopicCandidateExtractionReport;
  reduction: TopicClaimReductionReport;
  state: TopicCurrentStateSurface;
  delta: TopicDailyDeltaSurface;
  bookmark?: BookmarkDeepRadarReport;
  opportunities?: OpportunityRadarV2Report;
  answerPack?: TopicAnswerPack;
  reportReduction?: ReportReductionReport;
  reportAudit?: AuditUnreducedReport;
  dashboard?: TopicDashboard;
}

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function safety(): TopicEvalReport['safety'] { return { review_only: true, trusted_personal_memory_mutated: false, external_action_taken: false, live_web_fetch_performed: false, hidden_memory_reads: false, ops_intelligence_only: true }; }
function uniq<T>(items: T[]): T[] { return [...new Set(items.filter(Boolean))]; }
function unwrap(raw: any): any { return raw?.suite ? raw.suite : raw; }
function numberValue(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function bool(value: unknown): boolean { return value === true; }
function tmpRunDir(suiteId: string): string { return join(tmpdir(), `gbrain-topic-eval-${suiteId.replace(/[^a-z0-9_-]/gi, '-')}-${Date.now()}-${Math.random().toString(16).slice(2)}`); }
function metric(v: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: any, key) => {
    if (acc == null) return undefined;
    if (/^\d+$/.test(key) && Array.isArray(acc)) return acc[Number(key)];
    return acc[key];
  }, v as any);
}
function includesValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some(item => includesValue(item, expected));
  if (typeof expected === 'string') return String(actual ?? '').includes(expected);
  if (typeof expected === 'number' || typeof expected === 'boolean') return actual === expected;
  if (expected && typeof expected === 'object') return Object.entries(expected as Record<string, unknown>).every(([k, v]) => includesValue((actual as any)?.[k], v));
  return actual === expected;
}

export function readTopicEvalSuite(path: string): TopicEvalSuite {
  const parsed = unwrap(JSON.parse(readFileSync(path, 'utf8')));
  return normalizeSuite(parsed, dirname(resolve(path)));
}

export function readTopicEvalSuiteFromFixtureDir(dir: string): TopicEvalSuite {
  const candidates = ['suite.json', 'topic-eval-suite.json', 'eval-suite.json'].map(name => join(dir, name));
  const hit = candidates.find(p => existsSync(p));
  if (!hit) throw new Error(`fixture dir ${dir} must contain suite.json, topic-eval-suite.json, or eval-suite.json`);
  return readTopicEvalSuite(hit);
}

function normalizeSuite(raw: any, baseDir: string): TopicEvalSuite {
  if (!raw || typeof raw !== 'object') throw new Error('topic eval suite must be a JSON object');
  if (!raw.suite_id) throw new Error('topic eval suite requires suite_id');
  if (!raw.topic_id) throw new Error('topic eval suite requires topic_id');
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) throw new Error('topic eval suite requires non-empty cases[]');
  const suite: TopicEvalSuite = { schema: TOPIC_EVAL_SUITE_SCHEMA, suite_id: String(raw.suite_id), topic_id: String(raw.topic_id), domain: raw.domain, fixture: normalizeFixture(raw.fixture || {}, baseDir), cases: raw.cases.map((c: any) => ({ id: String(c.id || c.category), category: c.category, fixture: normalizeFixture(c.fixture || {}, baseDir), expect: c.expect || {} })) };
  validateSuite(suite);
  return suite;
}

function normalizeFixture(f: any, baseDir: string): TopicEvalFixture {
  const out: TopicEvalFixture = { ...f };
  for (const key of ['source_items', 'source_spans', 'bookmarks', 'memory_context'] as const) {
    const fileKey = `${key}_file`;
    if ((f as any)?.[fileKey]) (out as any)[key] = JSON.parse(readFileSync(resolve(baseDir, (f as any)[fileKey]), 'utf8'));
  }
  if (Array.isArray(f?.report_files)) out.report_files = f.report_files.map((p: string) => resolve(baseDir, p));
  return out;
}

function validateSuite(suite: TopicEvalSuite): void {
  const allowed: TopicEvalCategory[] = ['candidate_extraction','claim_reduction','topic_state_delta','opportunity_radar_v2','answer_pack_guard','bookmark_deep_radar','report_reducer_audit','topic_dashboard'];
  for (const c of suite.cases) if (!allowed.includes(c.category)) throw new Error(`unknown topic eval category: ${c.category}`);
}

function mergeFixture(suite: TopicEvalSuite, c: TopicEvalCase): TopicEvalFixture {
  return { ...(suite.fixture || {}), ...(c.fixture || {}), topic_id: c.fixture?.topic_id || suite.fixture?.topic_id || suite.topic_id, domain: c.fixture?.domain || suite.fixture?.domain || suite.domain };
}

function artifactPath(runDir: string, name: string): string { mkdirSync(runDir, { recursive: true }); return join(runDir, name); }

function reportFiles(fixture: TopicEvalFixture, runDir: string, caseId: string): string[] {
  const files = [...(fixture.report_files || [])];
  (fixture.report_texts || []).forEach((r, ix) => {
    const name = r.filename || r.path || `${caseId}-report-${ix + 1}.md`;
    const path = resolve(runDir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, r.text.endsWith('\n') ? r.text : `${r.text}\n`);
    files.push(path);
  });
  return files;
}

function runPipelineForCategory(suite: TopicEvalSuite, c: TopicEvalCase, runDir: string, now: Date): PipelineOutputs {
  const fixture = mergeFixture(suite, c);
  const topicId = fixture.topic_id || suite.topic_id;
  const sourceItems = fixture.source_items || [];
  const sourceSpans = fixture.source_spans || [];
  const extraction = extractTopicCandidatesFromSourceSpans({ topic_id: topicId, source_items: sourceItems, source_spans: sourceSpans, now });
  const reduction = reduceTopicClaimsFromExtraction(extraction, { topic_id: topicId, now });
  const state = compileTopicCurrentState({ topic_id: topicId, reduction, extraction, now });
  const delta = compileTopicDailyDelta({ topic_id: topicId, current: state, previous: fixture.previous_state, now });
  const out: PipelineOutputs = { extraction, reduction, state, delta };

  if (['bookmark_deep_radar','opportunity_radar_v2','topic_dashboard'].includes(c.category)) {
    out.bookmark = runBookmarkDeepRadar({ bookmarks: fixture.bookmarks || [], now, storePath: artifactPath(runDir, `${c.id}-ops.jsonl`), artifactPath: artifactPath(runDir, `${c.id}-bookmark-deep-radar.jsonl`) });
  }
  if (['report_reducer_audit','topic_dashboard'].includes(c.category)) {
    const files = reportFiles(fixture, runDir, c.id);
    const reductionStore = artifactPath(runDir, `${c.id}-report-reductions.jsonl`);
    if (files[0]) out.reportReduction = reduceReportArtifact({ inputPath: files[0], topicId, domain: fixture.domain, artifactStorePath: reductionStore, storePath: artifactPath(runDir, `${c.id}-report-ops.jsonl`), now, createWorkItems: false });
    const manifest = artifactPath(runDir, `${c.id}-manifest.json`);
    writeFileSync(manifest, JSON.stringify({ artifacts: files }, null, 2));
    out.reportAudit = auditUnreducedArtifacts({ manifestPath: manifest, reductionStorePath: reductionStore, now });
  }
  if (['opportunity_radar_v2','topic_dashboard'].includes(c.category)) {
    out.opportunities = runOpportunityRadarV2({ topicId, topicState: [state], topicDelta: [delta], bookmarkReports: out.bookmark ? [out.bookmark] : [], reductionReports: [reduction], memoryContext: fixture.memory_context, artifactPath: artifactPath(runDir, `${c.id}-opportunities.jsonl`), storePath: artifactPath(runDir, `${c.id}-opp-ops.jsonl`), now, createWorkItems: false });
  }
  if (['answer_pack_guard','topic_dashboard'].includes(c.category)) {
    out.answerPack = compileTopicAnswerPack({ topic_id: topicId, domain: fixture.domain, state, reduction, source_items: sourceItems, source_spans: sourceSpans, now });
  }
  if (c.category === 'topic_dashboard') {
    out.dashboard = compileTopicDashboard({ topic_id: topicId, state, delta, opportunities: out.opportunities, answerPack: out.answerPack, bookmarkRadar: out.bookmark, reportReduction: out.reportReduction, reportAudit: out.reportAudit, now });
  }
  return out;
}

function metricsFor(out: PipelineOutputs): Record<string, number | string | boolean> {
  return {
    topic_claims: out.extraction.topic_claims.length,
    topic_entities: out.extraction.topic_entities.length,
    topic_events: out.extraction.topic_events.length,
    topic_problem_signals: out.extraction.topic_problem_signals.length,
    unsupported_candidates: out.extraction.diagnostics.unsupported_candidates,
    reduced_claims: out.reduction.claims.length,
    supported_claims: out.reduction.diagnostics.supported_claims,
    draft_claims: out.reduction.diagnostics.draft_claims,
    current_claims: out.state.coverage.current_claims,
    open_unknowns: out.state.open_unknowns.length,
    delta_new: out.delta.material_new.length,
    opportunities: out.opportunities?.candidates.length || 0,
    archived_opportunities: out.opportunities?.archived_candidates.length || 0,
    answer_status: out.answerPack?.readiness.status || 'missing',
    answerable: out.answerPack?.readiness.answerable || false,
    excluded_sources: out.answerPack?.readiness.excluded_sources || 0,
    bookmark_decisions: out.bookmark?.decisions.length || 0,
    bookmark_source_spans: out.bookmark?.source_spans.length || 0,
    bookmark_topic_extractions: out.bookmark?.topic_extractions.length || 0,
    report_reduced_records: out.reportReduction?.diagnostics.reduced_records || 0,
    report_unreduced_artifacts: out.reportAudit?.unreduced_count || 0,
    dashboard_status: out.dashboard?.status || 'missing',
    dashboard_risks: out.dashboard?.risks.length || 0,
    dashboard_top_opportunities: out.dashboard?.top_opportunities.length || 0,
    trusted_personal_memory_mutated: false,
  };
}

function outputSummary(out: PipelineOutputs): Record<string, unknown> {
  return {
    extraction: { schema: out.extraction.schema, topic_claims: out.extraction.topic_claims.length, topic_entities: out.extraction.topic_entities.length, topic_events: out.extraction.topic_events.length, topic_problem_signals: out.extraction.topic_problem_signals.length },
    reduction: { schema: out.reduction.schema, claims: out.reduction.claims.length, supported: out.reduction.diagnostics.supported_claims },
    state: { schema: out.state.schema, current_claims: out.state.coverage.current_claims, open_unknowns: out.state.open_unknowns.length },
    delta: { schema: out.delta.schema, material_new: out.delta.material_new.length },
    opportunities: out.opportunities ? { schema: out.opportunities.schema, candidates: out.opportunities.candidates.length, archived: out.opportunities.archived_candidates.length } : undefined,
    answer_pack: out.answerPack ? { schema: out.answerPack.schema, status: out.answerPack.readiness.status, answerable: out.answerPack.readiness.answerable, excluded_sources: out.answerPack.readiness.excluded_sources } : undefined,
    bookmark_deep_radar: out.bookmark ? { schema: out.bookmark.schema, decisions: out.bookmark.decisions.length, source_spans: out.bookmark.source_spans.length } : undefined,
    report_reducer_audit: out.reportReduction || out.reportAudit ? { reduction_schema: out.reportReduction?.schema, audit_schema: out.reportAudit?.schema, reduced_records: out.reportReduction?.diagnostics.reduced_records || 0, unreduced_artifacts: out.reportAudit?.unreduced_count || 0 } : undefined,
    dashboard: out.dashboard ? { schema: out.dashboard.schema, status: out.dashboard.status, risks: out.dashboard.risks.map(r => r.kind), top_opportunities: out.dashboard.top_opportunities.length } : undefined,
  };
}

function assertExpectations(metrics: Record<string, number | string | boolean>, outputs: Record<string, unknown>, expected: TopicEvalExpectations | undefined, coverageCategories: TopicEvalCategory[]): string[] {
  const failures: string[] = [];
  if (!expected) return failures;
  for (const [k, v] of Object.entries(expected.min || {})) if (numberValue(metrics[k]) < v) failures.push(`${k} expected >= ${v}, got ${metrics[k]}`);
  for (const [k, v] of Object.entries(expected.max || {})) if (numberValue(metrics[k]) > v) failures.push(`${k} expected <= ${v}, got ${metrics[k]}`);
  for (const [k, v] of Object.entries(expected.equals || {})) {
    const actual = k.includes('.') ? metric({ metrics, outputs }, k) : (metrics[k] ?? metric(outputs, k));
    if (actual !== v) failures.push(`${k} expected ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`);
  }
  for (const [k, v] of Object.entries(expected.contains || {})) {
    const actual = k.includes('.') ? metric({ metrics, outputs }, k) : (metrics[k] ?? metric(outputs, k));
    if (!includesValue(actual, v)) failures.push(`${k} expected to contain ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`);
  }
  for (const cat of expected.coverage_categories || []) if (!coverageCategories.includes(cat)) failures.push(`coverage missing category ${cat}`);
  return failures;
}

function detectTrustedMutation(out: PipelineOutputs): boolean {
  const values = [
    out.extraction.trusted_personal_memory_mutated,
    out.reduction.trusted_personal_memory_mutated,
    out.state.trusted_personal_memory_mutated,
    out.delta.trusted_personal_memory_mutated,
    out.bookmark?.safety.trusted_personal_memory_mutated,
    out.opportunities?.safety.trusted_personal_memory_mutated,
    out.answerPack?.trusted_personal_memory_mutated,
    out.reportReduction?.safety.trusted_personal_memory_mutated,
    out.reportAudit?.safety.trusted_personal_memory_mutated,
    out.dashboard?.trusted_personal_memory_mutated,
  ];
  return values.some(bool);
}

export function runTopicEvalSuite(suite: TopicEvalSuite, options: RunTopicEvalOptions = {}): TopicEvalReport {
  validateSuite(suite);
  const now = options.now || new Date();
  const runDir = options.artifactDir || tmpRunDir(suite.suite_id);
  mkdirSync(runDir, { recursive: true });
  const coverage = uniq(suite.cases.map(c => c.category));
  const cases: TopicEvalCaseReport[] = [];
  for (const c of suite.cases) {
    const failures: string[] = [];
    let metrics: Record<string, number | string | boolean> = {};
    let outputs: Record<string, unknown> = {};
    try {
      const out = runPipelineForCategory(suite, c, runDir, c.fixture?.now ? new Date(c.fixture.now) : now);
      metrics = metricsFor(out);
      outputs = outputSummary(out);
      failures.push(...assertExpectations(metrics, outputs, c.expect, coverage));
      if (detectTrustedMutation(out)) failures.push('trusted_personal_memory_mutated must remain false');
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    cases.push({ id: c.id, category: c.category, pass: failures.length === 0, failures, metrics, outputs });
  }
  const failures = cases.flatMap(c => c.failures.map(message => ({ case_id: c.id, category: c.category, message })));
  const artifactPath = options.artifactPath || (options.writeArtifact ? join(runDir, `${suite.suite_id}-topic-eval-report.json`) : undefined);
  const report: TopicEvalReport = { schema: TOPIC_EVAL_REPORT_SCHEMA, suite_id: suite.suite_id, ok: failures.length === 0, generated_at: now.toISOString(), cases, pass_count: cases.filter(c => c.pass).length, fail_count: cases.filter(c => !c.pass).length, failures, coverage_categories: coverage, trusted_personal_memory_mutated: false, safety: safety(), artifact_path: artifactPath };
  if (artifactPath) { mkdirSync(dirname(artifactPath), { recursive: true }); writeFileSync(artifactPath, JSON.stringify(report, null, 2) + '\n'); }
  return report;
}

export function writeTopicEvalReport(path: string, report: TopicEvalReport): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2) + '\n'); }
export function defaultTopicEvalArtifactPath(baseDir = process.cwd(), suiteId = 'suite'): string { return join(baseDir, 'ops', 'intelligence', `topic-eval-${suiteId}-${sha(new Date().toISOString()).slice(0, 8)}.json`); }
