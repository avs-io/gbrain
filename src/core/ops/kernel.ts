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
export const OPS_WORKER_PROFILE_SCHEMA = 'gbrain.ops.worker_profile.v1';
export const OPS_TOPIC_TRACK_SCHEMA = 'gbrain.ops.topic_track.v2';
export const OPS_SOURCE_TARGET_SCHEMA = 'gbrain.ops.topic_source_target.v1';
export const OPS_SCOUT_SOURCE_QUEUE_SCHEMA = 'gbrain.ops.scout_source_queue_item.v1';
export const OPS_CONTROL_SCHEMA = 'gbrain.ops.control.v1';

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
export const SOURCE_TARGET_FETCH_POLICIES = ['manual', 'rss', 'search', 'crawl_allowed', 'api', 'disabled'] as const;
export type SourceTargetFetchPolicy = typeof SOURCE_TARGET_FETCH_POLICIES[number];
export const SOURCE_TARGET_AUTHORITY_TIERS = ['primary', 'high', 'medium', 'low', 'weak'] as const;
export type SourceTargetAuthorityTier = typeof SOURCE_TARGET_AUTHORITY_TIERS[number];
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
  model_lane?: string;
  worker_profile_id?: string;
  worker_kind: WorkerKind;
  privacy_tier: PrivacyTier;
  context_pack_required?: boolean;
  context_pack_id?: string;
  context_pack_path?: string;
  context_pack_status?: string;
  output_contract_required?: boolean;
  output_contract_id?: string;
  output_contract_path?: string;
  completion_json_path?: string;
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
  worker_profile_id?: string;
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

