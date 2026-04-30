import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import {
  auditOps,
  claimWorkItem,
  completeWorkItem,
  enqueueWorkPacket,
  initOpsStore,
  readOpsState,
} from '../src/core/ops/kernel.ts';

function tempStore(): string {
  return join(mkdtempSync(join(tmpdir(), 'gbrain-ops-')), 'ops.jsonl');
}

function packet(...workItems: any[]) {
  return {
    programs: [{ id: 'gbrain-core-build', title: 'GBrain Core Build', objective: 'Improve GBrain.', priority: 90 }],
    work_items: workItems,
  };
}

function work(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    program_id: 'gbrain-core-build',
    title: `Implement ${id}`,
    description: `Do ${id}`,
    lane: 'code',
    worker_kind: 'subagent',
    privacy_tier: 'P1_PRIVATE',
    acceptance_criteria: ['tests pass'],
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

describe('ops kernel', () => {
  test('enqueue/list stores programs and ready work items', async () => {
    const store = tempStore();
    initOpsStore(store);
    const enqueued = enqueueWorkPacket(packet(work('pr-a1')), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });
    expect(enqueued.programs[0].id).toBe('gbrain-core-build');
    expect(enqueued.work_items[0].state).toBe('ready');

    const listed = JSON.parse(await capture(() => runOpsCommand(null, ['work', 'list', '--state', 'ready', '--store', store, '--json'])));
    expect(listed.work_items.map((w: any) => w.id)).toEqual(['pr-a1']);

    const programs = JSON.parse(await capture(() => runOpsCommand(null, ['programs', 'list', '--store', store, '--json'])));
    expect(programs.programs[0].id).toBe('gbrain-core-build');
  });

  test('claim creates one active lease and rejects duplicate claims', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(work('pr-a1')), { path: store });
    const claimed = claimWorkItem('pr-a1', 'worker-1', { path: store, now: new Date('2026-04-30T06:05:00.000Z') });
    expect(claimed.work_item.state).toBe('running');
    expect(claimed.lease.lease_status).toBe('active');
    expect(claimed.run.status).toBe('running');
    expect(() => claimWorkItem('pr-a1', 'worker-2', { path: store })).toThrow(/not ready/);
    const state = readOpsState(store);
    expect(state.leases.filter(l => l.work_item_id === 'pr-a1' && l.lease_status === 'active')).toHaveLength(1);
  });

  test('completion releases lease and unblocks dependent work', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(
      work('pr-a1'),
      work('pr-a2', { dependencies: ['pr-a1'] }),
    ), { path: store });
    expect(readOpsState(store).work_items.find(w => w.id === 'pr-a2')?.state).toBe('approved');
    claimWorkItem('pr-a1', 'worker-1', { path: store });
    const completed = completeWorkItem('pr-a1', {
      work_item_id: 'pr-a1',
      program_id: 'gbrain-core-build',
      status: 'succeeded',
      summary: 'Implemented with tests.',
      artifacts: [{ kind: 'commit', ref: 'abc1234' }],
      checks_run: ['bun test test/ops-kernel.test.ts'],
    }, { path: store });
    expect(completed.work_item.state).toBe('succeeded');
    expect(completed.released_lease?.lease_status).toBe('released');
    expect(completed.artifacts[0].kind).toBe('commit');
    expect(completed.unblocked.map(w => w.id)).toEqual(['pr-a2']);
    expect(readOpsState(store).work_items.find(w => w.id === 'pr-a2')?.state).toBe('ready');
  });

  test('invalid completion is rejected without mutating work state', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(work('pr-a1')), { path: store });
    claimWorkItem('pr-a1', 'worker-1', { path: store });
    expect(() => completeWorkItem('pr-a1', { work_item_id: 'wrong', status: 'done', summary: '' }, { path: store })).toThrow(/invalid completion/);
    expect(readOpsState(store).work_items.find(w => w.id === 'pr-a1')?.state).toBe('running');
  });

  test('audit emits no-idle alert when ready work exists and nothing is active', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(work('pr-a1')), { path: store });
    const audit = auditOps({ path: store });
    expect(audit.status).toBe('red');
    expect(audit.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'no_idle', severity: 'red' })]));
    expect(readOpsState(store).supervisor_ticks).toHaveLength(1);
  });

  test('CLI enqueue/claim/complete path speaks JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-ops-cli-'));
    const store = join(dir, 'ops.jsonl');
    const packetPath = join(dir, 'packet.json');
    const completionPath = join(dir, 'completion.json');
    writeFileSync(packetPath, JSON.stringify(packet(work('pr-a1')), null, 2));
    writeFileSync(completionPath, JSON.stringify({ work_item_id: 'pr-a1', status: 'succeeded', summary: 'CLI completion ok.', artifacts: [{ kind: 'report', path: 'ops/reports/pr-a1.md' }] }, null, 2));

    const init = JSON.parse(await capture(() => runOpsCommand(null, ['init', '--store', store, '--json'])));
    expect(init.initialized).toBe(true);
    const enq = JSON.parse(await capture(() => runOpsCommand(null, ['work', 'enqueue', '--packet', packetPath, '--store', store, '--json'])));
    expect(enq.work_items[0].state).toBe('ready');
    const claim = JSON.parse(await capture(() => runOpsCommand(null, ['work', 'claim', '--id', 'pr-a1', '--worker', 'worker-cli', '--store', store, '--json'])));
    expect(claim.lease.worker_id).toBe('worker-cli');
    const done = JSON.parse(await capture(() => runOpsCommand(null, ['work', 'complete', '--id', 'pr-a1', '--completion', completionPath, '--store', store, '--json'])));
    expect(done.work_item.state).toBe('succeeded');
    const status = JSON.parse(await capture(() => runOpsCommand(null, ['status', '--store', store, '--json'])));
    expect(status.counts.work_items.succeeded).toBe(1);
  });
});
