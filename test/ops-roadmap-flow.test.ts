import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runOpsCommand } from '../src/commands/ops.ts';
import {
  claimWorkItem,
  completeWorkItem,
  importRoadmapFile,
  readOpsState,
  roadmapStatus,
  superviseOps,
} from '../src/core/ops/kernel.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gbrain-ops-roadmap-'));
}

function tempStore(dir = tempDir()): string {
  return join(dir, 'ops.jsonl');
}

function completion(id: string, status: 'succeeded' | 'failed' | 'waiting_human' = 'succeeded', extra: Record<string, unknown> = {}) {
  return {
    work_item_id: id,
    program_id: 'gbrain-core-build',
    status,
    summary: status === 'succeeded' ? `${id} completed with gates.` : `${id} did not complete cleanly.`,
    artifacts: status === 'succeeded' ? [{ kind: 'commit', ref: `${id}-sha` }] : [{ kind: 'test_report', path: `reports/${id}.json` }],
    checks_run: ['bun test test/ops-roadmap-flow.test.ts'],
    next_work_recommendations: [],
    requires_human: status === 'waiting_human',
    continuation: { flow_id: 'gbrain-pr-roadmap-2026-04-30', next_step_policy: 'auto_advance_if_dependencies_satisfied' },
    ...extra,
  };
}

