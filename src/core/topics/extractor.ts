import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import type { ScoutRunReport } from '../scout/runner.ts';
import type { SourceItemRecord, SourceSpanRecord } from '../evidence/source-bridge.ts';

export type TopicCandidateSupportStatus = 'supported' | 'unsupported';
export type TopicCandidateStatus = 'draft' | 'review_only';

export interface TopicCandidateEvidenceRef {
  source_span_id: string;
  source_item_id: string;
  quote: string;
  quote_hash?: string;
}

interface TopicCandidateBase {
  id: string;
  topic_id: string;
  status: TopicCandidateStatus;
  support_status: TopicCandidateSupportStatus;
  confidence: number;
  observed_at: string;
  source_span_ids: string[];
  evidence_refs: TopicCandidateEvidenceRef[];
  unsupported_reason?: string;
}

export interface TopicClaimCandidate extends TopicCandidateBase {
  schema: 'gbrain.topic_candidate.claim.v1';
  kind: 'topic_claim';
  claim: string;
  claim_type: 'policy' | 'market' | 'technical' | 'partnership' | 'procurement' | 'world_claim';
}

export interface TopicEntityCandidate extends TopicCandidateBase {
  schema: 'gbrain.topic_candidate.entity.v1';
  kind: 'topic_entity';
  entity: string;
  entity_type: 'organization' | 'person' | 'program' | 'product' | 'place' | 'unknown';
  context: string;
}

export interface TopicEventCandidate extends TopicCandidateBase {
  schema: 'gbrain.topic_candidate.event.v1';
  kind: 'topic_event';
  title: string;
  event_type: 'announcement' | 'launch' | 'funding' | 'policy' | 'partnership' | 'procurement' | 'deadline' | 'other';
  event_at?: string;
  entities: string[];
}

export interface TopicProblemSignalCandidate extends TopicCandidateBase {
  schema: 'gbrain.topic_candidate.problem_signal.v1';
  kind: 'topic_problem_signal';
  signal: string;
  problem_type: 'bottleneck' | 'risk' | 'gap' | 'demand' | 'constraint' | 'unknown';
  entities: string[];
}

export interface TopicCandidateExtractionReport {
  schema: 'gbrain.topics.candidate_extraction_report.v1';
  mode: 'review-only';
  trusted_world_truth: false;
  trusted_personal_memory_mutated: false;
  topic_id: string;
  generated_at: string;
  source?: { kind: 'source_spans' | 'scout_report'; scout_run_id?: string };
  diagnostics: {
    source_items_seen: number;
    source_spans_seen: number;
    topic_claims_extracted: number;
    topic_entities_extracted: number;
    topic_events_extracted: number;
    topic_problem_signals_extracted: number;
    unsupported_candidates: number;
    rejected_candidates: number;
    warnings: string[];
  };
  topic_claims: TopicClaimCandidate[];
  topic_entities: TopicEntityCandidate[];
  topic_events: TopicEventCandidate[];
  topic_problem_signals: TopicProblemSignalCandidate[];
}

export interface TopicExtractionInput {
  topic_id: string;
  source_items?: SourceItemRecord[];
  source_spans: SourceSpanRecord[];
  scout_report?: ScoutRunReport;
  now?: Date;
  allowUnsupported?: boolean;
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, input: unknown): string { return `${prefix}_${sha256(JSON.stringify(input)).slice(0, 18)}`; }
function norm(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function unique<T>(items: T[]): T[] { return [...new Set(items.filter(Boolean))]; }

function tokens(value: string): string[] {
  const stop = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'to', 'with']);
  return norm(value).split(/\s+/).filter(t => t.length > 2 && !stop.has(t));
}

function sentenceFromQuote(quote: string): string | undefined {
  const clean = quote.trim().replace(/\s+/g, ' ');
  if (clean.length < 16) return undefined;
  return clean.split(/(?<=[.!?])\s+/).find(s => s.length >= 16 && s.length <= 280) || clean.slice(0, 260);
}

