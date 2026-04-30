import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import { configDir } from '../config.ts';
import type { SurfacingCandidate } from '../radar/surfacing.ts';

export const ACTION_PROPOSAL_SCHEMA = 'gbrain.actions.action_proposal.v1';
export const ACTION_PROPOSAL_DECISION_SCHEMA = 'gbrain.actions.action_proposal_decision.v1';

export const ACTION_PROPOSAL_TYPES = [
  'draft_memo',
  'draft_email',
  'schedule_meeting_request',
  'create_openclaw_task',
  'create_codex_pr_task',
  'run_deep_scout',
  'update_trusted_memory',
] as const;

export type ActionProposalType = typeof ACTION_PROPOSAL_TYPES[number];
export type ActionApprovalState = 'pending_approval' | 'approved' | 'rejected';
export type ActionRiskLevel = 'low' | 'medium' | 'high';

export interface ActionEvidenceRef {
  ref: string;
  quote?: string;
  source_item_id?: string;
  url?: string;
  observed_at?: string;
}

export interface ActionProposal {
  schema: typeof ACTION_PROPOSAL_SCHEMA;
  id: string;
  proposal_type: 'action';
  action_type: ActionProposalType;
  created_at: string;
  updated_at: string;
  owner: string;
  title: string;
  rationale: string;
  expected_value: string;
  risk: {
    level: ActionRiskLevel;
    summary: string;
    external_effect: boolean;
  };
  evidence: ActionEvidenceRef[];
  source?: {
    kind: 'radar_candidate' | 'manual';
    id?: string;
  };
  approval: {
    state: ActionApprovalState;
    gate: 'explicit_human_approval_required';
    approved_at?: string;
    approved_by?: string;
    rejected_at?: string;
    rejected_by?: string;
    rejection_reason?: string;
  };
  execution_policy: {
    candidate_only: true;
    external_send_allowed: false;
    external_schedule_allowed: false;
    trusted_memory_write_allowed: false;
    local_task_creation_allowed: false;
    execution_after_approval: 'record_intent_only';
  };
  guardrails: {
    review_only: true;
    actions_performed: false;
    external_messages_sent: false;
    calendar_events_created: false;
    trusted_pages_edited: false;
    openclaw_tasks_created: false;
    codex_tasks_created: false;
  };
}

export interface ActionProposalDecision {
  schema: typeof ACTION_PROPOSAL_DECISION_SCHEMA;
  id: string;
  proposal_id: string;
  decided_at: string;
  decision: 'approved' | 'rejected';
  actor: string;
  reason?: string;
}

export interface ActionProposalStoreRecord {
  record_type: 'proposal' | 'decision';
  proposal?: ActionProposal;
  decision?: ActionProposalDecision;
}

function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableId(prefix: string, basis: unknown): string { return `${prefix}_${sha(JSON.stringify(basis)).slice(0, 14)}`; }
function nowIso(now?: Date): string { return (now || new Date()).toISOString(); }
function clean(v: unknown): string { return String(v || '').trim(); }
function validIso(v: unknown): boolean { return typeof v === 'string' && !Number.isNaN(Date.parse(v)); }
function isObject(v: unknown): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }

export function actionProposalsPath(): string { return join(configDir(), 'action-proposals.jsonl'); }

export function actionTypeForRadarCandidate(candidate: SurfacingCandidate): ActionProposalType {
  if (candidate.source_kind === 'meeting_context' || /meeting|calendar|schedule/i.test(`${candidate.title} ${candidate.summary}`)) return 'schedule_meeting_request';
  if (/email|intro|reply/i.test(`${candidate.title} ${candidate.summary}`)) return 'draft_email';
  if (/memo|brief|note|writeup/i.test(`${candidate.title} ${candidate.summary}`) || candidate.recommended_action.type === 'brief') return 'draft_memo';
  if (/codex|pr|pull request|code/i.test(`${candidate.title} ${candidate.summary}`)) return 'create_codex_pr_task';
  if (/trusted memory|memory update|remember/i.test(`${candidate.title} ${candidate.summary}`)) return 'update_trusted_memory';
  if (candidate.recommended_action.type === 'investigate' || candidate.source_kind === 'scout_claim' || candidate.source_kind === 'topic_delta') return 'run_deep_scout';
  return 'create_openclaw_task';
}

function riskFor(actionType: ActionProposalType): ActionProposal['risk'] {
  if (actionType === 'draft_email') return { level: 'medium', summary: 'Drafting an email is safe locally, but sending is an external action and remains blocked.', external_effect: true };
  if (actionType === 'schedule_meeting_request') return { level: 'high', summary: 'Meeting scheduling can affect external calendars/people; this proposal only records intent.', external_effect: true };
  if (actionType === 'update_trusted_memory') return { level: 'high', summary: 'Trusted memory updates require governed write-back; this proposal does not edit trusted pages.', external_effect: false };
  if (actionType === 'create_codex_pr_task' || actionType === 'create_openclaw_task') return { level: 'medium', summary: 'Task creation can start work; approval records intent only unless a separate safe task path is invoked.', external_effect: false };
  return { level: 'low', summary: 'Local review/scouting proposal only; execution is not performed by this surface.', external_effect: false };
}

