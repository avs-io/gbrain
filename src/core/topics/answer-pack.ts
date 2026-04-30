import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import type { SourceItemRecord, SourceSpanRecord } from '../evidence/source-bridge.ts';
import type { TopicClaimReductionReport } from './claim-reducer.ts';
import { readTopicExtractionInputFile } from './extractor.ts';
import type { TopicCurrentStateSurface } from './state-delta.ts';
import { readTopicCurrentStateFile, readTopicReductionOrStateFile } from './state-delta.ts';

export type TopicAnswerReadinessStatus = 'answerable' | 'unanswerable' | 'needs_verification';

export interface TopicAnswerPackCitation {
  source_span_id: string;
  source_item_id: string;
  quote: string;
  authority_tier?: string;
}

export interface TopicAnswerPackClaim {
  id: string;
  topic_id: string;
  domain?: string;
  claim: string;
  status: string;
  support_level: string;
  source_refs: string[];
  citations: TopicAnswerPackCitation[];
  caveats: string[];
}

export interface TopicAnswerPackUnsupportedClaim {
  id: string;
  topic_id?: string;
  domain?: string;
  claim: string;
  reason: string;
  source_refs: string[];
}

export interface TopicAnswerPackExcludedSource {
  id: string;
  kind: 'source_item' | 'source_span' | 'claim';
  reason: string;
  privacy?: string;
  namespace?: string;
  domain?: string;
}

export interface TopicAnswerPack {
  schema: 'gbrain.topics.answer_pack.v1';
  mode: 'review-only';
  trusted_world_truth: false;
  trusted_personal_memory_mutated: false;
  topic_id: string;
  domain?: string;
  requested_scope: { privacy: 'P3_PUBLIC'; namespace: 'world' };
  compiled_at: string;
  inputs: {
    state?: { as_of?: string; claims: number };
    reduction?: { reduced_at?: string; claims: number };
    source_spans?: { source_items: number; source_spans: number };
  };
  readiness: {
    status: TopicAnswerReadinessStatus;
    answerable: boolean;
    unanswerable: boolean;
    needs_verification: boolean;
    citation_coverage: number;
    supported_claims: number;
    unsupported_claims: number;
    excluded_sources: number;
  };
  answer_context: {
    instruction: string;
    boundaries: string[];
    allowed_claims: TopicAnswerPackClaim[];
    source_boundaries: Array<{ source_span_id: string; source_item_id: string; quote: string; title?: string; url?: string; authority?: string }>;
    open_unknowns: unknown[];
    caveats: string[];
  };
  unsupported_claims: TopicAnswerPackUnsupportedClaim[];
  excluded_sources: TopicAnswerPackExcludedSource[];
  caveats: string[];
  diagnostics: { errors: string[]; warnings: string[] };
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, input: unknown): string { return `${prefix}_${sha256(JSON.stringify(input)).slice(0, 18)}`; }
function uniq<T>(items: T[]): T[] { return [...new Set(items.filter(Boolean))]; }
function asString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function domainOf(value: unknown): string | undefined {
  const v = value as any;
  return asString(v?.domain) || asString(v?.topic_domain) || asString(v?.metadata?.domain) || asString(v?.metadata?.topic_domain);
}
function evidenceRefsOf(claim: any): TopicAnswerPackCitation[] {
  return (Array.isArray(claim?.evidence_refs) ? claim.evidence_refs : [])
    .map((r: any) => ({ source_span_id: r.source_span_id, source_item_id: r.source_item_id, quote: r.quote, authority_tier: asString(r.authority_tier || r.authority) }))
    .filter((r: TopicAnswerPackCitation) => Boolean(r.source_span_id && r.source_item_id && r.quote));
}
function sourceRefsOf(claim: any): string[] {
  return uniq([...(Array.isArray(claim?.source_refs) ? claim.source_refs : []), ...(Array.isArray(claim?.source_item_ids) ? claim.source_item_ids : []), ...(Array.isArray(claim?.source_span_ids) ? claim.source_span_ids : []), ...evidenceRefsOf(claim).flatMap(r => [r.source_item_id, r.source_span_id])]);
}
function isSupportedStatus(claim: any): boolean {
  return claim?.status === 'supported' && claim?.support_level !== 'unsupported' && claim?.support_status !== 'unsupported';
}
function claimText(claim: any): string { return String(claim?.claim || claim?.normalized_claim || claim?.title || '').trim(); }

