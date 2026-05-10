import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  countOps,
  opsStorePath,
  readOpsState,
  type OpsInterrupt,
  type OpsLease,
  type OpsState,
  type OpsSupervisorTick,
  type OpsWorkItem,
} from './kernel.ts';

export const OPS_LAUNCHAGENT_SCHEMA = 'gbrain.ops.launchagent.v1';
export const OPS_HEARTBEAT_CHECK_SCHEMA = 'gbrain.ops.heartbeat_check.v1';

const DEFAULT_LABEL = 'com.aditya.gbrain-supervisor';
const DEFAULT_START_INTERVAL_SECONDS = 180;
const DEFAULT_MAX_TICK_AGE_MINUTES = 10;

export interface LaunchAgentOptions {
  dryRun?: boolean;
  yes?: boolean;
  load?: boolean;
  label?: string;
  homeDir?: string;
  launchAgentsDir?: string;
  gbrainDir?: string;
  logDir?: string;
  startIntervalSeconds?: number;
}

export interface LaunchAgentPlan {
  ok: true;
  schema: typeof OPS_LAUNCHAGENT_SCHEMA;
  dry_run: boolean;
  installed: boolean;
  launchctl_loaded: false;
  launchctl_command?: string;
  label: string;
  plist_path: string;
  start_interval_seconds: number;
  gbrain_dir: string;
  log_dir: string;
  supervisor_command: string;
  program_arguments: string[];
  plist: string;
}

export interface HeartbeatCheckOptions {
  path?: string;
  now?: Date;
  maxTickAgeMinutes?: number;
}

export interface HeartbeatAlert {
  kind:
    | 'no_idle'
    | 'stale_active_lease'
    | 'stale_supervisor_tick'
    | 'supervisor_down'
    | 'blocked_critical_work'
    | 'dispatch_failed'
    | 'completion_missing'
    | 'critical_interrupt';
  severity: 'amber' | 'red';
  message: string;
  action: 'kick_supervisor' | 'inspect_dispatch' | 'recover_completion' | 'resolve_blocker' | 'review_interrupt' | 'install_or_start_supervisor';
  work_item_ids?: string[];
  lease_ids?: string[];
  interrupt_ids?: string[];
  age_minutes?: number;
}

export interface HeartbeatCheckResult {
  ok: true;
  schema: typeof OPS_HEARTBEAT_CHECK_SCHEMA;
  status: 'green' | 'amber' | 'red';
  checked_at: string;
  path: string;
  summary: string;
  action: 'none' | 'kick_supervisor' | 'inspect' | 'human_review';
  recommended_command?: string;
  counts: ReturnType<typeof countOps>;
  latest_tick?: OpsSupervisorTick;
  alerts: HeartbeatAlert[];
}

export function buildLaunchAgentPlan(opts: LaunchAgentOptions = {}): LaunchAgentPlan {
  const dryRun = opts.dryRun === true || opts.yes !== true;
  const label = sanitizeLaunchdLabel(opts.label || DEFAULT_LABEL);
  const home = opts.homeDir || homedir();
  const launchAgentsDir = opts.launchAgentsDir || join(home, 'Library', 'LaunchAgents');
  const plistPath = join(launchAgentsDir, `${label}.plist`);
  const gbrainDir = resolve(opts.gbrainDir || defaultGbrainDir());
  const logDir = resolve(opts.logDir || join(gbrainDir, '..', 'ops', 'logs'));
  const interval = Math.max(30, Math.floor(opts.startIntervalSeconds || DEFAULT_START_INTERVAL_SECONDS));
  const supervisorCommand = `cd ${shellQuote(gbrainDir)} && bun run src/cli.ts ops supervise --once --json >> ${shellQuote(join(logDir, 'gbrain-supervisor.log'))} 2>&1`;
  const programArguments = ['/bin/zsh', '-lc', supervisorCommand];
  const plist = renderLaunchAgentPlist({
    label,
    programArguments,
    startIntervalSeconds: interval,
    standardOutPath: join(logDir, 'gbrain-supervisor.stdout.log'),
    standardErrorPath: join(logDir, 'gbrain-supervisor.stderr.log'),
  });

  if (opts.yes) {
    mkdirSync(dirname(plistPath), { recursive: true });
    mkdirSync(logDir, { recursive: true });
    writeFileSync(plistPath, plist, { mode: 0o644 });
  }

  return {
    ok: true,
    schema: OPS_LAUNCHAGENT_SCHEMA,
    dry_run: dryRun,
    installed: opts.yes === true,
    launchctl_loaded: false,
    launchctl_command: opts.load ? `launchctl load ${shellQuote(plistPath)} && launchctl kickstart gui/$(id -u)/${shellQuote(label)}` : undefined,
    label,
    plist_path: plistPath,
    start_interval_seconds: interval,
    gbrain_dir: gbrainDir,
    log_dir: logDir,
    supervisor_command: supervisorCommand,
    program_arguments: programArguments,
    plist,
  };
}

