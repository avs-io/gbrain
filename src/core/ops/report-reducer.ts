import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';

import { enqueueWorkPacket, type OpsWorkItem } from './kernel.ts';

export const OPS_REPORT_REDUCTION_REPORT_SCHEMA = 'gbrain.ops.report_reduction_report.v1';
export const OPS_REPORT_REDUCTION_RECORD_SCHEMA = 'gbrain.ops.report_reduction_record.v1';
export const OPS_UNREDUCED_ARTIFACT_AUDIT_SCHEMA = 'gbrain.ops.unreduced_artifact_audit.v1';

export type ReportReductionTarget = 'topic_evidence_candidate_input' | 'opportunity_candidate_input' | 'action_work_item_input' | 'discard_archive';
export type ReportReductionStatus = 'reduced' | 'discarded' | 'archived' | 'skipped';

export interface ReportArtifactRef {
  path: string;
  absolute_path: string;
  sha256: string;
  bytes: number;
  media_type: 'markdown' | 'text' | 'json';
}

export interface ReportSourceSpanCandidateInput {
  id: string;
  topic_id?: string;
  domain?: string;
  text: string;
  quote: string;
  section_title: string;
  source_artifact_ref: ReportArtifactRef;
  source_locator: string;
}

export interface ReportOpportunityCandidateInput {
  id: string;
  topic_id?: string;
  domain?: string;
  title: string;
  summary: string;
  signals: string[];
  evidence_refs: { ref: string; quote: string }[];
  source_artifact_ref: ReportArtifactRef;
}

export interface ReportActionWorkItemInput {
  id: string;
  topic_id?: string;
  domain?: string;
  title: string;
  rationale: string;
  priority: 'P1' | 'P2' | 'P3';
  evidence_refs: { ref: string; quote: string }[];
  approval_requirement: 'human_review_before_external_action';
  source_artifact_ref: ReportArtifactRef;
}

export interface ReportReductionRecord {
  schema: typeof OPS_REPORT_REDUCTION_RECORD_SCHEMA;
  id: string;
  reduced_at: string;
  source_artifact_ref: ReportArtifactRef;
  reduction_target: ReportReductionTarget;
  status: ReportReductionStatus;
  reason: string;
  topic_id?: string;
  domain?: string;
  source_locator?: string;
  trusted_memory_mutated: false;
  trusted_personal_memory_mutated: false;
  output_ref?: string;
}

export interface ReportReductionReport {
  schema: typeof OPS_REPORT_REDUCTION_REPORT_SCHEMA;
  ok: true;
  mode: 'review-only';
  reduced_at: string;
  topic_id?: string;
  domain?: string;
  source_artifact_ref: ReportArtifactRef;
  records: ReportReductionRecord[];
  topic_evidence_candidate_inputs: ReportSourceSpanCandidateInput[];
  opportunity_candidate_inputs: ReportOpportunityCandidateInput[];
  action_work_item_inputs: ReportActionWorkItemInput[];
  discard_records: ReportReductionRecord[];
  created_work_items: OpsWorkItem[];
  artifact_store_path: string;
  safety: {
    review_only: true;
    trusted_memory_mutated: false;
    trusted_personal_memory_mutated: false;
    external_action_taken: false;
    live_web_fetch_performed: false;
    ops_intelligence_only: true;
  };
  diagnostics: { sections_seen: number; reduced_records: number; discarded_records: number; warnings: string[] };
}

export interface AuditUnreducedReport {
  schema: typeof OPS_UNREDUCED_ARTIFACT_AUDIT_SCHEMA;
  ok: true;
  audited_at: string;
  artifact_count: number;
  covered_count: number;
  unreduced_count: number;
  unreduced_artifacts: { path: string; absolute_path: string; sha256: string; reason: string }[];
  covered_artifacts: { path: string; absolute_path: string; sha256: string; record_id: string; status: ReportReductionStatus; reduction_target: ReportReductionTarget; reason: string }[];
  reduction_store_path: string;
  safety: ReportReductionReport['safety'];
}

