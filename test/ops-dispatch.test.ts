import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runOpsCommand } from '../src/commands/ops.ts';
import {
  dispatchWorkItem,
  enqueueWorkPacket,
  readOpsState,
  reconcileOpenClawTasks,
} from '../src/core/ops/kernel.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gbrain-ops-dispatch-'));
}

function tempStore(dir = tempDir()): string {
  return join(dir, 'ops.jsonl');
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
    expected_artifacts: [{ kind: 'test_report' }],
    ...extra,
  };
}

function completion(id: string) {
  return {
    work_item_id: id,
    program_id: 'always-on',
    status: 'succeeded',
    summary: 'Observed OpenClaw task completed and supplied valid completion JSON.',
    artifacts: [{ kind: 'test_report', ref: 'dispatch-fixture' }],
    checks_run: ['bun test test/ops-dispatch.test.ts'],
    next_work_recommendations: [],
    requires_human: false,
    continuation: {},
  };
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

describe('ops OpenClaw dispatch integration', () => {
  test('dummy subagent dispatch records dry-run packet, work pack, run metadata, and artifact', async () => {
    const dir = tempDir();
    const store = tempStore(dir);
    enqueueWorkPacket(packet(work('subagent-a5')), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });

    const cli = JSON.parse(await capture(() => runOpsCommand(null, [
      'dispatch', '--id', 'subagent-a5', '--dry-run', '--store', store, '--json',
      '--openclaw-task-id', 'task_dummy_subagent', '--session-key', 'session_dummy_subagent',
    ])));

    expect(cli.schema).toBe('gbrain.ops.dispatch.v1');
    expect(cli.dispatch_packet.schema).toBe('gbrain.ops.openclaw_dispatch_packet.v1');
    expect(cli.dispatch_packet.dry_run).toBe(true);
    expect(cli.dispatch_packet.runtime).toBe('openclaw_subagent');
    expect(cli.dispatch_packet.command_payload.tool).toBe('sessions_spawn');
    expect(cli.dispatch_packet.openclaw_task_id).toBe('task_dummy_subagent');
    expect(existsSync(cli.packet_path)).toBe(true);
    expect(existsSync(cli.work_pack_path)).toBe(true);

    const state = readOpsState(store);
    const run = state.runs.find(r => r.work_item_id === 'subagent-a5');
    expect(run?.runtime).toBe('openclaw_subagent');
    expect(run?.provider).toBe('openclaw');
    expect(run?.model).toBe('native-subagent');
    expect(run?.openclaw_task_id).toBe('task_dummy_subagent');
    expect(run?.session_key).toBe('session_dummy_subagent');
    expect(run?.input_pack_path).toBe(cli.work_pack_path);
    expect(state.artifacts.find(a => a.kind === 'openclaw_dispatch_packet')?.path).toBe(cli.packet_path);
    expect(JSON.parse(readFileSync(cli.packet_path, 'utf8')).command_payload.label).toBe('subagent-a5');
  });

  test('dummy ACP/Codex dispatch records dry-run command payload without spawning externally', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(work('codex-a5', { worker_kind: 'acp_codex', budget: { model: 'gpt-5.5-codex' } })), { path: store });

    const result = dispatchWorkItem('codex-a5', { path: store, dryRun: true, sessionKey: 'codex_session_dummy' });

    expect(result.dispatch_packet.runtime).toBe('openclaw_acp_codex');
    expect(result.dispatch_packet.provider).toBe('codex');
    expect(result.dispatch_packet.model).toBe('gpt-5.5-codex');
    expect(result.dispatch_packet.command_payload).toEqual(expect.objectContaining({ tool: 'acp_session', mode: 'dry_run', runtime: 'codex' }));
    expect(result.run.session_key).toBe('codex_session_dummy');
    expect(readOpsState(store).runs.find(r => r.id === result.run.id)?.status).toBe('running');
  });

  test('spawn failure records run error, blocks work, releases lease, and creates interrupt', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(work('failure-a5')), { path: store });

    const result = dispatchWorkItem('failure-a5', { path: store, dryRun: true, simulateFailure: true, failureMessage: 'native spawn unavailable' });

    expect(result.run.status).toBe('failed');
    expect(result.run.error).toContain('native spawn unavailable');
    expect(result.work_item.state).toBe('blocked');
    expect(result.interrupt?.title).toContain('OpenClaw dispatch failed');
    const state = readOpsState(store);
    expect(state.leases.find(l => l.id === result.lease?.id)?.lease_status).toBe('released');
    expect(state.interrupts.find(i => i.id === result.interrupt?.id)?.body).toContain('native spawn unavailable');
  });

  test('reconcile fixture updates observed running status and task identifiers', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(work('running-a5')), { path: store });
    const dispatched = dispatchWorkItem('running-a5', { path: store, dryRun: true, openclawTaskId: 'task_running_a5' });

    const result = reconcileOpenClawTasks({ tasks: [{ id: 'task_running_a5', status: 'running', provider: 'openclaw', model: 'native-subagent' }] }, { path: store });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].run_id).toBe(dispatched.run.id);
    expect(result.updates[0].run_status).toBe('running');
    const state = readOpsState(store);
    expect(state.runs.find(r => r.id === dispatched.run.id)?.status).toBe('running');
    expect(state.work_items.find(w => w.id === 'running-a5')?.state).toBe('running');
  });

  test('succeeded OpenClaw task without completion JSON does not mark work item succeeded', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(work('missing-completion-a5')), { path: store });
    const dispatched = dispatchWorkItem('missing-completion-a5', { path: store, dryRun: true, openclawTaskId: 'task_missing_completion' });

    const result = reconcileOpenClawTasks({ task: { id: 'task_missing_completion', status: 'succeeded' } }, { path: store });

    expect(result.updates[0]).toEqual(expect.objectContaining({ run_id: dispatched.run.id, run_status: 'succeeded', completion_accepted: false, work_item_state: 'running' }));
    const state = readOpsState(store);
    expect(state.runs.find(r => r.id === dispatched.run.id)?.status).toBe('succeeded');
    expect(state.runs.find(r => r.id === dispatched.run.id)?.error).toContain('completion JSON');
    expect(state.work_items.find(w => w.id === 'missing-completion-a5')?.state).toBe('running');
    expect(state.interrupts.find(i => i.title.includes('Completion JSON missing'))).toBeTruthy();
  });

  test('valid completion JSON from OpenClaw success is accepted and releases completion contract', () => {
    const dir = tempDir();
    const store = tempStore(dir);
    enqueueWorkPacket(packet(work('valid-completion-a5')), { path: store });
    const dispatched = dispatchWorkItem('valid-completion-a5', { path: store, dryRun: true, openclawTaskId: 'task_valid_completion' });
    const fixture = join(dir, 'openclaw-task.json');
    writeFileSync(fixture, JSON.stringify({ tasks: [{ id: 'task_valid_completion', status: 'completed', completion_json: completion('valid-completion-a5') }] }, null, 2));

    const result = reconcileOpenClawTasks(JSON.parse(readFileSync(fixture, 'utf8')), { path: store });

    expect(result.updates[0]).toEqual(expect.objectContaining({ run_id: dispatched.run.id, run_status: 'succeeded', completion_accepted: true, work_item_state: 'succeeded' }));
    const state = readOpsState(store);
    expect(state.work_items.find(w => w.id === 'valid-completion-a5')?.state).toBe('succeeded');
    expect(state.runs.find(r => r.id === dispatched.run.id)?.completion_json).toEqual(expect.objectContaining({ work_item_id: 'valid-completion-a5' }));
    expect(state.leases.find(l => l.work_item_id === 'valid-completion-a5')?.lease_status).toBe('released');
    expect(existsSync(join(dir, 'runs', dispatched.run.id, 'completion.json'))).toBe(true);
  });
});
