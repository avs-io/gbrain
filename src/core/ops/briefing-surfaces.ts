import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  buildOpsDashboard,
  opsStorePath,
  readOpsState,
  type OpsArtifact,
  type OpsProgram,
  type OpsState,
  type OpsWorkItem,
  type OpsWorkRun,
} from './kernel.ts';
import {
  buildOpportunityBriefReadySurface,
  opportunityStorePath,
  readOpportunityStore,
  type OpsOpportunityCandidate,
  type OpportunityBriefReadySurface,
} from './opportunity-radar.ts';

export const OPS_MORNING_BRIEF_SCHEMA = 'gbrain.ops.morning_brief.v1';
export const OPS_DAILY_BUILD_REPORT_SCHEMA = 'gbrain.ops.daily_build_report.v1';
export const OPS_WEEKLY_STRATEGY_SYNTHESIS_SCHEMA = 'gbrain.ops.weekly_strategy_synthesis.v1';

export interface BriefingStoreOptions {
  opsStorePath?: string;
  opportunityStorePath?: string;
  now?: Date;
  limit?: number;
}

export interface BriefingGuardrails {
  brief_ready: true;
  external_sent: false;
  review_only: true;
  trusted_personal_memory_mutated: false;
  raw_vibes_used: false;
  sources: Array<{ kind: 'ops_kernel' | 'opportunity_radar'; path: string; structured_store: true; record_count: number }>;
}

export interface MorningBriefSurface {
  schema: typeof OPS_MORNING_BRIEF_SCHEMA;
  ok: true;
  generated_at: string;
  headline: string;
  top_focus: Array<Pick<OpsWorkItem, 'id' | 'program_id' | 'title' | 'state' | 'priority' | 'lane' | 'deadline_at' | 'last_state_reason'>>;
  decisions_needed: Array<{ id: string; kind: 'work_item' | 'interrupt'; title: string; reason: string; severity?: string; proposed_action?: string }>;
  top_opportunities: Array<Pick<OpsOpportunityCandidate, 'id' | 'title' | 'summary' | 'why_now' | 'recommended_action' | 'scores' | 'evidence'>>;
  yesterday_completions: Array<Pick<OpsWorkItem, 'id' | 'program_id' | 'title' | 'updated_at' | 'last_state_reason'>>;
  watchlist: Array<{ id: string; title: string; state: string; reason: string }>;
  omitted_low_signal: { ready_or_running: number; opportunities: number; completions: number; interrupts: number };
  guardrails: BriefingGuardrails;
}

export interface DailyBuildReportSurface {
  schema: typeof OPS_DAILY_BUILD_REPORT_SCHEMA;
  ok: true;
  generated_at: string;
  window: { since: string; until: string };
  headline: string;
  completed_work: Array<{ id: string; program_id: string; title: string; summary?: string; completed_at: string; checks_run: unknown[]; artifacts: Array<Pick<OpsArtifact, 'kind' | 'path' | 'ref' | 'summary'>> }>;
  active_or_ready: Array<Pick<OpsWorkItem, 'id' | 'program_id' | 'title' | 'state' | 'priority' | 'lane'>>;
  failures_and_blockers: Array<{ id: string; title: string; state: string; reason: string }>;
  supervisor_health: ReturnType<typeof buildOpsDashboard>['supervisor_health'];
  guardrails: BriefingGuardrails;
}

export interface WeeklyStrategySynthesisSurface {
  schema: typeof OPS_WEEKLY_STRATEGY_SYNTHESIS_SCHEMA;
  ok: true;
  generated_at: string;
  window: { since: string; until: string };
  headline: string;
  program_progress: Array<{ program_id: string; title: string; completed: number; active: number; blocked: number; objective: string }>;
  strategic_signals: Array<{ id: string; title: string; why_now: string; recommended_action: string; score: number }>;
  recurring_blockers: Array<{ program_id?: string; count: number; examples: string[] }>;
  feedback_learning: { useful: number; not_useful: number; false_positive: number };
  recommended_next_moves: string[];
  guardrails: BriefingGuardrails;
}

function nowIso(now?: Date): string { return (now || new Date()).toISOString(); }
function ms(date: string | undefined): number { const t = date ? Date.parse(date) : NaN; return Number.isFinite(t) ? t : 0; }
function sinceDate(now: Date, days: number): Date { return new Date(now.getTime() - days * 86400000); }
function recent<T extends { updated_at?: string; created_at?: string; ended_at?: string }>(items: T[], since: Date): T[] { return items.filter(i => ms(i.updated_at || i.ended_at || i.created_at) >= since.getTime()); }
function byPriority(a: OpsWorkItem, b: OpsWorkItem): number { return b.priority - a.priority || a.title.localeCompare(b.title); }
function terminalSignalState(s: string): boolean { return ['failed', 'blocked', 'waiting_human'].includes(s); }

