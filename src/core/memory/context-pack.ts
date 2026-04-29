import { basename, isAbsolute } from 'path';
import type { ClaimLedgerRecord } from '../claims/claim-ledger.ts';
import { listClaimLedgerRecords } from '../claims/claim-ledger.ts';
import {
  GBRAIN_NAMESPACES,
  GBRAIN_PRIVACY_LEVELS,
  GBRAIN_SENSITIVITY_LEVELS,
  classifyNamespacePolicy,
  validateNamespacePolicy,
  type GBrainNamespace,
  type GBrainPrivacy,
  type GBrainSensitivity,
} from './namespace-policy.ts';
import type { TypedMemoryMatchedRoute, TypedMemoryRouteCandidate, TypedMemoryRouteResult, TypedMemorySensitivity } from './types.ts';

export const TYPED_MEMORY_CONTEXT_PACK_SCHEMA = 'gbrain.typed_memory.context_pack.v1';
export const GBRAIN_CONTEXT_PACK_V2_SCHEMA = 'gbrain.context_pack.v2';

export const TYPED_MEMORY_READ_ONLY_GUARDRAILS = {
  read_only: true,
  trusted_pages_edited: false,
  external_messages_sent: false,
  global_config_changed: false,
  proposal_queue_written: false,
  raw_local_paths_redacted: true,
} as const;

export const GBRAIN_CONTEXT_PACK_V2_GUARDRAILS = {
  read_only: true,
  trusted_pages_edited: false,
  external_messages_sent: false,
  global_config_changed: false,
  review_only_sources: true,
} as const;

export type TypedMemoryContextPackStatus = 'hit' | 'miss' | 'unavailable' | 'error';
export type GBrainContextPackMode = 'daily' | 'meeting' | 'decision' | 'project';
export type GBrainContextPackV2Status = 'hit' | 'abstain';

export type TypedMemoryContextPack = {
  schema: typeof TYPED_MEMORY_CONTEXT_PACK_SCHEMA;
  status: TypedMemoryContextPackStatus;
  generated_at: string;
  request: {
    query: string;
    context_supplied: boolean;
    limit: number;
    include_high_typed_memory: boolean;
  };
  routes: TypedMemoryMatchedRoute[];
  items: Array<{
    id: string;
    memory_type: string;
    title: string;
    claim: string;
    score: number;
    reasons: string[];
    sensitivity: TypedMemorySensitivity;
    permission_scope?: string;
    surfacing_policy?: string;
    status?: string;
    entities?: string[];
    review_required: boolean;
    provenance: {
      source_kind?: string;
      source_label: string;
      quote?: string;
      timestamp?: string;
      parent_ids?: string[];
    };
  }>;
  warnings: string[];
  guardrails: typeof TYPED_MEMORY_READ_ONLY_GUARDRAILS;
};

export type GBrainContextPackV2 = {
  schema: typeof GBRAIN_CONTEXT_PACK_V2_SCHEMA;
  status: GBrainContextPackV2Status;
  generated_at: string;
  request: {
    mode: GBrainContextPackMode;
    topic: string;
    allowed_namespaces: GBrainNamespace[];
    max_privacy: GBrainPrivacy;
    max_sensitivity: GBrainSensitivity;
    limit: number;
  };
  items: Array<{
    id: string;
    claim: string;
    type: string;
    status: string;
    namespace: GBrainNamespace;
    privacy: GBrainPrivacy;
    sensitivity: GBrainSensitivity;
    confidence: number;
    observed_at: string;
    valid_from?: string;
    valid_to?: string;
    review_required: true;
    evidence_span_ids: string[];
  }>;
  evidence_index: Array<{
    span_id: string;
    claim_ids: string[];
    quote_hash: string;
    source_id?: string;
    slug?: string;
    section?: string;
    start_line?: number;
    end_line?: number;
    quote?: string;
  }>;
  warnings: string[];
  excluded: {
    policy: number;
    mode: number;
    query: number;
  };
  guardrails: typeof GBRAIN_CONTEXT_PACK_V2_GUARDRAILS;
};

const privacyRank = new Map<GBrainPrivacy, number>(GBRAIN_PRIVACY_LEVELS.map((v, i) => [v, i]));
const sensitivityRank = new Map<GBrainSensitivity, number>(GBRAIN_SENSITIVITY_LEVELS.map((v, i) => [v, i]));

function statusFrom(routeResult: TypedMemoryRouteResult): TypedMemoryContextPackStatus {
  const warnings = routeResult.warnings || [];
  if (warnings.some(w => /json|parse|line \d+|error/i.test(w))) return 'error';
  if (warnings.some(w => /no typed-memory|not found/i.test(w))) return 'unavailable';
  if (routeResult.pass && routeResult.results.length > 0) return 'hit';
  return 'miss';
}

function sanitizeWarnings(warnings: string[] = []): string[] {
  return warnings.map(w => String(w).replace(/\/Users\/[^\s:]+/g, '$HOME').replace(process.env.HOME || '\0', '$HOME'));
}

