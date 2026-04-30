import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

import { configDir } from '../config.ts';

export const OPS_KERNEL_SCHEMA = 'gbrain.ops.kernel.v1';
export const OPS_EVENT_SCHEMA = 'gbrain.ops.event.v1';
export const OPS_COMPLETION_SCHEMA = 'gbrain.ops.completion.v1';

export const WORK_ITEM_STATES = [
  'proposed',
  'approved',
  'ready',
  'leased',
  'running',
  'succeeded',
  'failed',
  'blocked',
  'waiting_human',
  'cancelled',
  'quarantined',
] as const;

export type WorkItemState = typeof WORK_ITEM_STATES[number];
export type ProgramStatus = 'active' | 'paused' | 'retired';
export type WorkerKind = 'qwen_local' | 'minimax' | 'subagent' | 'acp_codex' | 'script' | 'human_review' | string;
export type PrivacyTier = 'P0' | 'P1' | 'P2' | 'P3' | 'P0_LOCAL_ONLY' | 'P1_PRIVATE' | 'P2_LIMITED_CLOUD' | 'P3_PUBLIC' | string;
export type LeaseStatus = 'active' | 'released' | 'expired' | 'revoked';
export type RunStatus = 'queued' | 'starting' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'lost';
export type InterruptSeverity = 'info' | 'low' | 'medium' | 'high' | 'urgent';
export type InterruptStatus = 'new' | 'delivered' | 'acknowledged' | 'dismissed' | 'resolved';

export interface OpsProgram {
  id: string;
  title: string;
  status: ProgramStatus;
  priority: number;
  owner_agent?: string;
  objective: string;
  lanes: string[];
  cadence: Record<string, unknown>;
  budgets: Record<string, unknown>;
  autonomy: Record<string, unknown>;
  approval_gates: unknown[];
  outputs: unknown[];
  created_at: string;
  updated_at: string;
}

export interface OpsWorkItem {
  id: string;
  program_id: string;
  title: string;
  description: string;
  state: WorkItemState;
  priority: number;
  lane: string;
  worker_kind: WorkerKind;
  privacy_tier: PrivacyTier;
  source_refs: unknown[];
  dependencies: string[];
  acceptance_criteria: unknown[];
  expected_artifacts: unknown[];
  budget: Record<string, unknown>;
  not_before?: string;
  deadline_at?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_state_reason?: string;
}

export interface OpsWorkRun {
  id: string;
  work_item_id: string;
  program_id: string;
  worker_id?: string;
  provider?: string;
  model?: string;
  openclaw_task_id?: string;
  session_key?: string;
  session_id?: string;
  runtime?: string;
  status: RunStatus;
  started_at?: string;
  ended_at?: string;
  last_event_at?: string;
  input_pack_path?: string;
  output_path?: string;
  completion_json?: unknown;
  error?: string;
  token_usage?: Record<string, unknown>;
  cost?: Record<string, unknown>;
  created_at: string;
}

export interface OpsLease {
  id: string;
  work_item_id: string;
  run_id?: string;
  worker_id: string;
  lease_status: LeaseStatus;
  claimed_at: string;
  expires_at: string;
  renewed_at?: string;
  released_at?: string;
  heartbeat_at?: string;
  metadata: Record<string, unknown>;
}

