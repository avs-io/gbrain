import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import {
  auditOps,
  claimWorkItem,
  enqueueWorkPacket,
  initOpsStore,
  readOpsState,
  superviseOps,
} from '../src/core/ops/kernel.ts';

function tempStore(): string {
  return join(mkdtempSync(join(tmpdir(), 'gbrain-ops-supervisor-')), 'ops.jsonl');
}

function packet(...workItems: any[]) {
  return {
    programs: [{ id: 'always-on', title: 'Always-On OS', objective: 'Keep approved work moving.', priority: 90 }],
    work_items: workItems,
  };
}

function work(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    program_id: 'always-on',
    title: `Work ${id}`,
    description: `Do ${id}`,
    lane: 'code',
    worker_kind: 'subagent',
    privacy_tier: 'P1_PRIVATE',
    priority: 50,
    acceptance_criteria: ['deterministic test passes'],
    ...extra,
  };
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

describe('ops supervisor daemon v1', () => {
  test('no-idle ready item gets claimed by supervise and clears audit red', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(work('ready-a3')), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });

    const before = auditOps({ path: store, now: new Date('2026-04-30T06:01:00.000Z') });
    expect(before.status).toBe('red');
    expect(before.alerts[0].kind).toBe('no_idle');

    const supervised = superviseOps({ path: store, now: new Date('2026-04-30T06:02:00.000Z') });
    expect(supervised.status).toBe('green');
    expect(supervised.claimed).toHaveLength(1);
    expect(supervised.claimed[0].run.runtime).toBe('codex');
    expect(supervised.claimed[0].run.provider).toBe('codex');
    expect(supervised.tick.claimed_count).toBe(1);

    const state = readOpsState(store);
    expect(state.work_items.find(w => w.id === 'ready-a3')?.state).toBe('running');
    expect(state.leases.filter(l => l.work_item_id === 'ready-a3' && l.lease_status === 'active')).toHaveLength(1);
    expect(auditOps({ path: store, now: new Date('2026-04-30T06:03:00.000Z') }).status).toBe('green');
  });

  test('no work yields green noop tick', () => {
    const store = tempStore();
    initOpsStore(store);
    const supervised = superviseOps({ path: store, now: new Date('2026-04-30T06:00:00.000Z') });
    expect(supervised.status).toBe('green');
    expect(supervised.claimed).toEqual([]);
    expect(supervised.tick.ready_count).toBe(0);
    expect(supervised.tick.running_count).toBe(0);
    expect(readOpsState(store).supervisor_ticks).toHaveLength(1);
  });

  test('stale active lease is expired and eligible work is reclaimed', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(work('stale-a3')), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });
    const firstClaim = claimWorkItem('stale-a3', 'worker-old', { path: store, now: new Date('2026-04-30T06:01:00.000Z'), leaseMinutes: 1 });

    const supervised = superviseOps({ path: store, now: new Date('2026-04-30T06:03:00.000Z') });
    expect(supervised.status).toBe('amber');
    expect(supervised.expired_leases.map(l => l.id)).toEqual([firstClaim.lease.id]);
    expect(supervised.claimed.map(c => c.work_item.id)).toEqual(['stale-a3']);

    const state = readOpsState(store);
    expect(state.leases.find(l => l.id === firstClaim.lease.id)?.lease_status).toBe('expired');
    expect(state.runs.find(r => r.id === firstClaim.run.id)?.status).toBe('timed_out');
    expect(state.leases.filter(l => l.work_item_id === 'stale-a3' && l.lease_status === 'active')).toHaveLength(1);
    expect(state.work_items.find(w => w.id === 'stale-a3')?.state).toBe('running');
  });

  test('dependency-satisfied approved item unblocks before selection', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(
      work('dependent-a3', { dependencies: ['foundation-a3'] }),
      work('foundation-a3', { state: 'succeeded' }),
    ), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });
    expect(readOpsState(store).work_items.find(w => w.id === 'dependent-a3')?.state).toBe('approved');

    const supervised = superviseOps({ path: store, now: new Date('2026-04-30T06:01:00.000Z') });
    expect(supervised.unblocked.map(w => w.id)).toEqual(['dependent-a3']);
    expect(supervised.claimed.map(c => c.work_item.id)).toEqual(['dependent-a3']);
    expect(readOpsState(store).work_items.find(w => w.id === 'dependent-a3')?.state).toBe('running');
  });

  test('blocked and waiting-human items are not claimed', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(
      work('blocked-a3', { state: 'blocked', last_state_reason: 'needs local artifact' }),
      work('waiting-a3', { state: 'waiting_human', worker_kind: 'human_review' }),
    ), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });

    const supervised = superviseOps({ path: store, now: new Date('2026-04-30T06:01:00.000Z') });
    expect(supervised.status).toBe('amber');
    expect(supervised.claimed).toEqual([]);
    const state = readOpsState(store);
    expect(state.work_items.find(w => w.id === 'blocked-a3')?.state).toBe('blocked');
    expect(state.work_items.find(w => w.id === 'waiting-a3')?.state).toBe('waiting_human');
  });

  test('supervisor tick records counts, decisions, and CLI JSON schema', async () => {
    const store = tempStore();
    enqueueWorkPacket(packet(
      work('claim-me', { priority: 90 }),
      work('remain-ready', { priority: 80 }),
      work('blocked-count', { state: 'blocked' }),
      work('waiting-count', { state: 'waiting_human' }),
    ), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });

    const cli = JSON.parse(await capture(() => runOpsCommand(null, ['supervise', '--once', '--store', store, '--json'])));
    expect(cli.schema).toBe('gbrain.ops.supervise.v1');
    expect(cli.tick.claimed_count).toBe(1);
    expect(cli.tick.ready_count).toBe(1);
    expect(cli.tick.running_count).toBe(1);
    expect(cli.tick.blocked_count).toBe(1);
    expect(cli.tick.waiting_human_count).toBe(1);
    expect(cli.tick.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'claim_work_item', work_item_id: 'claim-me' })]));
  });
});