export interface OpsWorkerProfile {
  schema: typeof OPS_WORKER_PROFILE_SCHEMA;
  id: string;
  title: string;
  worker_kind: WorkerKind;
  runtime: OpenClawDispatchRuntime | 'supervisor_placeholder' | string;
  provider: string;
  model?: string;
  public_cloud: boolean;
  allowed_privacy_tiers: string[];
  preferred_lanes: string[];
  task_types: string[];
  priority: number;
  max_concurrency: number;
  daily_task_budget?: number;
  daily_call_budget?: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OpsTopicTrack {
  schema: typeof OPS_TOPIC_TRACK_SCHEMA;
  id: string;
  slug: string;
  tier: 'T0' | 'T1' | 'T2' | 'T3';
  recipe_slug?: string;
  program_id: string;
  title: string;
  status: ProgramStatus;
  priority: number;
  objective: string;
  why_it_matters_to_chief: string;
  decision_surfaces: string[];
  standing_questions: string[];
  seed_queries: string[];
  watch_entities: string[];
  source_classes: string[];
  extraction_targets: string[];
  research_plan: ResearchPlanDsl;
  cadence: Record<string, unknown>;
  budgets: Record<string, unknown>;
  lanes: { privacy_tier: 'P3_PUBLIC'; namespace: 'world'; model_lanes: string[]; worker_lanes: string[] };
  approval_gates: unknown[];
  success_metrics: string[];
  autonomy: Record<string, unknown>;
  privacy_tier: 'P3_PUBLIC';
  namespace: 'world';
  source_targets: OpsSourceTarget[];
  created_at: string;
  updated_at: string;
}

export interface OpsSourceTarget {
  schema: typeof OPS_SOURCE_TARGET_SCHEMA;
  id: string;
  topic_id: string;
  source_class: string;
  label: string;
  url?: string;
  query?: string;
  authority_tier: SourceTargetAuthorityTier;
  fetch_policy: SourceTargetFetchPolicy;
  robots_required: boolean;
  max_fetches_per_day: number;
  privacy_tier: 'P3_PUBLIC';
  namespace: 'world';
  last_checked_at?: string;
  last_success_at?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SourceTargetFetchDecision {
  allowed: boolean;
  source_target_id: string;
  fetch_policy: SourceTargetFetchPolicy;
  skip_reason?: 'disabled' | 'manual_requires_explicit_url_review' | 'search_target_creates_discovery_work_only' | 'missing_url_or_query' | 'daily_target_limit_reached' | 'daily_domain_limit_reached' | 'robots_required' | 'unknown_policy';
  robots_required: boolean;
  max_fetches_per_day: number;
  domain?: string;
}

export interface ResearchPlanDsl {
  maps: Record<string, unknown>;
  discovery_queries: string[];
  extraction_targets: string[];
  opportunity_lenses: string[];
}

export interface OpsControlEvent {
  schema: typeof OPS_CONTROL_SCHEMA;
  id: string;
  action: 'pause_program' | 'resume_program' | 'kill_switch_on' | 'kill_switch_off';
  program_id?: string;
  reason?: string;
  affected_program_ids: string[];
  affected_topic_track_ids: string[];
  created_at: string;
}

export interface OpsControlState {
  kill_switch: { enabled: boolean; since?: string; reason?: string };
  paused_program_ids: string[];
  paused_public_scout_program_ids: string[];
  code_writing_program_ids: string[];
  latest_event?: OpsControlEvent;
}

export interface OpsScoutSourceQueueItem {
  schema: typeof OPS_SCOUT_SOURCE_QUEUE_SCHEMA;
  id: string;
  topic_track_id: string;
  query: string;
  status: 'queued' | 'fetched' | 'failed' | 'skipped';
  source_class?: string;
  source_url?: string;
  source_title?: string;
  published_at?: string;
  privacy_tier: 'P3_PUBLIC';
  namespace: 'world';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
  worker_profiles: OpsWorkerProfile[];
  topic_tracks: OpsTopicTrack[];
  source_targets: OpsSourceTarget[];
  scout_source_queue: OpsScoutSourceQueueItem[];
  roadmap_flows: OpsRoadmapFlow[];
  runs: OpsWorkRun[];
  leases: OpsLease[];
  artifacts: OpsArtifact[];
  supervisor_ticks: OpsSupervisorTick[];
  interrupts: OpsInterrupt[];
  budget_ledger: OpsBudgetLedgerEntry[];
  control_events: OpsControlEvent[];
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
  kind: 'no_idle' | 'blocked_work' | 'waiting_human' | 'stale_active_lease' | 'dispatch_failed' | 'completion_missing' | 'active_program_without_work';
  severity: 'info' | 'amber' | 'red';
  message: string;
  work_item_ids?: string[];
  lease_ids?: string[];
  program_ids?: string[];
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
  worker_profile_id?: string;
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

type OpsRecordType = 'init' | 'program_upsert' | 'work_upsert' | 'worker_profile_upsert' | 'topic_track_upsert' | 'source_target_upsert' | 'scout_source_upsert' | 'roadmap_flow_upsert' | 'run_upsert' | 'lease_upsert' | 'artifact_upsert' | 'supervisor_tick' | 'interrupt_upsert' | 'budget_ledger' | 'control_event' | 'work_state';

interface OpsEvent<T = unknown> {
  schema: typeof OPS_EVENT_SCHEMA;
  type: OpsRecordType;
  at: string;
  payload: T;
}

export interface OpsStoreOptions { path?: string; now?: Date; }

export interface ProgramSyncResult { ok: true; path: string; source_file: string; programs: OpsProgram[]; upserted_count: number; }

export interface WorkerProfileSyncResult { ok: true; path: string; source_file: string; worker_profiles: OpsWorkerProfile[]; upserted_count: number; }

export interface TopicTrackSyncResult { ok: true; path: string; source_file: string; topic_tracks: OpsTopicTrack[]; upserted_count: number; }

export interface ProgramWorkSeedResult {
  ok: true;
  path: string;
  source_file: string;
  active_program_count: number;
  created_count: number;
  skipped_count: number;
  work_items: OpsWorkItem[];
  skipped: Array<{ program_id: string; reason: string; work_item_ids: string[] }>;
}

export interface OpsWorkerProfilesConfig { workers: OpsWorkerProfile[]; }

export interface OpsTopicTracksConfig { topic_tracks: OpsTopicTrack[]; }

export interface TopicSourceTargetResult { ok: true; path?: string; source_file: string; topic_track: OpsTopicTrack; source_targets: OpsSourceTarget[]; }

export type WorkerRouteStatus = 'selected' | 'held' | 'denied' | 'legacy';

export interface OpsWorkerRouteDecision {
  status: WorkerRouteStatus;
  work_item_id: string;
  worker_profile_id?: string;
  worker_kind: WorkerKind;
  runtime: OpenClawDispatchRuntime | 'supervisor_placeholder' | string;
  provider: string;
  model?: string;
  reason: string;
  budget?: { max_concurrency: number; active_concurrency: number; daily_task_budget?: number; daily_tasks_used: number; daily_call_budget?: number; daily_calls_used: number; day: string };
  skipped: Array<{ worker_profile_id: string; reason: string }>;
}

export interface OpsRouteDecision {
  ok: boolean;
  reason: string;
  work_item_id: string;
  profile?: OpsWorkerProfile;
  provider?: string;
  model?: string;
  runtime?: string;
  defer?: 'privacy_route_denied' | 'concurrency_full' | 'budget_exceeded' | 'no_matching_profile';
}

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
  paused_programs: OpsProgram[];
  control: OpsControlState;
  safety_audit: OpsSafetyAudit;
}

export interface OpsMetricsWindow {
  ok: true;
  schema: 'gbrain.ops.metrics.v1';
  generated_at: string;
  store_path: string;
  window: { last: string; since: string; until: string };
  counts: ReturnType<typeof countOps>;
  completions: number;
  failures: number;
  active_runs: number;
  ready_backlog: number;
  stale_active_lease_count: number;
  budget_usage: OpsDashboardState['budget_usage'];
  programs: Array<{ program_id: string; status: ProgramStatus; ready: number; running: number; succeeded: number; failed: number; blocked: number; waiting_human: number }>;
  control: OpsControlState;
  safety_audit: OpsSafetyAudit;
}

export interface OpsSafetyAudit {
  ok: boolean;
  hidden_active_task_count: number;
  contact_risk_count: number;
  trusted_memory_mutation_risk_count: number;
  external_public_scout_active_count: number;
  active_tasks: Array<{ work_item_id: string; program_id: string; title: string; state: WorkItemState; lane: string; worker_kind: WorkerKind; can_contact_people: boolean; can_mutate_trusted_memory: boolean; is_external_public_scout: boolean; reason: string }>;
  hidden_active_runs: Array<{ run_id: string; work_item_id: string; program_id: string; status: RunStatus; reason: string }>;
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
  return { schema: OPS_KERNEL_SCHEMA, programs: [], work_items: [], worker_profiles: [], topic_tracks: [], source_targets: [], scout_source_queue: [], roadmap_flows: [], runs: [], leases: [], artifacts: [], supervisor_ticks: [], interrupts: [], budget_ledger: [], control_events: [] };
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
    case 'worker_profile_upsert': upsertById(state.worker_profiles, p as OpsWorkerProfile); break;
    case 'topic_track_upsert': upsertById(state.topic_tracks, p as OpsTopicTrack); break;
    case 'source_target_upsert': upsertById(state.source_targets, p as OpsSourceTarget); break;
    case 'scout_source_upsert': upsertById(state.scout_source_queue, p as OpsScoutSourceQueueItem); break;
    case 'roadmap_flow_upsert': upsertById(state.roadmap_flows, p as OpsRoadmapFlow); break;
    case 'run_upsert': upsertById(state.runs, p as OpsWorkRun); break;
    case 'lease_upsert': upsertById(state.leases, p as OpsLease); break;
    case 'artifact_upsert': upsertById(state.artifacts, p as OpsArtifact); break;
    case 'supervisor_tick': upsertById(state.supervisor_ticks, p as OpsSupervisorTick); break;
    case 'interrupt_upsert': upsertById(state.interrupts, p as OpsInterrupt); break;
    case 'budget_ledger': upsertById(state.budget_ledger, p as OpsBudgetLedgerEntry); break;
    case 'control_event': upsertById(state.control_events, p as OpsControlEvent); break;
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
    model_lane: typeof input.model_lane === 'string' ? input.model_lane : undefined,
    worker_profile_id: typeof input.worker_profile_id === 'string' ? input.worker_profile_id : undefined,
    worker_kind: String(input.worker_kind || 'subagent'),
    privacy_tier: String(input.privacy_tier || 'P2'),
    context_pack_required: input.context_pack_required === true ? true : undefined,
    context_pack_id: typeof input.context_pack_id === 'string' ? input.context_pack_id : undefined,
    context_pack_path: typeof input.context_pack_path === 'string' ? input.context_pack_path : undefined,
    context_pack_status: typeof input.context_pack_status === 'string' ? input.context_pack_status : undefined,
    output_contract_required: input.output_contract_required === true ? true : undefined,
    output_contract_id: typeof input.output_contract_id === 'string' ? input.output_contract_id : undefined,
    output_contract_path: typeof input.output_contract_path === 'string' ? input.output_contract_path : undefined,
    completion_json_path: typeof input.completion_json_path === 'string' ? input.completion_json_path : undefined,
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

export function normalizeWorkerProfile(input: unknown, now?: Date): OpsWorkerProfile {
  if (!isObject(input)) throw new Error('worker profile must be an object');
  const id = String(input.id || '').trim();
  if (!id) throw new Error('worker_profile.id is required');
  const at = nowIso(now);
  const budgets = object(input.budgets);
  const provider = String(input.provider || '').trim();
  if (!provider) throw new Error(`worker_profile ${id} requires provider`);
  const workerKind = String(input.worker_kind || input.kind || id);
  return {
    schema: OPS_WORKER_PROFILE_SCHEMA,
    id,
    title: String(input.title || id),
    worker_kind: workerKind,
    runtime: String(input.runtime || runtimeForWorkerKind(workerKind)),
    provider,
    model: typeof input.model === 'string' ? input.model : undefined,
    public_cloud: input.public_cloud === true || isMiniMaxRoute(provider, typeof input.model === 'string' ? input.model : undefined, workerKind),
    allowed_privacy_tiers: stringArray(input.allowed_privacy_tiers || input.privacy_tiers || input.privacy_allowed).map(normalizedPrivacyTier),
    preferred_lanes: stringArray(input.preferred_lanes || input.lanes),
    task_types: stringArray(input.task_types || input.tasks),
    priority: numberOr(input.priority, 50),
    max_concurrency: Math.max(1, Math.floor(numberOr(input.max_concurrency ?? input.max_concurrent ?? budgets.max_concurrency ?? budgets.max_concurrent, 1))),
    daily_task_budget: optionalNonNegativeInteger(input.daily_task_budget ?? budgets.daily_task_budget ?? budgets.daily_tasks ?? budgets.tasks_per_day ?? budgets.codex_tasks_per_day ?? budgets.max_daily_tasks),
    daily_call_budget: optionalNonNegativeInteger(input.daily_call_budget ?? budgets.daily_call_budget ?? budgets.daily_calls ?? budgets.calls_per_day ?? budgets.minimax_calls_per_day ?? budgets.max_daily_calls),
    metadata: object(input.metadata),
    created_at: typeof input.created_at === 'string' ? input.created_at : at,
    updated_at: at,
  };
}

export function syncWorkerProfilesFromYamlFile(file: string, opts: OpsStoreOptions = {}): WorkerProfileSyncResult {
  const raw = readFileSync(file, 'utf8');
  const parsed = parseWorkerProfilesYaml(raw);

  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const profiles = parsed.workers.map(p => normalizeWorkerProfile(p, opts.now));
  for (const profile of profiles) appendEvent(path, 'worker_profile_upsert', profile, opts.now);
  return { ok: true, path, source_file: file, worker_profiles: profiles, upserted_count: profiles.length };
}

export function normalizeTopicTrack(input: unknown, now?: Date): OpsTopicTrack {
  if (!isObject(input)) throw new Error('topic track must be an object');
  const id = String(input.id || input.slug || '').trim();
  if (!id) throw new Error('topic_track.id is required');
  const slug = String(input.slug || id.replace(/^world-/, '')).trim();
  const programId = String(input.program_id || id).trim();
  const at = nowIso(now);
  const researchPlan = normalizeResearchPlan(input.research_plan, input, id);
  const seedQueries = stringArray(input.seed_queries || input.queries || researchPlan.discovery_queries);
  if (!seedQueries.length) throw new Error(`topic_track ${id} requires seed_queries or research_plan.discovery_queries`);
  const watchEntities = stringArray(input.watch_entities);
  if (!watchEntities.length) throw new Error(`topic_track ${id} requires watch_entities`);
  const sourceClasses = stringArray(input.source_classes);
  if (!sourceClasses.length) throw new Error(`topic_track ${id} requires source_classes`);
  const extractionTargets = stringArray(input.extraction_targets || researchPlan.extraction_targets);
  if (!extractionTargets.length) throw new Error(`topic_track ${id} requires extraction_targets or research_plan.extraction_targets`);
  const tier = String(input.tier || (numberOr(input.priority, 50) >= 90 ? 'T0' : 'T2'));
  if (!['T0', 'T1', 'T2', 'T3'].includes(tier)) throw new Error(`topic_track ${id} tier must be T0, T1, T2, or T3`);
  const why = String(input.why_it_matters_to_chief || input.why || input.objective || '').trim();
  if (why.length < 20) throw new Error(`topic_track ${id} requires why_it_matters_to_chief`);
  const decisionSurfaces = stringArray(input.decision_surfaces);
  if (!decisionSurfaces.length) throw new Error(`topic_track ${id} requires decision_surfaces`);
  const standingQuestions = stringArray(input.standing_questions || input.questions);
  if (!standingQuestions.length) throw new Error(`topic_track ${id} requires standing_questions`);
  const successMetrics = stringArray(input.success_metrics || input.metrics);
  if (!successMetrics.length) throw new Error(`topic_track ${id} requires success_metrics`);
  const lanesInput = isObject(input.lanes) ? input.lanes : {};
  const modelLanes = stringArray(lanesInput.model_lanes || input.model_lanes || ['minimax-public-regular']);
  if (modelLanes.some(lane => /highspeed/i.test(lane))) throw new Error(`topic_track ${id} must not use highspeed model lanes`);
  return {
    schema: OPS_TOPIC_TRACK_SCHEMA,
    id,
    slug,
    tier: tier as OpsTopicTrack['tier'],
    recipe_slug: typeof input.recipe_slug === 'string' ? input.recipe_slug : slug,
    program_id: programId,
    title: String(input.title || id),
    status: ['active', 'paused', 'retired'].includes(String(input.status)) ? input.status as ProgramStatus : 'active',
    priority: numberOr(input.priority, 50),
    objective: String(input.objective || input.description || `Scout public world signals for ${id}`),
    why_it_matters_to_chief: why,
    decision_surfaces: decisionSurfaces,
    standing_questions: standingQuestions,
    seed_queries: seedQueries,
    watch_entities: watchEntities,
    source_classes: sourceClasses,
    extraction_targets: extractionTargets,
    research_plan: researchPlan,
    cadence: object(input.cadence),
    budgets: object(input.budgets),
    lanes: {
      privacy_tier: 'P3_PUBLIC',
      namespace: 'world',
      model_lanes: modelLanes,
      worker_lanes: stringArray(lanesInput.worker_lanes || input.worker_lanes || ['public_scout', 'public_fetch', 'world_extraction', 'topic_reduce', 'opportunity_scoring']),
    },
    approval_gates: array(input.approval_gates).length ? array(input.approval_gates) : ['external_send', 'trusted_memory_mutation', 'live_web_fetch_budget_increase'],
    success_metrics: successMetrics,
    autonomy: object(input.autonomy),
    privacy_tier: 'P3_PUBLIC',
    namespace: 'world',
    source_targets: normalizeSourceTargets(input.source_targets || input.topic_source_targets || [], id, at),
    created_at: typeof input.created_at === 'string' ? input.created_at : at,
    updated_at: at,
  };
}

export function normalizeSourceTarget(input: unknown, topicId: string, now?: Date | string): OpsSourceTarget {
  if (!isObject(input)) throw new Error(`source_target for ${topicId} must be an object`);
  const at = typeof now === 'string' ? now : nowIso(now);
  const id = String(input.id || hashId(`source_target_${topicId}`, input)).trim();
  if (!id) throw new Error(`source_target for ${topicId} requires id`);
  const sourceClass = String(input.source_class || '').trim();
  if (!sourceClass) throw new Error(`source_target ${id} requires source_class`);
  const label = String(input.label || '').trim();
  if (!label) throw new Error(`source_target ${id} requires label`);
  const url = typeof input.url === 'string' && input.url.trim() ? input.url.trim() : undefined;
  const query = typeof input.query === 'string' && input.query.trim() ? input.query.trim() : undefined;
  if (!url && !query) throw new Error(`source_target ${id} requires url or query`);
  if (url && !/^https?:\/\//i.test(url)) throw new Error(`source_target ${id} url must be public http(s)`);
  const policy = String(input.fetch_policy || '').trim();
  if (!SOURCE_TARGET_FETCH_POLICIES.includes(policy as SourceTargetFetchPolicy)) throw new Error(`source_target ${id} fetch_policy must be one of ${SOURCE_TARGET_FETCH_POLICIES.join(', ')}`);
  const authority = String(input.authority_tier || '').trim();
  if (!SOURCE_TARGET_AUTHORITY_TIERS.includes(authority as SourceTargetAuthorityTier)) throw new Error(`source_target ${id} authority_tier must be one of ${SOURCE_TARGET_AUTHORITY_TIERS.join(', ')}`);
  const privacy = String(input.privacy_tier || 'P3_PUBLIC');
  const namespace = String(input.namespace || 'world');
  if (privacy !== 'P3_PUBLIC' && privacy !== 'P3' && privacy !== 'public') throw new Error(`source_target ${id} must be P3/public`);
  if (namespace !== 'world' && namespace !== 'public') throw new Error(`source_target ${id} namespace must be world/public`);
  const maxFetches = Math.max(0, Math.floor(numberOr(input.max_fetches_per_day, policy === 'disabled' ? 0 : 5)));
  return {
    schema: OPS_SOURCE_TARGET_SCHEMA,
    id,
    topic_id: String(input.topic_id || topicId),
    source_class: sourceClass,
    label,
    url,
    query,
    authority_tier: authority as SourceTargetAuthorityTier,
    fetch_policy: policy as SourceTargetFetchPolicy,
    robots_required: input.robots_required === false ? false : true,
    max_fetches_per_day: maxFetches,
    privacy_tier: 'P3_PUBLIC',
    namespace: 'world',
    last_checked_at: typeof input.last_checked_at === 'string' ? input.last_checked_at : undefined,
    last_success_at: typeof input.last_success_at === 'string' ? input.last_success_at : undefined,
    metadata: object(input.metadata),
    created_at: typeof input.created_at === 'string' ? input.created_at : at,
    updated_at: typeof input.updated_at === 'string' ? input.updated_at : at,
  };
}

function normalizeSourceTargets(input: unknown, topicId: string, at: string): OpsSourceTarget[] {
  if (!Array.isArray(input)) return [];
  return input.map(t => normalizeSourceTarget(t, topicId, at));
}

function normalizeResearchPlan(input: unknown, parent: Record<string, unknown>, id: string): ResearchPlanDsl {
  const raw = isObject(input) ? input : {};
  const maps = object(raw.maps || parent.maps);
  if (!Object.keys(maps).length) throw new Error(`topic_track ${id} requires research_plan.maps`);
  const discoveryQueries = stringArray(raw.discovery_queries || parent.discovery_queries || parent.seed_queries || parent.queries);
  if (!discoveryQueries.length) throw new Error(`topic_track ${id} requires research_plan.discovery_queries`);
  const extractionTargets = stringArray(raw.extraction_targets || parent.extraction_targets);
  if (!extractionTargets.length) throw new Error(`topic_track ${id} requires research_plan.extraction_targets`);
  const opportunityLenses = stringArray(raw.opportunity_lenses || parent.opportunity_lenses);
  if (!opportunityLenses.length) throw new Error(`topic_track ${id} requires research_plan.opportunity_lenses`);
  return { maps, discovery_queries: discoveryQueries, extraction_targets: extractionTargets, opportunity_lenses: opportunityLenses };
}

export function parseTopicTracksYaml(raw: string): OpsTopicTracksConfig {
  const parsed = parseSimpleYaml(raw);
  if (!isObject(parsed)) throw new Error('topic track YAML must be a mapping');
  const rawTracks = Array.isArray(parsed.topic_tracks) ? parsed.topic_tracks : (Array.isArray(parsed.tracks) ? parsed.tracks : undefined);
  if (!rawTracks) throw new Error('topic track YAML must contain topic_tracks: [...]');
  return { topic_tracks: rawTracks.map(t => normalizeTopicTrack(t)) };
}

export function validateTopicTracksYaml(raw: string): { ok: boolean; errors: string[]; topic_tracks: OpsTopicTrack[] } {
  try {
    const parsed = parseTopicTracksYaml(raw);
    return { ok: true, errors: [], topic_tracks: parsed.topic_tracks };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)], topic_tracks: [] };
  }
}

export function getTopicTrackFromYamlFile(file: string, id: string): OpsTopicTrack {
  const parsed = parseTopicTracksYaml(readFileSync(file, 'utf8'));
  const track = parsed.topic_tracks.find(t => t.id === id || t.slug === id);
  if (!track) throw new Error(`topic track not found: ${id}`);
  return track;
}

export function seedTopicTrackWorkItemsFromYamlFile(file: string, id: string, opts: OpsStoreOptions & { force?: boolean } = {}): { ok: true; path: string; source_file: string; topic_track: OpsTopicTrack; work_items: OpsWorkItem[]; created_count: number; skipped_count: number } {
  const track = getTopicTrackFromYamlFile(file, id);
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  syncTopicTracksFromYamlFile(file, { path, now: opts.now });
  const before = readOpsState(path);
  const stages = topicSeedStages(track);
  const existing = new Set(before.work_items.map(w => w.id));
  const rawItems = stages.filter(s => opts.force || !existing.has(s.id));
  const program = {
    id: track.program_id,
    title: `${track.title} Topic Intelligence`,
    status: track.status,
    priority: track.priority,
    objective: track.objective,
    lanes: track.lanes.worker_lanes,
    cadence: track.cadence,
    budgets: track.budgets,
    autonomy: { ...track.autonomy, can_mutate_trusted_memory: false, can_contact_people: false },
    approval_gates: track.approval_gates,
    outputs: track.decision_surfaces,
  };
  const enqueued = rawItems.length ? enqueueWorkPacket({ program, work_items: rawItems }, { path, now: opts.now }) : enqueueWorkPacket({ program, work_items: [] }, { path, now: opts.now });
  return { ok: true, path, source_file: file, topic_track: track, work_items: enqueued.work_items, created_count: enqueued.work_items.length, skipped_count: stages.length - rawItems.length };
}

function topicSeedStages(track: OpsTopicTrack): Array<Record<string, unknown> & { id: string }> {
  const base = `topic-${track.id}`;
  const common = {
    program_id: track.program_id,
    priority: track.priority,
    privacy_tier: 'P3_PUBLIC',
    source_refs: [`topic_track:${track.id}`],
    guardrails: ['P3 public-only inputs', 'no trusted personal memory mutation', 'no external sends', 'no broad live web fetch in tests', 'MiniMax regular only; no highspeed'],
    approval_gates: track.approval_gates,
    budget: track.budgets,
    created_by: 'topic_track_seed_work',
  };
  return [
    { ...common, id: `${base}-discovery`, title: `Discover public sources for ${track.title}`, description: `Plan discovery from research_plan.discovery_queries without fetching in dry/test lanes. Queries: ${track.research_plan.discovery_queries.slice(0, 5).join('; ')}`, state: 'ready', lane: 'public_discovery', lanes: ['public_discovery'], worker_kind: 'minimax', acceptance_criteria: ['query plan produced', 'source candidates are public/P3', 'no private sources included'], expected_artifacts: ['discovery_query_plan.json'] },
    { ...common, id: `${base}-fetch`, title: `Fetch bounded public sources for ${track.title}`, description: 'Fetch only approved public source targets within budget; tests must use fixtures and perform no live web access.', state: 'approved', dependencies: [`${base}-discovery`], lane: 'public_fetch', lanes: ['public_fetch'], worker_kind: 'script', acceptance_criteria: ['all sources are P3_PUBLIC/world', 'robots/budget policy respected', 'source_items/source_spans emitted'], expected_artifacts: ['source_items.jsonl', 'source_spans.jsonl'] },
    { ...common, id: `${base}-extract`, title: `Extract candidates for ${track.title}`, description: `Extract review-only ${track.extraction_targets.join(', ')} from public source spans.`, state: 'approved', dependencies: [`${base}-fetch`], lane: 'world_extraction', lanes: ['world_extraction'], worker_kind: 'minimax', acceptance_criteria: ['candidate claims/events/entities cite source spans', 'unsupported claims remain review-only'], expected_artifacts: ['world_extraction.json'] },
    { ...common, id: `${base}-reduce`, title: `Reduce topic state for ${track.title}`, description: 'Reduce candidates into review-only topic state/deltas and standing-question updates.', state: 'approved', dependencies: [`${base}-extract`], lane: 'topic_reduce', lanes: ['topic_reduce'], worker_kind: 'script', acceptance_criteria: ['topic state cites source refs', 'unknowns/stale questions preserved'], expected_artifacts: ['topic_state.json'] },
    { ...common, id: `${base}-scoring`, title: `Score opportunities for ${track.title}`, description: `Score signals through opportunity lenses: ${track.research_plan.opportunity_lenses.join(', ')}.`, state: 'approved', dependencies: [`${base}-reduce`], lane: 'opportunity_scoring', lanes: ['opportunity_scoring'], worker_kind: 'minimax', acceptance_criteria: ['personal relevance separated from trusted memory', 'candidate actions require approval gates'], expected_artifacts: ['opportunity_scores.json'] },
  ];
}

export function syncTopicTracksFromYamlFile(file: string, opts: OpsStoreOptions = {}): TopicTrackSyncResult {
  const raw = readFileSync(file, 'utf8');
  const parsed = parseTopicTracksYaml(raw);
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const tracks = parsed.topic_tracks.map(t => normalizeTopicTrack(t, opts.now));
  for (const track of tracks) {
    appendEvent(path, 'topic_track_upsert', track, opts.now);
    for (const target of track.source_targets) appendEvent(path, 'source_target_upsert', target, opts.now);
  }
  return { ok: true, path, source_file: file, topic_tracks: tracks, upserted_count: tracks.length };
}

export function listOpsTopicTracks(opts: OpsStoreOptions = {}): OpsTopicTrack[] {
  return readOpsState(opts.path || opsStorePath()).topic_tracks.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function listSourceTargetsFromYamlFile(file: string, topicId: string): TopicSourceTargetResult {
  const topic_track = getTopicTrackFromYamlFile(file, topicId);
  return { ok: true, source_file: file, topic_track, source_targets: topic_track.source_targets };
}

export function validateSourceTargetsFromYaml(raw: string, topicId?: string): { ok: boolean; errors: string[]; source_targets: OpsSourceTarget[] } {
  try {
    const parsed = parseTopicTracksYaml(raw);
    const tracks = topicId ? parsed.topic_tracks.filter(t => t.id === topicId || t.slug === topicId) : parsed.topic_tracks;
    if (topicId && !tracks.length) throw new Error(`topic track not found: ${topicId}`);
    const source_targets = tracks.flatMap(t => t.source_targets);
    return { ok: true, errors: [], source_targets };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)], source_targets: [] };
  }
}