export function validateTopicCandidateSupport(text: string, refs: TopicCandidateEvidenceRef[]): { status: TopicCandidateSupportStatus; reason?: string; confidence: number } {
  if (!refs.length) return { status: 'unsupported', reason: 'candidate has no evidence_refs/source_span_ids', confidence: 0 };
  const textTokens = tokens(text);
  if (textTokens.length < 2) return { status: 'unsupported', reason: 'candidate text is too short for deterministic support', confidence: 0.1 };
  const quote = refs.map(r => r.quote).join(' ');
  const quoteNorm = norm(quote);
  const negationLure = /\b(false|rumou?r|speculat|not confirmed|denied|hoax|unverified|no evidence)\b/i.test(quote);
  const hits = textTokens.filter(t => quoteNorm.includes(t));
  const overlap = hits.length / textTokens.length;
  if (quoteNorm.includes(norm(text)) || overlap >= 0.55) return { status: 'supported', confidence: Math.min(0.86, Math.max(0.45, Number(overlap.toFixed(2)))) };
  if (negationLure) return { status: 'unsupported', reason: 'source quote contains noisy or negating language and candidate is not directly supported', confidence: Math.max(0.05, Number(overlap.toFixed(2))) };
  return { status: 'unsupported', reason: `insufficient lexical support from source_span quote (${hits.length}/${textTokens.length} terms)`, confidence: Math.max(0.05, Number(overlap.toFixed(2))) };
}

function evidenceRef(span: SourceSpanRecord): TopicCandidateEvidenceRef | undefined {
  if (!span.ref || !span.source_item_id || !span.quote?.trim()) return undefined;
  return { source_span_id: span.ref, source_item_id: span.source_item_id, quote: span.quote.trim(), quote_hash: span.quote_hash };
}

function assertPublicWorldInputs(items: SourceItemRecord[], spans: SourceSpanRecord[]): void {
  for (const item of items) {
    if (item.privacy !== 'P3_PUBLIC') throw new Error(`topic extraction accepts only P3_PUBLIC source_items; ${item.id} has ${item.privacy}`);
    if (item.namespace !== 'world') throw new Error(`topic extraction accepts only public world source_items; ${item.id} has namespace=${item.namespace}`);
  }
  for (const span of spans) {
    if (span.privacy !== 'P3_PUBLIC') throw new Error(`topic extraction accepts only P3_PUBLIC source_spans; ${span.ref} has ${span.privacy}`);
    if (span.namespace !== 'world') throw new Error(`topic extraction accepts only public world source_spans; ${span.ref} has namespace=${span.namespace}`);
  }
}

function claimType(text: string): TopicClaimCandidate['claim_type'] {
  if (/\b(policy|regulation|mission|ministry|government)\b/i.test(text)) return 'policy';
  if (/\b(procurement|tender|rfp|gpu|compute capacity)\b/i.test(text)) return 'procurement';
  if (/\b(partner|partnership|collaborat|alliance)\w*/i.test(text)) return 'partnership';
  if (/\b(launch|model|benchmark|api|technical|architecture)\b/i.test(text)) return 'technical';
  if (/\b(market|revenue|customer|demand|pricing)\b/i.test(text)) return 'market';
  return 'world_claim';
}

function eventType(text: string): TopicEventCandidate['event_type'] | undefined {
  if (/\b(announc|unveil|introduc)\w*/i.test(text)) return 'announcement';
  if (/\b(launch|release|roll\s*out|debut)\w*/i.test(text)) return 'launch';
  if (/\b(raised|funding|series\s+[a-z]|seed round|investment)\b/i.test(text)) return 'funding';
  if (/\b(policy|regulation|mission|ministry|government)\b/i.test(text)) return 'policy';
  if (/\b(partner|partnership|collaborat|alliance)\w*/i.test(text)) return 'partnership';
  if (/\b(procurement|tender|rfp)\b/i.test(text)) return 'procurement';
  if (/\b(deadline|due by|closes on|last date)\b/i.test(text)) return 'deadline';
  return undefined;
}