export function heartbeatTemplateMarkdown(): string {
  return `# HEARTBEAT — Always-On Intelligence OS

Run only the heartbeat check. Do not perform project work inside heartbeat unless the check explicitly instructs a supervisor kick.

Steps:
1. Run: \`cd ~/gbrain-sync && bun run src/cli.ts ops heartbeat-check --json\`
2. If status is \`green\`, reply exactly: \`HEARTBEAT_OK\`.
3. If status is \`amber\` or \`red\`, report only:
   - stale or failed critical tasks,
   - ready high-priority work that is not being claimed,
   - supervisor down / LaunchAgent not running,
   - high-confidence opportunity/risk interrupts,
   - human approval requests.
4. Do not summarize routine work.
5. Do not start long-running project work in the heartbeat/main session.
6. If the check says \`action: kick_supervisor\`, run \`bun run src/cli.ts ops supervise --once --json\`, then report whether it spawned work.
`;
}

export function heartbeatCheck(opts: HeartbeatCheckOptions = {}): HeartbeatCheckResult {
  const path = opts.path || opsStorePath();
  const now = opts.now || new Date();
  const checkedAt = now.toISOString();
  const state = readOpsState(path);
  const counts = countOps(state, now);
  const latestTick = latestSupervisorTick(state);
  const maxTickAgeMinutes = Math.max(1, Math.floor(opts.maxTickAgeMinutes || DEFAULT_MAX_TICK_AGE_MINUTES));
  const alerts: HeartbeatAlert[] = [];

  const activeCount = counts.active_count;
  const ready = readyBacklog(state, now);
  if (ready.length > 0 && activeCount === 0) {
    alerts.push({
      kind: 'no_idle',
      severity: 'red',
      message: 'Ready approved work exists but no active run or unexpired active lease exists.',
      action: 'kick_supervisor',
      work_item_ids: ready.map(w => w.id),
    });
  }

  const staleLeases = staleActiveLeases(state, now);
  if (staleLeases.length) {
    alerts.push({
      kind: 'stale_active_lease',
      severity: 'amber',
      message: 'Active leases are expired; supervisor should expire/reconcile them.',
      action: 'kick_supervisor',
      lease_ids: staleLeases.map(l => l.id),
      work_item_ids: staleLeases.map(l => l.work_item_id),
    });
  }

  const tickAge = latestTick ? minutesBetween(latestTick.tick_at, now) : undefined;
  if (!latestTick && (existsSync(path) || ready.length > 0 || activeCount > 0)) {
    alerts.push({
      kind: 'supervisor_down',
      severity: ready.length > 0 || activeCount > 0 ? 'red' : 'amber',
      message: 'No supervisor tick has been recorded for this ops store.',
      action: 'install_or_start_supervisor',
    });
  } else if (latestTick && tickAge !== undefined && tickAge > maxTickAgeMinutes) {
    alerts.push({
      kind: 'stale_supervisor_tick',
      severity: ready.length > 0 || activeCount > 0 ? 'red' : 'amber',
      message: `Latest supervisor tick is ${Math.floor(tickAge)} minutes old; backup kick is recommended.`,
      action: 'kick_supervisor',
      age_minutes: Math.floor(tickAge),
    });
  }

  for (const item of blockedCriticalWork(state, now)) {
    alerts.push({
      kind: 'blocked_critical_work',
      severity: item.priority >= 90 || deadlinePast(item, now) ? 'red' : 'amber',
      message: `Critical work is blocked: ${item.id} — ${item.title}`,
      action: 'resolve_blocker',
      work_item_ids: [item.id],
    });
  }

  for (const interrupt of openCriticalInterrupts(state)) {
    const classified = classifyInterrupt(interrupt);
    alerts.push({
      kind: classified.kind,
      severity: interrupt.severity === 'urgent' ? 'red' : classified.severity,
      message: `${interrupt.title}: ${interrupt.body}`.slice(0, 240),
      action: classified.action,
      work_item_ids: interrupt.work_item_id ? [interrupt.work_item_id] : undefined,
      interrupt_ids: [interrupt.id],
    });
  }

  const status: HeartbeatCheckResult['status'] = alerts.some(a => a.severity === 'red') ? 'red' : alerts.length ? 'amber' : 'green';
  const action = chooseHeartbeatAction(alerts);
  const recommendedCommand = action === 'kick_supervisor' ? 'bun run src/cli.ts ops supervise --once --json' : undefined;
  return {
    ok: true,
    schema: OPS_HEARTBEAT_CHECK_SCHEMA,
    status,
    checked_at: checkedAt,
    path,
    summary: summarizeHeartbeat(status, counts, alerts),
    action,
    recommended_command: recommendedCommand,
    counts,
    latest_tick: latestTick,
    alerts: alerts.slice(0, 10),
  };
}

