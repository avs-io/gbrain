import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

import { configDir } from '../config.ts';

export const OPS_KERNEL_SCHEMA = 'gbrain.ops.kernel.v1';
export const OPS_EVENT_SCHEMA = 'gbrain.ops.event.v1';
export const OPS_COMPLETION_SCHEMA = 'gbrain.ops.completion.v1';
export const OPS_WORK_PACK_SCHEMA = 'gbrain.ops.work_pack.v1';
export const OPS_DISPATCH_PACKET_SCHEMA = 'gbrain.ops.openclaw_dispatch_packet.v1';
export const OPS_ROADMAP_FLOW_SCHEMA = 'gbrain.ops.roadmap_flow.v1';
export const OPS_ROADMAP_STATUS_SCHEMA = 'gbrain.ops.roadmap_status.v1';

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
  lanes?: string[];
  worker_kind: WorkerKind;
  privacy_tier: PrivacyTier;
  source_refs: unknown[];
  dependencies: string[];
  acceptance_criteria: unknown[];
  expected_artifacts: unknown[];
  guardrails?: unknown[];
  approval_gates?: unknown[];
  budget: Record<string, unknown>;
  roadmap_flow_id?: string;
  roadmap_step_id?: string;
  auto_advance?: Record<string, unknown>;
  not_before?: string;
  deadline_at?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_state_reason?: string;
}

export interface OpsRoadmapFlow {
  schema: typeof OPS_ROADMAP_FLOW_SCHEMA;
  id: string;
  program_id: string;
  title: string;
  goal: string;
  source_file?: string;
  work_item_ids: string[];
  auto_advance: boolean;
  approval_required_before: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
  completion_path?: string;
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
  claimed_count?: number;
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
  roadmap_flows: OpsRoadmapFlow[];
  runs: OpsWorkRun[];
  leases: OpsLease[];
  artifacts: OpsArtifact[];
  supervisor_ticks: OpsSupervisorTick[];
  interrupts: OpsInterrupt[];
  budget_ledger: OpsBudgetLedgerEntry[];
}

export interface OpsCompletion {
  work_item_id: string;
  program_id: string;
  status: Extract<WorkItemState, 'succeeded' | 'failed' | 'blocked' | 'waiting_human' | 'cancelled' | 'quarantined'>;
  summary: string;
  artifacts: Array<{ kind: string; path?: string | null; ref?: string | null; hash?: string; summary?: string; metadata?: Record<string, unknown> }>;
  checks_run: Array<string | Record<string, unknown>>;
  next_work_recommendations: unknown[];
  requires_human: boolean;
  continuation: Record<string, unknown>;
  provider?: string;
  model?: string;
  token_usage?: Record<string, unknown>;
  cost?: Record<string, unknown>;
  output_path?: string;
  error?: string;
}

export interface OpsAuditAlert {
  kind: 'no_idle' | 'blocked_work' | 'waiting_human' | 'stale_active_lease' | 'dispatch_failed' | 'completion_missing';
  severity: 'info' | 'amber' | 'red';
  message: string;
  work_item_ids?: string[];
  lease_ids?: string[];
}

export interface OpsWorkPack {
  schema: typeof OPS_WORK_PACK_SCHEMA;
  generated_at: string;
  work_item: Pick<OpsWorkItem, 'id' | 'program_id' | 'title' | 'description' | 'state' | 'lane' | 'worker_kind' | 'privacy_tier' | 'priority' | 'created_at' | 'updated_at'>;
  program?: Pick<OpsProgram, 'id' | 'title' | 'objective' | 'status' | 'priority' | 'approval_gates' | 'autonomy'>;
  source_refs: unknown[];
  dependencies: {
    required: string[];
    resolved: Array<{ id: string; state: WorkItemState; title: string }>;
    pending: Array<{ id: string; state?: WorkItemState; title?: string }>;
  };
  acceptance_criteria: unknown[];
  expected_artifacts: unknown[];
  guardrails: {
    privacy_tier: PrivacyTier;
    internal_only: true;
    approval_gates: unknown[];
    work_item_guardrails: unknown[];
    program_autonomy?: Record<string, unknown>;
  };
  completion_contract: ReturnType<typeof completionContract>;
}

export type OpenClawDispatchRuntime = 'openclaw_subagent' | 'openclaw_acp_codex' | 'local_script_placeholder';

export interface OpsDispatchPacket {
  schema: typeof OPS_DISPATCH_PACKET_SCHEMA;
  id: string;
  generated_at: string;
  dry_run: boolean;
  live_dispatch_enabled: boolean;
  work_item_id: string;
  run_id: string;
  lease_id?: string;
  worker_kind: WorkerKind;
  runtime: OpenClawDispatchRuntime;
  provider: string;
  model?: string;
  work_pack_path: string;
  command_payload: Record<string, unknown>;
  openclaw_task_id?: string;
  session_key?: string;
  session_id?: string;
}

type OpsRecordType = 'init' | 'program_upsert' | 'work_upsert' | 'roadmap_flow_upsert' | 'run_upsert' | 'lease_upsert' | 'artifact_upsert' | 'supervisor_tick' | 'interrupt_upsert' | 'budget_ledger' | 'work_state';

interface OpsEvent<T = unknown> {
  schema: typeof OPS_EVENT_SCHEMA;
  type: OpsRecordType;
  at: string;
  payload: T;
}

export interface OpsStoreOptions { path?: string; now?: Date; }

export interface ProgramSyncResult { ok: true; path: string; source_file: string; programs: OpsProgram[]; upserted_count: number; }

export interface OpsRoadmapImportResult { ok: true; schema: typeof OPS_ROADMAP_FLOW_SCHEMA; path: string; source_file?: string; flow: OpsRoadmapFlow; programs: OpsProgram[]; work_items: OpsWorkItem[]; }

export interface OpsRoadmapStatusResult {
  ok: true;
  schema: typeof OPS_ROADMAP_STATUS_SCHEMA;
  path: string;
  flow: OpsRoadmapFlow;
  current_step?: OpsWorkItem;
  steps: Array<{ id: string; title: string; state: WorkItemState; roadmap_status: 'ready' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'waiting_human' | 'cancelled' | 'quarantined' | 'approved' | 'missing'; dependencies: string[]; blocked_by: Array<{ id: string; state?: WorkItemState; reason: string }> }>;
  counts: { total: number; ready: number; running: number; succeeded: number; failed: number; blocked: number; waiting_human: number; approved: number; cancelled: number; quarantined: number; missing: number };
  next_ready_item?: OpsWorkItem;
  no_idle_health: { status: 'green' | 'amber' | 'red'; ready_count: number; running_count: number; active_count: number; message: string; recommended_action: 'none' | 'run_supervisor' | 'resolve_blocker' | 'human_input' };
  blocked_reasons: Array<{ work_item_id: string; reason: string; dependency_id?: string; dependency_state?: WorkItemState }>;
}