function problemType(text: string): TopicProblemSignalCandidate['problem_type'] | undefined {
  if (/\b(bottleneck|blocked|shortage|constraint|capacity constrained)\b/i.test(text)) return 'bottleneck';
  if (/\b(risk|concern|threat|fragile|uncertain)\b/i.test(text)) return 'risk';
  if (/\b(gap|missing|lack|insufficient|unmet)\b/i.test(text)) return 'gap';
  if (/\b(demand|need|waiting|backlog)\b/i.test(text)) return 'demand';
  if (/\b(limit|cap|constraint|restricted)\b/i.test(text)) return 'constraint';
  return undefined;
}

function eventDate(text: string, fallback?: string): string | undefined {
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text)?.[1];
  if (iso) return new Date(`${iso}T00:00:00.000Z`).toISOString();
  if (fallback && !Number.isNaN(Date.parse(fallback))) return new Date(fallback).toISOString();
  return undefined;
}

function extractEntitiesFromText(text: string, explicit: string[] = []): string[] {
  const matches = text.match(/\b(?:[A-Z][A-Za-z0-9&.-]+)(?:\s+(?:[A-Z][A-Za-z0-9&.-]+|AI|ML|Mission|Ministry|Ltd|Inc|Corp|Foundation|Model))*\b/g) || [];
  return unique([...explicit, ...matches])
    .map(s => s.trim())
    .filter(s => s.length >= 3 && !['The', 'This', 'On', 'End', 'Briefing'].includes(s))
    .slice(0, 10);
}

function entityType(entity: string): TopicEntityCandidate['entity_type'] {
  if (/\b(Mission|Ministry|Department|MeitY|Government)\b/i.test(entity)) return 'program';
  if (/\b(AI|Inc|Ltd|Corp|Foundation|Labs|Systems)\b/i.test(entity)) return 'organization';
  if (/\b(India|Delhi|Bengaluru|Mumbai)\b/i.test(entity)) return 'place';
  return 'unknown';
}

function spanEntityHints(input: TopicExtractionInput, index: number): string[] {
  const signal = input.scout_report?.signals?.[index];
  return Array.isArray(signal?.entities) ? signal.entities.filter(Boolean) : [];
}

function spanPublishedAt(input: TopicExtractionInput, index: number): string | undefined {
  const signal = input.scout_report?.signals?.[index];
  if (signal?.published_at) return signal.published_at;
  const spanDate = input.source_spans[index]?.metadata?.published_at;
  return typeof spanDate === 'string' ? spanDate : undefined;
}