export function buildActionProposal(input: {
  actionType: ActionProposalType;
  title: string;
  rationale: string;
  expectedValue: string;
  evidence: ActionEvidenceRef[];
  owner?: string;
  source?: ActionProposal['source'];
  now?: Date;
}): ActionProposal {
  const created = nowIso(input.now);
  const id = stableId('act', { actionType: input.actionType, title: input.title, evidence: input.evidence.map(e => e.ref || e.url), source: input.source });
  return {
    schema: ACTION_PROPOSAL_SCHEMA,
    id,
    proposal_type: 'action',
    action_type: input.actionType,
    created_at: created,
    updated_at: created,
    owner: input.owner || 'Chief',
    title: clean(input.title),
    rationale: clean(input.rationale),
    expected_value: clean(input.expectedValue),
    risk: riskFor(input.actionType),
    evidence: input.evidence,
    source: input.source,
    approval: { state: 'pending_approval', gate: 'explicit_human_approval_required' },
    execution_policy: {
      candidate_only: true,
      external_send_allowed: false,
      external_schedule_allowed: false,
      trusted_memory_write_allowed: false,
      local_task_creation_allowed: false,
      execution_after_approval: 'record_intent_only',
    },
    guardrails: {
      review_only: true,
      actions_performed: false,
      external_messages_sent: false,
      calendar_events_created: false,
      trusted_pages_edited: false,
      openclaw_tasks_created: false,
      codex_tasks_created: false,
    },
  };
}

export function actionProposalFromRadarCandidate(candidate: SurfacingCandidate, opts: { owner?: string; now?: Date } = {}): ActionProposal {
  const actionType = actionTypeForRadarCandidate(candidate);
  return buildActionProposal({
    actionType,
    title: `${labelFor(actionType)}: ${candidate.title}`,
    rationale: candidate.recommended_action.rationale || `Radar candidate ${candidate.id} recommends ${candidate.recommended_action.type}; approval is required before work starts.`,
    expectedValue: `Convert radar signal into governed follow-up without silently sending, scheduling, creating tasks, or editing memory. Candidate score=${candidate.scores.final}.`,
    evidence: candidate.evidence.map(e => ({ ref: e.ref, quote: e.quote, source_item_id: e.source_item_id, url: e.url, observed_at: e.observed_at })),
    owner: opts.owner,
    source: { kind: 'radar_candidate', id: candidate.id },
    now: opts.now,
  });
}

function labelFor(actionType: ActionProposalType): string {
  return actionType.replace(/_/g, ' ');
}

export function validateActionProposal(proposal: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(proposal)) return ['proposal must be an object'];
  if (proposal.schema !== ACTION_PROPOSAL_SCHEMA) errors.push(`schema must be ${ACTION_PROPOSAL_SCHEMA}`);
  if (proposal.proposal_type !== 'action') errors.push('proposal_type must be action');
  if (!ACTION_PROPOSAL_TYPES.includes(proposal.action_type)) errors.push(`action_type must be one of: ${ACTION_PROPOSAL_TYPES.join(', ')}`);
  if (typeof proposal.id !== 'string' || !proposal.id.startsWith('act_')) errors.push('id must be an act_ id');
  if (!validIso(proposal.created_at)) errors.push('created_at must be ISO');
  if (!validIso(proposal.updated_at)) errors.push('updated_at must be ISO');
  for (const field of ['owner', 'title', 'rationale', 'expected_value']) if (typeof proposal[field] !== 'string' || proposal[field].trim().length < 3) errors.push(`${field} must be a non-empty string`);
  if (!Array.isArray(proposal.evidence) || proposal.evidence.length === 0) errors.push('evidence must include at least one cited ref');
  else proposal.evidence.forEach((e: any, idx: number) => { if (!isObject(e) || (typeof e.ref !== 'string' && typeof e.url !== 'string')) errors.push(`evidence[${idx}] must include ref or url`); });
  if (!isObject(proposal.risk)) errors.push('risk is required');
  else {
    if (!['low', 'medium', 'high'].includes(String(proposal.risk.level))) errors.push('risk.level must be low|medium|high');
    if (typeof proposal.risk.summary !== 'string' || proposal.risk.summary.length < 3) errors.push('risk.summary is required');
    if (typeof proposal.risk.external_effect !== 'boolean') errors.push('risk.external_effect must be boolean');
  }
  if (!isObject(proposal.approval)) errors.push('approval is required');
  else {
    if (!['pending_approval', 'approved', 'rejected'].includes(String(proposal.approval.state))) errors.push('approval.state is invalid');
    if (proposal.approval.gate !== 'explicit_human_approval_required') errors.push('approval.gate must be explicit_human_approval_required');
  }
  if (!isObject(proposal.execution_policy)) errors.push('execution_policy is required');
  else {
    const p = proposal.execution_policy;
    if (p.candidate_only !== true) errors.push('execution_policy.candidate_only must be true');
    if (p.external_send_allowed !== false) errors.push('execution_policy.external_send_allowed must be false');
    if (p.external_schedule_allowed !== false) errors.push('execution_policy.external_schedule_allowed must be false');
    if (p.trusted_memory_write_allowed !== false) errors.push('execution_policy.trusted_memory_write_allowed must be false');
    if (p.local_task_creation_allowed !== false) errors.push('execution_policy.local_task_creation_allowed must be false');
    if (p.execution_after_approval !== 'record_intent_only') errors.push('execution_policy.execution_after_approval must be record_intent_only');
  }
  if (!isObject(proposal.guardrails)) errors.push('guardrails is required');
  else {
    const g = proposal.guardrails;
    if (g.review_only !== true) errors.push('guardrails.review_only must be true');
    for (const field of ['actions_performed', 'external_messages_sent', 'calendar_events_created', 'trusted_pages_edited', 'openclaw_tasks_created', 'codex_tasks_created']) {
      if (g[field] !== false) errors.push(`guardrails.${field} must be false`);
    }
  }
  return errors;
}

