import { createHash } from 'node:crypto';

import type { ClaimEvidenceRef, ClaimLedgerRecord } from '../claims/claim-ledger.ts';
import type { PrivacyTier } from '../intelligence/policy.ts';
import type { GBrainPrivacy } from '../memory/namespace-policy.ts';
import type { TopicStateSurface } from '../world/topic-state.ts';

export const CONTEXT_PACK_V2_CONTRACT = 'gbrain.context_pack.v2';

export type ContextPackV2Type = 'project_pack' | 'meeting_brief' | 'opportunity_eval' | 'agent_handoff';
export type ContextPackV2Status = 'hit' | 'abstain';
export type ContextPackSourceType = 'personal_memory' | 'project_memory' | 'network_memory' | 'world_topic_state' | 'claim_ledger' | 'timeline' | 'openclaw_operational_memory';

export interface ContextPackV2SourceRef {
  ref: string;
  source_type: ContextPackSourceType;
  quote?: string;
  quote_hash?: string;
  source_item_id?: string;
  observed_at?: string;
}

export interface ContextPackV2Item {
  id: string;
  title: string;
  summary: string;
  source_refs: ContextPackV2SourceRef[];
  evidence_refs: string[];
  stale?: boolean;
  privacy?: GBrainPrivacy;
}

export interface ContextPackV2Compiled {
  schema: typeof CONTEXT_PACK_V2_CONTRACT;
  pack_type: ContextPackV2Type;
  status: ContextPackV2Status;
  compiled_at: string;
  request: Record<string, unknown>;
  retrieval_sources: Array<{ source_type: ContextPackSourceType; namespaces: string[]; count: number }>;
  sections: Record<string, ContextPackV2Item[]>;
  evidence_index: ContextPackV2SourceRef[];
  unknowns: string[];
  stale_warnings: string[];
  privacy_warnings: string[];
  token_estimate: number;
  privacy_tier: PrivacyTier;
  guardrails: {
    convenience_surface: true;
    trusted_memory: false;
    read_only: true;
    trusted_pages_edited: false;
    external_messages_sent: false;
  };
}

export interface CompileContextPackV2Input {
  packType: ContextPackV2Type;
  slug?: string;
  person?: string;
  date?: string;
  opportunity?: string;
  taskId?: string;
  task?: { id: string; title?: string; summary?: string; acceptance_criteria?: string[]; evidence_refs?: string[] };
  includeWorld?: boolean;
  records?: ClaimLedgerRecord[];
  topicStates?: TopicStateSurface[];
  operationalNotes?: Array<{ id: string; text: string; evidence_refs?: string[]; observed_at?: string }>;
  now?: Date;
}