function readSourceSpanBundle(path?: string): { source_items: SourceItemRecord[]; source_spans: SourceSpanRecord[] } | undefined {
  if (!path) return undefined;
  const input = readTopicExtractionInputFile(path);
  if (input.scout_report) return { source_items: input.scout_report.source_items || [], source_spans: input.scout_report.source_spans || [] };
  return { source_items: input.source_items || [], source_spans: input.source_spans || [] };
}

export function readTopicClaimReductionFile(path: string): TopicClaimReductionReport {
  const report = readTopicReductionOrStateFile(path);
  if (report.schema !== 'gbrain.topics.claim_reduction_report.v1') throw new Error('input file must contain gbrain.topics.claim_reduction_report.v1 (or wrapper)');
  return report as TopicClaimReductionReport;
}

export function readTopicAnswerPackInputs(paths: { state?: string; reduction?: string; sourceSpans?: string }): { state?: TopicCurrentStateSurface; reduction?: TopicClaimReductionReport; source_items?: SourceItemRecord[]; source_spans?: SourceSpanRecord[] } {
  const bundle = readSourceSpanBundle(paths.sourceSpans);
  return {
    state: paths.state ? readTopicCurrentStateFile(paths.state) : undefined,
    reduction: paths.reduction ? readTopicClaimReductionFile(paths.reduction) : undefined,
    source_items: bundle?.source_items,
    source_spans: bundle?.source_spans,
  };
}

function sourceIndex(items: SourceItemRecord[], spans: SourceSpanRecord[]): { itemById: Map<string, SourceItemRecord>; spanByRef: Map<string, SourceSpanRecord>; excluded: TopicAnswerPackExcludedSource[]; errors: string[] } {
  const itemById = new Map<string, SourceItemRecord>();
  const spanByRef = new Map<string, SourceSpanRecord>();
  const excluded: TopicAnswerPackExcludedSource[] = [];
  const errors: string[] = [];
  for (const item of items || []) {
    if (item.privacy !== 'P3_PUBLIC' || item.namespace !== 'world') {
      const reason = `source_item is outside requested P3_PUBLIC/world boundary (${item.privacy}/${item.namespace})`;
      excluded.push({ id: item.id, kind: 'source_item', reason, privacy: item.privacy, namespace: item.namespace, domain: domainOf(item) });
      errors.push(reason);
      continue;
    }
    itemById.set(item.id, item);
  }
  for (const span of spans || []) {
    if (span.privacy !== 'P3_PUBLIC' || span.namespace !== 'world') {
      const reason = `source_span is outside requested P3_PUBLIC/world boundary (${span.privacy}/${span.namespace})`;
      excluded.push({ id: span.ref, kind: 'source_span', reason, privacy: span.privacy, namespace: span.namespace, domain: domainOf(span) });
      errors.push(reason);
      continue;
    }
    spanByRef.set(span.ref, span);
  }
  return { itemById, spanByRef, excluded, errors };
}