export interface OpsDashboardState {
  generated_at: string;
  store_path: string;
  active_programs: OpsProgram[];
  ready_backlog: OpsWorkItem[];
  running_tasks: OpsWorkItem[];
  stale_tasks: Array<{ work_item?: OpsWorkItem; lease: OpsLease }>;
  recent_completions: OpsWorkItem[];
  pending_approvals: { work_items: OpsWorkItem[]; interrupts: OpsInterrupt[] };
  budget_usage: Array<{ provider: string; model?: string; program_id?: string; calls: number; input_tokens: number; output_tokens: number; estimated_cost: number }>;
  interrupt_queue: OpsInterrupt[];
  supervisor_health: { status: 'green' | 'amber' | 'red' | 'unknown'; latest_tick?: OpsSupervisorTick; stale_active_lease_count: number; ready_count: number; running_count: number };
  counts: ReturnType<typeof countOps>;
}

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
  return { schema: OPS_KERNEL_SCHEMA, programs: [], work_items: [], roadmap_flows: [], runs: [], leases: [], artifacts: [], supervisor_ticks: [], interrupts: [], budget_ledger: [] };
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
    case 'roadmap_flow_upsert': upsertById(state.roadmap_flows, p as OpsRoadmapFlow); break;
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
  const lanes = stringArray(input.lanes);
  const at = nowIso(now);
  const created = typeof input.created_at === 'string' ? input.created_at : at;
  return {
    id,
    program_id: programId,
    title,
    description,
    state: normalizeEligibilityState(requested, dependencies, existing),
    priority: numberOr(input.priority, 50),
    lane: String(input.lane || lanes[0] || 'general'),
    lanes: lanes.length ? lanes : undefined,
    worker_kind: String(input.worker_kind || 'subagent'),
    privacy_tier: String(input.privacy_tier || 'P2'),
    source_refs: array(input.source_refs),
    dependencies,
    acceptance_criteria: array(input.acceptance_criteria),
    expected_artifacts: array(input.expected_artifacts),
    guardrails: array(input.guardrails),
    approval_gates: array(input.approval_gates),
    budget: object(input.budget),
    roadmap_flow_id: typeof input.roadmap_flow_id === 'string' ? input.roadmap_flow_id : undefined,
    roadmap_step_id: typeof input.roadmap_step_id === 'string' ? input.roadmap_step_id : undefined,
    auto_advance: isObject(input.auto_advance) ? object(input.auto_advance) : undefined,
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

export function syncProgramsFromYamlFile(file: string, opts: OpsStoreOptions = {}): ProgramSyncResult {
  const raw = readFileSync(file, 'utf8');
  const parsed = parseSimpleYaml(raw);
  if (!isObject(parsed) || !Array.isArray(parsed.programs)) throw new Error('program registry YAML must contain programs: [...]');

  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const programs = parsed.programs.map(p => normalizeProgram(p, opts.now));
  for (const program of programs) appendEvent(path, 'program_upsert', program, opts.now);
  return { ok: true, path, source_file: file, programs, upserted_count: programs.length };
}

export function parseProgramsYaml(raw: string): { programs: unknown[] } {
  const parsed = parseSimpleYaml(raw);
  if (!isObject(parsed) || !Array.isArray(parsed.programs)) throw new Error('program registry YAML must contain programs: [...]');
  return { programs: parsed.programs };
}

export function importRoadmapFile(file: string, opts: OpsStoreOptions = {}): OpsRoadmapImportResult {
  const raw = readFileSync(file, 'utf8');
  const trimmed = raw.trim();
  const parsed = trimmed.startsWith('{') || trimmed.startsWith('[') ? JSON.parse(raw) : parseSimpleYaml(raw);
  return importRoadmapPacket(parsed, { ...opts, sourceFile: file });
}

export function importRoadmapPacket(packet: unknown, opts: OpsStoreOptions & { sourceFile?: string } = {}): OpsRoadmapImportResult {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const at = nowIso(opts.now);
  const raw = unwrapRoadmapPacket(packet);
  const flowId = String(raw.flow_id || raw.id || '').trim();
  if (!flowId) throw new Error('roadmap flow requires flow_id');
  const steps = Array.isArray(raw.steps) ? raw.steps : (Array.isArray(raw.work_items) ? raw.work_items : []);
  if (!steps.length) throw new Error('roadmap flow requires steps: [...]');
  const programId = String(raw.program_id || (isObject(raw.program) ? raw.program.id : '') || `${flowId}-program`).trim();
  const autoAdvance = raw.auto_advance !== false;
  const defaultLanes = stringArray(raw.lanes);
  const defaultSourceRefs = array(raw.source_refs);
  const defaultAcceptance = array(raw.acceptance_criteria);
  const defaultArtifacts = array(raw.expected_artifacts);
  const defaultGuardrails = array(raw.guardrails);
  const defaultApprovalGates = array(raw.approval_gates);
  const workItems = steps.map((stepRaw, index) => normalizeRoadmapStep(stepRaw, {
    flowId,
    programId,
    index,
    autoAdvance,
    defaultPriority: numberOr(raw.priority, 50),
    defaultWorkerKind: String(raw.worker_kind || 'subagent'),
    defaultPrivacyTier: String(raw.privacy_tier || 'P1_PRIVATE'),
    defaultLanes,
    defaultSourceRefs,
    defaultAcceptance,
    defaultArtifacts,
    defaultGuardrails,
    defaultApprovalGates,
  }));

  const explicitPrograms = Array.isArray(raw.programs) ? raw.programs : (isObject(raw.program) ? [raw.program] : []);
  const programs = explicitPrograms.length ? explicitPrograms : [{
    id: programId,
    title: String(raw.program_title || raw.title || flowId),
    objective: String(raw.goal || raw.objective || `Execute roadmap flow ${flowId}`),
    priority: numberOr(raw.program_priority ?? raw.priority, 50),
    lanes: defaultLanes,
    autonomy: { internal_ops_only: true, roadmap_flow_id: flowId },
    approval_gates: defaultApprovalGates,
  }];
  const enqueued = enqueueWorkPacket({ programs, work_items: workItems }, { path, now: opts.now });
  const flow: OpsRoadmapFlow = {
    schema: OPS_ROADMAP_FLOW_SCHEMA,
    id: flowId,
    program_id: programId,
    title: String(raw.title || flowId),
    goal: String(raw.goal || raw.objective || `Execute roadmap flow ${flowId}`),
    source_file: opts.sourceFile,
    work_item_ids: enqueued.work_items.map(w => w.id),
    auto_advance: autoAdvance,
    approval_required_before: stringArray(raw.approval_required_before),
    metadata: object(raw.metadata),
    created_at: typeof raw.created_at === 'string' ? raw.created_at : at,
    updated_at: at,
  };
  appendEvent(path, 'roadmap_flow_upsert', flow, opts.now);
  return { ok: true, schema: OPS_ROADMAP_FLOW_SCHEMA, path, source_file: opts.sourceFile, flow, programs: enqueued.programs, work_items: enqueued.work_items };
}

function unwrapRoadmapPacket(packet: unknown): Record<string, any> {
  if (!isObject(packet)) throw new Error('roadmap packet must be an object');
  const raw = isObject(packet.roadmap) ? packet.roadmap : (isObject(packet.flow) ? packet.flow : packet);
  if (!isObject(raw)) throw new Error('roadmap packet must contain an object roadmap/flow');
  return raw;
}

function normalizeRoadmapStep(stepRaw: unknown, defaults: {
  flowId: string;
  programId: string;
  index: number;
  autoAdvance: boolean;
  defaultPriority: number;
  defaultWorkerKind: string;
  defaultPrivacyTier: string;
  defaultLanes: string[];
  defaultSourceRefs: unknown[];
  defaultAcceptance: unknown[];
  defaultArtifacts: unknown[];
  defaultGuardrails: unknown[];
  defaultApprovalGates: unknown[];
}): Record<string, unknown> {
  if (!isObject(stepRaw)) throw new Error(`roadmap step ${defaults.index + 1} must be an object`);
  const id = String(stepRaw.work_item_id || stepRaw.id || '').trim();
  if (!id) throw new Error(`roadmap step ${defaults.index + 1} requires id`);
  const lanes = stringArray(stepRaw.lanes).length ? stringArray(stepRaw.lanes) : defaults.defaultLanes;
  const dependencies = stringArray(stepRaw.dependencies || stepRaw.depends_on || stepRaw.requires);
  return {
    id,
    program_id: String(stepRaw.program_id || defaults.programId),
    title: String(stepRaw.title || id),
    description: String(stepRaw.description || stepRaw.summary || stepRaw.goal || stepRaw.title || id),
    state: typeof stepRaw.state === 'string' ? stepRaw.state : 'approved',
    priority: numberOr(stepRaw.priority, defaults.defaultPriority),
    lane: String(stepRaw.lane || lanes[0] || 'roadmap'),
    lanes,
    worker_kind: String(stepRaw.worker_kind || defaults.defaultWorkerKind),
    privacy_tier: String(stepRaw.privacy_tier || defaults.defaultPrivacyTier),
    source_refs: array(stepRaw.source_refs).length ? array(stepRaw.source_refs) : defaults.defaultSourceRefs,
    dependencies,
    acceptance_criteria: array(stepRaw.acceptance_criteria).length ? array(stepRaw.acceptance_criteria) : defaults.defaultAcceptance,
    expected_artifacts: array(stepRaw.expected_artifacts).length ? array(stepRaw.expected_artifacts) : defaults.defaultArtifacts,
    guardrails: array(stepRaw.guardrails).length ? array(stepRaw.guardrails) : defaults.defaultGuardrails,
    approval_gates: array(stepRaw.approval_gates).length ? array(stepRaw.approval_gates) : defaults.defaultApprovalGates,
    budget: object(stepRaw.budget),
    roadmap_flow_id: defaults.flowId,
    roadmap_step_id: String(stepRaw.step_id || id),
    auto_advance: isObject(stepRaw.auto_advance) ? object(stepRaw.auto_advance) : { enabled: defaults.autoAdvance, flow_id: defaults.flowId, policy: 'auto_advance_if_dependencies_satisfied', order: defaults.index },
    not_before: typeof stepRaw.not_before === 'string' ? stepRaw.not_before : undefined,
    deadline_at: typeof stepRaw.deadline_at === 'string' ? stepRaw.deadline_at : undefined,
    created_by: String(stepRaw.created_by || 'roadmap_import'),
    last_state_reason: typeof stepRaw.last_state_reason === 'string' ? stepRaw.last_state_reason : undefined,
  };
}

interface YamlLine { indent: number; text: string; line: number; }

function parseSimpleYaml(raw: string): unknown {
  const lines: YamlLine[] = raw.split(/\r?\n/).map((line, ix) => {
    const withoutComment = stripYamlComment(line);
    return { indent: withoutComment.match(/^ */)?.[0].length || 0, text: withoutComment.trim(), line: ix + 1 };
  }).filter(l => l.text.length > 0);
  if (lines.length === 0) return {};
  const [value, next] = parseYamlBlock(lines, 0, lines[0].indent);
  if (next !== lines.length) throw new Error(`unexpected YAML content at line ${lines[next]?.line || next + 1}`);
  return value;
}

function stripYamlComment(line: string): string {
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if ((ch === '"' || ch === "'") && line[i - 1] !== '\\') quote = quote === ch ? undefined : (quote || ch);
    if (ch === '#' && !quote && (i === 0 || /\s/.test(line[i - 1] || ''))) return line.slice(0, i).trimEnd();
  }
  return line;
}

