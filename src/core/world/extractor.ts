import { createHash } from 'node:crypto';

import type { ScoutRunReport } from '../scout/runner.ts';
import type { SourceSpanRecord } from '../evidence/source-bridge.ts';

export type CandidateSupportStatus = 'supported' | 'unsupported';

export interface CandidateSourceRef {
  source_span_id: string;
  source_item_id: string;
  quote: string;
  quote_hash?: string;
}

export interface CandidateWorldClaim {
  schema: 'gbrain.world.candidate_claim.v1';
  id: string;
  topic: string;
  text: string;
  type: 'world_claim';
  status: 'candidate';
  support_status: CandidateSupportStatus;
  confidence: number;
  observed_at: string;
  source_refs: CandidateSourceRef[];
  unsupported_reason?: string;
}

export interface CandidateTimelineEvent {
  schema: 'gbrain.world.candidate_timeline_event.v1';
  id: string;
  topic: string;
  title: string;
  event_type: 'announcement' | 'launch' | 'funding' | 'policy' | 'partnership' | 'other';
  status: 'candidate';
  support_status: CandidateSupportStatus;
  confidence: number;
  observed_at: string;
  event_at?: string;
  entities: string[];
  source_refs: CandidateSourceRef[];
  unsupported_reason?: string;
}

export interface CandidateEntityUpdate {
  schema: 'gbrain.world.candidate_entity_update.v1';
  id: string;
  topic: string;
  entity: string;
  update: string;
  status: 'candidate';
  support_status: CandidateSupportStatus;
  confidence: number;
  observed_at: string;
  source_refs: CandidateSourceRef[];
  unsupported_reason?: string;
}

export interface WorldExtractionReport {
  schema: 'gbrain.world.extraction_report.v1';
  mode: 'candidate-review-only';
  trusted_world_truth: false;
  topic: string;
  scout_run_id?: string;
  diagnostics: {
    source_spans_seen: number;
    claims_extracted: number;
    events_extracted: number;
    entity_updates_extracted: number;
    unsupported_candidates: number;
    rejected_candidates: number;
    warnings: string[];
  };
  claims: CandidateWorldClaim[];
  events: CandidateTimelineEvent[];
  entity_updates: CandidateEntityUpdate[];
}

interface ExtractableSpan {
  span: SourceSpanRecord;
  claim?: string;
  entities: string[];
  published_at?: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(prefix: string, input: unknown): string {
  return `${prefix}_${sha256(JSON.stringify(input)).slice(0, 16)}`;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value: string): string[] {
  const stop = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'to', 'with']);
  return norm(value).split(/\s+/).filter(t => t.length > 2 && !stop.has(t));
}

function unique(items: string[]): string[] {
  return [...new Set(items.map(v => v.trim()).filter(Boolean))];
}

function sourceRef(span: SourceSpanRecord): CandidateSourceRef | undefined {
  if (!span.ref || !span.source_item_id || !span.quote?.trim()) return undefined;
  return { source_span_id: span.ref, source_item_id: span.source_item_id, quote: span.quote.trim(), quote_hash: span.quote_hash };
}

export function deterministicSupportValidator(candidateText: string, refs: CandidateSourceRef[]): { status: CandidateSupportStatus; reason?: string; confidence: number } {
  if (refs.length === 0) return { status: 'unsupported', reason: 'candidate has no source_span quote', confidence: 0 };
  const textTokens = tokens(candidateText);
  if (textTokens.length < 3) return { status: 'unsupported', reason: 'candidate text is too short for deterministic support', confidence: 0.1 };
  const quote = refs.map(r => r.quote).join(' ');
  const quoteNorm = norm(quote);
  const negationLure = /\b(false|rumou?r|speculat|not confirmed|denied|hoax|lure|unverified)\b/i.test(quote);
  const hits = textTokens.filter(t => quoteNorm.includes(t));
  const overlap = hits.length / textTokens.length;
  if (negationLure && overlap < 0.92) return { status: 'unsupported', reason: 'source quote contains noisy or negating language and candidate is not directly quoted', confidence: 0.15 };
  if (overlap >= 0.55 || quoteNorm.includes(norm(candidateText))) return { status: 'supported', confidence: Math.min(0.82, Math.max(0.45, Number(overlap.toFixed(2)))) };
  return { status: 'unsupported', reason: `insufficient lexical support from source_span quote (${hits.length}/${textTokens.length} terms)`, confidence: Math.max(0.05, Number(overlap.toFixed(2))) };
}