export function compileTopicAnswerPack(input: {
  topic_id: string;
  domain?: string;
  state?: TopicCurrentStateSurface;
  reduction?: TopicClaimReductionReport;
  source_items?: SourceItemRecord[];
  source_spans?: SourceSpanRecord[];
  now?: Date;
}): TopicAnswerPack {
  const topicId = input.topic_id?.trim();
  if (!topicId) throw new Error('answer-pack requires topic_id');
  const domain = input.domain?.trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  const caveats: string[] = ['review-only answer pack; downstream answerer must not add claims outside allowed_claims/source_boundaries'];

  if (!input.state && !input.reduction) errors.push('answer-pack requires --from-state and/or --from-reduction with source-backed claims');
  if (input.state && input.state.topic_id !== topicId) errors.push(`state topic_id ${input.state.topic_id} does not match ${topicId}`);
  if (input.reduction && input.reduction.topic_id !== topicId) errors.push(`reduction topic_id ${input.reduction.topic_id} does not match ${topicId}`);
  for (const obj of [input.state, input.reduction].filter(Boolean) as any[]) {
    const d = domainOf(obj);
    if (domain && d && d !== domain) errors.push(`input domain ${d} does not match requested domain ${domain}`);
  }

  const source_items = input.source_items || [];
  const source_spans = input.source_spans || [];
  const indexed = sourceIndex(source_items, source_spans);
  errors.push(...indexed.errors);
  const excluded_sources: TopicAnswerPackExcludedSource[] = [...indexed.excluded];

  const rawClaims: any[] = [];
  if (input.state) rawClaims.push(...(input.state.current_claims || []).map(c => ({ ...c, __origin: 'state' })));
  if (input.reduction) rawClaims.push(...(input.reduction.claims || []).map(c => ({ ...c, __origin: 'reduction' })));

  const seenClaims = new Set<string>();
  const allowed_claims: TopicAnswerPackClaim[] = [];
  const unsupported_claims: TopicAnswerPackUnsupportedClaim[] = [];
  const boundaryBySpan = new Map<string, TopicAnswerPack['answer_context']['source_boundaries'][number]>();

  for (const claim of rawClaims) {
    const id = claim.id || stableId('answer_claim', { topicId, text: claimText(claim) });
    if (seenClaims.has(id)) continue;
    seenClaims.add(id);
    const cDomain = domainOf(claim);
    const refs = sourceRefsOf(claim);
    const citations = evidenceRefsOf(claim);
    const text = claimText(claim);
    if (claim.topic_id && claim.topic_id !== topicId) {
      const reason = `claim topic_id ${claim.topic_id} does not match ${topicId}`;
      excluded_sources.push({ id, kind: 'claim', reason, domain: cDomain });
      unsupported_claims.push({ id, topic_id: claim.topic_id, domain: cDomain, claim: text, reason, source_refs: refs });
      continue;
    }
    if (domain && cDomain && cDomain !== domain) {
      const reason = `claim domain ${cDomain} does not match requested domain ${domain}`;
      excluded_sources.push({ id, kind: 'claim', reason, domain: cDomain });
      unsupported_claims.push({ id, topic_id: claim.topic_id, domain: cDomain, claim: text, reason, source_refs: refs });
      continue;
    }
    if (!citations.length) {
      unsupported_claims.push({ id, topic_id: claim.topic_id, domain: cDomain, claim: text, reason: 'claim lacks evidence_refs with source_span_id/source_item_id/quote', source_refs: refs });
      continue;
    }
    const badCitation = citations.find(c => (indexed.spanByRef.size && !indexed.spanByRef.has(c.source_span_id)) || (indexed.itemById.size && !indexed.itemById.has(c.source_item_id)) || excluded_sources.some(e => e.id === c.source_span_id || e.id === c.source_item_id));
    if (badCitation) {
      unsupported_claims.push({ id, topic_id: claim.topic_id, domain: cDomain, claim: text, reason: `claim cites source outside available/allowed source boundary: ${badCitation.source_span_id}`, source_refs: refs });
      continue;
    }
    if (!isSupportedStatus(claim)) {
      unsupported_claims.push({ id, topic_id: claim.topic_id, domain: cDomain, claim: text, reason: `claim status/support is not answerable (${claim.status || claim.support_status}/${claim.support_level})`, source_refs: refs });
      continue;
    }
    const claimCaveats: string[] = [];
    if ((claim.source_diversity || 0) < 2) claimCaveats.push('low source diversity; prefer phrasing as provisional unless independently corroborated');
    allowed_claims.push({ id, topic_id: topicId, domain: cDomain || domain, claim: text, status: String(claim.status || 'supported'), support_level: String(claim.support_level || 'direct_quote'), source_refs: refs, citations, caveats: claimCaveats });
    for (const cit of citations) {
      const span = indexed.spanByRef.get(cit.source_span_id);
      const item = indexed.itemById.get(cit.source_item_id);
      boundaryBySpan.set(cit.source_span_id, { source_span_id: cit.source_span_id, source_item_id: cit.source_item_id, quote: cit.quote, title: item?.title, url: item?.url, authority: span?.authority || item?.authority || cit.authority_tier });
    }
  }

  const citationClaims = rawClaims.length ? rawClaims.filter(c => evidenceRefsOf(c).length > 0).length : 0;
  const citation_coverage = rawClaims.length ? Number((citationClaims / rawClaims.length).toFixed(3)) : 0;
  if (!allowed_claims.length) caveats.push('no supported in-scope claims survived topic/domain/privacy/evidence guards');
  if (unsupported_claims.length) caveats.push('unsupported or uncited claims were withheld from answer_context.allowed_claims');
  if (excluded_sources.length) caveats.push('some sources/claims were excluded for cross-domain, topic, or privacy boundary violations');
  if (citation_coverage < 1) warnings.push(`citation coverage is ${citation_coverage}; downstream answer should acknowledge gaps or abstain`);

  let status: TopicAnswerReadinessStatus = 'answerable';
  if (!allowed_claims.length || errors.length) status = 'unanswerable';
  else if (unsupported_claims.length || citation_coverage < 1) status = 'needs_verification';

  const compiledAt = (input.now || new Date()).toISOString();
  const openUnknowns = input.state?.open_unknowns || [];
  return {
    schema: 'gbrain.topics.answer_pack.v1',
    mode: 'review-only',
    trusted_world_truth: false,
    trusted_personal_memory_mutated: false,
    topic_id: topicId,
    domain,
    requested_scope: { privacy: 'P3_PUBLIC', namespace: 'world' },
    compiled_at: compiledAt,
    inputs: {
      state: input.state ? { as_of: input.state.as_of, claims: input.state.current_claims.length } : undefined,
      reduction: input.reduction ? { reduced_at: input.reduction.reduced_at, claims: input.reduction.claims.length } : undefined,
      source_spans: source_items.length || source_spans.length ? { source_items: source_items.length, source_spans: source_spans.length } : undefined,
    },
    readiness: { status, answerable: status === 'answerable', unanswerable: status === 'unanswerable', needs_verification: status === 'needs_verification', citation_coverage, supported_claims: allowed_claims.length, unsupported_claims: unsupported_claims.length, excluded_sources: excluded_sources.length },
    answer_context: {
      instruction: 'Answer only from allowed_claims and source_boundaries. Do not mix in other topics/domains. Cite source_span_id for every substantive claim. Abstain if the user asks outside this topic/domain boundary.',
      boundaries: [`topic_id=${topicId}`, domain ? `domain=${domain}` : 'domain=unspecified', 'privacy=P3_PUBLIC', 'namespace=world', 'review-only; not trusted world truth'],
      allowed_claims,
      source_boundaries: [...boundaryBySpan.values()],
      open_unknowns: openUnknowns,
      caveats,
    },
    unsupported_claims,
    excluded_sources,
    caveats,
    diagnostics: { errors: uniq(errors), warnings: uniq(warnings) },
  };
}