function safeSourceLabel(pathValue: unknown): string {
  const raw = String(pathValue || '').trim();
  if (!raw) return 'unknown';
  const normalized = raw.replace(/\\/g, '/');
  const label = basename(normalized) || normalized.split('/').filter(Boolean).pop() || 'source';
  return isAbsolute(raw) || normalized.includes('/') ? label : raw;
}

function capQuote(quote: unknown, maxChars: number): string | undefined {
  if (typeof quote !== 'string' || quote.length === 0) return undefined;
  const oneLine = quote.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function reviewRequired(item: TypedMemoryRouteCandidate): boolean {
  return item.sensitivity === 'high' || item.surfacing_policy === 'approval_required' || item.surfacing_policy === 'never';
}

function toSafeItem(item: TypedMemoryRouteCandidate, maxQuoteChars: number): TypedMemoryContextPack['items'][number] {
  return {
    id: item.id,
    memory_type: item.memory_type,
    title: item.title,
    claim: item.claim,
    score: item.score,
    reasons: item.reasons,
    sensitivity: item.sensitivity,
    permission_scope: item.permission_scope,
    surfacing_policy: item.surfacing_policy,
    status: item.status,
    entities: item.entities,
    review_required: reviewRequired(item),
    provenance: {
      source_kind: item.source?.kind,
      source_label: safeSourceLabel(item.source?.path),
      quote: capQuote(item.source?.quote, maxQuoteChars),
      timestamp: item.source?.timestamp,
      parent_ids: item.source?.parent_ids,
    },
  };
}

export function toTypedMemoryContextPack(routeResult: TypedMemoryRouteResult, opts: {
  query: string;
  context?: string;
  limit?: number;
  includeHigh?: boolean;
  maxQuoteChars?: number;
}): TypedMemoryContextPack {
  const maxQuoteChars = Math.max(0, opts.maxQuoteChars ?? 240);
  return {
    schema: TYPED_MEMORY_CONTEXT_PACK_SCHEMA,
    status: statusFrom(routeResult),
    generated_at: routeResult.generated_at,
    request: {
      query: opts.query,
      context_supplied: Boolean(opts.context),
      limit: opts.limit || 8,
      include_high_typed_memory: opts.includeHigh === true,
    },
    routes: routeResult.matched_routes || [],
    items: (routeResult.results || []).map(item => toSafeItem(item, maxQuoteChars)),
    warnings: sanitizeWarnings(routeResult.warnings || []),
    guardrails: TYPED_MEMORY_READ_ONLY_GUARDRAILS,
  };
}

function validMode(mode: unknown): mode is GBrainContextPackMode {
  return mode === 'daily' || mode === 'meeting' || mode === 'decision' || mode === 'project';
}

function tokenize(input: string): string[] {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(t => t.length >= 3);
}

function modeMatches(record: ClaimLedgerRecord, mode: GBrainContextPackMode): boolean {
  if (mode === 'decision') return record.type === 'decision';
  if (mode === 'project') return record.type === 'project_status' || record.type === 'open_loop' || record.type === 'decision';
  return true;
}

function topicMatches(record: ClaimLedgerRecord, topic: string): boolean {
  const tokens = tokenize(topic);
  if (tokens.length === 0) return true;
  const haystack = [
    record.claim,
    record.type,
    record.namespace,
    ...(record.evidence || []).flatMap(ev => [ev.quote, ev.slug, ev.source_id]),
  ].filter(Boolean).join(' ').toLowerCase();
  return tokens.some(token => haystack.includes(token));
}

function policyAllows(record: ClaimLedgerRecord, allowedNamespaces: Set<GBrainNamespace>, maxPrivacy: GBrainPrivacy, maxSensitivity: GBrainSensitivity): boolean {
  if (!allowedNamespaces.has(record.namespace)) return false;
  if ((privacyRank.get(record.privacy) ?? Infinity) > (privacyRank.get(maxPrivacy) ?? -1)) return false;
  if ((sensitivityRank.get(record.sensitivity) ?? Infinity) > (sensitivityRank.get(maxSensitivity) ?? -1)) return false;
  const validation = validateNamespacePolicy(record);
  if (validation.length > 0) return false;
  const classified = classifyNamespacePolicy(record);
  return classified.agent_read !== 'denied' && classified.context_visibility !== 'deny';
}

function isStale(record: ClaimLedgerRecord, now: Date): boolean {
  if (record.status === 'stale' || record.status === 'superseded' || record.status === 'contradicted') return true;
  return !!record.valid_to && Date.parse(record.valid_to) < now.getTime();
}

function warningsFor(record: ClaimLedgerRecord, now: Date): string[] {
  const warnings: string[] = [];
  if (record.privacy === 'private' || record.privacy === 'confidential') warnings.push(`${record.id}: ${record.privacy} privacy; use only within approved context`);
  if (record.sensitivity === 'high' || record.sensitivity === 'restricted') warnings.push(`${record.id}: ${record.sensitivity} sensitivity; review before broad use`);
  if (isStale(record, now)) warnings.push(`${record.id}: stale/superseded memory; verify before relying on it`);
  return warnings;
}

export function buildContextPackV2(opts: {
  mode: GBrainContextPackMode;
  topic?: string;
  records: ClaimLedgerRecord[];
  allowedNamespaces?: GBrainNamespace[];
  maxPrivacy?: GBrainPrivacy;
  maxSensitivity?: GBrainSensitivity;
  limit?: number;
  now?: Date;
  maxQuoteChars?: number;
}): GBrainContextPackV2 {
  if (!validMode(opts.mode)) throw new Error('mode must be one of: daily, meeting, decision, project');
  const now = opts.now || new Date();
  const topic = opts.topic || '';
  const requestedLimit = opts.limit ?? 8;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.floor(requestedLimit)) : 8;
  const allowedNamespaces = opts.allowedNamespaces && opts.allowedNamespaces.length > 0 ? opts.allowedNamespaces : [...GBRAIN_NAMESPACES];
  const maxPrivacy = opts.maxPrivacy || 'internal';
  const maxSensitivity = opts.maxSensitivity || 'medium';
  const maxQuoteChars = Math.max(0, opts.maxQuoteChars ?? 320);
  const allowedSet = new Set(allowedNamespaces);
  const warnings: string[] = [];
  const excluded = { policy: 0, mode: 0, query: 0 };

  const selected: ClaimLedgerRecord[] = [];
  for (const record of opts.records) {
    if (!modeMatches(record, opts.mode)) { excluded.mode++; continue; }
    if (!topicMatches(record, topic)) { excluded.query++; continue; }
    if (!policyAllows(record, allowedSet, maxPrivacy, maxSensitivity)) { excluded.policy++; continue; }
    selected.push(record);
  }

  selected.sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at) || b.confidence - a.confidence);
  const limited = selected.slice(0, limit);
  for (const record of limited) warnings.push(...warningsFor(record, now));
  if (limited.length === 0) {
    const reason = excluded.policy > 0 ? 'policy excluded all matching records' : excluded.mode > 0 || excluded.query > 0 ? 'no records matched mode/topic after filtering' : 'no review-only claim records available';
    warnings.push(`${reason}; abstaining`);
  }

  const evidenceMap = new Map<string, GBrainContextPackV2['evidence_index'][number]>();
  for (const record of limited) {
    for (const ev of record.evidence || []) {
      if (!ev.span_id?.startsWith('gbs1:')) continue;
      const existing = evidenceMap.get(ev.span_id);
      if (existing) {
        if (!existing.claim_ids.includes(record.id)) existing.claim_ids.push(record.id);
        continue;
      }
      evidenceMap.set(ev.span_id, {
        span_id: ev.span_id,
        claim_ids: [record.id],
        quote_hash: ev.quote_hash,
        source_id: ev.source_id,
        slug: ev.slug,
        section: ev.section,
        start_line: ev.start_line,
        end_line: ev.end_line,
        quote: capQuote(ev.quote, maxQuoteChars),
      });
    }
  }

  return {
    schema: GBRAIN_CONTEXT_PACK_V2_SCHEMA,
    status: limited.length > 0 ? 'hit' : 'abstain',
    generated_at: now.toISOString(),
    request: {
      mode: opts.mode,
      topic,
      allowed_namespaces: allowedNamespaces,
      max_privacy: maxPrivacy,
      max_sensitivity: maxSensitivity,
      limit,
    },
    items: limited.map(record => ({
      id: record.id,
      claim: record.claim,
      type: record.type,
      status: record.status,
      namespace: record.namespace,
      privacy: record.privacy,
      sensitivity: record.sensitivity,
      confidence: record.confidence,
      observed_at: record.observed_at,
      valid_from: record.valid_from,
      valid_to: record.valid_to,
      review_required: true,
      evidence_span_ids: (record.evidence || []).map(ev => ev.span_id).filter(Boolean),
    })),
    evidence_index: Array.from(evidenceMap.values()),
    warnings: sanitizeWarnings(warnings),
    excluded,
    guardrails: GBRAIN_CONTEXT_PACK_V2_GUARDRAILS,
  };
}

export function loadContextPackV2(opts: {
  mode: GBrainContextPackMode;
  topic?: string;
  ledgerPath?: string;
  allowedNamespaces?: GBrainNamespace[];
  maxPrivacy?: GBrainPrivacy;
  maxSensitivity?: GBrainSensitivity;
  limit?: number;
  now?: Date;
  maxQuoteChars?: number;
}): GBrainContextPackV2 {
  const listed = listClaimLedgerRecords({ ledgerPath: opts.ledgerPath });
  const pack = buildContextPackV2({ ...opts, records: listed.records || [] });
  if (!listed.ok && listed.errors?.length) pack.warnings.unshift(...sanitizeWarnings(listed.errors));
  return pack;
}