export function appendActionProposal(proposal: ActionProposal, path = actionProposalsPath()): { ok: boolean; proposal: ActionProposal; path: string; duplicate: boolean; errors?: string[] } {
  const errors = validateActionProposal(proposal);
  if (errors.length) return { ok: false, proposal, path, duplicate: false, errors };
  const store = readActionProposalStore(path);
  const duplicate = store.proposals.some(p => p.id === proposal.id);
  if (!duplicate) {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ record_type: 'proposal', proposal } satisfies ActionProposalStoreRecord) + '\n', { mode: 0o600 });
  }
  return { ok: true, proposal, path, duplicate };
}

export function readActionProposalStore(path = actionProposalsPath()): { proposals: ActionProposal[]; decisions: ActionProposalDecision[] } {
  if (!existsSync(path)) return { proposals: [], decisions: [] };
  const proposals = new Map<string, ActionProposal>();
  const decisions: ActionProposalDecision[] = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const row = JSON.parse(line) as ActionProposalStoreRecord;
    if (row.record_type === 'proposal' && row.proposal) proposals.set(row.proposal.id, row.proposal);
    if (row.record_type === 'decision' && row.decision) {
      decisions.push(row.decision);
      const p = proposals.get(row.decision.proposal_id);
      if (p) {
        p.updated_at = row.decision.decided_at;
        if (row.decision.decision === 'approved') p.approval = { ...p.approval, state: 'approved', approved_at: row.decision.decided_at, approved_by: row.decision.actor };
        else p.approval = { ...p.approval, state: 'rejected', rejected_at: row.decision.decided_at, rejected_by: row.decision.actor, rejection_reason: row.decision.reason || 'rejected' };
      }
    }
  }
  return { proposals: [...proposals.values()], decisions };
}

export function reviewActionProposals(opts: { path?: string; limit?: number; state?: ActionApprovalState } = {}): ActionProposal[] {
  const all = readActionProposalStore(opts.path).proposals;
  const filtered = opts.state ? all.filter(p => p.approval.state === opts.state) : all;
  return filtered.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)).slice(0, opts.limit ?? 20);
}

export function recordActionProposalDecision(input: { proposalId: string; decision: 'approved' | 'rejected'; actor?: string; reason?: string; path?: string; now?: Date }): ActionProposalDecision {
  const path = input.path || actionProposalsPath();
  const store = readActionProposalStore(path);
  const proposal = store.proposals.find(p => p.id === input.proposalId);
  if (!proposal) throw new Error(`action proposal not found: ${input.proposalId}`);
  if (proposal.approval.state !== 'pending_approval') throw new Error(`action proposal is already ${proposal.approval.state}`);
  if (input.decision === 'rejected' && !clean(input.reason)) throw new Error('rejection reason is required');
  const decidedAt = nowIso(input.now);
  const decision: ActionProposalDecision = {
    schema: ACTION_PROPOSAL_DECISION_SCHEMA,
    id: stableId('act_decision', { proposalId: input.proposalId, decision: input.decision, at: decidedAt }),
    proposal_id: input.proposalId,
    decided_at: decidedAt,
    decision: input.decision,
    actor: input.actor || 'Chief',
    reason: input.reason,
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ record_type: 'decision', decision } satisfies ActionProposalStoreRecord) + '\n', { mode: 0o600 });
  return decision;
}
