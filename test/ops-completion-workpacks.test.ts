import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runOpsCommand } from '../src/commands/ops.ts';
import {
  buildWorkPack,
  claimWorkItem,
  completeWorkItem,
  enqueueWorkPacket,
  initOpsStore,
  readOpsState,
} from '../src/core/ops/kernel.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gbrain-ops-a4-'));
}

function tempStore(dir = tempDir()): string {
  return join(dir, 'ops.jsonl');
}

function packet(...workItems: any[]) {
  return {
    programs: [{
      id: 'always-on-os',
      title: 'Always-On Intelligence OS',
      objective: 'Keep approved useful work continuously conserved.',
      priority: 100,
      approval_gates: [{ kind: 'external_send', requires: 'human_approval' }],
      autonomy: { internal_files_only: true },
    }],
    work_items: workItems,
  };
}

function work(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    program_id: 'always-on-os',
    title: `Implement ${id}`,
    description: `Do ${id}`,
    lane: 'code',
    worker_kind: 'subagent',
    privacy_tier: 'P1_PRIVATE',
    source_refs: [{ kind: 'spec', path: 'ops/specs/openclaw-always-on-intelligence-os-spec-2026-04-30.md' }],
    acceptance_criteria: ['targeted tests pass', 'typecheck passes'],
    expected_artifacts: [{ kind: 'commit' }, { kind: 'test_report' }],
    guardrails: ['no external sends', 'no trusted memory mutation'],
    ...extra,
  };
}

function completion(id: string, extra: Record<string, unknown> = {}) {
  return {
    work_item_id: id,
    program_id: 'always-on-os',
    status: 'succeeded',
    summary: 'Completed deterministically with tests.',
    artifacts: [{ kind: 'commit', ref: 'abc1234' }],
    checks_run: ['bun test test/ops-completion-workpacks.test.ts'],
    next_work_recommendations: [],
    requires_human: false,
    continuation: {},
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

describe('ops work packs and completion contract', () => {
  test('work pack contains program, item, guardrails, dependencies, artifacts, and completion instructions', async () => {
    const dir = tempDir();
    const store = tempStore(dir);
    enqueueWorkPacket(packet(
      work('pr-a3', { state: 'succeeded' }),
      work('pr-a4', { dependencies: ['pr-a3', 'missing-pr'] }),
    ), { path: store, now: new Date('2026-04-30T07:00:00.000Z') });

    const pack = buildWorkPack('pr-a4', { path: store, now: new Date('2026-04-30T07:05:00.000Z') });
    expect(pack.schema).toBe('gbrain.ops.work_pack.v1');
    expect(pack.work_item.id).toBe('pr-a4');
    expect(pack.work_item.state).toBe('approved');
    expect(pack.work_item.lane).toBe('code');
    expect(pack.work_item.worker_kind).toBe('subagent');
    expect(pack.work_item.privacy_tier).toBe('P1_PRIVATE');
    expect(pack.program?.title).toBe('Always-On Intelligence OS');
    expect(pack.program?.objective).toContain('continuously conserved');
    expect(pack.source_refs).toHaveLength(1);
    expect(pack.dependencies.resolved.map(d => d.id)).toEqual(['pr-a3']);
    expect(pack.dependencies.pending.map(d => d.id)).toEqual(['missing-pr']);
    expect(pack.acceptance_criteria).toContain('targeted tests pass');
    expect(pack.expected_artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'commit' })]));
    expect(pack.guardrails.internal_only).toBe(true);
    expect(pack.guardrails.approval_gates).toHaveLength(1);
    expect(pack.completion_contract.required).toEqual(['work_item_id', 'program_id', 'status', 'summary', 'artifacts', 'checks_run', 'next_work_recommendations', 'requires_human', 'continuation']);
    expect(pack.completion_contract.instructions.join(' ')).toContain('prose-only completion is invalid');

    const out = join(dir, 'pack.json');
    const cli = JSON.parse(await capture(() => runOpsCommand(null, ['work', 'pack', '--id', 'pr-a4', '--out', out, '--store', store, '--json'])));
    expect(cli.schema).toBe('gbrain.ops.work_pack.v1');
    expect(JSON.parse(readFileSync(out, 'utf8')).work_item.id).toBe('pr-a4');
  });

  test('valid completion is accepted, persisted under a deterministic run path, and records checks/artifacts', () => {
    const dir = tempDir();
    const store = tempStore(dir);
    initOpsStore(store);
    enqueueWorkPacket(packet(work('pr-a4')), { path: store });
    const claimed = claimWorkItem('pr-a4', 'worker-a4', { path: store });

    const result = completeWorkItem('pr-a4', completion('pr-a4', {
      next_work_recommendations: [{ id: 'pr-a5', title: 'Dispatch integration', reason: 'next spec item' }],
    }), { path: store });

    expect(result.work_item.state).toBe('succeeded');
    expect(result.completion_path).toBe(join(dir, 'runs', claimed.run.id, 'completion.json'));
    expect(existsSync(result.completion_path)).toBe(true);
    const persisted = JSON.parse(readFileSync(result.completion_path, 'utf8'));
    expect(persisted.checks_run).toEqual(['bun test test/ops-completion-workpacks.test.ts']);
    expect(persisted.next_work_recommendations[0].id).toBe('pr-a5');

    const state = readOpsState(store);
    expect(state.artifacts.map(a => a.kind)).toEqual(['commit']);
    expect(state.runs.find(r => r.id === claimed.run.id)?.completion_path).toBe(result.completion_path);
    expect(state.runs.find(r => r.id === claimed.run.id)?.completion_json).toEqual(expect.objectContaining({ checks_run: expect.any(Array) }));
    expect(state.work_items.map(w => w.id)).toEqual(['pr-a4']);
  });

  test('invalid and prose-only completion are rejected without state mutation', async () => {
    const dir = tempDir();
    const store = tempStore(dir);
    enqueueWorkPacket(packet(work('pr-a4')), { path: store });
    claimWorkItem('pr-a4', 'worker-a4', { path: store });

    expect(() => completeWorkItem('pr-a4', { work_item_id: 'pr-a4', program_id: 'always-on-os', status: 'succeeded', summary: 'Missing mandatory machine fields.' }, { path: store })).toThrow(/invalid completion/);
    expect(readOpsState(store).work_items.find(w => w.id === 'pr-a4')?.state).toBe('running');

    const prosePath = join(dir, 'completion.txt');
    writeFileSync(prosePath, 'Implemented it, tests passed.');
    await expect(runOpsCommand(null, ['work', 'complete', '--id', 'pr-a4', '--completion', prosePath, '--store', store, '--json'])).rejects.toThrow();
    expect(readOpsState(store).work_items.find(w => w.id === 'pr-a4')?.state).toBe('running');
  });

  test('requires_human completion moves work to waiting_human and does not unblock dependencies', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(
      work('pr-a4'),
      work('pr-a5', { dependencies: ['pr-a4'] }),
    ), { path: store });
    claimWorkItem('pr-a4', 'worker-a4', { path: store });

    const result = completeWorkItem('pr-a4', completion('pr-a4', {
      status: 'waiting_human',
      summary: 'Needs human approval for external dispatch boundary.',
      artifacts: [],
      checks_run: ['boundary review prepared'],
      requires_human: true,
      continuation: { question: 'Approve dispatch integration boundary?' },
    }), { path: store });

    expect(result.work_item.state).toBe('waiting_human');
    expect(result.unblocked).toEqual([]);
    const state = readOpsState(store);
    expect(state.work_items.find(w => w.id === 'pr-a5')?.state).toBe('approved');
  });
});