export function buildMorningBriefSurface(opts: BriefingStoreOptions = {}): MorningBriefSurface {
  const now = opts.now || new Date();
  const limit = opts.limit || 5;
  const opsPath = opts.opsStorePath || opsStorePath();
  const oppPath = opts.opportunityStorePath || opportunityStorePath();
  const state = readOpsState(opsPath);
  const dashboard = buildOpsDashboard({ path: opsPath, now });
  const opportunities = buildOpportunityBriefReadySurface({ storePath: oppPath, now, topN: limit });
  const yesterday = sinceDate(now, 1);

  const focus = [...dashboard.running_tasks, ...dashboard.ready_backlog]
    .sort(byPriority)
    .slice(0, limit)
    .map(({ id, program_id, title, state, priority, lane, deadline_at, last_state_reason }) => ({ id, program_id, title, state, priority, lane, deadline_at, last_state_reason }));
  const pendingWork = dashboard.pending_approvals.work_items.slice(0, limit).map(w => ({ id: w.id, kind: 'work_item' as const, title: w.title, reason: w.last_state_reason || 'waiting for human approval/input' }));
  const pendingInterrupts = dashboard.pending_approvals.interrupts
    .filter(i => ['high', 'urgent', 'medium'].includes(i.severity) || i.requires_human)
    .slice(0, limit)
    .map(i => ({ id: i.id, kind: 'interrupt' as const, title: i.title, reason: i.body, severity: i.severity, proposed_action: i.proposed_action }));
  const completions = recent(state.work_items.filter(w => w.state === 'succeeded'), yesterday)
    .sort((a, b) => ms(b.updated_at) - ms(a.updated_at))
    .slice(0, limit)
    .map(({ id, program_id, title, updated_at, last_state_reason }) => ({ id, program_id, title, updated_at, last_state_reason }));
  const watchlist = state.work_items
    .filter(w => terminalSignalState(w.state))
    .sort((a, b) => ms(b.updated_at) - ms(a.updated_at) || b.priority - a.priority)
    .slice(0, limit)
    .map(w => ({ id: w.id, title: w.title, state: w.state, reason: w.last_state_reason || 'needs review' }));

  return {
    schema: OPS_MORNING_BRIEF_SCHEMA,
    ok: true,
    generated_at: now.toISOString(),
    headline: headlineForMorning(focus.length, pendingWork.length + pendingInterrupts.length, opportunities.top_candidates.length, watchlist.length),
    top_focus: focus,
    decisions_needed: [...pendingInterrupts, ...pendingWork].slice(0, limit),
    top_opportunities: opportunities.top_candidates.slice(0, limit).map(({ id, title, summary, why_now, recommended_action, scores, evidence }) => ({ id, title, summary, why_now, recommended_action, scores, evidence })),
    yesterday_completions: completions,
    watchlist,
    omitted_low_signal: {
      ready_or_running: Math.max(0, dashboard.running_tasks.length + dashboard.ready_backlog.length - focus.length),
      opportunities: Math.max(0, opportunities.top_candidates.length - limit),
      completions: Math.max(0, recent(state.work_items.filter(w => w.state === 'succeeded'), yesterday).length - completions.length),
      interrupts: Math.max(0, dashboard.pending_approvals.interrupts.length + dashboard.pending_approvals.work_items.length - (pendingInterrupts.length + pendingWork.length)),
    },
    guardrails: guardrails(state, opsPath, oppPath, opportunities),
  };
}

export function buildDailyBuildReportSurface(opts: BriefingStoreOptions = {}): DailyBuildReportSurface {
  const now = opts.now || new Date();
  const since = sinceDate(now, 1);
  const limit = opts.limit || 12;
  const opsPath = opts.opsStorePath || opsStorePath();
  const oppPath = opts.opportunityStorePath || opportunityStorePath();
  const state = readOpsState(opsPath);
  const dashboard = buildOpsDashboard({ path: opsPath, now });
  const recentSucceeded = recent(state.work_items.filter(w => w.state === 'succeeded'), since).sort((a, b) => ms(b.updated_at) - ms(a.updated_at)).slice(0, limit);
  const completed = recentSucceeded.map(w => {
    const run = latestRunForWork(state, w.id);
    const artifacts = state.artifacts.filter(a => a.work_item_id === w.id || (run?.id && a.run_id === run.id)).map(({ kind, path, ref, summary }) => ({ kind, path, ref, summary }));
    const completion = (run?.completion_json || {}) as any;
    return { id: w.id, program_id: w.program_id, title: w.title, summary: completion.summary || w.last_state_reason, completed_at: w.updated_at, checks_run: Array.isArray(completion.checks_run) ? completion.checks_run : [], artifacts };
  });
  const active = [...dashboard.running_tasks, ...dashboard.ready_backlog].sort(byPriority).slice(0, limit).map(({ id, program_id, title, state, priority, lane }) => ({ id, program_id, title, state, priority, lane }));
  const blockers = state.work_items.filter(w => terminalSignalState(w.state)).sort((a, b) => ms(b.updated_at) - ms(a.updated_at)).slice(0, limit).map(w => ({ id: w.id, title: w.title, state: w.state, reason: w.last_state_reason || 'needs review' }));
  return {
    schema: OPS_DAILY_BUILD_REPORT_SCHEMA,
    ok: true,
    generated_at: now.toISOString(),
    window: { since: since.toISOString(), until: now.toISOString() },
    headline: `${completed.length} completed, ${active.length} active/ready, ${blockers.length} blockers in the last 24h ops surface.`,
    completed_work: completed,
    active_or_ready: active,
    failures_and_blockers: blockers,
    supervisor_health: dashboard.supervisor_health,
    guardrails: guardrails(state, opsPath, oppPath),
  };
}

