import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { configDir } from '../config.ts';
import { parseSpanId } from '../evidence/source-window.ts';
import { validateNamespacePolicy } from '../memory/namespace-policy.ts';
import { verifyClaimSupport } from './claim-support-verifier.ts';

export type MemoryAtomType = 'episode' | 'semantic_fact' | 'preference_signal' | 'relationship_memory' | 'opportunity_memory' | 'procedure_memory' | 'identity_constraint' | 'world_model_claim';
export type MemoryAtomSupportLevel = 'direct_quote' | 'strong_inference' | 'weak_inference' | 'unsupported';
export type MemoryAtomSensitivity = 'P0' | 'P1' | 'P2' | 'P3';

export interface MemoryAtomTemporal {
  event_time?: string;
  valid_from?: string;
  valid_to?: string;
  uncertainty?: string;
}

export interface MemoryAtomProposal {
  proposal_id: string;
  source_item_id: string;
  evidence_span_ids: string[];
  atom_type: MemoryAtomType;
  subject_entities: string[];
  claim: string;
  temporal: MemoryAtomTemporal;
  confidence: number;
  support_level: MemoryAtomSupportLevel;
  sensitivity: MemoryAtomSensitivity;
  suggested_namespace: string;
  contradiction_candidates?: string[];
}

export interface MemoryAtomProposalRecord extends MemoryAtomProposal {
  created_at: string;
  review_only: true;
}

const QUEUE_FILE = 'memory-atom-proposals.jsonl';

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validIso(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function defaultMemoryAtomProposalQueuePath(): string {
  return join(configDir(), QUEUE_FILE);
}

export function memoryAtomProposalId(input: Pick<MemoryAtomProposal, 'source_item_id' | 'evidence_span_ids' | 'atom_type' | 'claim' | 'suggested_namespace'>): string {
  const basis = JSON.stringify({ source_item_id: input.source_item_id, evidence_span_ids: [...input.evidence_span_ids].sort(), atom_type: input.atom_type, claim: input.claim, suggested_namespace: input.suggested_namespace });
  return `map_${createHash('sha256').update(basis).digest('hex').slice(0, 12)}`;
}

export function validateMemoryAtomProposal(proposal: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(proposal)) return ['proposal must be an object'];
  if (typeof proposal.proposal_id !== 'string' || !proposal.proposal_id.startsWith('map_')) errors.push('proposal_id is required');
  if (typeof proposal.source_item_id !== 'string' || !proposal.source_item_id) errors.push('source_item_id is required');
  if (!Array.isArray(proposal.evidence_span_ids) || proposal.evidence_span_ids.length === 0) errors.push('evidence_span_ids must include at least one gbs1 span');
  else {
    for (const [idx, spanId] of proposal.evidence_span_ids.entries()) {
      if (typeof spanId !== 'string' || !spanId.startsWith('gbs1:')) errors.push(`evidence_span_ids[${idx}] must be a gbs1 span`);
      else {
        try { parseSpanId(spanId); } catch (err) { errors.push(`evidence_span_ids[${idx}] malformed: ${err instanceof Error ? err.message : String(err)}`); }
      }
    }
  }
  if (!['episode', 'semantic_fact', 'preference_signal', 'relationship_memory', 'opportunity_memory', 'procedure_memory', 'identity_constraint', 'world_model_claim'].includes(String(proposal.atom_type))) errors.push('atom_type is invalid');
  if (!Array.isArray(proposal.subject_entities)) errors.push('subject_entities must be an array');
  else if (proposal.subject_entities.some(v => typeof v !== 'string')) errors.push('subject_entities must be string[]');
  if (typeof proposal.claim !== 'string' || proposal.claim.trim().length < 3) errors.push('claim must be a non-empty string');
  if (!isObject(proposal.temporal)) errors.push('temporal must be an object');
  else {
    if (proposal.temporal.event_time !== undefined && !validIso(proposal.temporal.event_time)) errors.push('temporal.event_time must be ISO when present');
    if (proposal.temporal.valid_from !== undefined && !validIso(proposal.temporal.valid_from)) errors.push('temporal.valid_from must be ISO when present');
    if (proposal.temporal.valid_to !== undefined && !validIso(proposal.temporal.valid_to)) errors.push('temporal.valid_to must be ISO when present');
    if (typeof proposal.temporal.valid_from === 'string' && typeof proposal.temporal.valid_to === 'string' && Date.parse(proposal.temporal.valid_to) < Date.parse(proposal.temporal.valid_from)) errors.push('temporal.valid_to must not be before valid_from');
    if (proposal.temporal.uncertainty !== undefined && typeof proposal.temporal.uncertainty !== 'string') errors.push('temporal.uncertainty must be a string when present');
  }
  if (typeof proposal.confidence !== 'number' || proposal.confidence < 0 || proposal.confidence > 1) errors.push('confidence must be a number between 0 and 1');
  if (!['direct_quote', 'strong_inference', 'weak_inference', 'unsupported'].includes(String(proposal.support_level))) errors.push('support_level is invalid');
  if (proposal.support_level === 'unsupported') errors.push('unsupported support_level cannot be enqueued or promoted');
  if (!['P0', 'P1', 'P2', 'P3'].includes(String(proposal.sensitivity))) errors.push('sensitivity must be one of P0, P1, P2, P3');
  if (typeof proposal.suggested_namespace !== 'string' || !proposal.suggested_namespace) errors.push('suggested_namespace is required');
  else {
    const sensitivity = proposal.sensitivity === 'P0' ? 'low' : proposal.sensitivity === 'P1' ? 'medium' : 'high';
    errors.push(...validateNamespacePolicy({ namespace: proposal.suggested_namespace, privacy: 'private', sensitivity }));
  }
  if (proposal.contradiction_candidates !== undefined) {
    if (!Array.isArray(proposal.contradiction_candidates)) errors.push('contradiction_candidates must be an array when present');
    else if (proposal.contradiction_candidates.some(v => typeof v !== 'string')) errors.push('contradiction_candidates must be string[]');
  }
  return errors;
}