function targetDomain(target: OpsSourceTarget): string | undefined {
  if (!target.url) return undefined;
  try { return new URL(target.url).hostname.toLowerCase(); } catch { return undefined; }
}

export function decideSourceTargetFetch(target: OpsSourceTarget, opts: { targetFetchesToday?: number; domainFetchesToday?: number; maxDomainFetchesPerDay?: number; robotsAllowed?: boolean } = {}): SourceTargetFetchDecision {
  const domain = targetDomain(target);
  const base = { source_target_id: target.id, fetch_policy: target.fetch_policy, robots_required: target.robots_required, max_fetches_per_day: target.max_fetches_per_day, domain };
  if (!SOURCE_TARGET_FETCH_POLICIES.includes(target.fetch_policy)) return { ...base, allowed: false, skip_reason: 'unknown_policy' };
  if (target.fetch_policy === 'disabled') return { ...base, allowed: false, skip_reason: 'disabled' };
  if (target.fetch_policy === 'manual') return { ...base, allowed: false, skip_reason: 'manual_requires_explicit_url_review' };
  if (target.fetch_policy === 'search') return { ...base, allowed: false, skip_reason: 'search_target_creates_discovery_work_only' };
  if (!target.url && !target.query) return { ...base, allowed: false, skip_reason: 'missing_url_or_query' };
  if ((opts.targetFetchesToday || 0) >= target.max_fetches_per_day) return { ...base, allowed: false, skip_reason: 'daily_target_limit_reached' };
  if (opts.maxDomainFetchesPerDay !== undefined && (opts.domainFetchesToday || 0) >= opts.maxDomainFetchesPerDay) return { ...base, allowed: false, skip_reason: 'daily_domain_limit_reached' };
  if (target.robots_required && opts.robotsAllowed === false) return { ...base, allowed: false, skip_reason: 'robots_required' };
  return { ...base, allowed: true };
}