function sha(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 12); }
function norm(value: unknown): string { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function tokens(value: unknown): string[] { return norm(value).split(/\s+/).filter(t => t.length >= 3); }
function hasAny(hay: string, needle: string): boolean { const ts = tokens(needle); if (!ts.length) return true; const n = norm(hay); return ts.some(t => n.includes(t)); }
function ts(value?: string): number { return value && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : 0; }
function stale(record: ClaimLedgerRecord, now: Date): boolean { return ['stale', 'superseded', 'contradicted'].includes(record.status) || (!!record.valid_to && Date.parse(record.valid_to) < now.getTime()); }
function privacyTierForPrivacy(privacy?: GBrainPrivacy): PrivacyTier {
  if (privacy === 'public') return 'P3_PUBLIC';
  if (privacy === 'internal') return 'P2_LIMITED_CLOUD';
  if (privacy === 'private') return 'P1_PRIVATE';
  return 'P0_LOCAL_ONLY';
}
function maxPrivacyTier(tiers: PrivacyTier[]): PrivacyTier {
  const rank: Record<PrivacyTier, number> = { P3_PUBLIC: 0, P2_LIMITED_CLOUD: 1, P1_PRIVATE: 2, P0_LOCAL_ONLY: 3 };
  return tiers.sort((a, b) => rank[b] - rank[a])[0] || 'P3_PUBLIC';
}
function sourceTypeFor(record: ClaimLedgerRecord): ContextPackSourceType {
  if (record.namespace === 'personal') return 'personal_memory';
  if (record.namespace === 'ventures') return 'project_memory';
  if (record.namespace === 'network') return 'network_memory';
  if (record.namespace === 'world' || record.namespace === 'scouts') return 'claim_ledger';
  return 'openclaw_operational_memory';
}
function evidenceRefs(evidence: ClaimEvidenceRef[] = [], sourceType: ContextPackSourceType): ContextPackV2SourceRef[] {
  return evidence.filter(e => e.span_id).map(e => ({ ref: e.span_id, source_type: sourceType, quote: e.quote, quote_hash: e.quote_hash, source_item_id: e.source_item_id, observed_at: undefined }));
}
function itemFromRecord(record: ClaimLedgerRecord, sourceType = sourceTypeFor(record), now = new Date()): ContextPackV2Item {
  const refs = evidenceRefs(record.evidence || [], sourceType);
  return { id: record.id, title: record.type, summary: record.claim, source_refs: refs, evidence_refs: refs.map(r => r.ref), stale: stale(record, now), privacy: record.privacy };
}
function uniqRefs(refs: ContextPackV2SourceRef[]): ContextPackV2SourceRef[] {
  const seen = new Set<string>();
  return refs.filter(r => { const key = r.ref || `${r.source_type}:${r.quote_hash}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function addSource(counts: Map<ContextPackSourceType, { namespaces: Set<string>; count: number }>, sourceType: ContextPackSourceType, namespace: string, count = 1): void {
  const row = counts.get(sourceType) || { namespaces: new Set<string>(), count: 0 };
  row.namespaces.add(namespace); row.count += count; counts.set(sourceType, row);
}
function tokenEstimate(pack: Omit<ContextPackV2Compiled, 'token_estimate'>): number { return Math.ceil(JSON.stringify(pack).length / 4); }

export function compileContextPackV2(input: CompileContextPackV2Input): ContextPackV2Compiled {
  const now = input.now || new Date();
  const records = input.records || [];
  const topicStates = input.topicStates || [];
  const counts = new Map<ContextPackSourceType, { namespaces: Set<string>; count: number }>();
  const sections: Record<string, ContextPackV2Item[]> = {};
  const unknowns: string[] = [];
  const staleWarnings: string[] = [];
  const privacyWarnings: string[] = [];
  const privacyTiers: PrivacyTier[] = [];
  const push = (section: string, item: ContextPackV2Item, sourceType: ContextPackSourceType, namespace: string) => {
    sections[section] ||= [];
    sections[section].push(item);
    addSource(counts, sourceType, namespace);
    if (item.stale) staleWarnings.push(`${item.id}: stale or superseded; refresh before relying on it`);
    if (item.privacy && item.privacy !== 'public') privacyWarnings.push(`${item.id}: ${item.privacy} context; keep pack within approved audience`);
    privacyTiers.push(privacyTierForPrivacy(item.privacy));
  };

  if (input.packType === 'project_pack') {
    const slug = input.slug || '';
    for (const r of records.filter(r => ['project_status', 'decision', 'open_loop'].includes(r.type) && (r.namespace === 'ventures' || r.namespace === 'actions' || r.namespace === 'personal') && hasAny(`${r.claim} ${r.type}`, slug)).sort((a, b) => ts(b.observed_at) - ts(a.observed_at)).slice(0, 8)) {
      push(r.type === 'open_loop' ? 'open_loops' : r.type === 'decision' ? 'decisions' : 'current_project_state', itemFromRecord(r, sourceTypeFor(r), now), sourceTypeFor(r), r.namespace);
    }
    if (input.includeWorld) {
      const surfaces = topicStates.filter(s => hasAny(`${s.topic} ${s.title} ${JSON.stringify(s.relevance_to_active_projects || [])}`, slug)).slice(0, 3);
      for (const s of surfaces) {
        addSource(counts, 'world_topic_state', 'world', 1);
        sections.external_topic_state ||= [];
        for (const c of s.current_state.slice(0, 5)) sections.external_topic_state.push({ id: c.id, title: s.title, summary: c.text, source_refs: c.source_refs.map(ref => ({ ref: ref.source_span_id, source_type: 'world_topic_state', quote: ref.quote, quote_hash: ref.quote_hash, source_item_id: ref.source_item_id, observed_at: c.observed_at })), evidence_refs: c.source_refs.map(ref => ref.source_span_id), stale: c.stale, privacy: 'public' });
      }
      if (!surfaces.length) unknowns.push(`No external topic state available for project ${slug}`);
    }
    if (!(sections.current_project_state?.length || sections.decisions?.length || sections.open_loops?.length)) unknowns.push(`No current project memory found for ${slug}`);
  }

  if (input.packType === 'meeting_brief') {
    const person = input.person || '';
    const hits = records.filter(r => (r.namespace === 'network' || r.type === 'relationship') && hasAny(`${r.claim} ${r.evidence?.map(e => e.quote).join(' ')}`, person)).sort((a, b) => ts(b.observed_at) - ts(a.observed_at)).slice(0, 8);
    for (const r of hits) push('prior_interactions', itemFromRecord(r, 'network_memory', now), 'network_memory', r.namespace);
    if (!hits.length) unknowns.push(`No prior interactions found for ${person}; abstaining rather than fabricating a meeting brief`);
  }

  if (input.packType === 'opportunity_eval') {
    const opp = input.opportunity || input.slug || '';
    for (const r of records.filter(r => ['decision', 'project_status', 'preference', 'world', 'world_claim'].includes(r.type) && hasAny(`${r.claim} ${r.namespace}`, opp)).sort((a, b) => ts(b.observed_at) - ts(a.observed_at)).slice(0, 10)) {
      push(r.namespace === 'world' ? 'external_signals' : r.type === 'decision' ? 'relevant_decisions' : 'personal_fit', itemFromRecord(r, sourceTypeFor(r), now), sourceTypeFor(r), r.namespace);
    }
    if (!Object.keys(sections).length) unknowns.push(`No cited personal/project/world evidence found for opportunity ${opp}`);
  }

  if (input.packType === 'agent_handoff') {
    const task = input.task || { id: input.taskId || 'unknown-task' };
    sections.task = [{ id: task.id, title: task.title || 'task', summary: task.summary || task.id, source_refs: [], evidence_refs: task.evidence_refs || [] }];
    sections.acceptance_criteria = (task.acceptance_criteria || []).map((criterion, idx) => ({ id: `${task.id}:ac:${idx + 1}`, title: 'acceptance_criterion', summary: criterion, source_refs: [], evidence_refs: task.evidence_refs || [] }));
    for (const note of input.operationalNotes || []) push('operational_context', { id: note.id, title: 'operational_memory', summary: note.text, source_refs: (note.evidence_refs || []).map(ref => ({ ref, source_type: 'openclaw_operational_memory', observed_at: note.observed_at })), evidence_refs: note.evidence_refs || [] }, 'openclaw_operational_memory', 'operational');
    if (!sections.acceptance_criteria?.length) unknowns.push(`No acceptance criteria available for task ${task.id}`);
    const refs = [...(task.evidence_refs || []), ...(input.operationalNotes || []).flatMap(n => n.evidence_refs || [])];
    if (!refs.length) unknowns.push(`No evidence refs available for task ${task.id}`);
    addSource(counts, 'openclaw_operational_memory', 'operational', (input.operationalNotes || []).length + 1);
    privacyTiers.push('P1_PRIVATE');
  }

  const evidenceIndex = uniqRefs(Object.values(sections).flat().flatMap(i => i.source_refs));
  const status: ContextPackV2Status = input.packType === 'meeting_brief' && !sections.prior_interactions?.length ? 'abstain' : Object.values(sections).some(v => v.length) ? 'hit' : 'abstain';
  const base: Omit<ContextPackV2Compiled, 'token_estimate'> = {
    schema: CONTEXT_PACK_V2_CONTRACT,
    pack_type: input.packType,
    status,
    compiled_at: now.toISOString(),
    request: { pack_type: input.packType, slug: input.slug, person: input.person, date: input.date, opportunity: input.opportunity, task_id: input.taskId || input.task?.id, include_world: input.includeWorld === true },
    retrieval_sources: [...counts.entries()].map(([source_type, v]) => ({ source_type, namespaces: [...v.namespaces].sort(), count: v.count })).sort((a, b) => a.source_type.localeCompare(b.source_type)),
    sections,
    evidence_index: evidenceIndex,
    unknowns,
    stale_warnings: [...new Set(staleWarnings)],
    privacy_warnings: [...new Set(privacyWarnings)],
    privacy_tier: maxPrivacyTier(privacyTiers.length ? privacyTiers : ['P3_PUBLIC']),
    guardrails: { convenience_surface: true, trusted_memory: false, read_only: true, trusted_pages_edited: false, external_messages_sent: false },
  };
  return { ...base, token_estimate: tokenEstimate(base) };
}

export function validateContextPackV2(pack: ContextPackV2Compiled): string[] {
  const errors: string[] = [];
  if (pack.schema !== CONTEXT_PACK_V2_CONTRACT) errors.push('schema must be gbrain.context_pack.v2');
  if (!['project_pack', 'meeting_brief', 'opportunity_eval', 'agent_handoff'].includes(pack.pack_type)) errors.push('invalid pack_type');
  if (pack.guardrails.trusted_memory !== false || pack.guardrails.read_only !== true) errors.push('context packs must be read-only convenience surfaces, not trusted memory');
  for (const item of Object.values(pack.sections).flat()) {
    if (item.source_refs.length === 0 && pack.pack_type !== 'agent_handoff') errors.push(`${item.id} must carry at least one source ref`);
  }
  if (!Number.isFinite(pack.token_estimate) || pack.token_estimate <= 0) errors.push('token_estimate must be positive');
  if (!pack.privacy_tier) errors.push('privacy_tier is required');
  return errors;
}