function parseYamlBlock(lines: YamlLine[], index: number, indent: number): [unknown, number] {
  if (index >= lines.length) return [{}, index];
  if (lines[index].indent < indent) return [{}, index];
  if (lines[index].text.startsWith('- ')) return parseYamlArray(lines, index, indent);
  return parseYamlMap(lines, index, indent);
}

function parseYamlArray(lines: YamlLine[], index: number, indent: number): [unknown[], number] {
  const arr: unknown[] = [];
  let i = index;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.text.startsWith('- ')) break;
    const rest = line.text.slice(2).trim();
    if (!rest) {
      const [child, next] = parseYamlBlock(lines, i + 1, indent + 2);
      arr.push(child);
      i = next;
      continue;
    }
    const kv = splitYamlKeyValue(rest);
    if (kv) {
      const obj: Record<string, unknown> = {};
      obj[kv.key] = kv.value === '' ? {} : parseYamlScalar(kv.value);
      i++;
      while (i < lines.length && lines[i].indent > indent) {
        const [child, next] = parseYamlMap(lines, i, lines[i].indent);
        Object.assign(obj, child);
        i = next;
      }
      arr.push(obj);
    } else {
      arr.push(parseYamlScalar(rest));
      i++;
    }
  }
  return [arr, i];
}

function parseYamlMap(lines: YamlLine[], index: number, indent: number): [Record<string, unknown>, number] {
  const obj: Record<string, unknown> = {};
  let i = index;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;
    if (line.indent !== indent || line.text.startsWith('- ')) break;
    const kv = splitYamlKeyValue(line.text);
    if (!kv) throw new Error(`invalid YAML mapping at line ${line.line}`);
    if (kv.value === '') {
      const [child, next] = parseYamlBlock(lines, i + 1, indent + 2);
      obj[kv.key] = child;
      i = next;
    } else {
      obj[kv.key] = parseYamlScalar(kv.value);
      i++;
    }
  }
  return [obj, i];
}

function splitYamlKeyValue(text: string): { key: string; value: string } | undefined {
  const match = text.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
  return match ? { key: match[1], value: match[2] || '' } : undefined;
}

function parseYamlScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitYamlInlineArray(inner).map(parseYamlScalar);
  }
  return v;
}

