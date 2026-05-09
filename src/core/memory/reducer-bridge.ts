import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { listClaimLedgerRecords, type ClaimLedgerRecord } from '../claims/claim-ledger.ts';

export const REDUCER_BRIDGE_SCHEMA = 'gbrain.memory.reducer_bridge.v1';

const FORBIDDEN_ACTIONS = [
  'trusted_brain_direct_edit',
  'external_message_send',
  'auto_accept_high_sensitivity_memory',
];

export interface ReducerBridgeInput {
  claimLedgerPath?: string;
  memoryQueuePath?: string;
  limit?: number;
  now?: Date;
}

export interface ReducerBridgeResult {
  ok: boolean;
  action: 'reduce';
  schema: typeof REDUCER_BRIDGE_SCHEMA;
  dryRun: true;
  packet: any;
  stats: {
    claim_records_read: number;
    memory_proposals_read: number;
    candidate_count: number;
    duplicate_candidates_dropped: number;
  };
  errors: string[];
  warnings: string[];
  guardrails: {
    trusted_pages_edited: false;
    external_messages_sent: false;
    global_config_changed: false;
    database_written: false;
    packet_is_review_only: true;
  };
}

function sha(value: string, length = 16): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sourcePathForClaim(record: ClaimLedgerRecord): string {
  const ev = record.evidence[0];
  return ev.slug || ev.source_id || ev.span_id;
}

function claimRecordToCandidate(record: ClaimLedgerRecord): any {
  const ev = record.evidence[0];
  return {
    id: `bridge_claim_${sha(`${record.id}:${ev.span_id}`)}`,
    proposed_action: 'review_for_native_memory_proposal',
    claim: record.claim,
    type: record.type,
    status: 'proposed',
    namespace: record.namespace,
    privacy: record.privacy,
    sensitivity: record.sensitivity,
    confidence: record.confidence,
    observed_at: record.observed_at,
    source: {
      kind: 'gbs1_span',
      path: sourcePathForClaim(record),
      span_id: ev.span_id,
      quote: ev.quote,
      quote_hash: ev.quote_hash,
      start_line: ev.start_line,
      end_line: ev.end_line,
    },
    reducer_bridge: {
      input_kind: 'claim_ledger',
      input_id: record.id,
      input_schema_version: record.schema_version,
    },
    forbidden_actions: FORBIDDEN_ACTIONS,
  };
}