export function createSourceTargetFetchWorkItemsFromYamlFile(file: string, topicId: string, opts: OpsStoreOptions & { force?: boolean; maxDomainFetchesPerDay?: number } = {}): { ok: true; path: string; source_file: string; topic_track: OpsTopicTrack; created_count: number; skipped_count: number; skipped: Array<{ source_target_id: string; reason: string }>; work_items: OpsWorkItem[] } {
  const track = getTopicTrackFromYamlFile(file, topicId);
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  syncTopicTracksFromYamlFile(file, { path, now: opts.now });
  const state = readOpsState(path);
  const existing = new Set(state.work_items.map(w => w.id));
  const rawItems: Array<Record<string, unknown>> = [];
  const skipped: Array<{ source_target_id: string; reason: string }> = [];
  const domainCounts = new Map<string, number>();
  for (const target of track.source_targets) {
    const decision = decideSourceTargetFetch(target, { domainFetchesToday: targetDomain(target) ? domainCounts.get(targetDomain(target)!) || 0 : 0, maxDomainFetchesPerDay: opts.maxDomainFetchesPerDay ?? 25 });
    if (!decision.allowed) { skipped.push({ source_target_id: target.id, reason: decision.skip_reason || 'not_allowed' }); continue; }
    const id = `topic-${track.id}-source-${target.id}-fetch`;
    if (!opts.force && existing.has(id)) { skipped.push({ source_target_id: target.id, reason: 'work_item_exists' }); continue; }
    if (decision.domain) domainCounts.set(decision.domain, (domainCounts.get(decision.domain) || 0) + 1);
    rawItems.push(sourceTargetFetchWorkItem(track, target, id, decision));
  }
  const program = { id: track.program_id, title: `${track.title} Topic Intelligence`, status: track.status, priority: track.priority, objective: track.objective, lanes: track.lanes.worker_lanes, cadence: track.cadence, budgets: track.budgets, autonomy: { ...track.autonomy, can_mutate_trusted_memory: false, can_contact_people: false }, approval_gates: track.approval_gates, outputs: track.decision_surfaces };
  const enqueued = rawItems.length ? enqueueWorkPacket({ program, work_items: rawItems }, { path, now: opts.now }) : enqueueWorkPacket({ program, work_items: [] }, { path, now: opts.now });
  return { ok: true, path, source_file: file, topic_track: track, created_count: enqueued.work_items.length, skipped_count: skipped.length, skipped, work_items: enqueued.work_items };
}

function sourceTargetFetchWorkItem(track: OpsTopicTrack, target: OpsSourceTarget, id: string, decision: SourceTargetFetchDecision): Record<string, unknown> {
  return {
    id,
    program_id: track.program_id,
    title: `Fetch source target: ${target.label}`,
    description: `Create P3/world source_items and source_spans for approved source target ${target.id}. This WorkItem is policy-bounded; execution must verify robots and rate limits before HTTP access.`,
    state: 'ready',
    priority: track.priority,
    lane: 'public_fetch',
    lanes: ['public_fetch'],
    worker_kind: 'script',
    privacy_tier: 'P3_PUBLIC',
    source_refs: [`topic_track:${track.id}`, `topic_source_target:${target.id}`, { topic_id: track.id, source_target_id: target.id, input: { url: target.url, query: target.query, source_class: target.source_class, authority_tier: target.authority_tier, fetch_policy: target.fetch_policy } }],
    dependencies: [],
    acceptance_criteria: ['input source target remains P3_PUBLIC/world', 'robots policy checked before HTTP fetch', 'per-target and per-domain budgets respected', 'source_items/source_spans emitted or explicit skip reason recorded'],
    expected_artifacts: ['source_items.jsonl', 'source_spans.jsonl', { outputs: ['source_items', 'source_spans'], topic_id: track.id, source_target_id: target.id }],
    guardrails: ['P3 public-only inputs', 'no private/logged-in scraping', 'respect robots.txt and crawl delay', 'bounded per-target/domain fetches', 'no trusted personal memory mutation', 'no external sends'],
    approval_gates: track.approval_gates,
    budget: { ...track.budgets, max_fetches_per_day: target.max_fetches_per_day, robots_required: target.robots_required, fetch_policy_decision: decision },
    created_by: 'topic_source_target_fetch_work',
  };
}

export function upsertScoutSourceQueueItem(input: Omit<OpsScoutSourceQueueItem, 'schema' | 'created_at' | 'updated_at'> & { created_at?: string; updated_at?: string }, opts: OpsStoreOptions = {}): OpsScoutSourceQueueItem {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const at = nowIso(opts.now);
  const item: OpsScoutSourceQueueItem = {
    schema: OPS_SCOUT_SOURCE_QUEUE_SCHEMA,
    ...input,
    privacy_tier: 'P3_PUBLIC',
    namespace: 'world',
    metadata: object(input.metadata),
    created_at: input.created_at || at,
    updated_at: at,
  };
  appendEvent(path, 'scout_source_upsert', item, opts.now);
  return item;
}

export function parseWorkerProfilesYaml(raw: string): OpsWorkerProfilesConfig {
  const parsed = parseSimpleYaml(raw);
  if (!isObject(parsed)) throw new Error('worker profile YAML must be a mapping');
  const rawProfiles = Array.isArray(parsed.workers) ? parsed.workers : parsed.worker_profiles;
  if (!Array.isArray(rawProfiles)) throw new Error('worker profile YAML must contain workers: [...] or worker_profiles: [...]');
  return { workers: rawProfiles.map(p => normalizeWorkerProfile(p)) };
}

export function defaultWorkerProfiles(): OpsWorkerProfile[] {
  return [
    normalizeWorkerProfile({
      id: 'qwen-private-extractor',
      title: 'Qwen private extractor',
      worker_kind: 'qwen_local',
      provider: 'local-qwen',
      model: 'mlx-community/Qwen3.6-35B-A3B-4bit',
      allowed_privacy_tiers: ['P0', 'P1', 'P2'],
      preferred_lanes: ['private_extraction', 'memory_extraction', 'extraction'],
      task_types: ['private_extraction', 'extraction'],
      max_concurrency: 2,
      daily_task_budget: 100000,
      metadata: { allowed_model_lanes: ['mlx_qwen_private', 'local_private', 'private_extraction', 'memory_extraction', 'extraction'], requires_context_pack: true, requires_output_contract: true },
    }),
    normalizeWorkerProfile({
      id: 'minimax-public-scout',
      title: 'MiniMax public scout',
      worker_kind: 'minimax',
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      public_cloud: true,
      allowed_privacy_tiers: ['P3'],
      preferred_lanes: ['public_scout', 'scout', 'research'],
      task_types: ['public_scout', 'world_scout'],
      max_concurrency: 20,
      daily_task_budget: 5000,
      daily_call_budget: 5000,
      metadata: { allowed_model_lanes: ['minimax_public_cloud', 'public_scout', 'world_scout', 'scout', 'research'], requires_context_pack: true, requires_output_contract: true },
    }),
    normalizeWorkerProfile({
      id: 'codex-pr-engineer',
      title: 'Codex PR engineer',
      worker_kind: 'acp_codex',
      runtime: 'codex',
      provider: 'codex',
      model: 'openai-codex/default',
      allowed_privacy_tiers: ['P1', 'P2'],
      preferred_lanes: ['code_pr', 'code', 'pr', 'engineering'],
      task_types: ['code_pr', 'code'],
      max_concurrency: 2,
      daily_task_budget: 20,
      metadata: { allowed_model_lanes: ['codex_code', 'acp_codex', 'code_pr', 'code', 'pr', 'engineering'], requires_context_pack: true, requires_output_contract: true },
    }),
    normalizeWorkerProfile({
      id: 'claude-reviewer',
      title: 'Claude reviewer',
      worker_kind: 'claude_code',
      provider: 'claude-code',
      model: 'claude-code/default',
      allowed_privacy_tiers: ['P2', 'P3'],
      preferred_lanes: ['review', 'code_review', 'architecture_review'],
      task_types: ['review'],
      max_concurrency: 1,
      daily_task_budget: 10,
      metadata: { allowed_model_lanes: ['claude_code_review', 'review', 'code_review', 'architecture_review'], requires_context_pack: true, requires_output_contract: true },
    }),
  ];
}

export function routeWorkItemToWorkerProfile(item: OpsWorkItem, state: OpsState, opts: { profiles?: OpsWorkerProfile[]; now?: Date } = {}): OpsRouteDecision {
  const routed = selectWorkerRoute(item, opts.profiles ? { ...state, worker_profiles: opts.profiles } : state, { now: opts.now });
  const profile = routed.worker_profile_id ? (opts.profiles || state.worker_profiles).find(p => p.id === routed.worker_profile_id) : undefined;
  if (routed.status === 'selected' || routed.status === 'legacy') return { ok: true, work_item_id: item.id, reason: routed.reason, profile, provider: routed.provider, model: routed.model, runtime: routed.runtime };
  const policyDenied = routed.reason.includes('privacy') || routed.reason.includes('MiniMax') || routed.reason.includes('route guardrails');
  const concurrencyFull = routed.status === 'held' && routed.reason.includes('max_concurrency');
  const budgetExceeded = routed.status === 'held' || routed.reason.includes('budget');
  return { ok: false, work_item_id: item.id, reason: routed.reason, profile, provider: routed.provider, model: routed.model, runtime: routed.runtime, defer: policyDenied ? 'privacy_route_denied' : concurrencyFull ? 'concurrency_full' : budgetExceeded ? 'budget_exceeded' : 'no_matching_profile' };
}

export function parseProgramsYaml(raw: string): { programs: unknown[] } {
  const parsed = parseSimpleYaml(raw);
  if (!isObject(parsed) || !Array.isArray(parsed.programs)) throw new Error('program registry YAML must contain programs: [...]');
  return { programs: parsed.programs };
}