export function buildMemoryAtomProposal(input: Omit<MemoryAtomProposal, 'proposal_id'> & { now?: Date }): MemoryAtomProposalRecord {
  const now = input.now || new Date();
  const proposal: MemoryAtomProposal = { ...input, proposal_id: memoryAtomProposalId(input) };
  const errors = validateMemoryAtomProposal(proposal);
  if (errors.length) throw new Error(errors.join('; '));
  return { ...proposal, created_at: now.toISOString(), review_only: true };
}

export function proposeMemoryAtomFromSpan(input: {
  span_id: string;
  claim: string;
  atom_type: MemoryAtomType;
  subject_entities?: string[];
  suggested_namespace: string;
  sensitivity: MemoryAtomSensitivity;
  now?: Date;
  quote?: string;
}): { ok: boolean; proposal?: MemoryAtomProposalRecord; errors?: string[] } {
  try {
    const parsed = parseSpanId(input.span_id);
    if (!input.span_id.startsWith('gbs1:')) return { ok: false, errors: ['from-span must be a gbs1 span'] };
    if (!input.quote || !input.quote.trim()) return { ok: false, errors: ['quote is required for direct_quote proposals'] };
    const support = verifyClaimSupport({ claim: input.claim, evidence_spans: [{ span_id: input.span_id, quote: input.quote, source_item_id: `${parsed.sourceId}:${parsed.slug}` }] });
    if (!support.ok || support.support_level !== 'direct_quote') return { ok: false, errors: [`claim support must verify direct_quote: ${support.reasons.join('; ') || 'unsupported'}`] };
    const proposal = buildMemoryAtomProposal({
      source_item_id: `${parsed.sourceId}:${parsed.slug}`,
      evidence_span_ids: [input.span_id],
      atom_type: input.atom_type,
      subject_entities: input.subject_entities || [],
      claim: input.claim,
      temporal: {},
      confidence: 1,
      support_level: 'direct_quote',
      sensitivity: input.sensitivity,
      suggested_namespace: input.suggested_namespace,
      now: input.now,
    });
    return { ok: true, proposal };
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
}

function readQueue(path: string): { proposals: MemoryAtomProposalRecord[]; errors: string[] } {
  if (!existsSync(path)) return { proposals: [], errors: [] };
  const proposals: MemoryAtomProposalRecord[] = [];
  const errors: string[] = [];
  for (const [idx, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const validation = validateMemoryAtomProposal(parsed);
      if (validation.length) errors.push(`line ${idx + 1}: ${validation.join('; ')}`);
      else proposals.push(parsed);
    } catch (err) { errors.push(`line ${idx + 1}: ${err instanceof Error ? err.message : String(err)}`); }
  }
  return { proposals, errors };
}

export function listMemoryAtomProposals(opts: { queuePath?: string } = {}): { ok: boolean; proposals: MemoryAtomProposalRecord[]; path: string; errors?: string[] } {
  const path = opts.queuePath || defaultMemoryAtomProposalQueuePath();
  const { proposals, errors } = readQueue(path);
  return { ok: errors.length === 0, proposals, path, errors: errors.length ? errors : undefined };
}

export function enqueueMemoryAtomProposal(proposal: MemoryAtomProposalRecord, opts: { queuePath?: string; dryRun?: boolean } = {}): { ok: boolean; proposal: MemoryAtomProposalRecord; duplicate: boolean; path: string; errors?: string[]; queued: boolean; dryRun: boolean } {
  const path = opts.queuePath || defaultMemoryAtomProposalQueuePath();
  const { proposals, errors } = readQueue(path);
  const duplicate = proposals.some(p => p.proposal_id === proposal.proposal_id || memoryAtomProposalId(p) === proposal.proposal_id);
  if (duplicate) return { ok: true, proposal, duplicate: true, path, queued: false, dryRun: !!opts.dryRun, errors: errors.length ? errors : undefined };
  if (!opts.dryRun) {
    ensureParent(path);
    appendFileSync(path, JSON.stringify(proposal) + '\n', 'utf8');
  }
  return { ok: true, proposal, duplicate: false, path, queued: !opts.dryRun, dryRun: !!opts.dryRun, errors: errors.length ? errors : undefined };
}