function splitYamlInlineArray(inner: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if ((ch === '"' || ch === "'") && inner[i - 1] !== '\\') quote = quote === ch ? undefined : (quote || ch);
    if (ch === ',' && !quote) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function listPrograms(opts: OpsStoreOptions = {}): OpsProgram[] {
  return readOpsState(opts.path || opsStorePath()).programs.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function listWorkItems(filter: { state?: WorkItemState }, opts: OpsStoreOptions = {}): OpsWorkItem[] {
  let items = readOpsState(opts.path || opsStorePath()).work_items;
  if (filter.state) items = items.filter(w => w.state === filter.state);
  return [...items].sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export function roadmapStatus(flowId: string, opts: OpsStoreOptions = {}): OpsRoadmapStatusResult {
  const path = opts.path || opsStorePath();
  const now = opts.now || new Date();
  const state = readOpsState(path);
  const flow = state.roadmap_flows.find(f => f.id === flowId);
  if (!flow) throw new Error(`roadmap flow not found: ${flowId}`);
  const counts: OpsRoadmapStatusResult['counts'] = { total: flow.work_item_ids.length, ready: 0, running: 0, succeeded: 0, failed: 0, blocked: 0, waiting_human: 0, approved: 0, cancelled: 0, quarantined: 0, missing: 0 };
  const blockedReasons: OpsRoadmapStatusResult['blocked_reasons'] = [];
  const steps = flow.work_item_ids.map(id => {
    const item = state.work_items.find(w => w.id === id);
    if (!item) {
      counts.missing++;
      blockedReasons.push({ work_item_id: id, reason: 'work item missing from ops store' });
      return { id, title: id, state: 'blocked' as WorkItemState, roadmap_status: 'missing' as const, dependencies: [], blocked_by: [{ id, reason: 'work item missing from ops store' }] };
    }
    const blockedBy = roadmapBlockedBy(item, state);
    const roadmap_status = roadmapStepStatus(item, blockedBy);
    counts[roadmap_status]++;
    for (const dep of blockedBy) blockedReasons.push({ work_item_id: item.id, reason: dep.reason, dependency_id: dep.id, dependency_state: dep.state });
    return { id: item.id, title: item.title, state: item.state, roadmap_status, dependencies: item.dependencies, blocked_by: blockedBy };
  });
  const currentStepId = steps.find(s => s.roadmap_status !== 'succeeded')?.id;
  const currentStep = currentStepId ? state.work_items.find(w => w.id === currentStepId) : undefined;
  const flowItems = flow.work_item_ids.map(id => state.work_items.find(w => w.id === id)).filter((w): w is OpsWorkItem => !!w);
  const nextReady = [...flowItems].filter(w => w.state === 'ready').sort(sortWorkItems)[0];
  const activeFlowIds = new Set(flow.work_item_ids);
  const activeLeases = state.leases.filter(l => activeFlowIds.has(l.work_item_id) && l.lease_status === 'active' && Date.parse(l.expires_at) > now.getTime()).length;
  const activeRuns = state.runs.filter(r => activeFlowIds.has(r.work_item_id) && ACTIVE_RUN_STATUSES.has(r.status)).length;
  const runningCount = flowItems.filter(w => activeState(w.state)).length;
  const activeCount = Math.max(runningCount, activeLeases, activeRuns);
  let noIdle: OpsRoadmapStatusResult['no_idle_health'];
  if (activeCount > 0) {
    noIdle = { status: 'green', ready_count: counts.ready, running_count: runningCount, active_count: activeCount, message: 'Roadmap has active work in progress.', recommended_action: 'none' };
  } else if (nextReady) {
    noIdle = { status: 'red', ready_count: counts.ready, running_count: runningCount, active_count: activeCount, message: 'Roadmap has ready work and no active run/lease; supervisor should claim the next item.', recommended_action: 'run_supervisor' };
  } else if (counts.waiting_human > 0 || blockedReasons.some(r => r.reason.includes('human'))) {
    noIdle = { status: 'amber', ready_count: counts.ready, running_count: runningCount, active_count: activeCount, message: 'Roadmap is waiting for human approval/input before downstream auto-advance.', recommended_action: 'human_input' };
  } else if (counts.failed > 0 || counts.blocked > 0 || counts.missing > 0) {
    noIdle = { status: 'amber', ready_count: counts.ready, running_count: runningCount, active_count: activeCount, message: 'Roadmap has failed or blocked steps; downstream work must not auto-skip.', recommended_action: 'resolve_blocker' };
  } else {
    noIdle = { status: 'green', ready_count: counts.ready, running_count: runningCount, active_count: activeCount, message: nextReady ? 'Roadmap has ready work and an active worker.' : 'Roadmap has no no-idle violation.', recommended_action: 'none' };
  }
  return { ok: true, schema: OPS_ROADMAP_STATUS_SCHEMA, path, flow, current_step: currentStep, steps, counts, next_ready_item: nextReady, no_idle_health: noIdle, blocked_reasons: blockedReasons };
}

function roadmapStepStatus(item: OpsWorkItem, blockedBy: Array<{ id: string; state?: WorkItemState; reason: string }>): OpsRoadmapStatusResult['steps'][number]['roadmap_status'] {
  if (item.state === 'ready') return 'ready';
  if (item.state === 'leased' || item.state === 'running') return 'running';
  if (item.state === 'succeeded') return 'succeeded';
  if (item.state === 'failed') return 'failed';
  if (item.state === 'waiting_human') return 'waiting_human';
  if (item.state === 'cancelled') return 'cancelled';
  if (item.state === 'quarantined') return 'quarantined';
  if (item.state === 'blocked' || blockedBy.length > 0) return 'blocked';
  return 'approved';
}

function roadmapBlockedBy(item: OpsWorkItem, state: OpsState): Array<{ id: string; state?: WorkItemState; reason: string }> {
  if (item.state === 'ready' || item.state === 'running' || item.state === 'leased' || item.state === 'succeeded') return [];
  const blocked: Array<{ id: string; state?: WorkItemState; reason: string }> = [];
  for (const depId of item.dependencies) {
    const dep = state.work_items.find(w => w.id === depId);
    if (!dep) blocked.push({ id: depId, reason: `missing dependency ${depId}` });
    else if (dep.state !== 'succeeded') {
      const reason = dep.state === 'waiting_human'
        ? `waiting for human approval/input on dependency ${depId}`
        : dep.state === 'failed'
          ? `blocked by failed dependency ${depId}`
          : `waiting for dependency ${depId} (${dep.state})`;
      blocked.push({ id: depId, state: dep.state, reason });
    }
  }
  return blocked;
}

export function buildWorkPack(id: string, opts: OpsStoreOptions = {}): OpsWorkPack {
  const state = readOpsState(opts.path || opsStorePath());
  const item = state.work_items.find(w => w.id === id);
  if (!item) throw new Error(`work item not found: ${id}`);
  const program = state.programs.find(p => p.id === item.program_id);
  const dependencyRows = item.dependencies.map(depId => state.work_items.find(w => w.id === depId));
  const resolved = dependencyRows
    .filter((w): w is OpsWorkItem => !!w && w.state === 'succeeded')
    .map(w => ({ id: w.id, state: w.state, title: w.title }));
  const pending = item.dependencies
    .map(depId => state.work_items.find(w => w.id === depId) || { id: depId })
    .filter(w => !('state' in w) || w.state !== 'succeeded')
    .map(w => ('state' in w ? { id: w.id, state: w.state, title: w.title } : { id: w.id }));

  return {
    schema: OPS_WORK_PACK_SCHEMA,
    generated_at: nowIso(opts.now),
    work_item: {
      id: item.id,
      program_id: item.program_id,
      title: item.title,
      description: item.description,
      state: item.state,
      lane: item.lane,
      worker_kind: item.worker_kind,
      privacy_tier: item.privacy_tier,
      priority: item.priority,
      created_at: item.created_at,
      updated_at: item.updated_at,
    },
    program: program ? {
      id: program.id,
      title: program.title,
      objective: program.objective,
      status: program.status,
      priority: program.priority,
      approval_gates: program.approval_gates,
      autonomy: program.autonomy,
    } : undefined,
    source_refs: item.source_refs,
    dependencies: { required: item.dependencies, resolved, pending },
    acceptance_criteria: item.acceptance_criteria,
    expected_artifacts: item.expected_artifacts,
    guardrails: {
      privacy_tier: item.privacy_tier,
      internal_only: true,
      approval_gates: [...(program?.approval_gates || []), ...(item.approval_gates || [])],
      work_item_guardrails: item.guardrails || [],
      program_autonomy: program?.autonomy,
    },
    completion_contract: completionContract(item),
  };
}

export function renderWorkPackMarkdown(pack: OpsWorkPack): string {
  const lines: string[] = [];
  lines.push(`# Work Pack: ${pack.work_item.id}`);
  lines.push('');
  lines.push(`- Schema: ${pack.schema}`);
  lines.push(`- Program: ${pack.program?.title || pack.work_item.program_id} (${pack.work_item.program_id})`);
  lines.push(`- Objective: ${pack.program?.objective || 'unknown'}`);
  lines.push(`- State: ${pack.work_item.state}`);
  lines.push(`- Lane / worker: ${pack.work_item.lane} / ${pack.work_item.worker_kind}`);
  lines.push(`- Privacy tier: ${pack.work_item.privacy_tier}`);
  lines.push('');
  lines.push('## Task');
  lines.push(pack.work_item.description);
  lines.push('');
  lines.push('## Dependencies');
  lines.push(pack.dependencies.required.length ? pack.dependencies.required.map(id => `- ${id}`).join('\n') : '- none');
  lines.push('');
  lines.push('## Acceptance criteria');
  lines.push(pack.acceptance_criteria.length ? pack.acceptance_criteria.map(v => `- ${formatPackValue(v)}`).join('\n') : '- none listed');
  lines.push('');
  lines.push('## Expected artifacts');
  lines.push(pack.expected_artifacts.length ? pack.expected_artifacts.map(v => `- ${formatPackValue(v)}`).join('\n') : '- none listed');
  lines.push('');
  lines.push('## Guardrails / approval gates');
  lines.push(`- Internal-only ops state: ${pack.guardrails.internal_only}`);
  lines.push(`- Approval gates: ${pack.guardrails.approval_gates.length ? pack.guardrails.approval_gates.map(formatPackValue).join('; ') : 'none listed'}`);
  lines.push(`- Work item guardrails: ${pack.guardrails.work_item_guardrails.length ? pack.guardrails.work_item_guardrails.map(formatPackValue).join('; ') : 'none listed'}`);
  lines.push('');
  lines.push('## Completion contract');
  lines.push('Submit JSON only. Required fields:');
  for (const field of pack.completion_contract.required) lines.push(`- ${field}`);
  lines.push('');
  lines.push('Allowed statuses: ' + pack.completion_contract.status_enum.join(', '));
  return lines.join('\n');
}

function formatPackValue(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function completionContract(item?: OpsWorkItem) {
  return {
    schema: OPS_COMPLETION_SCHEMA,
    required: ['work_item_id', 'program_id', 'status', 'summary', 'artifacts', 'checks_run', 'next_work_recommendations', 'requires_human', 'continuation'],
    status_enum: ['succeeded', 'failed', 'blocked', 'waiting_human', 'cancelled', 'quarantined'] as const,
    instructions: [
      'Return machine-readable JSON only; prose-only completion is invalid and will not mutate state.',
      'Set status=succeeded only when every acceptance criterion is satisfied and checks/artifacts are recorded.',
      'Set requires_human=true only with status=waiting_human or status=blocked, and explain the human decision/input in continuation.',
      'next_work_recommendations are parsed and persisted for review; they are not auto-executed or enqueued.',
    ],
    json_schema: {
      type: 'object',
      additionalProperties: true,
      required: ['work_item_id', 'program_id', 'status', 'summary', 'artifacts', 'checks_run', 'next_work_recommendations', 'requires_human', 'continuation'],
      properties: {
        work_item_id: { type: 'string', const: item?.id },
        program_id: { type: 'string', const: item?.program_id },
        status: { type: 'string', enum: ['succeeded', 'failed', 'blocked', 'waiting_human', 'cancelled', 'quarantined'] },
        summary: { type: 'string', minLength: 3 },
        artifacts: { type: 'array', items: { type: 'object', required: ['kind'] } },
        checks_run: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object' }] } },
        next_work_recommendations: { type: 'array' },
        requires_human: { type: 'boolean' },
        continuation: { type: 'object' },
      },
    },
    example: {
      work_item_id: item?.id || '<work_item_id>',
      program_id: item?.program_id || '<program_id>',
      status: 'succeeded',
      summary: 'Completed acceptance criteria and verified gates.',
      artifacts: [{ kind: 'commit', ref: '<commit_sha>' }],
      checks_run: ['bun test <targeted-test>'],
      next_work_recommendations: [],
      requires_human: false,
      continuation: { notes: 'No follow-up required.' },
    },
  };
}

export interface OpsDispatchOptions extends OpsStoreOptions {
  dryRun?: boolean;
  allowLive?: boolean;
  workerId?: string;
  leaseMinutes?: number;
  provider?: string;
  model?: string;
  openclawTaskId?: string;
  sessionKey?: string;
  sessionId?: string;
  simulateFailure?: boolean;
  failureMessage?: string;
}

export interface OpsDispatchResult {
  ok: true;
  path: string;
  work_item: OpsWorkItem;
  lease?: OpsLease;
  run: OpsWorkRun;
  dispatch_packet: OpsDispatchPacket;
  packet_path: string;
  work_pack_path: string;
  interrupt?: OpsInterrupt;
  artifact: OpsArtifact;
}

export function dispatchWorkItem(id: string, opts: OpsDispatchOptions = {}): OpsDispatchResult {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const now = opts.now || new Date();
  const at = nowIso(now);
  const dryRun = opts.dryRun !== false;
  const live = opts.allowLive === true && dryRun === false;
  let state = readOpsState(path);
  let item = state.work_items.find(w => w.id === id);
  if (!item) throw new Error(`work item not found: ${id}`);
  if (!['ready', 'running', 'leased'].includes(item.state)) throw new Error(`work item ${id} is not dispatchable (state=${item.state})`);

  let claimed: ReturnType<typeof claimWorkItem> | undefined;
  let lease: OpsLease | undefined;
  let run: OpsWorkRun | undefined;
  if (item.state === 'ready') {
    const initialPlan = openClawRuntimePlan(item, opts);
    claimed = claimWorkItem(id, opts.workerId || `openclaw-dispatch-${initialPlan.runtime}`, { path, now, leaseMinutes: opts.leaseMinutes || 60, runtime: initialPlan.runtime, runStatus: 'starting' });
    item = claimed.work_item;
    lease = claimed.lease;
    run = claimed.run;
  } else {
    lease = state.leases.find(l => l.work_item_id === id && l.lease_status === 'active');
    run = (lease?.run_id ? state.runs.find(r => r.id === lease?.run_id) : undefined) || state.runs.filter(r => r.work_item_id === id).at(-1);
    if (!run) throw new Error(`work item ${id} has no run to dispatch`);
  }

  state = readOpsState(path);
  item = state.work_items.find(w => w.id === id) || item;
  run = state.runs.find(r => r.id === run!.id) || run;
  const plan = openClawRuntimePlan(item, opts);
  const workPackPath = persistWorkPackMarkdown(path, buildWorkPack(id, { path, now }));
  const packet: OpsDispatchPacket = {
    schema: OPS_DISPATCH_PACKET_SCHEMA,
    id: hashId('dispatch', { work_item_id: id, run_id: run.id, runtime: plan.runtime }),
    generated_at: at,
    dry_run: dryRun,
    live_dispatch_enabled: live,
    work_item_id: id,
    run_id: run.id,
    lease_id: lease?.id,
    worker_kind: item.worker_kind,
    runtime: plan.runtime,
    provider: plan.provider,
    model: plan.model,
    work_pack_path: workPackPath,
    command_payload: plan.command_payload,
    openclaw_task_id: opts.openclawTaskId,
    session_key: opts.sessionKey,
    session_id: opts.sessionId,
  };
  const packetPath = persistDispatchPacket(path, packet);

  if (opts.simulateFailure) {
    const message = opts.failureMessage || 'simulated OpenClaw dispatch failure';
    const failedRun: OpsWorkRun = { ...run, runtime: plan.runtime, provider: plan.provider, model: plan.model, openclaw_task_id: opts.openclawTaskId || run.openclaw_task_id, session_key: opts.sessionKey || run.session_key, session_id: opts.sessionId || run.session_id, input_pack_path: workPackPath, output_path: packetPath, status: 'failed', ended_at: at, last_event_at: at, error: message };
    appendEvent(path, 'run_upsert', failedRun, now);
    if (lease) appendEvent(path, 'lease_upsert', { ...lease, lease_status: 'released', released_at: at, heartbeat_at: at }, now);
    const blocked: OpsWorkItem = { ...item, state: 'blocked', updated_at: at, last_state_reason: `dispatch failed: ${message}` };
    appendEvent(path, 'work_upsert', blocked, now);
    const interrupt = dispatchFailureInterrupt(blocked, failedRun, message, now);
    appendEvent(path, 'interrupt_upsert', interrupt, now);
    const artifact = dispatchArtifact(packet, packetPath, blocked.id, failedRun.id, now, true);
    appendEvent(path, 'artifact_upsert', artifact, now);
    return { ok: true, path, work_item: blocked, lease, run: failedRun, dispatch_packet: packet, packet_path: packetPath, work_pack_path: workPackPath, interrupt, artifact };
  }

  const updatedRun: OpsWorkRun = {
    ...run,
    runtime: plan.runtime,
    provider: plan.provider,
    model: plan.model,
    openclaw_task_id: opts.openclawTaskId || run.openclaw_task_id,
    session_key: opts.sessionKey || run.session_key,
    session_id: opts.sessionId || run.session_id,
    input_pack_path: workPackPath,
    output_path: packetPath,
    status: 'running',
    last_event_at: at,
  };
  appendEvent(path, 'run_upsert', updatedRun, now);
  const artifact = dispatchArtifact(packet, packetPath, item.id, updatedRun.id, now, false);
  appendEvent(path, 'artifact_upsert', artifact, now);
  return { ok: true, path, work_item: item, lease, run: updatedRun, dispatch_packet: packet, packet_path: packetPath, work_pack_path: workPackPath, artifact };
}

function openClawRuntimePlan(item: OpsWorkItem, opts: OpsDispatchOptions): { runtime: OpenClawDispatchRuntime; provider: string; model?: string; command_payload: Record<string, unknown> } {
  const kind = String(item.worker_kind || '').toLowerCase();
  const budget = object(item.budget);
  const model = opts.model || (typeof budget.model === 'string' ? budget.model : undefined);
  if (['subagent', 'native_subagent', 'openclaw_subagent'].includes(kind)) {
    const provider = opts.provider || 'openclaw';
    return {
      runtime: 'openclaw_subagent',
      provider,
      model: model || 'native-subagent',
      command_payload: {
        tool: 'sessions_spawn',
        mode: opts.dryRun === false && opts.allowLive === true ? 'live_opt_in' : 'dry_run',
        label: item.id,
        task: item.description,
        work_pack: `ops/work-packs/${sanitizePathPart(item.id)}.md`,
      },
    };
  }
  if (['acp_codex', 'codex', 'acp', 'claude_code'].includes(kind)) {
    const provider = opts.provider || (kind === 'claude_code' ? 'claude-code' : 'codex');
    return {
      runtime: 'openclaw_acp_codex',
      provider,
      model: model || (provider === 'claude-code' ? 'claude-code/default' : 'openai-codex/default'),
      command_payload: {
        tool: 'acp_session',
        mode: opts.dryRun === false && opts.allowLive === true ? 'live_opt_in' : 'dry_run',
        runtime: provider,
        work_item_id: item.id,
        prompt_file: `ops/work-packs/${sanitizePathPart(item.id)}.md`,
      },
    };
  }
  const provider = opts.provider || (typeof budget.provider === 'string' ? budget.provider : 'local');
  return {
    runtime: 'local_script_placeholder',
    provider,
    model,
    command_payload: {
      tool: 'local_script_placeholder',
      mode: 'dry_run',
      work_item_id: item.id,
      command: `gbrain ops work pack --id ${shellQuote(item.id)}`,
    },
  };
}

function persistWorkPackMarkdown(storePath: string, pack: OpsWorkPack): string {
  const dir = join(dirname(storePath), 'work-packs');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sanitizePathPart(pack.work_item.id)}.md`);
  writeFileSync(path, renderWorkPackMarkdown(pack) + '\n', { mode: 0o600 });
  return path;
}

function persistDispatchPacket(storePath: string, packet: OpsDispatchPacket): string {
  const dir = join(dirname(storePath), 'runs', sanitizePathPart(packet.run_id));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'dispatch.json');
  writeFileSync(path, JSON.stringify(packet, null, 2) + '\n', { mode: 0o600 });
  return path;
}

function dispatchArtifact(packet: OpsDispatchPacket, packetPath: string, workItemId: string, runId: string, now: Date, failed: boolean): OpsArtifact {
  return {
    id: hashId('artifact', { kind: 'openclaw_dispatch_packet', runId, packetPath }),
    run_id: runId,
    work_item_id: workItemId,
    kind: 'openclaw_dispatch_packet',
    path: packetPath,
    summary: failed ? 'OpenClaw dispatch failure packet recorded.' : 'OpenClaw dispatch packet recorded.',
    metadata: { schema: packet.schema, runtime: packet.runtime, dry_run: packet.dry_run, provider: packet.provider, model: packet.model, openclaw_task_id: packet.openclaw_task_id, session_key: packet.session_key },
    created_at: nowIso(now),
  };
}

function dispatchFailureInterrupt(item: OpsWorkItem, run: OpsWorkRun, message: string, now: Date): OpsInterrupt {
  return {
    id: hashId('interrupt', { kind: 'dispatch_failed', work_item_id: item.id, run_id: run.id, message }),
    severity: 'high',
    program_id: item.program_id,
    work_item_id: item.id,
    title: `OpenClaw dispatch failed for ${item.id}`,
    body: message,
    proposed_action: 'Inspect the recorded dispatch packet and unblock or retry the work item.',
    requires_human: false,
    status: 'new',
    created_at: nowIso(now),
  };
}

function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'"'"'`)}'`;
}

export function claimWorkItem(id: string, workerId: string, opts: OpsStoreOptions & { leaseMinutes?: number; runtime?: string; runStatus?: RunStatus } = {}): { ok: true; work_item: OpsWorkItem; lease: OpsLease; run: OpsWorkRun } {
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
    runtime: opts.runtime || item.worker_kind,
    status: opts.runStatus || 'running',
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
  if (typeof input.program_id !== 'string' || !input.program_id.trim()) errors.push('program_id is required');
  if (item && input.program_id !== item.program_id) errors.push(`program_id must match ${item.program_id}`);
  if (!terminal.includes(String(input.status))) errors.push(`status must be one of: ${terminal.join(', ')}`);
  if (typeof input.summary !== 'string' || input.summary.trim().length < 3) errors.push('summary must be a non-empty string');
  if (!Array.isArray(input.artifacts)) errors.push('artifacts is required and must be an array');
  if (Array.isArray(input.artifacts)) {
    input.artifacts.forEach((a: unknown, idx: number) => {
      if (!isObject(a)) errors.push(`artifacts[${idx}] must be an object`);
      else if (typeof a.kind !== 'string' || !a.kind.trim()) errors.push(`artifacts[${idx}].kind is required`);
    });
  }
  if (!Array.isArray(input.checks_run)) errors.push('checks_run is required and must be an array');
  if (Array.isArray(input.checks_run)) {
    input.checks_run.forEach((check: unknown, idx: number) => {
      if (typeof check === 'string') {
        if (!check.trim()) errors.push(`checks_run[${idx}] must be non-empty`);
      } else if (!isObject(check)) errors.push(`checks_run[${idx}] must be a string or object`);
    });
  }
  if (!Array.isArray(input.next_work_recommendations)) errors.push('next_work_recommendations is required and must be an array');
  if (typeof input.requires_human !== 'boolean') errors.push('requires_human is required and must be a boolean');
  if (!isObject(input.continuation)) errors.push('continuation is required and must be an object');
  if (input.status === 'waiting_human' && input.requires_human !== true) errors.push('waiting_human completions require requires_human=true');
  if (input.requires_human === true && !['waiting_human', 'blocked'].includes(String(input.status))) errors.push('requires_human=true requires status waiting_human or blocked');
  return errors;
}

export function completeWorkItem(id: string, completion: unknown, opts: OpsStoreOptions = {}): { ok: true; work_item: OpsWorkItem; run?: OpsWorkRun; released_lease?: OpsLease; artifacts: OpsArtifact[]; unblocked: OpsWorkItem[]; completion_path: string } {
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
  const completionPath = persistCompletionJson(path, c, run?.id, id);
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
      completion_path: completionPath,
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
      if (candidate.state !== 'approved' && !(candidate.state === 'blocked' && isRoadmapAutoAdvanceItem(candidate))) continue;
      if (!candidate.dependencies.includes(id)) continue;
      if (!depsSatisfied(candidate.dependencies, nextState)) continue;
      const ready: OpsWorkItem = { ...candidate, state: 'ready', updated_at: at, last_state_reason: `dependencies satisfied after ${id}` };
      appendEvent(path, 'work_upsert', ready, opts.now);
      unblocked.push(ready);
    }
  } else if (c.status === 'failed' || c.status === 'waiting_human') {
    for (const candidate of nextState.work_items) {
      if (!isRoadmapAutoAdvanceItem(candidate)) continue;
      if (!candidate.dependencies.includes(id)) continue;
      if (terminalState(candidate.state) || activeState(candidate.state)) continue;
      const reason = c.status === 'waiting_human'
        ? `roadmap auto-advance blocked: waiting for human approval/input on dependency ${id}`
        : `roadmap auto-advance blocked: dependency ${id} failed`;
      const blocked: OpsWorkItem = { ...candidate, state: 'blocked', updated_at: at, last_state_reason: reason };
      appendEvent(path, 'work_upsert', blocked, opts.now);
    }
  }
  return { ok: true, work_item: updatedItem, run: updatedRun, released_lease: released, artifacts, unblocked, completion_path: completionPath };
}