function renderLaunchAgentPlist(input: { label: string; programArguments: string[]; startIntervalSeconds: number; standardOutPath: string; standardErrorPath: string }): string {
  const args = input.programArguments.map(arg => `    <string>${xmlEscape(arg)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(input.label)}</string>

  <key>ProgramArguments</key>
  <array>
${args}
  </array>

  <key>StartInterval</key>
  <integer>${input.startIntervalSeconds}</integer>

  <key>RunAtLoad</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${xmlEscape(input.standardOutPath)}</string>

  <key>StandardErrorPath</key>
  <string>${xmlEscape(input.standardErrorPath)}</string>
</dict>
</plist>
`;
}

function defaultGbrainDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

function sanitizeLaunchdLabel(label: string): string {
  const out = label.trim();
  if (!out || !/^[A-Za-z0-9_.-]+$/.test(out)) throw new Error(`invalid LaunchAgent label: ${label}`);
  return out;
}

function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'"'"'`)}'`;
}

function xmlEscape(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function latestSupervisorTick(state: OpsState): OpsSupervisorTick | undefined {
  return [...state.supervisor_ticks].sort((a, b) => a.tick_at.localeCompare(b.tick_at) || Number(a.id) - Number(b.id)).at(-1);
}

function readyBacklog(state: OpsState, now: Date): OpsWorkItem[] {
  return state.work_items
    .filter(w => w.state === 'ready')
    .filter(w => !w.not_before || Date.parse(w.not_before) <= now.getTime())
    .sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

function staleActiveLeases(state: OpsState, now: Date): OpsLease[] {
  return state.leases.filter(l => l.lease_status === 'active' && Date.parse(l.expires_at) <= now.getTime());
}

function blockedCriticalWork(state: OpsState, now: Date): OpsWorkItem[] {
  return state.work_items
    .filter(w => w.state === 'blocked')
    .filter(w => w.priority >= 80 || deadlinePast(w, now) || /critical|urgent|p0/i.test(`${w.lane} ${w.title} ${w.description}`))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function deadlinePast(item: OpsWorkItem, now: Date): boolean {
  return !!item.deadline_at && Date.parse(item.deadline_at) <= now.getTime();
}

function openCriticalInterrupts(state: OpsState): OpsInterrupt[] {
  return state.interrupts
    .filter(i => !['resolved', 'dismissed'].includes(i.status))
    .filter(i => ['high', 'urgent'].includes(i.severity) || /dispatch failed|completion json missing|critical|urgent/i.test(`${i.title} ${i.body}`))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}

function classifyInterrupt(interrupt: OpsInterrupt): Pick<HeartbeatAlert, 'kind' | 'severity' | 'action'> {
  const text = `${interrupt.title} ${interrupt.body}`.toLowerCase();
  if (text.includes('dispatch failed')) return { kind: 'dispatch_failed', severity: 'red', action: 'inspect_dispatch' };
  if (text.includes('completion json missing') || text.includes('completion missing')) return { kind: 'completion_missing', severity: 'red', action: 'recover_completion' };
  return { kind: 'critical_interrupt', severity: interrupt.severity === 'urgent' ? 'red' : 'amber', action: 'review_interrupt' };
}

function minutesBetween(iso: string, now: Date): number {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - ts) / 60000);
}

function chooseHeartbeatAction(alerts: HeartbeatAlert[]): HeartbeatCheckResult['action'] {
  if (alerts.some(a => a.action === 'kick_supervisor' || a.action === 'install_or_start_supervisor')) return 'kick_supervisor';
  if (alerts.some(a => a.action === 'review_interrupt' || a.action === 'resolve_blocker')) return 'human_review';
  if (alerts.length) return 'inspect';
  return 'none';
}

function summarizeHeartbeat(status: HeartbeatCheckResult['status'], counts: ReturnType<typeof countOps>, alerts: HeartbeatAlert[]): string {
  if (status === 'green') return 'green: no ready backlog, no stale leases, no critical interrupts';
  const kinds = [...new Set(alerts.map(a => a.kind))].join(', ');
  return `${status}: ${alerts.length} actionable alert(s): ${kinds}; ready=${counts.ready_count}, active=${counts.active_count}, stale_leases=${counts.stale_active_lease_count}`;
}