export interface ReduceReportOptions { inputPath: string; topicId?: string; domain?: string; artifactStorePath?: string; storePath?: string; now?: Date; createWorkItems?: boolean; }
export interface AuditUnreducedOptions { manifestPath?: string; dir?: string; reductionStorePath?: string; now?: Date; }

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, basis: unknown): string { return `${prefix}_${sha(JSON.stringify(basis)).slice(0, 16)}`; }
function clean(value: unknown): string { return String(value || '').replace(/\s+/g, ' ').trim(); }
function norm(value: unknown): string { return clean(value).toLowerCase(); }
function safety(): ReportReductionReport['safety'] { return { review_only: true, trusted_memory_mutated: false, trusted_personal_memory_mutated: false, external_action_taken: false, live_web_fetch_performed: false, ops_intelligence_only: true }; }

export function reportReductionStorePath(baseDir = process.cwd()): string { return join(baseDir, 'ops', 'intelligence', 'report-reductions.jsonl'); }

function artifactRef(path: string): ReportArtifactRef {
  const absolute = resolve(path);
  const raw = readFileSync(absolute, 'utf8');
  const ext = extname(path).toLowerCase();
  const media_type = ext === '.json' ? 'json' : ext === '.txt' ? 'text' : 'markdown';
  return { path, absolute_path: absolute, sha256: sha(raw), bytes: Buffer.byteLength(raw), media_type };
}

function readReportText(path: string): string {
  const raw = readFileSync(path, 'utf8');
  if (extname(path).toLowerCase() !== '.json') return raw;
  const parsed = JSON.parse(raw);
  if (typeof parsed === 'string') return parsed;
  const parts = [parsed.title, parsed.summary, parsed.report, parsed.markdown, parsed.text, parsed.content, ...(Array.isArray(parsed.sections) ? parsed.sections.map((s: any) => `${s.title || ''}\n${s.text || s.content || s.summary || ''}`) : [])];
  return parts.map(clean).filter(Boolean).join('\n\n') || raw;
}

interface Section { title: string; text: string; locator: string; }
function splitSections(text: string): Section[] {
  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let title = 'Report';
  let buf: string[] = [];
  let start = 1;
  const flush = (lineNo: number) => { const body = clean(buf.join('\n')); if (body) sections.push({ title, text: body, locator: `L${start}-L${Math.max(start, lineNo - 1)}` }); buf = []; start = lineNo + 1; };
  lines.forEach((line, ix) => {
    const h = /^\s{0,3}#{1,4}\s+(.+?)\s*$/.exec(line);
    if (h) { flush(ix + 1); title = clean(h[1]); start = ix + 2; }
    else buf.push(line);
  });
  flush(lines.length + 1);
  if (!sections.length && clean(text)) return [{ title: 'Report', text: clean(text), locator: 'L1-L1' }];
  return sections;
}

function sentence(text: string): string { return clean(text).split(/(?<=[.!?])\s+/).find(s => s.length >= 24) || clean(text).slice(0, 260); }
function isLowSignal(text: string): boolean {
  const t = norm(text);
  return clean(text).length < 80 || /\b(no actionable signal|nothing material|no material change|fyi only|routine status|same state|no change)\b/i.test(t);
}
function isAction(text: string): boolean { return /\b(action|next step|todo|follow[- ]?up|recommend(?:ed)?|should|need to|work item|proposal|draft|investigate|build|contact|prepare)\b/i.test(text); }
function isOpportunity(text: string): boolean { return /\b(opportunity|why now|wedge|pilot|partnership|customer|market|revenue|startup|founder|investor|demand|gap|bottleneck|pain)\b/i.test(text); }
function isEvidence(text: string): boolean { return /\b(source|evidence|claim|signal|announced|reported|according to|launched|policy|funding|deadline|procurement|quote|span)\b/i.test(text); }

function record(ref: ReportArtifactRef, target: ReportReductionTarget, status: ReportReductionStatus, reason: string, now: string, topicId?: string, domain?: string, locator?: string, outputRef?: string): ReportReductionRecord {
  return { schema: OPS_REPORT_REDUCTION_RECORD_SCHEMA, id: stableId('report_reduction', [ref.sha256, target, locator, outputRef, status]), reduced_at: now, source_artifact_ref: ref, reduction_target: target, status, reason, topic_id: topicId, domain, source_locator: locator, trusted_memory_mutated: false, trusted_personal_memory_mutated: false, output_ref: outputRef };
}

export function appendReportReductionRecords(records: ReportReductionRecord[], path = reportReductionStorePath()): string {
  if (!records.length) return path;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, records.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
  return path;
}

export function readReportReductionRecords(path = reportReductionStorePath()): ReportReductionRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l) as ReportReductionRecord).filter(r => r.schema === OPS_REPORT_REDUCTION_RECORD_SCHEMA);
}