function roadmapYaml(): string {
  return `flow_id: gbrain-pr-roadmap-2026-04-30
program_id: gbrain-core-build
title: GBrain PR18-PR27 Roadmap
goal: Implement PR18-PR27 intelligence-substrate roadmap
auto_advance: true
priority: 90
worker_kind: subagent
privacy_tier: P1_PRIVATE
lanes: [code, evals]
approval_required_before: [push, trusted_memory_write]
expected_artifacts:
  - kind: commit
  - kind: test_report
steps:
  - id: pr18
    title: Claim ledger v1
    state: succeeded
    acceptance_criteria: [claim ledger tests pass]
  - id: pr19
    title: TopicTrack schema and scout registry
    depends_on: [pr18]
    acceptance_criteria: [topic schema test passes]
  - id: pr20
    title: Scout runner
    depends_on: [pr19]
    acceptance_criteria: [scout runner test passes]
  - id: pr21
    title: World candidate extraction
    depends_on: [pr20]
    acceptance_criteria: [world extractor test passes]
  - id: pr22
    title: Topic state compiler
    depends_on: [pr21]
    acceptance_criteria: [topic state test passes]
  - id: pr23
    title: ContextPack v2 compiler
    depends_on: [pr22]
  - id: pr24
    title: Radar surfacing v1
    depends_on: [pr23]
  - id: pr25
    title: Governed action proposals
    depends_on: [pr24]
  - id: pr26
    title: Workflow eval suite v1
    depends_on: [pr25]
  - id: pr27
    title: Data hygiene and timeline hardening
    depends_on: [pr26]
`;
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

describe('ops roadmap flow manager', () => {
  test('imports PR18-PR27 YAML into managed WorkItems with dependencies and metadata', async () => {
    const dir = tempDir();
    const store = tempStore(dir);
    const file = join(dir, 'roadmap.yaml');
    writeFileSync(file, roadmapYaml());

    const cli = JSON.parse(await capture(() => runOpsCommand(null, ['roadmap', 'import', '--file', file, '--store', store, '--json'])));
    expect(cli.schema).toBe('gbrain.ops.roadmap_flow.v1');
    expect(cli.flow.id).toBe('gbrain-pr-roadmap-2026-04-30');
    expect(cli.work_items).toHaveLength(10);

    const state = readOpsState(store);
    const pr19 = state.work_items.find(w => w.id === 'pr19');
    const pr20 = state.work_items.find(w => w.id === 'pr20');
    expect(pr19?.state).toBe('ready');
    expect(pr20?.state).toBe('approved');
    expect(pr20?.dependencies).toEqual(['pr19']);
    expect(pr20?.worker_kind).toBe('subagent');
    expect(pr20?.privacy_tier).toBe('P1_PRIVATE');
    expect(pr20?.lanes).toEqual(['code', 'evals']);
    expect(pr20?.expected_artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'commit' })]));
    expect(pr20?.auto_advance).toEqual(expect.objectContaining({ enabled: true, flow_id: 'gbrain-pr-roadmap-2026-04-30' }));
  });

  test('PR19 completion unblocks PR20 and supervisor claims PR20 within no-idle SLA', () => {
    const dir = tempDir();
    const store = tempStore(dir);
    const file = join(dir, 'roadmap.yaml');
    writeFileSync(file, roadmapYaml());
    importRoadmapFile(file, { path: store, now: new Date('2026-04-30T06:00:00.000Z') });

    claimWorkItem('pr19', 'worker-pr19', { path: store, now: new Date('2026-04-30T06:01:00.000Z') });
    const completed = completeWorkItem('pr19', completion('pr19'), { path: store, now: new Date('2026-04-30T06:05:00.000Z') });
    expect(completed.unblocked.map(w => w.id)).toEqual(['pr20']);
    expect(readOpsState(store).work_items.find(w => w.id === 'pr20')?.state).toBe('ready');

    const before = roadmapStatus('gbrain-pr-roadmap-2026-04-30', { path: store, now: new Date('2026-04-30T06:06:00.000Z') });
    expect(before.current_step?.id).toBe('pr20');
    expect(before.next_ready_item?.id).toBe('pr20');
    expect(before.no_idle_health.status).toBe('red');

    const supervised = superviseOps({ path: store, now: new Date('2026-04-30T06:07:00.000Z') });
    expect(supervised.claimed.map(c => c.work_item.id)).toEqual(['pr20']);
    expect(supervised.claimed[0].run.runtime).toBe('supervisor_placeholder');

    const after = roadmapStatus('gbrain-pr-roadmap-2026-04-30', { path: store, now: new Date('2026-04-30T06:08:00.000Z') });
    expect(after.current_step?.id).toBe('pr20');
    expect(after.counts.running).toBe(1);
    expect(after.no_idle_health.status).toBe('green');
  });

  test('PR20 failure keeps PR21 blocked and status reports current step/counts', () => {
    const dir = tempDir();
    const store = tempStore(dir);
    const file = join(dir, 'roadmap.yaml');
    writeFileSync(file, roadmapYaml());
    importRoadmapFile(file, { path: store });
    claimWorkItem('pr19', 'worker-pr19', { path: store });
    completeWorkItem('pr19', completion('pr19'), { path: store });
    superviseOps({ path: store });

    completeWorkItem('pr20', completion('pr20', 'failed', { summary: 'PR20 tests failed; do not advance PR21.', requires_human: false }), { path: store });

    const state = readOpsState(store);
    expect(state.work_items.find(w => w.id === 'pr20')?.state).toBe('failed');
    expect(state.work_items.find(w => w.id === 'pr21')?.state).toBe('blocked');
    expect(state.work_items.find(w => w.id === 'pr21')?.last_state_reason).toContain('dependency pr20 failed');

    const status = roadmapStatus('gbrain-pr-roadmap-2026-04-30', { path: store });
    expect(status.current_step?.id).toBe('pr20');
    expect(status.counts.succeeded).toBe(2);
    expect(status.counts.failed).toBe(1);
    expect(status.counts.blocked).toBeGreaterThanOrEqual(1);
    expect(status.next_ready_item).toBeUndefined();
    expect(status.blocked_reasons).toEqual(expect.arrayContaining([expect.objectContaining({ work_item_id: 'pr21', dependency_id: 'pr20', dependency_state: 'failed' })]));
    expect(status.no_idle_health.recommended_action).toBe('resolve_blocker');
  });

  test('waiting_human blocks downstream and status explains approval/input needed', () => {
    const dir = tempDir();
    const store = tempStore(dir);
    const file = join(dir, 'roadmap.yaml');
    writeFileSync(file, roadmapYaml());
    importRoadmapFile(file, { path: store });
    claimWorkItem('pr19', 'worker-pr19', { path: store });

    completeWorkItem('pr19', completion('pr19', 'waiting_human', {
      summary: 'Needs approval before continuing roadmap.',
      artifacts: [],
      checks_run: ['prepared approval packet'],
      continuation: { question: 'Approve continuing PR20?' },
    }), { path: store });

    const state = readOpsState(store);
    expect(state.work_items.find(w => w.id === 'pr19')?.state).toBe('waiting_human');
    expect(state.work_items.find(w => w.id === 'pr20')?.state).toBe('blocked');
    expect(state.work_items.find(w => w.id === 'pr20')?.last_state_reason).toContain('human approval/input');

    const status = roadmapStatus('gbrain-pr-roadmap-2026-04-30', { path: store });
    expect(status.current_step?.id).toBe('pr19');
    expect(status.counts.waiting_human).toBe(1);
    expect(status.counts.blocked).toBeGreaterThanOrEqual(1);
    expect(status.blocked_reasons.map(r => r.reason).join(' ')).toContain('human approval/input');
    expect(status.no_idle_health.recommended_action).toBe('human_input');
  });
});