function isRoadmapAutoAdvanceItem(item: OpsWorkItem): boolean {
  if (item.auto_advance?.enabled === false) return false;
  if (item.roadmap_flow_id) return true;
  return !!item.auto_advance;
}

export interface OpsOpenClawObservedTask {
  id?: string;
  task_id?: string;
  openclaw_task_id?: string;
  session_key?: string;
  session_id?: string;
  run_id?: string;
  work_item_id?: string;
  status?: string;
  state?: string;
  provider?: string;
  model?: string;
  error?: string;
  completion_json?: unknown;
  completion?: unknown;
}

export interface OpsReconcileResult {
  ok: true;
  path: string;
  observed_count: number;
  updates: Array<{ run_id: string; work_item_id: string; observed_status: string; run_status: RunStatus; completion_accepted: boolean; work_item_state: WorkItemState; alert?: OpsInterrupt }>;
}

export function reconcileOpenClawTasks(input: unknown, opts: OpsStoreOptions = {}): OpsReconcileResult {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const now = opts.now || new Date();
  const at = nowIso(now);
  const observed = normalizeObservedTasks(input);
  const updates: OpsReconcileResult['updates'] = [];

  for (const task of observed) {
    const state = readOpsState(path);
    const run = findRunForObservedTask(state, task);
    if (!run) continue;
    const item = state.work_items.find(w => w.id === run.work_item_id);
    if (!item) continue;
    const observedStatus = String(task.status || task.state || 'unknown');
    const mapped = runStatusFromObserved(observedStatus);
    const completion = task.completion_json ?? task.completion;

    if (mapped === 'succeeded') {
      const completionErrors = validateCompletion(completion, item);
      if (completionErrors.length === 0) {
        const accepted = completeWorkItem(item.id, completion, { path, now });
        updates.push({ run_id: accepted.run?.id || run.id, work_item_id: item.id, observed_status: observedStatus, run_status: accepted.run?.status || 'succeeded', completion_accepted: true, work_item_state: accepted.work_item.state });
        continue;
      }
      const updatedRun: OpsWorkRun = {
        ...run,
        status: 'succeeded',
        provider: task.provider || run.provider,
        model: task.model || run.model,
        openclaw_task_id: task.openclaw_task_id || task.task_id || task.id || run.openclaw_task_id,
        session_key: task.session_key || run.session_key,
        session_id: task.session_id || run.session_id,
        ended_at: at,
        last_event_at: at,
        error: `OpenClaw reported success but completion JSON was missing or invalid: ${completionErrors.join('; ')}`,
      };
      appendEvent(path, 'run_upsert', updatedRun, now);
      const interrupt = completionMissingInterrupt(item, updatedRun, updatedRun.error || 'completion missing', now);
      appendEvent(path, 'interrupt_upsert', interrupt, now);
      updates.push({ run_id: run.id, work_item_id: item.id, observed_status: observedStatus, run_status: 'succeeded', completion_accepted: false, work_item_state: item.state, alert: interrupt });
      continue;
    }

    const terminalFailure = ['failed', 'timed_out', 'lost', 'cancelled'].includes(mapped);
    const updatedRun: OpsWorkRun = {
      ...run,
      status: mapped,
      provider: task.provider || run.provider,
      model: task.model || run.model,
      openclaw_task_id: task.openclaw_task_id || task.task_id || task.id || run.openclaw_task_id,
      session_key: task.session_key || run.session_key,
      session_id: task.session_id || run.session_id,
      ended_at: terminalFailure ? at : run.ended_at,
      last_event_at: at,
      error: task.error || run.error,
    };
    appendEvent(path, 'run_upsert', updatedRun, now);
    let workItemState = item.state;
    let interrupt: OpsInterrupt | undefined;
    if (terminalFailure) {
      const failedItem: OpsWorkItem = { ...item, state: mapped === 'cancelled' ? 'cancelled' : 'failed', updated_at: at, last_state_reason: task.error || `OpenClaw task reconciled as ${mapped}` };
      appendEvent(path, 'work_upsert', failedItem, now);
      const activeLease = state.leases.find(l => l.work_item_id === item.id && l.lease_status === 'active');
      if (activeLease) appendEvent(path, 'lease_upsert', { ...activeLease, lease_status: 'released', released_at: at, heartbeat_at: at }, now);
      workItemState = failedItem.state;
      interrupt = dispatchFailureInterrupt(failedItem, updatedRun, task.error || `OpenClaw task reconciled as ${mapped}`, now);
      appendEvent(path, 'interrupt_upsert', interrupt, now);
    }
    updates.push({ run_id: run.id, work_item_id: item.id, observed_status: observedStatus, run_status: mapped, completion_accepted: false, work_item_state: workItemState, alert: interrupt });
  }

  return { ok: true, path, observed_count: observed.length, updates };
}