function readMemoryProposalRecords(memoryQueuePath?: string): { records: any[]; errors: string[]; warnings: string[] } {
  if (!memoryQueuePath) return { records: [], errors: [], warnings: [] };
  if (!existsSync(memoryQueuePath)) return { records: [], errors: [], warnings: [`memory proposal queue not found: ${memoryQueuePath}`] };
  const records: any[] = [];
  const errors: string[] = [];
  readFileSync(memoryQueuePath, 'utf-8').split('\n').forEach((line, idx) => {
    if (!line.trim()) return;
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      errors.push(`memory proposal line ${idx + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return { records, errors, warnings: [] };
}

function memoryProposalCandidateToCandidate(record: any, candidate: any, idx: number): any {
  const source = candidate?.source && typeof candidate.source === 'object' ? candidate.source : {};
  const sourcePath = typeof source.path === 'string' && source.path.length > 0 ? source.path : `memory-proposal:${record?.id || 'unknown'}`;
  return {
    ...candidate,
    id: `bridge_mem_${sha(`${record?.id || 'record'}:${candidate?.id || idx}:${normalizeText(candidate?.claim)}`)}`,
    proposed_action: candidate?.proposed_action || 'review_for_native_memory_proposal',
    claim: normalizeText(candidate?.claim) || normalizeText(record?.outcome) || 'Review memory proposal candidate',
    status: 'proposed',
    namespace: candidate?.namespace || 'personal',
    privacy: candidate?.privacy || 'private',
    sensitivity: candidate?.sensitivity || 'high',
    source: {
      ...source,
      path: sourcePath,
      quote: typeof source.quote === 'string' && source.quote.length > 0 ? source.quote : normalizeText(candidate?.claim || record?.outcome || sourcePath),
    },
    reducer_bridge: {
      input_kind: 'memory_proposal_queue',
      input_id: record?.id || null,
      input_candidate_id: candidate?.id || null,
    },
    forbidden_actions: Array.from(new Set([...(Array.isArray(candidate?.forbidden_actions) ? candidate.forbidden_actions : []), ...FORBIDDEN_ACTIONS])),
  };
}

function dedupeCandidates(candidates: any[]): { candidates: any[]; dropped: number } {
  const seen = new Set<string>();
  const out: any[] = [];
  let dropped = 0;
  for (const candidate of candidates) {
    const key = sha(JSON.stringify({
      claim: normalizeText(candidate?.claim).toLowerCase(),
      source: candidate?.source?.span_id || candidate?.source?.quote_hash || candidate?.source?.path || '',
    }), 32);
    if (seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    out.push(candidate);
  }
  return { candidates: out, dropped };
}

export function reduceReviewJsonlToProposalPacket(input: ReducerBridgeInput = {}): ReducerBridgeResult {
  const now = input.now || new Date();
  const errors: string[] = [];
  const warnings: string[] = [];
  const claimRecords = input.claimLedgerPath ? listClaimLedgerRecords({ ledgerPath: input.claimLedgerPath }) : { records: [], errors: [] as string[] };
  if (claimRecords.errors?.length) errors.push(...claimRecords.errors.map(e => `claim ledger: ${e}`));

  const memoryRecords = readMemoryProposalRecords(input.memoryQueuePath);
  errors.push(...memoryRecords.errors);
  warnings.push(...memoryRecords.warnings);

  const rawCandidates: any[] = [];
  for (const record of claimRecords.records || []) rawCandidates.push(claimRecordToCandidate(record));
  for (const record of memoryRecords.records) {
    const packetCandidates = Array.isArray(record?.packet?.candidates) ? record.packet.candidates : [];
    packetCandidates.forEach((candidate: any, idx: number) => rawCandidates.push(memoryProposalCandidateToCandidate(record, candidate, idx)));
  }

  const deduped = dedupeCandidates(rawCandidates);
  const limit = Math.max(0, input.limit ?? deduped.candidates.length);
  const candidates = deduped.candidates.slice(0, limit);
  if (rawCandidates.length > candidates.length + deduped.dropped) warnings.push(`candidate limit applied: ${candidates.length}/${deduped.candidates.length}`);

  const contextHash = sha(JSON.stringify({
    claimLedgerPath: input.claimLedgerPath || null,
    memoryQueuePath: input.memoryQueuePath || null,
    claimIds: (claimRecords.records || []).map(r => r.id).sort(),
    memoryIds: memoryRecords.records.map(r => r?.id).filter(Boolean).sort(),
    candidateIds: candidates.map(c => c.id).sort(),
  }), 24);

  const packet = {
    packet_type: 'governed_surfacing_proposal_packet',
    schema_version: 1,
    reducer_bridge_schema: REDUCER_BRIDGE_SCHEMA,
    generated_at: now.toISOString(),
    outcome: 'native_reducer_bridge_review_packet',
    review_required: true,
    context: {
      kind: 'native_reducer_bridge',
      hash: contextHash,
      claim_ledger_path: input.claimLedgerPath || null,
      memory_queue_path: input.memoryQueuePath || null,
    },
    candidates,
    validation: {
      pass: errors.length === 0 && candidates.length > 0,
      errors,
      warnings,
    },
    guardrails: {
      trusted_pages_edited: false,
      external_messages_sent: false,
      global_config_changed: false,
      database_written: false,
      packet_is_review_only: true,
    },
  };

  if (candidates.length === 0) errors.push('no reducible review records found');
  packet.validation.pass = errors.length === 0;
  packet.validation.errors = errors;

  return {
    ok: errors.length === 0,
    action: 'reduce',
    schema: REDUCER_BRIDGE_SCHEMA,
    dryRun: true,
    packet,
    stats: {
      claim_records_read: (claimRecords.records || []).length,
      memory_proposals_read: memoryRecords.records.length,
      candidate_count: candidates.length,
      duplicate_candidates_dropped: deduped.dropped,
    },
    errors,
    warnings,
    guardrails: {
      trusted_pages_edited: false,
      external_messages_sent: false,
      global_config_changed: false,
      database_written: false,
      packet_is_review_only: true,
    },
  };
}