export function reduceReportArtifact(options: ReduceReportOptions): ReportReductionReport {
  const now = (options.now || new Date()).toISOString();
  const source = artifactRef(options.inputPath);
  const text = readReportText(options.inputPath);
  const sections = splitSections(text);
  const topicInputs: ReportSourceSpanCandidateInput[] = [];
  const oppInputs: ReportOpportunityCandidateInput[] = [];
  const actionInputs: ReportActionWorkItemInput[] = [];
  const records: ReportReductionRecord[] = [];
  const warnings: string[] = [];

  for (const section of sections) {
    const quote = sentence(section.text);
    const baseRef = `${source.absolute_path}#${section.locator}`;
    if (isLowSignal(section.text)) {
      records.push(record(source, 'discard_archive', 'discarded', 'low-signal report section; archived with explicit discard record', now, options.topicId, options.domain, section.locator));
      continue;
    }
    let matched = false;
    if (isEvidence(section.text)) {
      const input: ReportSourceSpanCandidateInput = { id: stableId('report_span_input', [source.sha256, section.locator]), topic_id: options.topicId, domain: options.domain, text: section.text, quote, section_title: section.title, source_artifact_ref: source, source_locator: section.locator };
      topicInputs.push(input);
      records.push(record(source, 'topic_evidence_candidate_input', 'reduced', 'section contains source-backed claim/signal language; reduced to topic evidence candidate input', now, options.topicId, options.domain, section.locator, input.id));
      matched = true;
    }
    if (isOpportunity(section.text)) {
      const input: ReportOpportunityCandidateInput = { id: stableId('report_opp_input', [source.sha256, section.locator]), topic_id: options.topicId, domain: options.domain, title: section.title, summary: section.text.slice(0, 500), signals: [quote], evidence_refs: [{ ref: baseRef, quote }], source_artifact_ref: source };
      oppInputs.push(input);
      records.push(record(source, 'opportunity_candidate_input', 'reduced', 'section contains opportunity/timing/problem-fit language; reduced to opportunity candidate input', now, options.topicId, options.domain, section.locator, input.id));
      matched = true;
    }
    if (isAction(section.text)) {
      const input: ReportActionWorkItemInput = { id: stableId('report_action_input', [source.sha256, section.locator]), topic_id: options.topicId, domain: options.domain, title: `Review report action: ${section.title}`.slice(0, 140), rationale: section.text.slice(0, 700), priority: /\b(urgent|deadline|blocker|P1|interrupt)\b/i.test(section.text) ? 'P1' : /\b(should|recommend|pilot|build|draft|investigate)\b/i.test(section.text) ? 'P2' : 'P3', evidence_refs: [{ ref: baseRef, quote }], approval_requirement: 'human_review_before_external_action', source_artifact_ref: source };
      actionInputs.push(input);
      records.push(record(source, 'action_work_item_input', 'reduced', 'section contains action/next-step language; reduced to review-only action work item input', now, options.topicId, options.domain, section.locator, input.id));
      matched = true;
    }
    if (!matched) records.push(record(source, 'discard_archive', 'archived', 'section did not meet deterministic evidence/opportunity/action thresholds; archived with reason', now, options.topicId, options.domain, section.locator));
  }
  if (!records.length) warnings.push('empty report artifact; no sections reduced');
  const artifactPath = options.artifactStorePath || reportReductionStorePath();
  appendReportReductionRecords(records, artifactPath);
  const createdWorkItems = options.createWorkItems === false ? [] : createReportWorkItems(actionInputs, options.storePath, options.now || new Date());
  return { schema: OPS_REPORT_REDUCTION_REPORT_SCHEMA, ok: true, mode: 'review-only', reduced_at: now, topic_id: options.topicId, domain: options.domain, source_artifact_ref: source, records, topic_evidence_candidate_inputs: topicInputs, opportunity_candidate_inputs: oppInputs, action_work_item_inputs: actionInputs, discard_records: records.filter(r => r.status === 'discarded' || r.status === 'archived'), created_work_items: createdWorkItems, artifact_store_path: artifactPath, safety: safety(), diagnostics: { sections_seen: sections.length, reduced_records: records.filter(r => r.status === 'reduced').length, discarded_records: records.filter(r => r.status !== 'reduced').length, warnings } };
}