function normalizeObservedTasks(input: unknown): OpsOpenClawObservedTask[] {
  if (Array.isArray(input)) return input.filter(isObject) as OpsOpenClawObservedTask[];
  if (!isObject(input)) throw new Error('OpenClaw task fixture must be an object or array');
  if (Array.isArray(input.tasks)) return input.tasks.filter(isObject) as OpsOpenClawObservedTask[];
  if (isObject(input.task)) return [input.task as OpsOpenClawObservedTask];
  return [input as OpsOpenClawObservedTask];
}

function findRunForObservedTask(state: OpsState, task: OpsOpenClawObservedTask): OpsWorkRun | undefined {
  const taskIds = [task.openclaw_task_id, task.task_id, task.id].filter((v): v is string => typeof v === 'string' && v.length > 0);
  return state.runs.find(r => task.run_id && r.id === task.run_id)
    || state.runs.find(r => task.work_item_id && r.work_item_id === task.work_item_id)
    || state.runs.find(r => !!r.openclaw_task_id && taskIds.includes(r.openclaw_task_id))
    || state.runs.find(r => !!r.session_key && task.session_key === r.session_key)
    || state.runs.find(r => !!r.session_id && task.session_id === r.session_id);
}

function runStatusFromObserved(raw: string): RunStatus {
  const s = raw.toLowerCase().replace(/[ -]/g, '_');
  if (['queued', 'pending'].includes(s)) return 'queued';
  if (['starting', 'dispatching'].includes(s)) return 'starting';
  if (['running', 'in_progress', 'active'].includes(s)) return 'running';
  if (['succeeded', 'success', 'completed', 'complete', 'done'].includes(s)) return 'succeeded';
  if (['failed', 'failure', 'error'].includes(s)) return 'failed';
  if (['timed_out', 'timeout', 'expired'].includes(s)) return 'timed_out';
  if (['cancelled', 'canceled'].includes(s)) return 'cancelled';
  if (['lost', 'missing', 'unknown'].includes(s)) return 'lost';
  return 'running';
}

function completionMissingInterrupt(item: OpsWorkItem, run: OpsWorkRun, message: string, now: Date): OpsInterrupt {
  return {
    id: hashId('interrupt', { kind: 'completion_missing', work_item_id: item.id, run_id: run.id, message }),
    severity: 'high',
    program_id: item.program_id,
    work_item_id: item.id,
    title: `Completion JSON missing for ${item.id}`,
    body: message,
    proposed_action: 'Recover or submit a valid ops completion JSON before marking work succeeded.',
    requires_human: false,
    status: 'new',
    created_at: nowIso(now),
  };
}