export function extractTopicCandidatesFromSourceSpans(input: TopicExtractionInput): TopicCandidateExtractionReport {
  if (!input.topic_id?.trim()) throw new Error('topic extraction requires topic_id');
  const topicId = input.topic_id.trim();
  const sourceItems = input.source_items || input.scout_report?.source_items || [];
  const sourceSpans = input.source_spans || input.scout_report?.source_spans || [];
  assertPublicWorldInputs(sourceItems, sourceSpans);

  const generatedAt = (input.now || new Date()).toISOString();
  const topic_claims: TopicClaimCandidate[] = [];
  const topic_entities: TopicEntityCandidate[] = [];
  const topic_events: TopicEventCandidate[] = [];
  const topic_problem_signals: TopicProblemSignalCandidate[] = [];
  let rejected = 0;

  sourceSpans.forEach((span, index) => {
    const ref = evidenceRef(span);
    if (!ref) { rejected++; return; }
    const text = sentenceFromQuote(ref.quote);
    if (!text) { rejected++; return; }
    const source_span_ids = [ref.source_span_id];
    const evidence_refs = [ref];
    const support = validateTopicCandidateSupport(text, evidence_refs);
    const base = { topic_id: topicId, status: 'review_only' as const, support_status: support.status, confidence: support.confidence, observed_at: generatedAt, source_span_ids, evidence_refs, unsupported_reason: support.reason };

    topic_claims.push({ schema: 'gbrain.topic_candidate.claim.v1', kind: 'topic_claim', id: stableId('topic_claim', { topicId, text, source_span_ids }), claim: text, claim_type: claimType(text), ...base });

    const entities = extractEntitiesFromText(`${text} ${ref.quote}`, spanEntityHints(input, index));
    for (const entity of entities) {
      const entitySupport = norm(ref.quote).includes(norm(entity)) ? support : { status: 'unsupported' as const, reason: 'entity name is not present in source_span quote', confidence: Math.min(0.2, support.confidence) };
      topic_entities.push({ schema: 'gbrain.topic_candidate.entity.v1', kind: 'topic_entity', id: stableId('topic_entity', { topicId, entity, source_span_ids }), topic_id: topicId, entity, entity_type: entityType(entity), context: text, status: 'review_only', support_status: entitySupport.status, confidence: entitySupport.confidence, observed_at: generatedAt, source_span_ids, evidence_refs, unsupported_reason: entitySupport.reason });
    }

    const et = eventType(`${text} ${ref.quote}`);
    if (et) topic_events.push({ schema: 'gbrain.topic_candidate.event.v1', kind: 'topic_event', id: stableId('topic_event', { topicId, text, et, source_span_ids }), title: text.slice(0, 180), event_type: et, event_at: eventDate(`${text} ${ref.quote}`, spanPublishedAt(input, index)), entities, ...base });

    const pt = problemType(`${text} ${ref.quote}`);
    if (pt) topic_problem_signals.push({ schema: 'gbrain.topic_candidate.problem_signal.v1', kind: 'topic_problem_signal', id: stableId('topic_problem', { topicId, text, pt, source_span_ids }), signal: text, problem_type: pt, entities, ...base });
  });

  const unsupported = [...topic_claims, ...topic_entities, ...topic_events, ...topic_problem_signals].filter(c => c.support_status === 'unsupported').length;
  const report: TopicCandidateExtractionReport = {
    schema: 'gbrain.topics.candidate_extraction_report.v1',
    mode: 'review-only',
    trusted_world_truth: false,
    trusted_personal_memory_mutated: false,
    topic_id: topicId,
    generated_at: generatedAt,
    source: input.scout_report ? { kind: 'scout_report', scout_run_id: input.scout_report.run_ledger?.run_id } : { kind: 'source_spans' },
    diagnostics: {
      source_items_seen: sourceItems.length,
      source_spans_seen: sourceSpans.length,
      topic_claims_extracted: topic_claims.length,
      topic_entities_extracted: topic_entities.length,
      topic_events_extracted: topic_events.length,
      topic_problem_signals_extracted: topic_problem_signals.length,
      unsupported_candidates: unsupported,
      rejected_candidates: rejected,
      warnings: [
        'review-only topic candidates; trusted memory/world state is not mutated',
        'P3 public world source_items and source_spans only; private/non-public input is rejected fail-closed',
        'every candidate must carry topic_id, source_span_ids, and evidence_refs; unsupported candidates remain untrusted',
      ],
    },
    topic_claims,
    topic_entities,
    topic_events,
    topic_problem_signals,
  };
  const errors = validateTopicCandidateExtractionReport(report);
  if (errors.length) throw new Error(`Topic candidate extraction failed schema validation: ${errors.join('; ')}`);
  return report;
}

export function extractTopicCandidatesFromScout(report: ScoutRunReport, input: { topic_id: string; now?: Date }): TopicCandidateExtractionReport {
  return extractTopicCandidatesFromSourceSpans({ topic_id: input.topic_id, source_items: report.source_items, source_spans: report.source_spans, scout_report: report, now: input.now });
}

