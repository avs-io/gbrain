import { describe, expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import {
  buildOpsDashboard,
  buildOpsMetrics,
  claimWorkItem,
  enqueueWorkPacket,
  pauseOpsProgram,
  readOpsState,
  resumeOpsProgram,
  setOpsKillSwitch,
  superviseOps,
} from '../src/core/ops/kernel.ts';

function tempStore(): string { return join(mkdtempSync(join(tmpdir(), 'gbrain-ops-control-')), 'ops.jsonl'); }

function packet() {
  return {
    programs: [
      { id: 'world-scout', title: 'World Scout', objective: 'Public scouting.', status: 'active', priority: 90, lanes: ['public_scout'], autonomy: { can_contact_people: false, can_mutate_trusted_memory: false, can_ingest_public_sources: true } },
      { id: 'code-build', title: 'Code Build', objective: 'Write code.', status: 'active', priority: 80, lanes: ['code_pr'], autonomy: { can_modify_code: true, can_commit: true, can_contact_people: false, can_mutate_trusted_memory: false } },
    ],
    work_items: [
      { id: 'scout-ready', program_id: 'world-scout', title: 'Scout ready', description: 'Run public scout', state: 'ready', lane: 'public_scout', worker_kind: 'minimax', privacy_tier: 'P3_PUBLIC' },
      { id: 'code-ready', program_id: 'code-build', title: 'Code ready', description: 'Draft PR', state: 'ready', lane: 'code_pr', worker_kind: 'acp_codex', privacy_tier: 'P1_PRIVATE' },
    ],
  };
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

describe('ops control plane pause/resume/kill-switch/metrics', () => {
  test('pauses and resumes public scouts deterministically in ops state', async () => {
    const store = tempStore();
    enqueueWorkPacket(packet(), { path: store, now: new Date('2026-04-30T07:00:00.000Z') });

    const paused = pauseOpsProgram('all-public-scouts', { path: store, now: new Date('2026-04-30T07:01:00.000Z'), reason: 'operator pause' });
    expect(paused.affected_programs.map(p => p.id)).toEqual(['world-scout']);
    expect(readOpsState(store).programs.find(p => p.id === 'world-scout')?.status).toBe('paused');
    expect(() => claimWorkItem('scout-ready', 'worker-1', { path: store })).toThrow(/program world-scout is paused/);

    const supervised = superviseOps({ path: store, now: new Date('2026-04-30T07:02:00.000Z'), maxClaims: 10, maxRunning: 10 });
    expect(supervised.claimed.map(c => c.work_item.id)).toEqual(['code-ready']);

    const resumed = resumeOpsProgram('all-public-scouts', { path: store, now: new Date('2026-04-30T07:03:00.000Z') });
    expect(resumed.affected_programs.map(p => p.id)).toEqual(['world-scout']);
    expect(readOpsState(store).programs.find(p => p.id === 'world-scout')?.status).toBe('active');

    const cli = JSON.parse(await capture(() => runOpsCommand(null, ['pause', '--program', 'all-public-scouts', '--store', store, '--json'])));
    expect(cli.schema).toBe('gbrain.ops.control.pause.v1');
  });

  test('kill switch stops claims and dashboard/metrics expose safety state', async () => {
    const store = tempStore();
    enqueueWorkPacket(packet(), { path: store, now: new Date('2026-04-30T08:00:00.000Z') });
    const kill = setOpsKillSwitch(true, { path: store, now: new Date('2026-04-30T08:01:00.000Z'), reason: 'freeze' });
    expect(kill.control.kill_switch.enabled).toBe(true);
    expect(() => claimWorkItem('scout-ready', 'worker-1', { path: store })).toThrow(/kill switch is ON/);
    expect(superviseOps({ path: store, now: new Date('2026-04-30T08:02:00.000Z'), maxClaims: 10 }).claimed).toEqual([]);

    const dashboard = buildOpsDashboard({ path: store, now: new Date('2026-04-30T08:03:00.000Z') });
    expect(dashboard.control.kill_switch.enabled).toBe(true);
    expect(dashboard.safety_audit.ok).toBe(true);
    expect(dashboard.safety_audit.hidden_active_task_count).toBe(0);

    const metrics = buildOpsMetrics({ path: store, now: new Date('2026-04-30T08:04:00.000Z'), last: '24h' });
    expect(metrics.schema).toBe('gbrain.ops.metrics.v1');
    expect(metrics.control.kill_switch.enabled).toBe(true);

    const off = JSON.parse(await capture(() => runOpsCommand(null, ['kill-switch', '--off', '--store', store, '--json'])));
    expect(off.control.kill_switch.enabled).toBe(false);
  });

  test('safety audit proves hidden active runs and unsafe autonomy are visible', () => {
    const store = tempStore();
    enqueueWorkPacket({
      programs: [{ id: 'unsafe', title: 'Unsafe', objective: 'Unsafe active program.', status: 'active', lanes: ['code'], autonomy: { can_contact_people: true, can_mutate_trusted_memory: true } }],
      work_items: [{ id: 'unsafe-running', program_id: 'unsafe', title: 'Unsafe running', description: 'Active', state: 'running', lane: 'code', worker_kind: 'acp_codex', privacy_tier: 'P1_PRIVATE' }],
    }, { path: store, now: new Date('2026-04-30T09:00:00.000Z') });
    appendFileSync(store, JSON.stringify({ schema: 'gbrain.ops.event.v1', type: 'run_upsert', at: '2026-04-30T09:01:00.000Z', payload: { id: 'hidden-run', work_item_id: 'missing', program_id: 'unsafe', status: 'running', created_at: '2026-04-30T09:01:00.000Z' } }) + '\n');

    const audit = buildOpsDashboard({ path: store, now: new Date('2026-04-30T09:02:00.000Z') }).safety_audit;
    expect(audit.ok).toBe(false);
    expect(audit.hidden_active_task_count).toBe(1);
    expect(audit.contact_risk_count).toBe(1);
    expect(audit.trusted_memory_mutation_risk_count).toBe(1);
  });
});