function persistCompletionJson(storePath: string, completion: OpsCompletion, runId: string | undefined, workItemId: string): string {
  const dir = join(dirname(storePath), 'runs', sanitizePathPart(runId || `work_${workItemId}`));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'completion.json');
  writeFileSync(path, JSON.stringify(completion, null, 2) + '\n', { mode: 0o600 });
  return path;
}

function sanitizePathPart(v: string): string {
  return v.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120) || 'unknown';
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

export interface OpsSuperviseResult {
  ok: true;
  status: 'green' | 'amber' | 'red';
  path: string;
  counts: ReturnType<typeof countOps>;
  alerts: OpsAuditAlert[];
  tick: OpsSupervisorTick;
  expired_leases: OpsLease[];
  unblocked: OpsWorkItem[];
  claimed: Array<{ work_item: OpsWorkItem; lease: OpsLease; run: OpsWorkRun }>;
  decisions: unknown[];
}

export interface OpsSuperviseOptions extends OpsStoreOptions {
  maxClaims?: number;
  maxRunning?: number;
  leaseMinutes?: number;
  workerId?: string;
}

const ACTIVE_RUN_STATUSES = new Set<RunStatus>(['queued', 'starting', 'running']);

export function superviseOps(opts: OpsSuperviseOptions = {}): OpsSuperviseResult {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const now = opts.now || new Date();
  const at = nowIso(now);
  const decisions: unknown[] = [];
  const expiredLeases: OpsLease[] = [];
  const unblocked: OpsWorkItem[] = [];
  const claimed: OpsSuperviseResult['claimed'] = [];
  const maxClaims = Math.max(0, Math.floor(opts.maxClaims ?? 1));
  const maxRunning = Math.max(0, Math.floor(opts.maxRunning ?? 1));
  const workerId = opts.workerId || 'ops-supervisor-placeholder';

  let state = readOpsState(path);
  for (const lease of state.leases.filter(l => l.lease_status === 'active').sort((a, b) => a.claimed_at.localeCompare(b.claimed_at) || a.id.localeCompare(b.id))) {
    const item = state.work_items.find(w => w.id === lease.work_item_id);
    if (item && terminalState(item.state)) {
      const released: OpsLease = { ...lease, lease_status: 'released', released_at: at, heartbeat_at: at };
      appendEvent(path, 'lease_upsert', released, now);
      decisions.push({ action: 'release_terminal_lease', work_item_id: item.id, lease_id: lease.id, reason: `work item already ${item.state}` });
      continue;
    }
    if (Date.parse(lease.expires_at) > now.getTime()) {
      if (item && !activeState(item.state)) {
        const running: OpsWorkItem = { ...item, state: 'running', updated_at: at, last_state_reason: `reconciled active lease ${lease.id}` };
        appendEvent(path, 'work_upsert', running, now);
        decisions.push({ action: 'reconcile_active_lease', work_item_id: item.id, lease_id: lease.id });
      }
      continue;
    }

    const expired: OpsLease = { ...lease, lease_status: 'expired', released_at: at, heartbeat_at: at };
    appendEvent(path, 'lease_upsert', expired, now);
    expiredLeases.push(expired);
    decisions.push({ action: 'expire_stale_lease', work_item_id: lease.work_item_id, lease_id: lease.id, expired_at: at });

    const run = lease.run_id ? state.runs.find(r => r.id === lease.run_id) : undefined;
    if (run && ACTIVE_RUN_STATUSES.has(run.status)) {
      const timedOut: OpsWorkRun = { ...run, status: 'timed_out', ended_at: at, last_event_at: at, error: run.error || `lease expired at ${lease.expires_at}` };
      appendEvent(path, 'run_upsert', timedOut, now);
      decisions.push({ action: 'mark_run_timed_out', work_item_id: lease.work_item_id, run_id: run.id });
    }
    if (item && activeState(item.state)) {
      const retryState: WorkItemState = depsSatisfied(item.dependencies, state) ? 'ready' : 'approved';
      const retried: OpsWorkItem = { ...item, state: retryState, updated_at: at, last_state_reason: `lease ${lease.id} expired; returned to ${retryState}` };
      appendEvent(path, 'work_upsert', retried, now);
      decisions.push({ action: 'return_expired_work_to_backlog', work_item_id: item.id, state: retryState });
    }
  }

  state = readOpsState(path);
  for (const item of [...state.work_items].sort(sortWorkItems)) {
    if (item.state !== 'approved' && !(item.state === 'blocked' && isRoadmapAutoAdvanceItem(item))) continue;
    if (!depsSatisfied(item.dependencies, state)) continue;
    const ready: OpsWorkItem = { ...item, state: 'ready', updated_at: at, last_state_reason: 'dependencies satisfied during supervisor tick' };
    appendEvent(path, 'work_upsert', ready, now);
    unblocked.push(ready);
    decisions.push({ action: 'unblock_dependencies_satisfied', work_item_id: item.id, dependencies: item.dependencies });
  }

  state = readOpsState(path);
  const runningCount = activeWorkCount(state, now);
  const availableSlots = Math.max(0, maxRunning - runningCount);
  const claimLimit = Math.min(maxClaims, availableSlots);
  if (claimLimit <= 0) {
    decisions.push({ action: 'claim_skipped', reason: availableSlots <= 0 ? 'capacity_full' : 'max_claims_zero', max_running: maxRunning, running_count: runningCount });
  } else {
    const candidates = readyClaimCandidates(state, now);
    for (const item of candidates.slice(0, claimLimit)) {
      const result = claimWorkItem(item.id, workerId, { path, now, leaseMinutes: opts.leaseMinutes || 30, runtime: 'supervisor_placeholder', runStatus: 'running' });
      claimed.push(result);
      decisions.push({ action: 'claim_work_item', work_item_id: item.id, lease_id: result.lease.id, run_id: result.run.id, runtime: result.run.runtime });
    }
    if (candidates.length === 0) decisions.push({ action: 'claim_skipped', reason: 'no_ready_claim_candidates' });
  }

  state = readOpsState(path);
  const counts = countOps(state, now);
  const alerts = buildOpsAlerts(state, now);
  if (expiredLeases.length) alerts.push({ kind: 'stale_active_lease', severity: 'amber', message: 'Supervisor expired stale active leases and returned eligible work to the backlog.', lease_ids: expiredLeases.map(l => l.id), work_item_ids: expiredLeases.map(l => l.work_item_id) });
  const status: 'green' | 'amber' | 'red' = alerts.some(a => a.severity === 'red') ? 'red' : alerts.length ? 'amber' : 'green';
  const tick: OpsSupervisorTick = {
    id: nextNumericId(state.supervisor_ticks),
    tick_at: at,
    status,
    ready_count: counts.work_items.ready || 0,
    running_count: counts.active_count,
    blocked_count: counts.work_items.blocked || 0,
    waiting_human_count: counts.work_items.waiting_human || 0,
    spawned_count: 0,
    claimed_count: claimed.length,
    alerts,
    decisions,
  };
  appendEvent(path, 'supervisor_tick', tick, now);
  return { ok: true, status, path, counts, alerts, tick, expired_leases: expiredLeases, unblocked, claimed, decisions };
}

function readyClaimCandidates(state: OpsState, now: Date): OpsWorkItem[] {
  const activeProgramIds = new Set(state.programs.filter(p => p.status === 'active').map(p => p.id));
  const hasPrograms = state.programs.length > 0;
  return [...state.work_items]
    .filter(w => w.state === 'ready')
    .filter(w => !w.not_before || Date.parse(w.not_before) <= now.getTime())
    .filter(w => !hasPrograms || activeProgramIds.has(w.program_id))
    .filter(w => !state.leases.some(l => l.work_item_id === w.id && l.lease_status === 'active' && Date.parse(l.expires_at) > now.getTime()))
    .sort((a, b) => {
      const pa = state.programs.find(p => p.id === a.program_id)?.priority || 0;
      const pb = state.programs.find(p => p.id === b.program_id)?.priority || 0;
      return b.priority - a.priority || pb - pa || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
    });
}

function activeRunCount(state: OpsState): number {
  return state.runs.filter(r => ACTIVE_RUN_STATUSES.has(r.status)).length;
}

function activeWorkCount(state: OpsState, now: Date): number {
  const activeValidLeaseWorkIds = new Set(state.leases.filter(l => l.lease_status === 'active' && Date.parse(l.expires_at) > now.getTime()).map(l => l.work_item_id));
  const activeRunWorkIds = new Set(state.runs.filter(r => ACTIVE_RUN_STATUSES.has(r.status)).map(r => r.work_item_id));
  return state.work_items.filter(w => activeState(w.state) || activeValidLeaseWorkIds.has(w.id) || activeRunWorkIds.has(w.id)).length;
}