export function buildWeeklyStrategySynthesisSurface(opts: BriefingStoreOptions = {}): WeeklyStrategySynthesisSurface {
  const now = opts.now || new Date();
  const since = sinceDate(now, 7);
  const limit = opts.limit || 8;
  const opsPath = opts.opsStorePath || opsStorePath();
  const oppPath = opts.opportunityStorePath || opportunityStorePath();
  const state = readOpsState(opsPath);
  const opportunityStore = readOpportunityStore(oppPath);
  const recentItems = recent(state.work_items, since);
  const byProgram = new Map<string, { program?: OpsProgram; items: OpsWorkItem[] }>();
  for (const item of recentItems) {
    const current = byProgram.get(item.program_id) || { program: state.programs.find(p => p.id === item.program_id), items: [] };
    current.items.push(item);
    byProgram.set(item.program_id, current);
  }
  const programProgress = [...byProgram.entries()].map(([program_id, value]) => ({
    program_id,
    title: value.program?.title || program_id,
    objective: value.program?.objective || '',
    completed: value.items.filter(i => i.state === 'succeeded').length,
    active: value.items.filter(i => i.state === 'running' || i.state === 'leased' || i.state === 'ready').length,
    blocked: value.items.filter(i => terminalSignalState(i.state)).length,
  })).sort((a, b) => b.completed - a.completed || b.active - a.active || a.title.localeCompare(b.title)).slice(0, limit);
  const signals = opportunityStore.candidates
    .filter(c => (c.status === 'brief_ready' || c.status === 'useful') && ms(c.generated_at) >= since.getTime())
    .sort((a, b) => b.scores.final - a.scores.final)
    .slice(0, limit)
    .map(c => ({ id: c.id, title: c.title, why_now: c.why_now, recommended_action: c.recommended_action, score: c.scores.final }));
  const blockerGroups = groupBlockers(recentItems.filter(i => terminalSignalState(i.state))).slice(0, limit);
  const feedback = opportunityStore.feedback.filter(f => ms(f.decided_at) >= since.getTime());
  const recommendations = recommendNextMoves(programProgress, signals, blockerGroups);
  return {
    schema: OPS_WEEKLY_STRATEGY_SYNTHESIS_SCHEMA,
    ok: true,
    generated_at: now.toISOString(),
    window: { since: since.toISOString(), until: now.toISOString() },
    headline: `${programProgress.reduce((n, p) => n + p.completed, 0)} completions across ${programProgress.length} programs; ${signals.length} strategic signals; ${blockerGroups.length} blocker clusters.`,
    program_progress: programProgress,
    strategic_signals: signals,
    recurring_blockers: blockerGroups,
    feedback_learning: { useful: feedback.filter(f => f.value === 'useful').length, not_useful: feedback.filter(f => f.value === 'not_useful').length, false_positive: feedback.filter(f => f.false_positive).length },
    recommended_next_moves: recommendations,
    guardrails: guardrails(state, opsPath, oppPath),
  };
}

export function renderMorningBriefMarkdown(surface: MorningBriefSurface): string {
  const lines = [`# Morning brief`, '', surface.headline, ''];
  appendItems(lines, 'Top focus', surface.top_focus.map(i => `${i.title} (${i.state}, p${i.priority})`));
  appendItems(lines, 'Decisions needed', surface.decisions_needed.map(i => `${i.title}: ${i.reason}`));
  appendItems(lines, 'Top opportunities', surface.top_opportunities.map(i => `${i.title}: ${i.why_now}`));
  appendItems(lines, 'Watchlist', surface.watchlist.map(i => `${i.title} (${i.state}): ${i.reason}`));
  lines.push('', '_Internal brief-ready surface only; nothing was sent externally._');
  return lines.join('\n');
}