export function validateTopicCandidateExtractionReport(report: TopicCandidateExtractionReport): string[] {
  const errors: string[] = [];
  if (report.schema !== 'gbrain.topics.candidate_extraction_report.v1') errors.push('schema must be gbrain.topics.candidate_extraction_report.v1');
  if (report.mode !== 'review-only') errors.push('mode must be review-only');
  if (report.trusted_world_truth !== false) errors.push('trusted_world_truth must be false');
  if (report.trusted_personal_memory_mutated !== false) errors.push('trusted_personal_memory_mutated must be false');
  if (!report.topic_id) errors.push('topic_id is required');
  const seen = new Set<string>();
  const validateBase = (kind: string, c: TopicCandidateBase) => {
    if (!c.id) errors.push(`${kind}.id is required`);
    if (seen.has(c.id)) errors.push(`${kind}.id must be unique: ${c.id}`);
    seen.add(c.id);
    if (c.topic_id !== report.topic_id) errors.push(`${kind} ${c.id} topic_id must match report.topic_id`);
    if (!Array.isArray(c.source_span_ids) || c.source_span_ids.length === 0) errors.push(`${kind} ${c.id} source_span_ids required`);
    if (!Array.isArray(c.evidence_refs) || c.evidence_refs.length === 0) errors.push(`${kind} ${c.id} evidence_refs required`);
    const refIds = new Set(c.evidence_refs.map(r => r.source_span_id));
    for (const id of c.source_span_ids || []) if (!refIds.has(id)) errors.push(`${kind} ${c.id} source_span_ids must be backed by evidence_refs: ${id}`);
    for (const [i, ref] of (c.evidence_refs || []).entries()) {
      if (!ref.source_span_id || (!ref.source_span_id.startsWith('srcspan1:') && !ref.source_span_id.startsWith('gbs1:'))) errors.push(`${kind} ${c.id} evidence_refs[${i}].source_span_id must be gbs1/srcspan1`);
      if (!ref.source_item_id) errors.push(`${kind} ${c.id} evidence_refs[${i}].source_item_id required`);
      if (!ref.quote) errors.push(`${kind} ${c.id} evidence_refs[${i}].quote required`);
    }
    if (c.support_status === 'unsupported' && !c.unsupported_reason) errors.push(`${kind} ${c.id} unsupported candidates require unsupported_reason`);
  };
  report.topic_claims.forEach(c => { if (c.schema !== 'gbrain.topic_candidate.claim.v1') errors.push(`claim ${c.id} schema invalid`); validateBase('topic_claim', c); });
  report.topic_entities.forEach(c => { if (c.schema !== 'gbrain.topic_candidate.entity.v1') errors.push(`entity ${c.id} schema invalid`); validateBase('topic_entity', c); });
  report.topic_events.forEach(c => { if (c.schema !== 'gbrain.topic_candidate.event.v1') errors.push(`event ${c.id} schema invalid`); validateBase('topic_event', c); });
  report.topic_problem_signals.forEach(c => { if (c.schema !== 'gbrain.topic_candidate.problem_signal.v1') errors.push(`problem_signal ${c.id} schema invalid`); validateBase('topic_problem_signal', c); });
  return errors;
}

export function readTopicExtractionInputFile(path: string): { source_items?: SourceItemRecord[]; source_spans?: SourceSpanRecord[]; scout_report?: ScoutRunReport } {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(raw)) return { source_spans: raw as SourceSpanRecord[] };
  if (!raw || typeof raw !== 'object') throw new Error('topic extraction input must be a JSON object or source_spans array');
  const obj = raw as any;
  if (obj.schema === 'gbrain.scout.run_report.v1') return { scout_report: obj as ScoutRunReport, source_items: obj.source_items || [], source_spans: obj.source_spans || [] };
  if (Array.isArray(obj.source_spans)) return { source_items: Array.isArray(obj.source_items) ? obj.source_items : [], source_spans: obj.source_spans };
  if (Array.isArray(obj.spans)) return { source_items: Array.isArray(obj.source_items) ? obj.source_items : [], source_spans: obj.spans };
  throw new Error('topic extraction input requires source_spans/spans array or gbrain.scout.run_report.v1');
}

export function defaultTopicCandidateArtifactPath(baseDir = process.cwd()): string {
  return join(baseDir, 'ops', 'intelligence', 'topic-candidate-extractions.jsonl');
}

export function appendTopicCandidateExtractionArtifact(report: TopicCandidateExtractionReport, path = defaultTopicCandidateArtifactPath()): string {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ record_type: 'topic_candidate_extraction', report }) + '\n', { mode: 0o600 });
  return path;
}