function buildOpsAlerts(state: OpsState, now: Date): OpsAuditAlert[] {
  const alerts: OpsAuditAlert[] = [];
  const ready = state.work_items.filter(w => w.state === 'ready');
  const activeValidLeases = state.leases.filter(l => l.lease_status === 'active' && Date.parse(l.expires_at) > now.getTime());
  if (ready.length > 0 && activeValidLeases.length === 0 && activeRunCount(state) === 0) {
    alerts.push({ kind: 'no_idle', severity: 'red', message: 'Ready approved work exists but no active run or unexpired active lease exists.', work_item_ids: ready.map(w => w.id) });
  }
  const staleLeases = state.leases.filter(l => l.lease_status === 'active' && Date.parse(l.expires_at) <= now.getTime());
  if (staleLeases.length) alerts.push({ kind: 'stale_active_lease', severity: 'amber', message: 'Active leases have expired and need supervisor inspection.', lease_ids: staleLeases.map(l => l.id), work_item_ids: staleLeases.map(l => l.work_item_id) });
  const blocked = state.work_items.filter(w => w.state === 'blocked');
  if (blocked.length) alerts.push({ kind: 'blocked_work', severity: 'amber', message: 'Blocked work exists.', work_item_ids: blocked.map(w => w.id) });
  const waiting = state.work_items.filter(w => w.state === 'waiting_human');
  if (waiting.length) alerts.push({ kind: 'waiting_human', severity: 'amber', message: 'Work is waiting for human input.', work_item_ids: waiting.map(w => w.id) });
  return alerts;
}

export function auditOps(opts: OpsStoreOptions = {}): { ok: true; status: 'green' | 'amber' | 'red'; path: string; counts: ReturnType<typeof countOps>; alerts: OpsAuditAlert[]; tick: OpsSupervisorTick } {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const state = readOpsState(path);
  const now = opts.now || new Date();
  const counts = countOps(state, now);
  const alerts = buildOpsAlerts(state, now);
  const status: 'green' | 'amber' | 'red' = alerts.some(a => a.severity === 'red') ? 'red' : alerts.length ? 'amber' : 'green';
  const tick: OpsSupervisorTick = {
    id: nextNumericId(state.supervisor_ticks),
    tick_at: nowIso(now),
    status,
    ready_count: counts.work_items.ready || 0,
    running_count: counts.active_count,
    blocked_count: counts.work_items.blocked || 0,
    waiting_human_count: counts.work_items.waiting_human || 0,
    spawned_count: 0,
    claimed_count: 0,
    alerts,
    decisions: [],
  };
  appendEvent(path, 'supervisor_tick', tick, now);
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
  const nowDate = now || new Date();
  const nowMs = nowDate.getTime();
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
    active_count: activeWorkCount(state, nowDate),
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

export function buildOpsDashboard(opts: OpsStoreOptions = {}): OpsDashboardState {
  const path = opts.path || opsStorePath();
  const state = readOpsState(path);
  const now = opts.now || new Date();
  const nowMs = now.getTime();
  const counts = countOps(state, now);
  const activeLeases = state.leases.filter(l => l.lease_status === 'active');
  const staleTasks = activeLeases
    .filter(l => Date.parse(l.expires_at) <= nowMs)
    .map(lease => ({ lease, work_item: state.work_items.find(w => w.id === lease.work_item_id) }));
  const latestTick = state.supervisor_ticks.at(-1);
  const openInterrupts = state.interrupts.filter(i => !['resolved', 'dismissed'].includes(i.status));
  return {
    generated_at: nowIso(now),
    store_path: path,
    active_programs: [...state.programs].filter(p => p.status === 'active').sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)),
    ready_backlog: [...state.work_items].filter(w => w.state === 'ready').sort(sortWorkItems),
    running_tasks: [...state.work_items].filter(w => activeState(w.state)).sort(sortWorkItems),
    stale_tasks: staleTasks,
    recent_completions: [...state.work_items].filter(w => w.state === 'succeeded').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 10),
    pending_approvals: {
      work_items: [...state.work_items].filter(w => w.state === 'waiting_human').sort(sortWorkItems),
      interrupts: openInterrupts.filter(i => i.requires_human).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    },
    budget_usage: summarizeBudgetUsage(state.budget_ledger),
    interrupt_queue: openInterrupts.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    supervisor_health: {
      status: latestTick?.status || 'unknown',
      latest_tick: latestTick,
      stale_active_lease_count: staleTasks.length,
      ready_count: counts.ready_count,
      running_count: counts.active_count,
    },
    counts,
  };
}

function sortWorkItems(a: OpsWorkItem, b: OpsWorkItem): number {
  return b.priority - a.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function summarizeBudgetUsage(entries: OpsBudgetLedgerEntry[]): OpsDashboardState['budget_usage'] {
  const byKey = new Map<string, OpsDashboardState['budget_usage'][number]>();
  for (const entry of entries) {
    const key = [entry.provider, entry.model || '', entry.program_id || ''].join('\t');
    const row = byKey.get(key) || { provider: entry.provider, model: entry.model, program_id: entry.program_id, calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost: 0 };
    row.calls += entry.calls || 0;
    row.input_tokens += entry.input_tokens || 0;
    row.output_tokens += entry.output_tokens || 0;
    row.estimated_cost += entry.estimated_cost || 0;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => b.calls - a.calls || a.provider.localeCompare(b.provider));
}

export function renderOpsDashboardMarkdown(dashboard: OpsDashboardState): string {
  const lines: string[] = [];
  lines.push('# Always-On Intelligence OS Dashboard');
  lines.push('');
  lines.push('<!-- MACHINE-REFRESHABLE: regenerate with `gbrain ops dashboard --markdown` after syncing the ops store. -->');
  lines.push('');
  lines.push(`Generated: ${dashboard.generated_at}`);
  lines.push(`Store: \`${dashboard.store_path}\``);
  lines.push('');
  lines.push('## Supervisor health');
  lines.push('');
  lines.push(`- Status: **${dashboard.supervisor_health.status}**`);
  lines.push(`- Latest tick: ${dashboard.supervisor_health.latest_tick?.tick_at || 'none'}`);
  lines.push(`- Ready backlog: ${dashboard.supervisor_health.ready_count}`);
  lines.push(`- Running/leased tasks: ${dashboard.supervisor_health.running_count}`);
  lines.push(`- Stale active leases: ${dashboard.supervisor_health.stale_active_lease_count}`);
  lines.push('');
  lines.push('## Active programs');
  lines.push('');
  pushProgramRows(lines, dashboard.active_programs);
  lines.push('');
  lines.push('## Ready backlog');
  lines.push('');
  pushWorkRows(lines, dashboard.ready_backlog, 'No ready work items.');
  lines.push('');
  lines.push('## Running tasks');
  lines.push('');
  pushWorkRows(lines, dashboard.running_tasks, 'No running or leased work items.');
  lines.push('');
  lines.push('## Stale tasks');
  lines.push('');
  if (!dashboard.stale_tasks.length) lines.push('- None.');
  else for (const row of dashboard.stale_tasks) lines.push(`- ${row.work_item?.id || row.lease.work_item_id} — lease ${row.lease.id} expired ${row.lease.expires_at}`);
  lines.push('');
  lines.push('## Recent completions');
  lines.push('');
  pushWorkRows(lines, dashboard.recent_completions, 'No recent completions.');
  lines.push('');
  lines.push('## Pending approvals');
  lines.push('');
  if (!dashboard.pending_approvals.work_items.length && !dashboard.pending_approvals.interrupts.length) lines.push('- None.');
  for (const item of dashboard.pending_approvals.work_items) lines.push(`- Work item ${item.id} — ${item.title}`);
  for (const interrupt of dashboard.pending_approvals.interrupts) lines.push(`- Interrupt ${interrupt.id} (${interrupt.severity}) — ${interrupt.title}`);
  lines.push('');
  lines.push('## Budget usage');
  lines.push('');
  if (!dashboard.budget_usage.length) lines.push('- No budget ledger entries.');
  else for (const row of dashboard.budget_usage) lines.push(`- ${row.provider}${row.model ? `/${row.model}` : ''}${row.program_id ? ` for ${row.program_id}` : ''}: ${row.calls} calls, ${row.input_tokens}/${row.output_tokens} tokens, est. cost ${row.estimated_cost}`);
  lines.push('');
  lines.push('## Interrupt queue');
  lines.push('');
  if (!dashboard.interrupt_queue.length) lines.push('- Empty.');
  else for (const interrupt of dashboard.interrupt_queue) lines.push(`- ${interrupt.severity} ${interrupt.id} [${interrupt.status}] — ${interrupt.title}`);
  lines.push('');
  return lines.join('\n');
}

function pushProgramRows(lines: string[], programs: OpsProgram[]): void {
  if (!programs.length) {
    lines.push('- No active programs.');
    return;
  }
  for (const p of programs) lines.push(`- **${p.id}** (${p.priority}) — ${p.objective}`);
}

function pushWorkRows(lines: string[], workItems: OpsWorkItem[], empty: string): void {
  if (!workItems.length) {
    lines.push(`- ${empty}`);
    return;
  }
  for (const w of workItems) lines.push(`- **${w.id}** [${w.state}/${w.lane}/${w.worker_kind}] (${w.priority}) — ${w.title}`);
}