export interface OpsArtifact {
  id: string;
  run_id?: string;
  work_item_id?: string;
  kind: string;
  path?: string | null;
  ref?: string | null;
  hash?: string;
  summary?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface OpsSupervisorTick {
  id: number;
  tick_at: string;
  status: 'green' | 'amber' | 'red';
  ready_count: number;
  running_count: number;
  blocked_count: number;
  waiting_human_count: number;
  spawned_count: number;
  alerts: OpsAuditAlert[];
  decisions: unknown[];
}

export interface OpsInterrupt {
  id: string;
  severity: InterruptSeverity;
  program_id?: string;
  work_item_id?: string;
  title: string;
  body: string;
  proposed_action?: string;
  requires_human: boolean;
  status: InterruptStatus;
  created_at: string;
  delivered_at?: string;
  resolved_at?: string;
}

export interface OpsBudgetLedgerEntry {
  id: number;
  provider: string;
  model?: string;
  program_id?: string;
  work_item_id?: string;
  run_id?: string;
  calls: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost?: number;
  occurred_at: string;
  metadata: Record<string, unknown>;
}

export interface OpsState {
  schema: typeof OPS_KERNEL_SCHEMA;
  programs: OpsProgram[];
  work_items: OpsWorkItem[];
  runs: OpsWorkRun[];
  leases: OpsLease[];
  artifacts: OpsArtifact[];
  supervisor_ticks: OpsSupervisorTick[];
  interrupts: OpsInterrupt[];
  budget_ledger: OpsBudgetLedgerEntry[];
}

export interface OpsCompletion {
  work_item_id: string;
  program_id?: string;
  status: Extract<WorkItemState, 'succeeded' | 'failed' | 'blocked' | 'waiting_human' | 'cancelled' | 'quarantined'>;
  summary: string;
  artifacts?: Array<{ kind: string; path?: string | null; ref?: string | null; hash?: string; summary?: string; metadata?: Record<string, unknown> }>;
  checks_run?: string[];
  next_work_recommendations?: unknown[];
  requires_human?: unknown[];
  continuation?: Record<string, unknown>;
  provider?: string;
  model?: string;
  token_usage?: Record<string, unknown>;
  cost?: Record<string, unknown>;
  output_path?: string;
  error?: string;
}

export interface OpsAuditAlert {
  kind: 'no_idle' | 'blocked_work' | 'waiting_human' | 'stale_active_lease';
  severity: 'info' | 'amber' | 'red';
  message: string;
  work_item_ids?: string[];
  lease_ids?: string[];
}

type OpsRecordType = 'init' | 'program_upsert' | 'work_upsert' | 'run_upsert' | 'lease_upsert' | 'artifact_upsert' | 'supervisor_tick' | 'interrupt_upsert' | 'budget_ledger' | 'work_state';

interface OpsEvent<T = unknown> {
  schema: typeof OPS_EVENT_SCHEMA;
  type: OpsRecordType;
  at: string;
  payload: T;
}

export interface OpsStoreOptions { path?: string; now?: Date; }

function nowIso(now?: Date): string { return (now || new Date()).toISOString(); }
function isObject(v: unknown): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function stringArray(v: unknown): string[] { return Array.isArray(v) ? v.map(x => String(x)).filter(Boolean) : []; }
function array(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function object(v: unknown): Record<string, unknown> { return isObject(v) ? v : {}; }
function numberOr(v: unknown, fallback: number): number { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function uuid(prefix: string): string { return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 18)}`; }
function hashId(prefix: string, v: unknown): string { return `${prefix}_${createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16)}`; }
function terminalState(s: WorkItemState): boolean { return ['succeeded', 'failed', 'blocked', 'waiting_human', 'cancelled', 'quarantined'].includes(s); }
function activeState(s: WorkItemState): boolean { return s === 'leased' || s === 'running'; }

export function opsStorePath(): string {
  return join(configDir(), 'ops-kernel.jsonl');
}

export function emptyOpsState(): OpsState {
  return { schema: OPS_KERNEL_SCHEMA, programs: [], work_items: [], runs: [], leases: [], artifacts: [], supervisor_ticks: [], interrupts: [], budget_ledger: [] };
}

export function initOpsStore(path = opsStorePath(), now?: Date): { ok: true; path: string; initialized: boolean } {
  mkdirSync(dirname(path), { recursive: true });
  const initialized = !existsSync(path);
  if (initialized) appendEvent(path, 'init', { schema: OPS_KERNEL_SCHEMA }, now);
  return { ok: true, path, initialized };
}

export function readOpsState(path = opsStorePath()): OpsState {
  const state = emptyOpsState();
  if (!existsSync(path)) return state;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const evt = JSON.parse(line) as OpsEvent;
    applyEvent(state, evt);
  }
  return state;
}

function appendEvent<T>(path: string, type: OpsRecordType, payload: T, now?: Date): void {
  mkdirSync(dirname(path), { recursive: true });
  const evt: OpsEvent<T> = { schema: OPS_EVENT_SCHEMA, type, at: nowIso(now), payload };
  appendFileSync(path, JSON.stringify(evt) + '\n', { mode: 0o600 });
}

function upsertById<T extends { id: string | number }>(arr: T[], item: T): void {
  const ix = arr.findIndex(x => x.id === item.id);
  if (ix >= 0) arr[ix] = item;
  else arr.push(item);
}

function applyEvent(state: OpsState, evt: OpsEvent): void {
  const p: any = evt.payload;
  switch (evt.type) {
    case 'program_upsert': upsertById(state.programs, p as OpsProgram); break;
    case 'work_upsert': upsertById(state.work_items, p as OpsWorkItem); break;
    case 'run_upsert': upsertById(state.runs, p as OpsWorkRun); break;
    case 'lease_upsert': upsertById(state.leases, p as OpsLease); break;
    case 'artifact_upsert': upsertById(state.artifacts, p as OpsArtifact); break;
    case 'supervisor_tick': upsertById(state.supervisor_ticks, p as OpsSupervisorTick); break;
    case 'interrupt_upsert': upsertById(state.interrupts, p as OpsInterrupt); break;
    case 'budget_ledger': upsertById(state.budget_ledger, p as OpsBudgetLedgerEntry); break;
    case 'work_state': {
      const item = state.work_items.find(w => w.id === p.id);
      if (item) {
        item.state = p.state;
        item.updated_at = p.updated_at;
        item.last_state_reason = p.reason;
      }
      break;
    }
    case 'init': break;
  }
}

export function normalizeProgram(input: unknown, now?: Date): OpsProgram {
  if (!isObject(input)) throw new Error('program must be an object');
  const id = String(input.id || '').trim();
  if (!id) throw new Error('program.id is required');
  const at = nowIso(now);
  return {
    id,
    title: String(input.title || id),
    status: ['active', 'paused', 'retired'].includes(String(input.status)) ? input.status as ProgramStatus : 'active',
    priority: numberOr(input.priority, 50),
    owner_agent: input.owner_agent ? String(input.owner_agent) : undefined,
    objective: String(input.objective || input.description || `Ops program ${id}`),
    lanes: stringArray(input.lanes),
    cadence: object(input.cadence),
    budgets: object(input.budgets),
    autonomy: object(input.autonomy),
    approval_gates: array(input.approval_gates),
    outputs: array(input.outputs),
    created_at: typeof input.created_at === 'string' ? input.created_at : at,
    updated_at: at,
  };
}

export function normalizeWorkItem(input: unknown, existing: OpsState, now?: Date): OpsWorkItem {
  if (!isObject(input)) throw new Error('work item must be an object');
  const id = String(input.id || '').trim();
  if (!id) throw new Error('work_item.id is required');
  const programId = String(input.program_id || '').trim();
  if (!programId) throw new Error(`work_item ${id} requires program_id`);
  const title = String(input.title || '').trim();
  if (!title) throw new Error(`work_item ${id} requires title`);
  const description = String(input.description || input.summary || title).trim();
  const requested = WORK_ITEM_STATES.includes(String(input.state) as WorkItemState) ? String(input.state) as WorkItemState : 'approved';
  const dependencies = stringArray(input.dependencies || input.depends_on);
  const at = nowIso(now);
  const created = typeof input.created_at === 'string' ? input.created_at : at;
  return {
    id,
    program_id: programId,
    title,
    description,
    state: normalizeEligibilityState(requested, dependencies, existing),
    priority: numberOr(input.priority, 50),
    lane: String(input.lane || 'general'),
    worker_kind: String(input.worker_kind || 'subagent'),
    privacy_tier: String(input.privacy_tier || 'P2'),
    source_refs: array(input.source_refs),
    dependencies,
    acceptance_criteria: array(input.acceptance_criteria),
    expected_artifacts: array(input.expected_artifacts),
    budget: object(input.budget),
    not_before: typeof input.not_before === 'string' ? input.not_before : undefined,
    deadline_at: typeof input.deadline_at === 'string' ? input.deadline_at : undefined,
    created_by: String(input.created_by || 'system'),
    created_at: created,
    updated_at: at,
    last_state_reason: typeof input.last_state_reason === 'string' ? input.last_state_reason : eligibilityReason(requested, dependencies, existing),
  };
}

function depsSatisfied(dependencies: string[], state: OpsState): boolean {
  return dependencies.every(id => state.work_items.find(w => w.id === id)?.state === 'succeeded');
}

function normalizeEligibilityState(requested: WorkItemState, dependencies: string[], state: OpsState): WorkItemState {
  if (terminalState(requested) || activeState(requested) || requested === 'proposed') return requested;
  if (requested === 'ready') return depsSatisfied(dependencies, state) ? 'ready' : 'approved';
  if (requested === 'approved' && depsSatisfied(dependencies, state)) return 'ready';
  return requested;
}

function eligibilityReason(requested: WorkItemState, dependencies: string[], state: OpsState): string | undefined {
  if ((requested === 'approved' || requested === 'ready') && depsSatisfied(dependencies, state)) return 'dependencies satisfied';
  if (requested === 'ready' && !depsSatisfied(dependencies, state)) return 'dependencies not yet satisfied';
  return undefined;
}

export function enqueueWorkPacket(packet: unknown, opts: OpsStoreOptions = {}): { ok: true; path: string; programs: OpsProgram[]; work_items: OpsWorkItem[] } {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const state = readOpsState(path);
  if (!isObject(packet)) throw new Error('packet must be an object');

  const rawPrograms = Array.isArray(packet.programs) ? packet.programs : (packet.program ? [packet.program] : []);
  const programs = rawPrograms.map(p => normalizeProgram(p, opts.now));
  for (const program of programs) {
    appendEvent(path, 'program_upsert', program, opts.now);
    upsertById(state.programs, program);
  }

  const rawItems = Array.isArray(packet.work_items) ? packet.work_items : (packet.work_item ? [packet.work_item] : [packet]);
  const workItems: OpsWorkItem[] = [];
  for (const rawItem of rawItems) {
    const item = normalizeWorkItem(rawItem, state, opts.now);
    appendEvent(path, 'work_upsert', item, opts.now);
    upsertById(state.work_items, item);
    workItems.push(item);
  }
  return { ok: true, path, programs, work_items: workItems };
}

export function listPrograms(opts: OpsStoreOptions = {}): OpsProgram[] {
  return readOpsState(opts.path || opsStorePath()).programs.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function listWorkItems(filter: { state?: WorkItemState }, opts: OpsStoreOptions = {}): OpsWorkItem[] {
  let items = readOpsState(opts.path || opsStorePath()).work_items;
  if (filter.state) items = items.filter(w => w.state === filter.state);
  return [...items].sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export function claimWorkItem(id: string, workerId: string, opts: OpsStoreOptions & { leaseMinutes?: number } = {}): { ok: true; work_item: OpsWorkItem; lease: OpsLease; run: OpsWorkRun } {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const state = readOpsState(path);
  const item = state.work_items.find(w => w.id === id);
  if (!item) throw new Error(`work item not found: ${id}`);
  if (item.state !== 'ready') throw new Error(`work item ${id} is not ready (state=${item.state})`);
  const existingLease = state.leases.find(l => l.work_item_id === id && l.lease_status === 'active');
  if (existingLease) throw new Error(`work item ${id} already has active lease ${existingLease.id}`);
  const at = nowIso(opts.now);
  const expires = new Date(opts.now?.getTime() || Date.now());
  expires.setMinutes(expires.getMinutes() + (opts.leaseMinutes || 30));
  const run: OpsWorkRun = {
    id: uuid('run'),
    work_item_id: id,
    program_id: item.program_id,
    worker_id: workerId,
    runtime: item.worker_kind,
    status: 'running',
    started_at: at,
    last_event_at: at,
    created_at: at,
  };
  const lease: OpsLease = {
    id: uuid('lease'),
    work_item_id: id,
    run_id: run.id,
    worker_id: workerId,
    lease_status: 'active',
    claimed_at: at,
    expires_at: expires.toISOString(),
    heartbeat_at: at,
    metadata: {},
  };
  const updated: OpsWorkItem = { ...item, state: 'running', updated_at: at, last_state_reason: `claimed by ${workerId}` };
  appendEvent(path, 'run_upsert', run, opts.now);
  appendEvent(path, 'lease_upsert', lease, opts.now);
  appendEvent(path, 'work_upsert', updated, opts.now);
  return { ok: true, work_item: updated, lease, run };
}

export function validateCompletion(input: unknown, item?: OpsWorkItem): string[] {
  const errors: string[] = [];
  if (!isObject(input)) return ['completion must be an object'];
  const terminal = ['succeeded', 'failed', 'blocked', 'waiting_human', 'cancelled', 'quarantined'];
  if (typeof input.work_item_id !== 'string' || !input.work_item_id.trim()) errors.push('work_item_id is required');
  if (item && input.work_item_id !== item.id) errors.push(`work_item_id must match ${item.id}`);
  if (item && input.program_id && input.program_id !== item.program_id) errors.push(`program_id must match ${item.program_id}`);
  if (!terminal.includes(String(input.status))) errors.push(`status must be one of: ${terminal.join(', ')}`);
  if (typeof input.summary !== 'string' || input.summary.trim().length < 3) errors.push('summary must be a non-empty string');
  if (input.artifacts !== undefined && !Array.isArray(input.artifacts)) errors.push('artifacts must be an array when provided');
  if (Array.isArray(input.artifacts)) {
    input.artifacts.forEach((a: unknown, idx: number) => {
      if (!isObject(a)) errors.push(`artifacts[${idx}] must be an object`);
      else if (typeof a.kind !== 'string' || !a.kind.trim()) errors.push(`artifacts[${idx}].kind is required`);
    });
  }
  return errors;
}

export function completeWorkItem(id: string, completion: unknown, opts: OpsStoreOptions = {}): { ok: true; work_item: OpsWorkItem; run?: OpsWorkRun; released_lease?: OpsLease; artifacts: OpsArtifact[]; unblocked: OpsWorkItem[] } {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const state = readOpsState(path);
  const item = state.work_items.find(w => w.id === id);
  if (!item) throw new Error(`work item not found: ${id}`);
  const errors = validateCompletion(completion, item);
  if (errors.length) throw new Error(`invalid completion: ${errors.join('; ')}`);
  const c = completion as OpsCompletion;
  const at = nowIso(opts.now);
  const activeLease = state.leases.find(l => l.work_item_id === id && l.lease_status === 'active');
  const run = activeLease?.run_id ? state.runs.find(r => r.id === activeLease.run_id) : state.runs.filter(r => r.work_item_id === id).at(-1);
  let released: OpsLease | undefined;
  if (activeLease) {
    released = { ...activeLease, lease_status: 'released', released_at: at, heartbeat_at: at };
    appendEvent(path, 'lease_upsert', released, opts.now);
  }
  let updatedRun: OpsWorkRun | undefined;
  if (run) {
    updatedRun = {
      ...run,
      status: runStatusForCompletion(c.status),
      ended_at: at,
      last_event_at: at,
      completion_json: c,
      output_path: c.output_path || run.output_path,
      error: c.error || run.error,
      provider: c.provider || run.provider,
      model: c.model || run.model,
      token_usage: c.token_usage || run.token_usage,
      cost: c.cost || run.cost,
    };
    appendEvent(path, 'run_upsert', updatedRun, opts.now);
  }
  const updatedItem: OpsWorkItem = { ...item, state: c.status, updated_at: at, last_state_reason: c.summary };
  appendEvent(path, 'work_upsert', updatedItem, opts.now);

  const artifacts = (c.artifacts || []).map(a => normalizeArtifact(a, id, updatedRun?.id, opts.now));
  for (const artifact of artifacts) appendEvent(path, 'artifact_upsert', artifact, opts.now);

  const nextState = readOpsState(path);
  const unblocked: OpsWorkItem[] = [];
  if (c.status === 'succeeded') {
    for (const candidate of nextState.work_items) {
      if (candidate.state !== 'approved') continue;
      if (!candidate.dependencies.includes(id)) continue;
      if (!depsSatisfied(candidate.dependencies, nextState)) continue;
      const ready: OpsWorkItem = { ...candidate, state: 'ready', updated_at: at, last_state_reason: `dependencies satisfied after ${id}` };
      appendEvent(path, 'work_upsert', ready, opts.now);
      unblocked.push(ready);
    }
  }
  return { ok: true, work_item: updatedItem, run: updatedRun, released_lease: released, artifacts, unblocked };
}

function runStatusForCompletion(status: OpsCompletion['status']): RunStatus {
  switch (status) {
    case 'succeeded': return 'succeeded';
    case 'cancelled': return 'cancelled';
    default: return 'failed';
  }
}

function normalizeArtifact(input: NonNullable<OpsCompletion['artifacts']>[number], workItemId: string, runId?: string, now?: Date): OpsArtifact {
  const basis = { workItemId, runId, kind: input.kind, path: input.path || null, ref: input.ref || null, hash: input.hash || null };
  return {
    id: hashId('artifact', basis),
    run_id: runId,
    work_item_id: workItemId,
    kind: input.kind,
    path: input.path ?? undefined,
    ref: input.ref ?? undefined,
    hash: input.hash,
    summary: input.summary,
    metadata: input.metadata || {},
    created_at: nowIso(now),
  };
}

export function auditOps(opts: OpsStoreOptions = {}): { ok: true; status: 'green' | 'amber' | 'red'; path: string; counts: ReturnType<typeof countOps>; alerts: OpsAuditAlert[]; tick: OpsSupervisorTick } {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const state = readOpsState(path);
  const counts = countOps(state, opts.now);
  const alerts: OpsAuditAlert[] = [];
  const ready = state.work_items.filter(w => w.state === 'ready');
  const active = state.work_items.filter(w => activeState(w.state));
  const activeLeases = state.leases.filter(l => l.lease_status === 'active');
  if (ready.length > 0 && active.length === 0 && activeLeases.length === 0) {
    alerts.push({ kind: 'no_idle', severity: 'red', message: 'Ready approved work exists but no work item is active/running and no active lease exists.', work_item_ids: ready.map(w => w.id) });
  }
  const staleLeases = activeLeases.filter(l => Date.parse(l.expires_at) <= (opts.now?.getTime() || Date.now()));
  if (staleLeases.length) alerts.push({ kind: 'stale_active_lease', severity: 'amber', message: 'Active leases have expired and need supervisor inspection.', lease_ids: staleLeases.map(l => l.id), work_item_ids: staleLeases.map(l => l.work_item_id) });
  const blocked = state.work_items.filter(w => w.state === 'blocked');
  if (blocked.length) alerts.push({ kind: 'blocked_work', severity: 'amber', message: 'Blocked work exists.', work_item_ids: blocked.map(w => w.id) });
  const waiting = state.work_items.filter(w => w.state === 'waiting_human');
  if (waiting.length) alerts.push({ kind: 'waiting_human', severity: 'amber', message: 'Work is waiting for human input.', work_item_ids: waiting.map(w => w.id) });
  const status: 'green' | 'amber' | 'red' = alerts.some(a => a.severity === 'red') ? 'red' : alerts.length ? 'amber' : 'green';
  const tick: OpsSupervisorTick = {
    id: nextNumericId(state.supervisor_ticks),
    tick_at: nowIso(opts.now),
    status,
    ready_count: counts.work_items.ready || 0,
    running_count: (counts.work_items.running || 0) + (counts.work_items.leased || 0),
    blocked_count: counts.work_items.blocked || 0,
    waiting_human_count: counts.work_items.waiting_human || 0,
    spawned_count: 0,
    alerts,
    decisions: [],
  };
  appendEvent(path, 'supervisor_tick', tick, opts.now);
  return { ok: true, status, path, counts, alerts, tick };
}

function nextNumericId<T extends { id: number }>(rows: T[]): number { return rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1; }

export function countOps(state: OpsState, now?: Date): {
  programs: Record<string, number>;
  work_items: Record<string, number>;
  runs: Record<string, number>;
  leases: Record<string, number>;
  artifacts: number;
  supervisor_ticks: number;
  interrupts: Record<string, number>;
  budget_ledger: number;
  active_count: number;
  ready_count: number;
  stale_active_lease_count: number;
} {
  const by = <T>(rows: T[], get: (row: T) => string | undefined): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const row of rows) out[get(row) || 'unknown'] = (out[get(row) || 'unknown'] || 0) + 1;
    return out;
  };
  const nowMs = now?.getTime() || Date.now();
  const activeLeases = state.leases.filter(l => l.lease_status === 'active');
  return {
    programs: by(state.programs, p => p.status),
    work_items: by(state.work_items, w => w.state),
    runs: by(state.runs, r => r.status),
    leases: by(state.leases, l => l.lease_status),
    artifacts: state.artifacts.length,
    supervisor_ticks: state.supervisor_ticks.length,
    interrupts: by(state.interrupts, i => i.status),
    budget_ledger: state.budget_ledger.length,
    active_count: state.work_items.filter(w => activeState(w.state)).length,
    ready_count: state.work_items.filter(w => w.state === 'ready').length,
    stale_active_lease_count: activeLeases.filter(l => Date.parse(l.expires_at) <= nowMs).length,
  };
}

export function opsStatus(opts: OpsStoreOptions = {}): { ok: true; initialized: boolean; path: string; counts: ReturnType<typeof countOps>; latest_tick?: OpsSupervisorTick } {
  const path = opts.path || opsStorePath();
  const initialized = existsSync(path);
  const state = readOpsState(path);
  return { ok: true, initialized, path, counts: countOps(state, opts.now), latest_tick: state.supervisor_ticks.at(-1) };
}
