import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { configDir } from '../config.ts';
import {
  parseSourceSpanRef,
  sourceItemIdForPage,
  type SourceSpanRefKind,
} from '../evidence/source-bridge.ts';
import { parseSpanId } from '../evidence/source-window.ts';
import {
  conservativeNamespacePolicyDefaults,
  validateNamespacePolicy,
  type GBrainNamespace,
  type GBrainPrivacy,
  type GBrainSensitivity,
} from '../memory/namespace-policy.ts';

export type ClaimType = 'identity' | 'preference' | 'project_status' | 'decision' | 'open_loop' | 'relationship' | 'world' | 'world_claim' | 'procedure' | 'other';
export type ClaimStatus = 'proposed' | 'verified' | 'trusted' | 'stale' | 'superseded' | 'contradicted' | 'rejected';
export type ClaimEdgeType = 'stales' | 'supersedes' | 'contradicts' | 'supports' | 'refines';
export type ClaimEvidenceRole = 'supports' | 'contradicts' | 'context';

export interface ClaimEvidenceRef {
  span_id: string;
  ref_kind: SourceSpanRefKind;
  source_item_id: string;
  authority: 'source_span';
  role: ClaimEvidenceRole;
  quote: string;
  quote_hash: string;
  source_id?: string;
  slug?: string;
  section?: string;
  start_line?: number;
  end_line?: number;
  start_char?: number;
  end_char?: number;
}

export interface ClaimEdge {
  type: ClaimEdgeType;
  claim_id: string;
  note?: string;
}

export interface ClaimLedgerRecord {
  id: string;
  schema_version: 1;
  created_at: string;
  updated_at: string;
  claim: string;
  type: ClaimType;
  status: ClaimStatus;
  namespace: GBrainNamespace;
  privacy: GBrainPrivacy;
  sensitivity: GBrainSensitivity;
  confidence: number;
  observed_at: string;
  valid_from?: string;
  valid_to?: string;
  evidence: ClaimEvidenceRef[];
  edges?: ClaimEdge[];
  review_required: true;
  guardrails: {
    trusted_pages_edited: false;
    external_messages_sent: false;
    global_config_changed: false;
    record_is_review_only: true;
  };
}

export interface ClaimRow {
  id: string;
  claim: string;
  type: ClaimType;
  status: ClaimStatus;
  namespace: GBrainNamespace;
  privacy: GBrainPrivacy;
  sensitivity: GBrainSensitivity;
  confidence: number;
  observed_at: string;
  valid_from?: string;
  valid_to?: string;
  created_at: string;
  updated_at: string;
}

export interface ClaimEvidenceRow {
  claim_id: string;
  source_span_ref: string;
  ref_kind: SourceSpanRefKind;
  source_item_id: string;
  role: ClaimEvidenceRole;
  quote_hash: string;
}

export interface ClaimEdgeRow {
  from_claim_id: string;
  to_claim_id: string;
  type: ClaimEdgeType;
  note?: string;
}

export interface ClaimLedgerTables {
  claims: ClaimRow[];
  claim_evidence: ClaimEvidenceRow[];
  claim_edges: ClaimEdgeRow[];
}

export interface ClaimLedgerResult {
  ok: boolean;
  action: 'validate' | 'propose' | 'verify' | 'list' | 'show';
  errors?: string[];
  record?: ClaimLedgerRecord;
  records?: ClaimLedgerRecord[];
  tables?: ClaimLedgerTables;
  count?: number;
  ledgerPath?: string;
  dryRun?: boolean;
  queued?: boolean;
  duplicate?: boolean;
}

const LEDGER_FILE = 'claim-ledger.jsonl';
const CLAIM_TYPES = new Set<ClaimType>(['identity', 'preference', 'project_status', 'decision', 'open_loop', 'relationship', 'world', 'world_claim', 'procedure', 'other']);
const CLAIM_STATUSES = new Set<ClaimStatus>(['proposed', 'verified', 'trusted', 'stale', 'superseded', 'contradicted', 'rejected']);
const CLAIM_EDGE_TYPES = new Set<ClaimEdgeType>(['stales', 'supersedes', 'contradicts', 'supports', 'refines']);
const CLAIM_EVIDENCE_ROLES = new Set<ClaimEvidenceRole>(['supports', 'contradicts', 'context']);

export function claimLedgerPath(): string {
  return join(configDir(), LEDGER_FILE);
}

export function hashQuote(quote: string): string {
  return createHash('sha256').update(quote).digest('hex');
}