export function renderDailyBuildReportMarkdown(surface: DailyBuildReportSurface): string {
  const lines = [`# Daily build report`, '', surface.headline, ''];
  appendItems(lines, 'Completed work', surface.completed_work.map(i => `${i.title}: ${i.summary || 'completed'}${i.checks_run.length ? ` — checks: ${i.checks_run.map(String).join(', ')}` : ''}`));
  appendItems(lines, 'Active / ready', surface.active_or_ready.map(i => `${i.title} (${i.state}, p${i.priority})`));
  appendItems(lines, 'Failures / blockers', surface.failures_and_blockers.map(i => `${i.title} (${i.state}): ${i.reason}`));
  lines.push('', '_Internal build report only; nothing was sent externally._');
  return lines.join('\n');
}

export function renderWeeklyStrategyMarkdown(surface: WeeklyStrategySynthesisSurface): string {
  const lines = [`# Weekly strategy synthesis`, '', surface.headline, ''];
  appendItems(lines, 'Program progress', surface.program_progress.map(p => `${p.title}: ${p.completed} completed, ${p.active} active, ${p.blocked} blocked`));
  appendItems(lines, 'Strategic signals', surface.strategic_signals.map(s => `${s.title} (score ${s.score}): ${s.recommended_action}`));
  appendItems(lines, 'Recommended next moves', surface.recommended_next_moves);
  lines.push('', '_Internal strategy surface only; nothing was sent externally._');
  return lines.join('\n');
}

export function writeBriefingSurface(path: string, surface: MorningBriefSurface | DailyBuildReportSurface | WeeklyStrategySynthesisSurface): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(surface, null, 2) + '\n');
}

function guardrails(state: OpsState, opsPath: string, oppPath: string, opportunities?: OpportunityBriefReadySurface): BriefingGuardrails {
  const oppRecords = opportunities ? opportunities.top_candidates.length : readOpportunityStore(oppPath).candidates.length;
  return {
    brief_ready: true,
    external_sent: false,
    review_only: true,
    trusted_personal_memory_mutated: false,
    raw_vibes_used: false,
    sources: [
      { kind: 'ops_kernel', path: opsPath, structured_store: true, record_count: state.work_items.length + state.runs.length + state.artifacts.length + state.interrupts.length + state.supervisor_ticks.length },
      { kind: 'opportunity_radar', path: oppPath, structured_store: true, record_count: oppRecords },
    ],
  };
}

function latestRunForWork(state: OpsState, workItemId: string): OpsWorkRun | undefined {
  return state.runs.filter(r => r.work_item_id === workItemId).sort((a, b) => ms(b.ended_at || b.last_event_at || b.created_at) - ms(a.ended_at || a.last_event_at || a.created_at))[0];
}

function groupBlockers(items: OpsWorkItem[]): Array<{ program_id?: string; count: number; examples: string[] }> {
  const groups = new Map<string, OpsWorkItem[]>();
  for (const item of items) {
    const key = item.program_id || 'unknown';
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups.entries()].map(([program_id, group]) => ({ program_id, count: group.length, examples: group.slice(0, 3).map(i => `${i.title}: ${i.last_state_reason || i.state}`) })).sort((a, b) => b.count - a.count);
}

function recommendNextMoves(progress: WeeklyStrategySynthesisSurface['program_progress'], signals: WeeklyStrategySynthesisSurface['strategic_signals'], blockers: WeeklyStrategySynthesisSurface['recurring_blockers']): string[] {
  const moves: string[] = [];
  const strongest = signals[0];
  if (strongest) moves.push(`Review strategic signal: ${strongest.title}. ${strongest.recommended_action}`);
  const blocked = blockers[0];
  if (blocked) moves.push(`Clear blocker cluster for ${blocked.program_id}: ${blocked.examples[0]}`);
  const active = progress.find(p => p.active > 0);
  if (active) moves.push(`Keep ${active.title} moving: ${active.active} active/ready item(s) remain.`);
  if (!moves.length) moves.push('No high-signal action from structured stores; keep supervisor/watchdog running and wait for fresh evidence.');
  return moves.slice(0, 5);
}

function headlineForMorning(focus: number, decisions: number, opportunities: number, watch: number): string {
  const parts = [`${focus} focus item${focus === 1 ? '' : 's'}`];
  if (decisions) parts.push(`${decisions} decision${decisions === 1 ? '' : 's'} needed`);
  if (opportunities) parts.push(`${opportunities} opportunity signal${opportunities === 1 ? '' : 's'}`);
  if (watch) parts.push(`${watch} watchlist item${watch === 1 ? '' : 's'}`);
  return `${parts.join('; ')} from structured ops stores.`;
}

function appendItems(lines: string[], title: string, items: string[]): void {
  if (!items.length) return;
  lines.push(`## ${title}`);
  for (const item of items) lines.push(`- ${item}`);
  lines.push('');
}