function eventType(text: string): CandidateTimelineEvent['event_type'] | undefined {
  if (/\b(announc|unveil|introduc)\w*/i.test(text)) return 'announcement';
  if (/\b(launch|release|roll\s*out|debut)\w*/i.test(text)) return 'launch';
  if (/\b(raised|funding|series\s+[a-z]|seed round|investment)\b/i.test(text)) return 'funding';
  if (/\b(policy|regulation|mission|government|ministry|procurement)\b/i.test(text)) return 'policy';
  if (/\b(partner|partnership|collaborat|alliance)\w*/i.test(text)) return 'partnership';
  return undefined;
}

function eventDate(text: string, publishedAt?: string): string | undefined {
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text)?.[1];
  if (iso) return iso;
  if (publishedAt && !Number.isNaN(Date.parse(publishedAt))) return new Date(publishedAt).toISOString();
  return undefined;
}

function candidateTextFromSpan(input: ExtractableSpan): string | undefined {
  const claim = input.claim?.trim();
  if (claim && claim.length >= 12) return claim.replace(/\s+/g, ' ');
  const quote = input.span.quote?.trim().replace(/\s+/g, ' ');
  if (!quote || quote.length < 24) return undefined;
  const firstSentence = quote.split(/(?<=[.!?])\s+/).find(s => s.length >= 24 && s.length <= 260) || quote.slice(0, 240);
  return firstSentence.trim();
}

function extractablesFromScout(report: ScoutRunReport): ExtractableSpan[] {
  return report.source_spans.map((span, index) => {
    const signal = report.signals[index];
    return { span, claim: signal?.claim, entities: signal?.entities || [], published_at: signal?.published_at };
  });
}

export function validateWorldExtractionReport(report: WorldExtractionReport): string[] {
  const errors: string[] = [];
  if (report.schema !== 'gbrain.world.extraction_report.v1') errors.push('schema must be gbrain.world.extraction_report.v1');
  if (report.mode !== 'candidate-review-only') errors.push('mode must be candidate-review-only');
  if (report.trusted_world_truth !== false) errors.push('trusted_world_truth must be false');
  const seen = new Set<string>();
  const validateRefs = (kind: string, id: string, refs: CandidateSourceRef[]) => {
    if (!id) errors.push(`${kind}.id is required`);
    if (seen.has(id)) errors.push(`${kind}.id must be unique: ${id}`);
    seen.add(id);
    if (!Array.isArray(refs) || refs.length === 0) errors.push(`${kind} ${id} must reference at least one source_span id`);
    refs.forEach((ref, i) => {
      if (!ref.source_span_id || (!ref.source_span_id.startsWith('srcspan1:') && !ref.source_span_id.startsWith('gbs1:'))) errors.push(`${kind} ${id} source_refs[${i}].source_span_id must be gbs1/srcspan1`);
      if (!ref.source_item_id) errors.push(`${kind} ${id} source_refs[${i}].source_item_id is required`);
      if (!ref.quote) errors.push(`${kind} ${id} source_refs[${i}].quote is required`);
    });
  };
  for (const c of report.claims) {
    if (c.schema !== 'gbrain.world.candidate_claim.v1') errors.push(`claim ${c.id} schema invalid`);
    if (c.status !== 'candidate') errors.push(`claim ${c.id} status must be candidate`);
    validateRefs('claim', c.id, c.source_refs);
  }
  for (const e of report.events) {
    if (e.schema !== 'gbrain.world.candidate_timeline_event.v1') errors.push(`event ${e.id} schema invalid`);
    if (e.status !== 'candidate') errors.push(`event ${e.id} status must be candidate`);
    validateRefs('event', e.id, e.source_refs);
  }
  for (const u of report.entity_updates) {
    if (u.schema !== 'gbrain.world.candidate_entity_update.v1') errors.push(`entity_update ${u.id} schema invalid`);
    if (u.status !== 'candidate') errors.push(`entity_update ${u.id} status must be candidate`);
    validateRefs('entity_update', u.id, u.source_refs);
  }
  return errors;
}