export function claimIdFor(claim: string, evidence: ClaimEvidenceRef[], now = new Date()): string {
  const basis = JSON.stringify({ claim, spans: evidence.map(e => e.span_id).sort() });
  const hash = createHash('sha256').update(basis).digest('hex').slice(0, 12);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `claim_${stamp}_${hash}`;
}

function ensureParent(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validIsoDate(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function evidenceRefFromSpan(spanId: string, quote: string, quoteHash = hashQuote(quote), role: ClaimEvidenceRole = 'supports'): ClaimEvidenceRef {
  const parsedRef = parseSourceSpanRef(spanId);
  if (parsedRef.ref_kind === 'srcspan1') {
    return {
      span_id: spanId,
      ref_kind: 'srcspan1',
      source_item_id: parsedRef.source_item_id!,
      authority: 'source_span',
      role,
      quote,
      quote_hash: quoteHash,
      start_char: parsedRef.start_char,
      end_char: parsedRef.end_char,
    };
  }
  const parsed = parseSpanId(spanId);
  return {
    span_id: spanId,
    ref_kind: 'gbs1',
    source_item_id: sourceItemIdForPage(parsed.sourceId, parsed.slug),
    authority: 'source_span',
    role,
    quote,
    quote_hash: quoteHash,
    source_id: parsed.sourceId,
    slug: parsed.slug,
    section: parsed.section,
    start_line: parsed.startLine,
    end_line: parsed.endLine,
  };
}

export function buildClaimLedgerRecord(input: {
  claim: string;
  type?: ClaimType;
  status?: ClaimStatus;
  namespace?: GBrainNamespace;
  privacy?: GBrainPrivacy;
  sensitivity?: GBrainSensitivity;
  confidence?: number;
  observedAt?: string;
  validFrom?: string;
  validTo?: string;
  evidence: ClaimEvidenceRef[];
  edges?: ClaimEdge[];
  now?: Date;
}): ClaimLedgerRecord {
  const now = input.now || new Date();
  const policy = conservativeNamespacePolicyDefaults({ namespace: input.namespace, privacy: input.privacy, sensitivity: input.sensitivity });
  return {
    id: claimIdFor(input.claim, input.evidence, now),
    schema_version: 1,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    claim: input.claim,
    type: input.type || 'other',
    status: input.status || 'proposed',
    namespace: policy.namespace as GBrainNamespace,
    privacy: policy.privacy as GBrainPrivacy,
    sensitivity: policy.sensitivity as GBrainSensitivity,
    confidence: input.confidence ?? 0.5,
    observed_at: input.observedAt || now.toISOString(),
    valid_from: input.validFrom || undefined,
    valid_to: input.validTo || undefined,
    evidence: input.evidence,
    edges: input.edges && input.edges.length > 0 ? input.edges : undefined,
    review_required: true,
    guardrails: {
      trusted_pages_edited: false,
      external_messages_sent: false,
      global_config_changed: false,
      record_is_review_only: true,
    },
  };
}

export function toClaimLedgerTables(records: ClaimLedgerRecord[]): ClaimLedgerTables {
  return {
    claims: records.map(r => ({
      id: r.id,
      claim: r.claim,
      type: r.type,
      status: r.status,
      namespace: r.namespace,
      privacy: r.privacy,
      sensitivity: r.sensitivity,
      confidence: r.confidence,
      observed_at: r.observed_at,
      valid_from: r.valid_from,
      valid_to: r.valid_to,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
    claim_evidence: records.flatMap(r => r.evidence.map(ev => ({
      claim_id: r.id,
      source_span_ref: ev.span_id,
      ref_kind: ev.ref_kind,
      source_item_id: ev.source_item_id,
      role: ev.role,
      quote_hash: ev.quote_hash,
    }))),
    claim_edges: records.flatMap(r => (r.edges || []).map(edge => ({
      from_claim_id: r.id,
      to_claim_id: edge.claim_id,
      type: edge.type,
      note: edge.note,
    }))),
  };
}

export function validateClaimLedgerRecord(record: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(record)) return ['record must be a JSON object'];

  if (typeof record.id !== 'string' || !/^claim_[0-9TZ]+_[a-f0-9]{12}$/.test(record.id)) errors.push('id must be a deterministic claim_* id');
  if (record.schema_version !== 1) errors.push('schema_version must be 1');
  if (typeof record.claim !== 'string' || record.claim.trim().length < 3) errors.push('claim must be a non-empty string');
  if (!CLAIM_TYPES.has(record.type)) errors.push(`type must be one of: ${Array.from(CLAIM_TYPES).join(', ')}`);
  if (!CLAIM_STATUSES.has(record.status)) errors.push(`status must be one of: ${Array.from(CLAIM_STATUSES).join(', ')}`);
  errors.push(...validateNamespacePolicy({ namespace: record.namespace, privacy: record.privacy, sensitivity: record.sensitivity }));
  if (typeof record.confidence !== 'number' || record.confidence < 0 || record.confidence > 1) errors.push('confidence must be a number between 0 and 1');
  if (!validIsoDate(record.created_at)) errors.push('created_at must be an ISO-like date string');
  if (!validIsoDate(record.updated_at)) errors.push('updated_at must be an ISO-like date string');
  if (!validIsoDate(record.observed_at)) errors.push('observed_at must be an ISO-like date string');
  if (record.valid_from !== undefined && !validIsoDate(record.valid_from)) errors.push('valid_from must be an ISO-like date string when present');
  if (record.valid_to !== undefined && !validIsoDate(record.valid_to)) errors.push('valid_to must be an ISO-like date string when present');
  if (record.valid_from && record.valid_to && Date.parse(record.valid_to) < Date.parse(record.valid_from)) errors.push('valid_to must not be before valid_from');

  let supportingSourceSpanCount = 0;
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    errors.push('evidence must include at least one source span');
  } else {
    record.evidence.forEach((ev: unknown, idx: number) => {
      const prefix = `evidence[${idx}]`;
      if (!isObject(ev)) {
        errors.push(`${prefix} must be an object`);
        return;
      }
      if (ev.authority !== 'source_span') errors.push(`${prefix}.authority must be source_span`);
      if (!CLAIM_EVIDENCE_ROLES.has(ev.role)) errors.push(`${prefix}.role must be one of: ${Array.from(CLAIM_EVIDENCE_ROLES).join(', ')}`);
      if (ev.role === 'supports' && ev.authority === 'source_span') supportingSourceSpanCount++;
      if (typeof ev.span_id !== 'string') errors.push(`${prefix}.span_id is required`);
      else {
        try {
          const parsedRef = parseSourceSpanRef(ev.span_id);
          if (ev.ref_kind !== parsedRef.ref_kind) errors.push(`${prefix}.ref_kind must match span_id`);
          if (parsedRef.ref_kind === 'gbs1') {
            const parsed = parseSpanId(ev.span_id);
            if (ev.source_item_id !== sourceItemIdForPage(parsed.sourceId, parsed.slug)) errors.push(`${prefix}.source_item_id must match span_id`);
            if (ev.source_id !== undefined && ev.source_id !== parsed.sourceId) errors.push(`${prefix}.source_id must match span_id`);
            if (ev.slug !== undefined && ev.slug !== parsed.slug) errors.push(`${prefix}.slug must match span_id`);
            if (ev.section !== undefined && ev.section !== parsed.section) errors.push(`${prefix}.section must match span_id`);
            if (ev.start_line !== undefined && ev.start_line !== parsed.startLine) errors.push(`${prefix}.start_line must match span_id`);
            if (ev.end_line !== undefined && ev.end_line !== parsed.endLine) errors.push(`${prefix}.end_line must match span_id`);
          } else {
            if (ev.source_item_id !== parsedRef.source_item_id) errors.push(`${prefix}.source_item_id must match span_id`);
            if (ev.start_char !== parsedRef.start_char) errors.push(`${prefix}.start_char must match span_id`);
            if (ev.end_char !== parsedRef.end_char) errors.push(`${prefix}.end_char must match span_id`);
          }
        } catch (err) {
          errors.push(`${prefix}.span_id malformed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (typeof ev.quote !== 'string' || ev.quote.trim().length === 0) errors.push(`${prefix}.quote is required`);
      if (typeof ev.quote_hash !== 'string' || !/^[a-f0-9]{64}$/.test(ev.quote_hash)) errors.push(`${prefix}.quote_hash must be a sha256 hex digest`);
      if (typeof ev.quote === 'string' && typeof ev.quote_hash === 'string' && ev.quote_hash !== hashQuote(ev.quote)) errors.push(`${prefix}.quote_hash must match quote`);
    });
  }
  if (record.status === 'verified' && supportingSourceSpanCount === 0) errors.push('verified claims require at least one supporting source_span evidence');

  if (record.edges !== undefined) {
    if (!Array.isArray(record.edges)) errors.push('edges must be an array when present');
    else record.edges.forEach((edge: unknown, idx: number) => {
      const prefix = `edges[${idx}]`;
      if (!isObject(edge)) {
        errors.push(`${prefix} must be an object`);
        return;
      }
      if (!CLAIM_EDGE_TYPES.has(edge.type)) errors.push(`${prefix}.type must be one of: ${Array.from(CLAIM_EDGE_TYPES).join(', ')}`);
      if (typeof edge.claim_id !== 'string' || !edge.claim_id.startsWith('claim_')) errors.push(`${prefix}.claim_id must reference a claim_* id`);
      if (edge.note !== undefined && typeof edge.note !== 'string') errors.push(`${prefix}.note must be a string when present`);
    });
  }

  const guardrails = isObject(record.guardrails) ? record.guardrails : null;
  if (record.review_required !== true) errors.push('review_required must be true');
  if (!guardrails) errors.push('guardrails must be present');
  else {
    if (guardrails.trusted_pages_edited !== false) errors.push('guardrails.trusted_pages_edited must be false');
    if (guardrails.external_messages_sent !== false) errors.push('guardrails.external_messages_sent must be false');
    if (guardrails.global_config_changed !== false) errors.push('guardrails.global_config_changed must be false');
    if (guardrails.record_is_review_only !== true) errors.push('guardrails.record_is_review_only must be true');
  }

  if (record.status === 'trusted') errors.push('JSONL claim ledger cannot mark claims trusted; trusted status requires reviewed DB/page integration in a later PR');
  return errors;
}

function readLedger(path: string): { records: ClaimLedgerRecord[]; errors: string[] } {
  if (!existsSync(path)) return { records: [], errors: [] };
  const records: ClaimLedgerRecord[] = [];
  const errors: string[] = [];
  readFileSync(path, 'utf-8').split('\n').forEach((line, idx) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      const validation = validateClaimLedgerRecord(parsed);
      if (validation.length) errors.push(`line ${idx + 1}: ${validation.join('; ')}`);
      else records.push(parsed);
    } catch (err) {
      errors.push(`line ${idx + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return { records, errors };
}

export function listClaimLedgerRecords(opts: { ledgerPath?: string; tables?: boolean } = {}): ClaimLedgerResult {
  const ledgerPath = opts.ledgerPath || claimLedgerPath();
  const { records, errors } = readLedger(ledgerPath);
  return { ok: errors.length === 0, action: 'list', records, tables: opts.tables ? toClaimLedgerTables(records) : undefined, count: records.length, errors: errors.length ? errors : undefined, ledgerPath };
}

export function showClaimLedgerRecord(id: string, opts: { ledgerPath?: string } = {}): ClaimLedgerResult {
  const listed = listClaimLedgerRecords(opts);
  const record = (listed.records || []).find(r => r.id === id);
  return { ...listed, action: 'show', record, records: undefined, count: record ? 1 : 0, ok: listed.ok && !!record, errors: record ? listed.errors : [...(listed.errors || []), `claim not found: ${id}`] };
}

export function verifyClaimLedgerRecord(id: string, opts: { ledgerPath?: string } = {}): ClaimLedgerResult {
  const result = showClaimLedgerRecord(id, opts);
  if (!result.record) return { ...result, action: 'verify' };
  const record = { ...result.record, status: 'verified' as ClaimStatus, updated_at: new Date().toISOString() };
  const errors = validateClaimLedgerRecord(record);
  return { ok: errors.length === 0, action: 'verify', record, errors: errors.length ? errors : undefined, ledgerPath: result.ledgerPath, dryRun: true, queued: false };
}

export function enqueueClaimLedgerRecord(record: ClaimLedgerRecord, opts: { dryRun?: boolean; ledgerPath?: string } = {}): ClaimLedgerResult {
  const ledgerPath = opts.ledgerPath || claimLedgerPath();
  const errors = validateClaimLedgerRecord(record);
  if (errors.length) return { ok: false, action: 'propose', record, errors, ledgerPath, dryRun: !!opts.dryRun };
  const existing = listClaimLedgerRecords({ ledgerPath });
  const duplicate = (existing.records || []).some(r => r.id === record.id || (r.claim === record.claim && JSON.stringify(r.evidence.map(e => e.span_id).sort()) === JSON.stringify(record.evidence.map(e => e.span_id).sort())));
  if (duplicate) return { ok: true, action: 'propose', record, ledgerPath, dryRun: !!opts.dryRun, queued: false, duplicate: true };
  if (!opts.dryRun) {
    ensureParent(ledgerPath);
    appendFileSync(ledgerPath, JSON.stringify(record) + '\n', 'utf-8');
  }
  return { ok: true, action: 'propose', record, ledgerPath, dryRun: !!opts.dryRun, queued: !opts.dryRun, duplicate: false };
}