export function validateTopicAnswerPack(pack: TopicAnswerPack): string[] {
  const errors: string[] = [];
  if (pack.schema !== 'gbrain.topics.answer_pack.v1') errors.push('schema must be gbrain.topics.answer_pack.v1');
  if (pack.mode !== 'review-only') errors.push('mode must be review-only');
  if (pack.trusted_world_truth !== false) errors.push('trusted_world_truth must be false');
  if (pack.trusted_personal_memory_mutated !== false) errors.push('trusted_personal_memory_mutated must be false');
  if (!pack.topic_id) errors.push('topic_id required');
  for (const claim of pack.answer_context.allowed_claims) {
    if (claim.topic_id !== pack.topic_id) errors.push(`${claim.id} topic_id must match answer pack`);
    if (pack.domain && claim.domain && claim.domain !== pack.domain) errors.push(`${claim.id} domain must match answer pack`);
    if (!claim.citations.length) errors.push(`${claim.id} requires citations`);
  }
  return errors;
}

export function defaultTopicAnswerPackArtifactPath(baseDir = process.cwd()): string { return join(baseDir, 'ops', 'intelligence', 'topic-answer-packs.jsonl'); }
export function appendTopicAnswerPackArtifact(pack: TopicAnswerPack, path = defaultTopicAnswerPackArtifactPath()): string {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ record_type: 'topic_answer_pack', pack }) + '\n', { mode: 0o600 });
  return path;
}