export function extractWorldCandidatesFromScout(report: ScoutRunReport, input: { topic?: string; now?: Date } = {}): WorldExtractionReport {
  const topic = input.topic || report.recipe?.topic || report.recipe?.slug || 'world';
  const observedAt = (input.now || new Date()).toISOString();
  const claims: CandidateWorldClaim[] = [];
  const events: CandidateTimelineEvent[] = [];
  const entity_updates: CandidateEntityUpdate[] = [];
  let rejected = 0;

  for (const item of extractablesFromScout(report)) {
    if (item.span.privacy !== 'P3_PUBLIC' || item.span.namespace !== 'world') {
      rejected++;
      continue;
    }
    const ref = sourceRef(item.span);
    if (!ref) {
      rejected++;
      continue;
    }
    const text = candidateTextFromSpan(item);
    if (!text) {
      rejected++;
      continue;
    }
    const support = deterministicSupportValidator(text, [ref]);
    const claim: CandidateWorldClaim = {
      schema: 'gbrain.world.candidate_claim.v1',
      id: stableId('world_claim', { topic, text, spans: [ref.source_span_id] }),
      topic,
      text,
      type: 'world_claim',
      status: 'candidate',
      support_status: support.status,
      confidence: support.confidence,
      observed_at: observedAt,
      source_refs: [ref],
      unsupported_reason: support.reason,
    };
    claims.push(claim);

    const et = eventType(`${text} ${ref.quote}`);
    if (et) {
      events.push({
        schema: 'gbrain.world.candidate_timeline_event.v1',
        id: stableId('world_event', { topic, text, spans: [ref.source_span_id], et }),
        topic,
        title: text.slice(0, 180),
        event_type: et,
        status: 'candidate',
        support_status: support.status,
        confidence: support.confidence,
        observed_at: observedAt,
        event_at: eventDate(`${text} ${ref.quote}`, item.published_at),
        entities: unique(item.entities),
        source_refs: [ref],
        unsupported_reason: support.reason,
      });
    }

    for (const entity of unique(item.entities).slice(0, 8)) {
      const entitySupport = norm(ref.quote).includes(norm(entity)) ? support : { status: 'unsupported' as const, reason: 'entity name is not present in source_span quote', confidence: Math.min(0.2, support.confidence) };
      entity_updates.push({
        schema: 'gbrain.world.candidate_entity_update.v1',
        id: stableId('world_entity_update', { topic, entity, text, spans: [ref.source_span_id] }),
        topic,
        entity,
        update: text,
        status: 'candidate',
        support_status: entitySupport.status,
        confidence: entitySupport.confidence,
        observed_at: observedAt,
        source_refs: [ref],
        unsupported_reason: entitySupport.reason,
      });
    }
  }

  const unsupported = [...claims, ...events, ...entity_updates].filter(c => c.support_status === 'unsupported').length;
  const extraction: WorldExtractionReport = {
    schema: 'gbrain.world.extraction_report.v1',
    mode: 'candidate-review-only',
    trusted_world_truth: false,
    topic,
    scout_run_id: report.run_ledger?.run_id,
    diagnostics: {
      source_spans_seen: report.source_spans.length,
      claims_extracted: claims.length,
      events_extracted: events.length,
      entity_updates_extracted: entity_updates.length,
      unsupported_candidates: unsupported,
      rejected_candidates: rejected,
      warnings: [
        'candidate extraction only; no trusted world pages are edited',
        'P3 public world source_spans only; private/non-world spans are rejected',
        'deterministic support validator marks candidates supported only when source-span quote lexically supports the text',
      ],
    },
    claims,
    events,
    entity_updates,
  };
  const errors = validateWorldExtractionReport(extraction);
  if (errors.length) throw new Error(`World extraction failed schema validation: ${errors.join('; ')}`);
  return extraction;
}