export function seedInitialWorkItemsFromProgramsYamlFile(file: string, opts: OpsStoreOptions & { force?: boolean } = {}): ProgramWorkSeedResult {
  const raw = readFileSync(file, 'utf8');
  const parsed = parseProgramsYaml(raw);
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const programs = parsed.programs.map(p => normalizeProgram(p, opts.now));
  for (const program of programs) appendEvent(path, 'program_upsert', program, opts.now);

  let state = readOpsState(path);
  const activePrograms = programs.filter(p => p.status === 'active');
  const created: OpsWorkItem[] = [];
  const skipped: ProgramWorkSeedResult['skipped'] = [];
  for (const program of activePrograms.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    const existing = state.work_items.filter(w => w.program_id === program.id && !['cancelled', 'quarantined'].includes(w.state));
    if (existing.length && opts.force !== true) {
      skipped.push({ program_id: program.id, reason: 'program already has non-cancelled WorkItems', work_item_ids: existing.map(w => w.id).sort() });
      continue;
    }
    const item = normalizeWorkItem(initialWorkItemForProgram(program), state, opts.now);
    appendEvent(path, 'work_upsert', item, opts.now);
    created.push(item);
    state = readOpsState(path);
  }
  return { ok: true, path, source_file: file, active_program_count: activePrograms.length, created_count: created.length, skipped_count: skipped.length, work_items: created, skipped };
}