function createReportWorkItems(inputs: ReportActionWorkItemInput[], storePath: string | undefined, now: Date): OpsWorkItem[] {
  if (!inputs.length) return [];
  const at = now.toISOString();
  const packet = { programs: [{ id: 'report-reducer', title: 'Report Reducer', status: 'active', priority: 74, objective: 'Convert report artifacts into structured review-only state, opportunity, or action inputs.', lanes: ['report_reduction'], cadence: { trigger: 'artifact_reduced' }, budgets: { max_external_actions: 0, max_live_fetches: 0 }, autonomy: { internal_ops_only: true, can_contact_people: false, can_mutate_trusted_memory: false }, approval_gates: ['human_review_before_external_action', 'trusted_memory_mutation', 'external_send'], outputs: ['report_reduction_records', 'review_action_work_items'], created_at: at, updated_at: at }], work_items: inputs.map(i => ({ id: i.id, program_id: 'report-reducer', title: i.title, description: i.rationale, state: 'approved', priority: i.priority === 'P1' ? 88 : i.priority === 'P2' ? 70 : 52, lane: 'report_reduction', lanes: ['report_reduction'], worker_kind: 'script', privacy_tier: 'P2_LIMITED_CLOUD', source_refs: [{ kind: 'report_reduction_action_input', id: i.id, artifact: i.source_artifact_ref.path }, ...i.evidence_refs], dependencies: [], acceptance_criteria: ['Review source artifact span before action.', 'Produce keep/kill/action proposal recommendation.', 'Do not mutate trusted memory, send externally, or fetch live web.'], expected_artifacts: ['report_action_review.json'], guardrails: ['review_only', 'no_external_action', 'no_trusted_memory_mutation'], approval_gates: ['human_review_before_external_action'], budget: {}, created_by: 'report-reducer', created_at: at, updated_at: at, last_state_reason: 'report reducer created review-only work item' })) };
  return enqueueWorkPacket(packet, { path: storePath, now }).work_items;
}

function artifactPathsFromManifest(path: string): string[] {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.artifacts) ? raw.artifacts : Array.isArray(raw.files) ? raw.files : [];
  return arr.map((x: any) => typeof x === 'string' ? x : x.path || x.file || x.artifact_path).filter(Boolean);
}
function artifactPathsFromDir(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const name of readdirSync(d)) { const p = join(d, name); const st = statSync(p); if (st.isDirectory()) walk(p); else if (/\.(md|markdown|txt|json)$/i.test(name)) out.push(p); } };
  walk(dir);
  return out;
}

export function auditUnreducedArtifacts(options: AuditUnreducedOptions): AuditUnreducedReport {
  const auditedAt = (options.now || new Date()).toISOString();
  const paths = options.manifestPath ? artifactPathsFromManifest(options.manifestPath) : options.dir ? artifactPathsFromDir(options.dir) : [];
  if (!options.manifestPath && !options.dir) throw new Error('audit unreduced requires --manifest <file> or --dir <dir>');
  const records = readReportReductionRecords(options.reductionStorePath || reportReductionStorePath());
  const byHash = new Map(records.map(r => [r.source_artifact_ref.sha256, r]));
  const unreduced: AuditUnreducedReport['unreduced_artifacts'] = [];
  const covered: AuditUnreducedReport['covered_artifacts'] = [];
  for (const p of paths) {
    const ref = artifactRef(p);
    const rec = byHash.get(ref.sha256);
    if (rec && ['reduced', 'discarded', 'archived'].includes(rec.status)) covered.push({ path: ref.path, absolute_path: ref.absolute_path, sha256: ref.sha256, record_id: rec.id, status: rec.status, reduction_target: rec.reduction_target, reason: rec.reason });
    else unreduced.push({ path: ref.path, absolute_path: ref.absolute_path, sha256: ref.sha256, reason: 'no report reduction/discard/archive record found for artifact hash' });
  }
  return { schema: OPS_UNREDUCED_ARTIFACT_AUDIT_SCHEMA, ok: true, audited_at: auditedAt, artifact_count: paths.length, covered_count: covered.length, unreduced_count: unreduced.length, unreduced_artifacts: unreduced, covered_artifacts: covered, reduction_store_path: options.reductionStorePath || reportReductionStorePath(), safety: safety() };
}

export function writeReportReductionReport(path: string, report: ReportReductionReport | AuditUnreducedReport): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2) + '\n'); }