function initialWorkItemForProgram(program: OpsProgram): Record<string, unknown> {
  const lanes = program.lanes.length ? program.lanes : ['general'];
  const lower = lanes.map(l => l.toLowerCase());
  const has = (...needles: string[]) => lower.some(l => needles.some(n => l.includes(n)));
  const code = has('code', 'engineering', 'migration', 'test_repair') || isCodeWritingProgram(program);
  const privateExtract = has('private', 'meeting', 'commitment', 'relationship', 'followup', 'memory_match', 'dossier');
  const publicScout = !privateExtract && (has('public_scout', 'world_scout', 'public_enrichment', 'public_professional_context') || isExternalPublicScoutProgram(program));
  const lane = publicScout ? (lower.find(l => ['public_scout', 'world_scout', 'public_enrichment', 'public_professional_context'].some(n => l.includes(n))) || lanes[0])
    : code ? (lower.find(l => ['code', 'engineering', 'migration', 'test_repair'].some(n => l.includes(n))) || lanes[0])
      : privateExtract ? (lower.find(l => ['private', 'meeting', 'commitment', 'relationship', 'followup', 'memory_match', 'dossier'].some(n => l.includes(n))) || lanes[0])
        : lanes[0];
  const workerKind = publicScout ? 'minimax' : code ? 'acp_codex' : privateExtract ? 'qwen_local' : 'subagent';
  const privacyTier = publicScout ? 'P3' : privateExtract ? 'P1_PRIVATE' : code ? 'P2' : 'P2';
  return {
    id: `seed-${program.id}-initial-loop`,
    program_id: program.id,
    title: `Start ${program.title}`,
    description: `Initial allocator-owned WorkItem for active program ${program.id}. Convert the program charter into the next concrete reducer/generator step, record artifacts in ops state, and recommend follow-on WorkItems instead of running as an untracked cron/report.`,
    state: 'ready',
    priority: program.priority,
    lane,
    lanes,
    worker_kind: workerKind,
    privacy_tier: privacyTier,
    source_refs: [{ kind: 'program_registry', ref: program.id }],
    dependencies: [],
    acceptance_criteria: [
      'Work is represented by ops WorkItems/Runs/Leases rather than an untracked cron prompt.',
      'Completion JSON records artifacts or an explicit discard/blocker.',
      'Next work recommendations are structured as candidate WorkItems when follow-up is needed.',
    ],
    expected_artifacts: [{ kind: 'ops_completion_json' }, { kind: 'work_item_recommendations' }],
    guardrails: program.approval_gates,
    approval_gates: program.approval_gates,
    budget: program.budgets,
    created_by: 'ops-program-seed',
    last_state_reason: 'seeded from active program registry',
  };
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

export function listWorkerProfiles(opts: OpsStoreOptions = {}): OpsWorkerProfile[] {
  return readOpsState(opts.path || opsStorePath()).worker_profiles.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
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

function optionalNonNegativeInteger(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function normalizedPrivacyTier(raw: unknown): string {
  const s = String(raw || '').toUpperCase();
  if (s.includes('P0')) return 'P0';
  if (s.includes('P1')) return 'P1';
  if (s.includes('P2')) return 'P2';
  if (s.includes('P3')) return 'P3';
  return s || 'P2';
}

function isSensitivePrivacy(raw: unknown): boolean {
  const tier = normalizedPrivacyTier(raw);
  return tier === 'P0' || tier === 'P1';
}

function isMiniMaxRoute(provider?: string, model?: string, workerKind?: string): boolean {
  return [provider, model, workerKind].filter(Boolean).some(v => String(v).toLowerCase().includes('minimax'));
}

function explicitPublicCloudAllowed(item: OpsWorkItem): boolean {
  const budget = object(item.budget);
  const redacted = budget.redacted === true || budget.redacted_input === true || budget.sanitized === true;
  const budgetAllows = redacted || ((budget.public_cloud_allowed === true || budget.allow_public_cloud === true) && redacted);
  if (budgetAllows) return true;
  return array(item.guardrails).some(g => isObject(g)
    && (g.public_cloud_allowed === true || g.allow_public_cloud === true)
    && (g.redacted === true || g.redacted_input === true || g.sanitized === true));
}

function runtimeForWorkerKind(workerKind: string): OpenClawDispatchRuntime | 'supervisor_placeholder' {
  const kind = workerKind.toLowerCase();
  if (['acp_codex', 'codex', 'acp', 'claude_code'].includes(kind)) return 'openclaw_acp_codex';
  if (['subagent', 'native_subagent', 'openclaw_subagent'].includes(kind)) return 'openclaw_subagent';
  return 'local_script_placeholder';
}

function routePolicyError(item: OpsWorkItem, provider?: string, model?: string, workerKind?: string, publicCloud?: boolean): string | undefined {
  const sensitive = isSensitivePrivacy(item.privacy_tier);
  const publicRoute = publicCloud === true || isMiniMaxRoute(provider, model, workerKind);
  if (sensitive && publicRoute && !explicitPublicCloudAllowed(item)) {
    return `${normalizedPrivacyTier(item.privacy_tier)} work cannot route to public cloud/MiniMax without explicit redaction allowance`;
  }
  if (isMiniMaxRoute(provider, model, workerKind) && normalizedPrivacyTier(item.privacy_tier) !== 'P3' && !explicitPublicCloudAllowed(item)) {
    return `MiniMax is restricted to P3 public or explicitly redacted/allowed work`;
  }
  return undefined;
}

function assertRouteAllowedForWork(item: OpsWorkItem, provider?: string, model?: string, workerKind?: string, publicCloud?: boolean): void {
  const error = routePolicyError(item, provider, model, workerKind, publicCloud);
  if (error) throw new Error(`route denied for ${item.id}: ${error}`);
}

function profileMetadataStringArray(profile: OpsWorkerProfile, key: string): string[] {
  const value = profile.metadata?.[key];
  return stringArray(value);
}

function profileAllowedModelLanes(profile: OpsWorkerProfile): string[] {
  return [...stringArray((profile as unknown as Record<string, unknown>).allowed_model_lanes), ...profileMetadataStringArray(profile, 'allowed_model_lanes')];
}

function profileRequires(profile: OpsWorkerProfile, key: 'requires_context_pack' | 'requires_output_contract'): boolean {
  return (profile as unknown as Record<string, unknown>)[key] === true || profile.metadata?.[key] === true;
}

function workItemRecord(item: OpsWorkItem): Record<string, unknown> {
  return item as unknown as Record<string, unknown>;
}

function dispatchFailClosedRequired(item: OpsWorkItem): boolean {
  const rec = workItemRecord(item);
  const budget = object(item.budget);
  return item.context_pack_required === true
    || item.output_contract_required === true
    || budget.fail_closed_dispatch === true
    || budget.serious_work === true
    || budget.strict_worker_routing === true
    || typeof rec.context_pack_id === 'string'
    || typeof rec.context_pack_path === 'string'
    || typeof rec.output_contract_id === 'string'
    || typeof rec.output_contract_path === 'string';
}

function requestedModelLane(item: OpsWorkItem): string {
  return String(item.model_lane || item.lane || stringArray(item.lanes)[0] || item.worker_kind || '').trim();
}

function hasDispatchContextPack(item: OpsWorkItem): boolean {
  const rec = workItemRecord(item);
  return Boolean(rec.context_pack_path || rec.contextPackPath || rec.context_pack_id || rec.contextPackId || (rec.context_pack && isObject(rec.context_pack)) || (rec.contextPack && isObject(rec.contextPack)));
}

function hasDispatchOutputContract(item: OpsWorkItem): boolean {
  const rec = workItemRecord(item);
  return Boolean(rec.output_contract_path || rec.outputContractPath || rec.output_contract_id || rec.outputContractId || (rec.output_contract && isObject(rec.output_contract)) || (rec.outputContract && isObject(rec.outputContract)) || (rec.completion_contract && isObject(rec.completion_contract)) || (rec.completionContract && isObject(rec.completionContract)) || rec.completion_json_path);
}

function failClosedRouteError(item: OpsWorkItem, profile?: OpsWorkerProfile): string | undefined {
  if (!dispatchFailClosedRequired(item)) return undefined;
  if (!profile) return 'no worker profile available for fail-closed WorkItem';
  if (!profile.allowed_privacy_tiers.length) return `${profile.id} missing allowed_privacy_tiers`;
  if (!profileAllowedModelLanes(profile).length) return `${profile.id} missing metadata.allowed_model_lanes`;
  if (!Number.isFinite(Number(profile.max_concurrency)) || Number(profile.max_concurrency) < 1) return `${profile.id} max_concurrency must be >= 1`;
  if (!profileRequires(profile, 'requires_context_pack')) return `${profile.id} does not require ContextPack; profile is not dispatch-safe`;
  if (!profileRequires(profile, 'requires_output_contract')) return `${profile.id} does not require OutputContract; profile is not dispatch-safe`;
  const requested = requestedModelLane(item).toLowerCase();
  const allowed = profileAllowedModelLanes(profile).map(s => s.toLowerCase());
  const routedLane = String(item.lane || '').toLowerCase();
  const routedKind = String(profile.worker_kind || item.worker_kind || '').toLowerCase();
  if (requested && !allowed.includes(requested) && !allowed.includes(routedLane) && !allowed.includes(routedKind)) {
    return `${profile.id} does not allow model lane ${requestedModelLane(item)}`;
  }
  if (!hasDispatchContextPack(item)) return 'missing ContextPack; no dispatch';
  if (item.context_pack_required === true && item.context_pack_status !== 'validated') return `ContextPack status must be validated (got ${item.context_pack_status || 'missing'})`;
  if (!hasDispatchOutputContract(item)) return 'missing OutputContract/completion contract; no dispatch';
  return undefined;
}

function profileMatchesManualOverride(profile: OpsWorkerProfile, provider?: string, model?: string): boolean {
  if (provider && profile.provider !== provider) return false;
  if (model && profile.model !== model) return false;
  return true;
}

export function selectWorkerRoute(item: OpsWorkItem, state: OpsState, opts: { now?: Date; provider?: string; model?: string } = {}): OpsWorkerRouteDecision {
  const failClosed = dispatchFailClosedRequired(item);
  if (opts.provider || opts.model) {
    const matchingProfiles = state.worker_profiles.filter(p => profileMatchesManualOverride(p, opts.provider, opts.model));
    const profile = item.worker_profile_id ? matchingProfiles.find(p => p.id === item.worker_profile_id) : matchingProfiles[0];
    if (failClosed) {
      if (!profile) {
        return { status: 'denied', work_item_id: item.id, worker_kind: item.worker_kind, runtime: runtimeForWorkerKind(item.worker_kind), provider: opts.provider || String(item.budget.provider || 'local'), model: opts.model || (typeof item.budget.model === 'string' ? item.budget.model : undefined), reason: 'manual provider/model override has no matching worker profile; no dispatch', skipped: [] };
      }
      const error = failClosedRouteError(item, profile);
      if (error) {
        return { status: 'denied', work_item_id: item.id, worker_profile_id: profile.id, worker_kind: profile.worker_kind, runtime: profile.runtime, provider: profile.provider, model: profile.model, reason: error, skipped: [{ worker_profile_id: profile.id, reason: error }] };
      }
    }
    assertRouteAllowedForWork(item, opts.provider, opts.model, profile?.worker_kind || item.worker_kind, profile?.public_cloud ?? isMiniMaxRoute(opts.provider, opts.model, item.worker_kind));
    return {
      status: 'legacy',
      work_item_id: item.id,
      worker_profile_id: profile?.id,
      worker_kind: item.worker_kind,
      runtime: runtimeForWorkerKind(item.worker_kind),
      provider: opts.provider || String(item.budget.provider || 'local'),
      model: opts.model || (typeof item.budget.model === 'string' ? item.budget.model : undefined),
      reason: 'manual provider/model override passed route guardrails',
      skipped: [],
    };
  }

  const profiles = state.worker_profiles;
  if (!profiles.length) {
    if (failClosed) {
      return { status: 'denied', work_item_id: item.id, worker_kind: item.worker_kind, runtime: runtimeForWorkerKind(item.worker_kind), provider: legacyProviderForWorkerKind(item.worker_kind), model: legacyModelForWorkerKind(item.worker_kind, legacyProviderForWorkerKind(item.worker_kind)), reason: 'no synced worker profiles; fail-closed WorkItem cannot use legacy route', skipped: [] };
    }
    const budget = object(item.budget);
    const provider = typeof budget.provider === 'string' ? budget.provider : legacyProviderForWorkerKind(item.worker_kind);
    const model = typeof budget.model === 'string' ? budget.model : legacyModelForWorkerKind(item.worker_kind, provider);
    assertRouteAllowedForWork(item, provider, model, item.worker_kind, isMiniMaxRoute(provider, model, item.worker_kind));
    return { status: 'legacy', work_item_id: item.id, worker_kind: item.worker_kind, runtime: runtimeForWorkerKind(item.worker_kind), provider, model, reason: 'no synced worker profiles; using legacy worker_kind route', skipped: [] };
  }

  const scored = profiles.map(profile => ({ profile, score: workerProfileScore(profile, item) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || b.profile.priority - a.profile.priority || a.profile.id.localeCompare(b.profile.id));
  const skipped: OpsWorkerRouteDecision['skipped'] = [];
  const held: Array<{ profile: OpsWorkerProfile; budget: NonNullable<OpsWorkerRouteDecision['budget']>; reason: string }> = [];

  for (const { profile } of scored) {
    if (item.worker_profile_id && profile.id !== item.worker_profile_id) {
      skipped.push({ worker_profile_id: profile.id, reason: `requested worker_profile_id ${item.worker_profile_id}` });
      continue;
    }
    const privacy = normalizedPrivacyTier(item.privacy_tier);
    if (profile.allowed_privacy_tiers.length && !profile.allowed_privacy_tiers.map(normalizedPrivacyTier).includes(privacy)) {
      skipped.push({ worker_profile_id: profile.id, reason: `privacy tier ${privacy} not allowed` });
      continue;
    }
    const failClosedError = failClosedRouteError(item, profile);
    if (failClosedError) {
      skipped.push({ worker_profile_id: profile.id, reason: failClosedError });
      continue;
    }
    const policyError = routePolicyError(item, profile.provider, profile.model, profile.worker_kind, profile.public_cloud);
    if (policyError) {
      skipped.push({ worker_profile_id: profile.id, reason: policyError });
      continue;
    }
    const budget = evaluateProfileBudget(profile, state, opts.now || new Date());
    if (budget.reason) {
      skipped.push({ worker_profile_id: profile.id, reason: budget.reason });
      held.push({ profile, budget: budget.budget, reason: budget.reason });
      continue;
    }
    return {
      status: 'selected',
      work_item_id: item.id,
      worker_profile_id: profile.id,
      worker_kind: profile.worker_kind,
      runtime: profile.runtime,
      provider: profile.provider,
      model: profile.model,
      reason: `selected ${profile.id} by deterministic worker profile routing`,
      budget: budget.budget,
      skipped,
    };
  }

  if (held.length) {
    const best = held[0];
    return { status: 'held', work_item_id: item.id, worker_profile_id: best.profile.id, worker_kind: best.profile.worker_kind, runtime: best.profile.runtime, provider: best.profile.provider, model: best.profile.model, reason: best.reason, budget: best.budget, skipped };
  }

  return { status: 'denied', work_item_id: item.id, worker_kind: item.worker_kind, runtime: runtimeForWorkerKind(item.worker_kind), provider: legacyProviderForWorkerKind(item.worker_kind), model: legacyModelForWorkerKind(item.worker_kind, legacyProviderForWorkerKind(item.worker_kind)), reason: skipped.length ? `no worker profile passed route guardrails: ${skipped.map(s => `${s.worker_profile_id}: ${s.reason}`).join('; ')}` : 'no matching worker profile for work item', skipped };
}

function workerProfileScore(profile: OpsWorkerProfile, item: OpsWorkItem): number {
  const profileId = profile.id.toLowerCase();
  const kind = String(item.worker_kind || '').toLowerCase();
  const lane = String(item.lane || '').toLowerCase();
  const lanes = [lane, ...stringArray(item.lanes).map(s => s.toLowerCase())];
  const title = `${item.title} ${item.description}`.toLowerCase();
  const taskTypes = profile.task_types.map(s => s.toLowerCase());
  const preferred = profile.preferred_lanes.map(s => s.toLowerCase());
  const allowedModelLanes = profileAllowedModelLanes(profile).map(s => s.toLowerCase());
  let score = 0;
  if (profile.worker_kind.toLowerCase() === kind || profileId === kind) score += 100;
  if (preferred.some(l => lanes.includes(l))) score += 50;
  if (allowedModelLanes.some(l => lanes.includes(l) || l === kind)) score += 60;
  if (taskTypes.some(t => lanes.includes(t) || title.includes(t.replace(/_/g, ' ')))) score += 30;
  const isPublicScout = normalizedPrivacyTier(item.privacy_tier) === 'P3' && (lanes.some(l => ['scout', 'public_scout', 'world_scout', 'research'].includes(l)) || title.includes('public scout'));
  if (isPublicScout && isMiniMaxRoute(profile.provider, profile.model, profile.worker_kind)) score += 120;
  const isCodePr = lanes.some(l => ['code', 'pr', 'engineering'].includes(l)) || kind.includes('codex') || title.includes(' pr ') || title.includes('pull request');
  if (isCodePr && (profile.provider.toLowerCase().includes('codex') || profile.worker_kind.toLowerCase().includes('codex') || profileId.includes('codex'))) score += 120;
  const isPrivateExtraction = isSensitivePrivacy(item.privacy_tier) && (lanes.some(l => ['extraction', 'private_extraction', 'memory_extraction'].includes(l)) || kind.includes('qwen') || title.includes('private extraction'));
  if (isPrivateExtraction && (profile.provider.toLowerCase().includes('local') || profile.provider.toLowerCase().includes('qwen') || profile.model?.toLowerCase().includes('qwen') || profileId.includes('qwen'))) score += 120;
  const isReview = lanes.some(l => ['review', 'code_review'].includes(l)) || title.includes('review');
  if (isReview && (profile.provider.toLowerCase().includes('claude') || profileId.includes('claude'))) score += 80;
  return score;
}

function evaluateProfileBudget(profile: OpsWorkerProfile, state: OpsState, now: Date): { reason?: string; budget: NonNullable<OpsWorkerRouteDecision['budget']> } {
  const day = now.toISOString().slice(0, 10);
  const activeLeases = state.leases.filter(l => l.lease_status === 'active' && Date.parse(l.expires_at) > now.getTime() && l.metadata?.worker_profile_id === profile.id).length;
  const activeRuns = state.runs.filter(r => r.worker_profile_id === profile.id && ACTIVE_RUN_STATUSES.has(r.status)).length;
  const active = Math.max(activeLeases, activeRuns);
  const profileLedger = state.budget_ledger.filter(e => e.occurred_at.slice(0, 10) === day && e.metadata?.worker_profile_id === profile.id);
  const providerLedger = state.budget_ledger.filter(e => e.occurred_at.slice(0, 10) === day && e.provider === profile.provider && (profile.model ? e.model === profile.model : true));
  const dailyTasksUsed = profileLedger.reduce((sum, e) => sum + (e.calls || 0), 0);
  const dailyCallsUsed = providerLedger.reduce((sum, e) => sum + (e.calls || 0), 0);
  const budget = { max_concurrency: profile.max_concurrency, active_concurrency: active, daily_task_budget: profile.daily_task_budget, daily_tasks_used: dailyTasksUsed, daily_call_budget: profile.daily_call_budget, daily_calls_used: dailyCallsUsed, day };
  if (active >= profile.max_concurrency) return { reason: `budget_deferred: ${profile.id} max_concurrency ${profile.max_concurrency} reached`, budget };
  if (profile.daily_task_budget !== undefined && dailyTasksUsed >= profile.daily_task_budget) return { reason: `budget_deferred: ${profile.id} daily_task_budget ${profile.daily_task_budget} reached`, budget };
  if (profile.daily_call_budget !== undefined && dailyCallsUsed >= profile.daily_call_budget) return { reason: `budget_deferred: ${profile.provider}${profile.model ? `/${profile.model}` : ''} daily_call_budget ${profile.daily_call_budget} reached`, budget };
  return { budget };
}

function legacyProviderForWorkerKind(workerKind: WorkerKind): string {
  const kind = String(workerKind || '').toLowerCase();
  if (['acp_codex', 'codex', 'acp'].includes(kind)) return 'codex';
  if (kind === 'claude_code') return 'claude-code';
  if (kind.includes('minimax')) return 'minimax';
  if (kind.includes('qwen')) return 'local-qwen';
  if (['subagent', 'native_subagent', 'openclaw_subagent'].includes(kind)) return 'openclaw';
  return 'local';
}

function legacyModelForWorkerKind(workerKind: WorkerKind, provider: string): string | undefined {
  const kind = String(workerKind || '').toLowerCase();
  if (provider === 'codex') return 'openai-codex/default';
  if (provider === 'claude-code') return 'claude-code/default';
  if (provider === 'openclaw') return 'native-subagent';
  if (kind.includes('minimax')) return 'MiniMax-M2.7';
  if (kind.includes('qwen')) return 'mlx-community/Qwen3.6-35B-A3B-4bit';
  return undefined;
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
  assertOpsControlsAllowWork(state, item);
  if (!['ready', 'running', 'leased'].includes(item.state)) throw new Error(`work item ${id} is not dispatchable (state=${item.state})`);

  let claimed: ReturnType<typeof claimWorkItem> | undefined;
  let lease: OpsLease | undefined;
  let run: OpsWorkRun | undefined;
  if (item.state === 'ready') {
    const initialPlan = openClawRuntimePlan(item, opts, state);
    claimed = claimWorkItem(id, opts.workerId || initialPlan.worker_profile_id || `openclaw-dispatch-${initialPlan.runtime}`, { path, now, leaseMinutes: opts.leaseMinutes || 60, runtime: initialPlan.runtime, runStatus: 'starting', provider: initialPlan.provider, model: initialPlan.model, workerProfileId: initialPlan.worker_profile_id });
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
  const plan = openClawRuntimePlan(item, opts, state);
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
    worker_profile_id: plan.worker_profile_id,
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

function openClawRuntimePlan(item: OpsWorkItem, opts: OpsDispatchOptions, state?: OpsState): { runtime: OpenClawDispatchRuntime; provider: string; model?: string; worker_profile_id?: string; command_payload: Record<string, unknown> } {
  const route = state ? selectWorkerRoute(item, state, { now: opts.now, provider: opts.provider, model: opts.model }) : undefined;
  if (route?.status === 'held') throw new Error(`route held for ${item.id}: ${route.reason}`);
  if (route?.status === 'denied') throw new Error(`route denied for ${item.id}: ${route.reason}`);
  const routedKind = route?.worker_kind || item.worker_kind;
  const kind = String(routedKind || '').toLowerCase();
  const budget = object(item.budget);
  const model = route?.model || opts.model || (typeof budget.model === 'string' ? budget.model : undefined);
  const providerOverride = route?.provider || opts.provider;
  assertRouteAllowedForWork(item, providerOverride, model, routedKind, route?.status === 'selected' ? state?.worker_profiles.find(p => p.id === route.worker_profile_id)?.public_cloud : undefined);
  if (['subagent', 'native_subagent', 'openclaw_subagent'].includes(kind)) {
    const provider = providerOverride || 'openclaw';
    return {
      runtime: 'openclaw_subagent',
      provider,
      model: model || 'native-subagent',
      worker_profile_id: route?.worker_profile_id,
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
    const provider = providerOverride || (kind === 'claude_code' ? 'claude-code' : 'codex');
    return {
      runtime: 'openclaw_acp_codex',
      provider,
      model: model || (provider === 'claude-code' ? 'claude-code/default' : 'openai-codex/default'),
      worker_profile_id: route?.worker_profile_id,
      command_payload: {
        tool: 'acp_session',
        mode: opts.dryRun === false && opts.allowLive === true ? 'live_opt_in' : 'dry_run',
        runtime: provider,
        work_item_id: item.id,
        prompt_file: `ops/work-packs/${sanitizePathPart(item.id)}.md`,
      },
    };
  }
  const provider = providerOverride || (typeof budget.provider === 'string' ? budget.provider : 'local');
  return {
    runtime: 'local_script_placeholder',
    provider,
    model,
    worker_profile_id: route?.worker_profile_id,
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

export function claimWorkItem(id: string, workerId: string, opts: OpsStoreOptions & { leaseMinutes?: number; runtime?: string; runStatus?: RunStatus; provider?: string; model?: string; workerProfileId?: string } = {}): { ok: true; work_item: OpsWorkItem; lease: OpsLease; run: OpsWorkRun } {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const state = readOpsState(path);
  const item = state.work_items.find(w => w.id === id);
  if (!item) throw new Error(`work item not found: ${id}`);
  assertOpsControlsAllowWork(state, item);
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
    worker_profile_id: opts.workerProfileId,
    worker_id: workerId,
    provider: opts.provider,
    model: opts.model,
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
    metadata: opts.workerProfileId ? { worker_profile_id: opts.workerProfileId, provider: opts.provider, model: opts.model } : {},
  };
  const updated: OpsWorkItem = { ...item, state: 'running', updated_at: at, last_state_reason: `claimed by ${workerId}` };
  appendEvent(path, 'run_upsert', run, opts.now);
  appendEvent(path, 'lease_upsert', lease, opts.now);
  appendEvent(path, 'work_upsert', updated, opts.now);
  if (opts.provider || opts.workerProfileId) {
    const latest = readOpsState(path);
    const ledger: OpsBudgetLedgerEntry = {
      id: nextNumericId(latest.budget_ledger),
      provider: opts.provider || 'unknown',
      model: opts.model,
      program_id: item.program_id,
      work_item_id: id,
      run_id: run.id,
      calls: 1,
      occurred_at: at,
      metadata: { kind: 'task_reservation', worker_profile_id: opts.workerProfileId, worker_id: workerId },
    };
    appendEvent(path, 'budget_ledger', ledger, opts.now);
  }
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
    for (const item of candidates) {
      if (claimed.length >= claimLimit) break;
      const routeState = state.worker_profiles.length ? state : { ...state, worker_profiles: defaultWorkerProfiles() };
      const route = selectWorkerRoute(item, routeState, { now });
      if (route.status === 'held') {
        decisions.push({ action: 'defer_work_item', work_item_id: item.id, worker_profile_id: route.worker_profile_id, reason: route.reason, defer: /concurrency/i.test(route.reason) ? 'concurrency_full' : 'budget_exceeded', budget: route.budget });
        continue;
      }
      if (route.status === 'denied') {
        const denied: OpsWorkItem = { ...item, state: 'blocked', updated_at: at, last_state_reason: `route_denied: ${route.reason}` };
        appendEvent(path, 'work_upsert', denied, now);
        decisions.push({ action: 'route_denied_work_item', work_item_id: item.id, reason: route.reason, skipped: route.skipped });
        state = readOpsState(path);
        continue;
      }
      const result = claimWorkItem(item.id, opts.workerId || route.worker_profile_id || workerId, { path, now, leaseMinutes: opts.leaseMinutes || 30, runtime: route.runtime, runStatus: 'running', provider: route.provider, model: route.model, workerProfileId: route.worker_profile_id });
      claimed.push(result);
      decisions.push({ action: 'claim_work_item', work_item_id: item.id, lease_id: result.lease.id, run_id: result.run.id, runtime: result.run.runtime, provider: route.provider, model: route.model, worker_profile_id: route.worker_profile_id, route_reason: route.reason });
      state = readOpsState(path);
    }
    if (candidates.length === 0) decisions.push({ action: 'claim_skipped', reason: 'no_ready_claim_candidates' });
    else if (claimed.length === 0) decisions.push({ action: 'claim_skipped', reason: 'all_ready_candidates_deferred' });
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
  if (deriveControlState(state).kill_switch.enabled) return [];
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
  const nowMs = now.getTime();
  const recentCutoffMs = nowMs - 24 * 60 * 60 * 1000;
  const ready = state.work_items.filter(w => w.state === 'ready');
  const activeValidLeases = state.leases.filter(l => l.lease_status === 'active' && Date.parse(l.expires_at) > nowMs);
  const activeProgramsWithoutWork = state.programs.filter(p => p.status === 'active').filter(p => {
    const items = state.work_items.filter(w => w.program_id === p.id);
    return !items.some(w => w.state === 'ready' || activeState(w.state) || Date.parse(w.updated_at) >= recentCutoffMs);
  });
  if (activeProgramsWithoutWork.length) {
    alerts.push({ kind: 'active_program_without_work', severity: 'red', message: 'Active programs have no ready, running, or recently updated WorkItems; seed or generate allocator-owned work.', program_ids: activeProgramsWithoutWork.map(p => p.id) });
  }
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


function isTruthyFlag(v: unknown): boolean { return v === true || v === 'true' || v === 'yes'; }
function programCanContactPeople(program?: OpsProgram): boolean { return isTruthyFlag(program?.autonomy?.can_contact_people) || isTruthyFlag(program?.autonomy?.external_message_send); }
function programCanMutateTrustedMemory(program?: OpsProgram): boolean { return isTruthyFlag(program?.autonomy?.can_mutate_trusted_memory) || isTruthyFlag(program?.autonomy?.trusted_memory_write); }
function isCodeWritingProgram(program: OpsProgram): boolean {
  const lanes = program.lanes.map(l => l.toLowerCase());
  return lanes.some(l => ['code', 'code_pr', 'pr', 'engineering', 'test_repair', 'migration'].includes(l)) || isTruthyFlag(program.autonomy?.can_modify_code) || isTruthyFlag(program.autonomy?.can_commit);
}
function isExternalPublicScoutProgram(program: OpsProgram): boolean {
  const lanes = program.lanes.map(l => l.toLowerCase());
  return lanes.some(l => ['public_scout', 'world_scout', 'scout', 'public_enrichment', 'public_professional_context'].includes(l)) || isTruthyFlag(program.autonomy?.can_ingest_public_sources) || isTruthyFlag(program.autonomy?.can_scan_public_professional_context);
}
function programMatchesControlTarget(program: OpsProgram, target: string): boolean {
  const t = target.toLowerCase();
  if (program.id === target) return true;
  if (['all-public-scouts', 'public-scouts', 'external-public-scouts', 'external-scouts'].includes(t)) return isExternalPublicScoutProgram(program);
  if (['code-writing', 'code-writers', 'code', 'code-pr'].includes(t)) return isCodeWritingProgram(program);
  if (['all', '*'].includes(t)) return true;
  return false;
}
function deriveControlState(state: OpsState): OpsControlState {
  const latestByAction = state.control_events.at(-1);
  const kill = [...state.control_events].reverse().find(e => e.action === 'kill_switch_on' || e.action === 'kill_switch_off');
  const pausedProgramIds = state.programs.filter(p => p.status === 'paused').map(p => p.id).sort();
  return {
    kill_switch: kill?.action === 'kill_switch_on' ? { enabled: true, since: kill.created_at, reason: kill.reason } : { enabled: false, since: kill?.created_at, reason: kill?.reason },
    paused_program_ids: pausedProgramIds,
    paused_public_scout_program_ids: state.programs.filter(p => p.status === 'paused' && isExternalPublicScoutProgram(p)).map(p => p.id).sort(),
    code_writing_program_ids: state.programs.filter(isCodeWritingProgram).map(p => p.id).sort(),
    latest_event: latestByAction,
  };
}
function assertOpsControlsAllowWork(state: OpsState, item: OpsWorkItem): void {
  const control = deriveControlState(state);
  if (control.kill_switch.enabled) throw new Error(`ops kill switch is ON; refusing to claim or dispatch work item ${item.id}`);
  const program = state.programs.find(p => p.id === item.program_id);
  if (program?.status === 'paused') throw new Error(`program ${program.id} is paused; refusing to claim or dispatch work item ${item.id}`);
}
export function pauseOpsProgram(programId: string, opts: OpsStoreOptions & { reason?: string } = {}): { ok: true; schema: typeof OPS_CONTROL_SCHEMA; path: string; event: OpsControlEvent; affected_programs: OpsProgram[]; affected_topic_tracks: OpsTopicTrack[] } {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const state = readOpsState(path);
  const at = nowIso(opts.now);
  const programs = state.programs.filter(p => programMatchesControlTarget(p, programId));
  if (!programs.length) throw new Error(`no program matched pause target: ${programId}`);
  const updatedPrograms = programs.map(p => ({ ...p, status: 'paused' as ProgramStatus, updated_at: at }));
  const updatedTracks = state.topic_tracks.filter(t => programs.some(p => p.id === t.program_id) || programMatchesControlTarget({ ...(state.programs.find(p => p.id === t.program_id) || programs[0]), id: t.program_id } as OpsProgram, programId)).map(t => ({ ...t, status: 'paused' as ProgramStatus, updated_at: at }));
  for (const program of updatedPrograms) appendEvent(path, 'program_upsert', program, opts.now);
  for (const track of updatedTracks) appendEvent(path, 'topic_track_upsert', track, opts.now);
  const event: OpsControlEvent = { schema: OPS_CONTROL_SCHEMA, id: hashId('control', { action: 'pause_program', programId, at }), action: 'pause_program', program_id: programId, reason: opts.reason, affected_program_ids: updatedPrograms.map(p => p.id), affected_topic_track_ids: updatedTracks.map(t => t.id), created_at: at };
  appendEvent(path, 'control_event', event, opts.now);
  return { ok: true, schema: OPS_CONTROL_SCHEMA, path, event, affected_programs: updatedPrograms, affected_topic_tracks: updatedTracks };
}
export function resumeOpsProgram(programId: string, opts: OpsStoreOptions & { reason?: string } = {}): { ok: true; schema: typeof OPS_CONTROL_SCHEMA; path: string; event: OpsControlEvent; affected_programs: OpsProgram[]; affected_topic_tracks: OpsTopicTrack[] } {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const state = readOpsState(path);
  const at = nowIso(opts.now);
  const programs = state.programs.filter(p => programMatchesControlTarget(p, programId));
  if (!programs.length) throw new Error(`no program matched resume target: ${programId}`);
  const updatedPrograms = programs.map(p => ({ ...p, status: 'active' as ProgramStatus, updated_at: at }));
  const updatedTracks = state.topic_tracks.filter(t => programs.some(p => p.id === t.program_id)).map(t => ({ ...t, status: 'active' as ProgramStatus, updated_at: at }));
  for (const program of updatedPrograms) appendEvent(path, 'program_upsert', program, opts.now);
  for (const track of updatedTracks) appendEvent(path, 'topic_track_upsert', track, opts.now);
  const event: OpsControlEvent = { schema: OPS_CONTROL_SCHEMA, id: hashId('control', { action: 'resume_program', programId, at }), action: 'resume_program', program_id: programId, reason: opts.reason, affected_program_ids: updatedPrograms.map(p => p.id), affected_topic_track_ids: updatedTracks.map(t => t.id), created_at: at };
  appendEvent(path, 'control_event', event, opts.now);
  return { ok: true, schema: OPS_CONTROL_SCHEMA, path, event, affected_programs: updatedPrograms, affected_topic_tracks: updatedTracks };
}
export function setOpsKillSwitch(enabled: boolean, opts: OpsStoreOptions & { reason?: string } = {}): { ok: true; schema: typeof OPS_CONTROL_SCHEMA; path: string; event: OpsControlEvent; control: OpsControlState } {
  const path = opts.path || opsStorePath();
  initOpsStore(path, opts.now);
  const state = readOpsState(path);
  const at = nowIso(opts.now);
  const event: OpsControlEvent = { schema: OPS_CONTROL_SCHEMA, id: hashId('control', { action: enabled ? 'kill_switch_on' : 'kill_switch_off', at }), action: enabled ? 'kill_switch_on' : 'kill_switch_off', reason: opts.reason, affected_program_ids: state.programs.map(p => p.id), affected_topic_track_ids: state.topic_tracks.map(t => t.id), created_at: at };
  appendEvent(path, 'control_event', event, opts.now);
  return { ok: true, schema: OPS_CONTROL_SCHEMA, path, event, control: deriveControlState(readOpsState(path)) };
}
export function buildOpsSafetyAudit(state: OpsState): OpsSafetyAudit {
  const activeItems = state.work_items.filter(w => activeState(w.state));
  const activeIds = new Set(activeItems.map(w => w.id));
  const hidden = state.runs.filter(r => ACTIVE_RUN_STATUSES.has(r.status) && !activeIds.has(r.work_item_id));
  const activeTasks = activeItems.map(w => {
    const program = state.programs.find(p => p.id === w.program_id);
    const canContact = programCanContactPeople(program);
    const canMutate = programCanMutateTrustedMemory(program);
    const isScout = !!program && isExternalPublicScoutProgram(program);
    const reasons = [canContact ? 'program autonomy permits contacting people' : 'program autonomy denies contacting people', canMutate ? 'program autonomy permits trusted memory mutation' : 'program autonomy denies trusted memory mutation', isScout ? 'external/public scout lane' : 'not an external/public scout lane'];
    return { work_item_id: w.id, program_id: w.program_id, title: w.title, state: w.state, lane: w.lane, worker_kind: w.worker_kind, can_contact_people: canContact, can_mutate_trusted_memory: canMutate, is_external_public_scout: isScout, reason: reasons.join('; ') };
  });
  const hiddenActiveRuns = hidden.map(r => ({ run_id: r.id, work_item_id: r.work_item_id, program_id: r.program_id, status: r.status, reason: 'active run has no active work item in ops state' }));
  const contact = activeTasks.filter(t => t.can_contact_people).length;
  const mutate = activeTasks.filter(t => t.can_mutate_trusted_memory).length;
  return { ok: hiddenActiveRuns.length === 0 && contact === 0 && mutate === 0, hidden_active_task_count: hiddenActiveRuns.length, contact_risk_count: contact, trusted_memory_mutation_risk_count: mutate, external_public_scout_active_count: activeTasks.filter(t => t.is_external_public_scout).length, active_tasks: activeTasks, hidden_active_runs: hiddenActiveRuns };
}
function parseLastWindow(raw?: string): number {
  if (!raw) return 24 * 60 * 60 * 1000;
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)(m|h|d)$/i);
  if (!m) throw new Error('--last must look like 30m, 24h, or 7d');
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return n * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
}
export function buildOpsMetrics(opts: OpsStoreOptions & { last?: string } = {}): OpsMetricsWindow {
  const path = opts.path || opsStorePath();
  const state = readOpsState(path);
  const until = opts.now || new Date();
  const ms = parseLastWindow(opts.last);
  const since = new Date(until.getTime() - ms);
  const sinceMs = since.getTime();
  const inWindow = (iso?: string) => !!iso && Date.parse(iso) >= sinceMs && Date.parse(iso) <= until.getTime();
  const windowItems = state.work_items.filter(w => inWindow(w.updated_at));
  const byProgram = state.programs.map(p => {
    const items = state.work_items.filter(w => w.program_id === p.id);
    return { program_id: p.id, status: p.status, ready: items.filter(w => w.state === 'ready').length, running: items.filter(w => activeState(w.state)).length, succeeded: items.filter(w => w.state === 'succeeded' && inWindow(w.updated_at)).length, failed: items.filter(w => w.state === 'failed' && inWindow(w.updated_at)).length, blocked: items.filter(w => w.state === 'blocked').length, waiting_human: items.filter(w => w.state === 'waiting_human').length };
  });
  return { ok: true, schema: 'gbrain.ops.metrics.v1', generated_at: nowIso(until), store_path: path, window: { last: opts.last || '24h', since: since.toISOString(), until: until.toISOString() }, counts: countOps(state, until), completions: windowItems.filter(w => w.state === 'succeeded').length, failures: windowItems.filter(w => w.state === 'failed').length, active_runs: state.runs.filter(r => ACTIVE_RUN_STATUSES.has(r.status)).length, ready_backlog: state.work_items.filter(w => w.state === 'ready').length, stale_active_lease_count: countOps(state, until).stale_active_lease_count, budget_usage: summarizeBudgetUsage(state.budget_ledger.filter(e => inWindow(e.occurred_at))), programs: byProgram, control: deriveControlState(state), safety_audit: buildOpsSafetyAudit(state) };
}

export function countOps(state: OpsState, now?: Date): {
  programs: Record<string, number>;
  work_items: Record<string, number>;
  runs: Record<string, number>;
  leases: Record<string, number>;
  artifacts: number;
  supervisor_ticks: number;
  interrupts: Record<string, number>;
  budget_ledger: number;
  control_events: number;
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
    control_events: state.control_events.length,
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
  const control = deriveControlState(state);
  return {
    generated_at: nowIso(now),
    store_path: path,
    active_programs: [...state.programs].filter(p => p.status === 'active').sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)),
    paused_programs: [...state.programs].filter(p => p.status === 'paused').sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)),
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
    control,
    safety_audit: buildOpsSafetyAudit(state),
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
  lines.push('## Control plane');
  lines.push('');
  lines.push(`- Kill switch: **${dashboard.control.kill_switch.enabled ? 'ON' : 'off'}**${dashboard.control.kill_switch.reason ? ` — ${dashboard.control.kill_switch.reason}` : ''}`);
  lines.push(`- Paused programs: ${dashboard.control.paused_program_ids.length ? dashboard.control.paused_program_ids.join(', ') : 'none'}`);
  lines.push(`- Safety audit: **${dashboard.safety_audit.ok ? 'ok' : 'attention'}** (hidden=${dashboard.safety_audit.hidden_active_task_count}, contact-risk=${dashboard.safety_audit.contact_risk_count}, trusted-memory-risk=${dashboard.safety_audit.trusted_memory_mutation_risk_count})`);
  lines.push('');
  lines.push('## Active programs');
  lines.push('');
  pushProgramRows(lines, dashboard.active_programs);
  lines.push('');
  lines.push('## Paused programs');
  lines.push('');
  pushProgramRows(lines, dashboard.paused_programs);
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
