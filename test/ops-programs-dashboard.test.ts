import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import {
  auditOps,
  buildOpsDashboard,
  claimWorkItem,
  completeWorkItem,
  enqueueWorkPacket,
  parseProgramsYaml,
  readOpsState,
  renderOpsDashboardMarkdown,
  syncProgramsFromYamlFile,
} from '../src/core/ops/kernel.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gbrain-ops-a2-'));
}

function tempStore(dir = tempDir()): string {
  return join(dir, 'ops.jsonl');
}

function registryYaml(priority = 90): string {
  return `programs:
  - id: gbrain-core-build
    title: GBrain Core Build
    status: active
    priority: ${priority}
    owner_agent: claw
    objective: Improve GBrain as evidence-addressable memory and intelligence substrate.
    lanes: [code, evals, docs]
    cadence:
      supervisor_min_interval_minutes: 5
      daily_rollup: true
    budgets:
      minimax_calls_per_day: 1000
      codex_tasks_per_day: 4
    autonomy:
      can_modify_code: true
      can_commit: true
      can_push: false
      can_mutate_trusted_memory: false
      can_contact_people: false
    approval_gates:
      - push_to_remote
      - trusted_memory_write
      - external_message_send
    outputs:
      - type: pr
      - type: test_report
  - id: relationship-steward
    title: Relationship Steward
    status: active
    priority: 80
    owner_agent: local-private
    objective: Track commitments and meeting context without external sends.
    lanes: [meeting_brief, followup_suggestion]
    cadence:
      calendar_lookahead_hours: 48
    budgets:
      qwen_jobs_per_day: 20
    autonomy:
      can_create_meeting_briefs: true
      can_contact_people: false
    approval_gates:
      - external_message_send
    outputs:
      - type: meeting_brief
`;
}

function packet() {
  return {
    work_items: [
      {
        id: 'ready-a2',
        program_id: 'gbrain-core-build',
        title: 'Implement PR-A2',
        description: 'Program registry and dashboard.',
        state: 'ready',
        priority: 90,
        lane: 'code',
        worker_kind: 'subagent',
        privacy_tier: 'P1_PRIVATE',
        acceptance_criteria: ['tests pass'],
      },
      {
        id: 'running-a3',
        program_id: 'gbrain-core-build',
        title: 'Implement supervisor',
        description: 'Supervisor daemon v1.',
        state: 'ready',
        priority: 85,
        lane: 'code',
        worker_kind: 'subagent',
        privacy_tier: 'P1_PRIVATE',
      },
      {
        id: 'done-a1',
        program_id: 'gbrain-core-build',
        title: 'Ops kernel',
        description: 'Ops kernel CLI.',
        state: 'ready',
        priority: 80,
        lane: 'code',
        worker_kind: 'subagent',
        privacy_tier: 'P1_PRIVATE',
      },
      {
        id: 'approval-needed',
        program_id: 'relationship-steward',
        title: 'Approve follow-up draft',
        description: 'Human approval needed before sending.',
        state: 'waiting_human',
        priority: 70,
        lane: 'followup_suggestion',
        worker_kind: 'human_review',
        privacy_tier: 'P1_PRIVATE',
      },
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

describe('ops program registry and dashboard', () => {
  test('minimal YAML parser reads the program seed shape', () => {
    const parsed = parseProgramsYaml(registryYaml());
    expect(parsed.programs).toHaveLength(2);
    expect((parsed.programs[0] as any).lanes).toEqual(['code', 'evals', 'docs']);
    expect((parsed.programs[0] as any).cadence.daily_rollup).toBe(true);
    expect((parsed.programs[0] as any).outputs[0]).toEqual({ type: 'pr' });
  });

  test('programs sync upserts YAML programs through kernel and CLI', async () => {
    const dir = tempDir();
    const store = tempStore(dir);
    const file = join(dir, 'programs.yaml');
    writeFileSync(file, registryYaml());

    const synced = syncProgramsFromYamlFile(file, { path: store, now: new Date('2026-04-30T06:00:00.000Z') });
    expect(synced.upserted_count).toBe(2);
    expect(readOpsState(store).programs.map(p => p.id).sort()).toEqual(['gbrain-core-build', 'relationship-steward']);

    writeFileSync(file, registryYaml(95));
    const cli = JSON.parse(await capture(() => runOpsCommand(null, ['programs', 'sync', '--file', file, '--store', store, '--json'])));
    expect(cli.schema).toBe('gbrain.ops.programs.sync.v1');
    expect(cli.upserted_count).toBe(2);
    const state = readOpsState(store);
    expect(state.programs).toHaveLength(2);
    expect(state.programs.find(p => p.id === 'gbrain-core-build')?.priority).toBe(95);
  });

  test('dashboard state and markdown are generated from the ops store', async () => {
    const dir = tempDir();
    const store = tempStore(dir);
    const file = join(dir, 'programs.yaml');
    writeFileSync(file, registryYaml());
    syncProgramsFromYamlFile(file, { path: store, now: new Date('2026-04-30T06:00:00.000Z') });
    enqueueWorkPacket(packet(), { path: store, now: new Date('2026-04-30T06:01:00.000Z') });
    claimWorkItem('running-a3', 'worker-1', { path: store, now: new Date('2026-04-30T06:02:00.000Z'), leaseMinutes: 1 });
    claimWorkItem('done-a1', 'worker-2', { path: store, now: new Date('2026-04-30T06:03:00.000Z') });
    completeWorkItem('done-a1', { work_item_id: 'done-a1', status: 'succeeded', summary: 'Ops kernel committed.', artifacts: [{ kind: 'commit', ref: 'cad0320' }] }, { path: store, now: new Date('2026-04-30T06:04:00.000Z') });
    auditOps({ path: store, now: new Date('2026-04-30T06:05:00.000Z') });

    const dashboard = buildOpsDashboard({ path: store, now: new Date('2026-04-30T06:05:00.000Z') });
    expect(dashboard.active_programs.map(p => p.id)).toContain('gbrain-core-build');
    expect(dashboard.ready_backlog.map(w => w.id)).toEqual(['ready-a2']);
    expect(dashboard.running_tasks.map(w => w.id)).toEqual(['running-a3']);
    expect(dashboard.stale_tasks.map(t => t.work_item?.id)).toEqual(['running-a3']);
    expect(dashboard.recent_completions.map(w => w.id)).toEqual(['done-a1']);
    expect(dashboard.pending_approvals.work_items.map(w => w.id)).toEqual(['approval-needed']);

    const markdown = renderOpsDashboardMarkdown(dashboard);
    expect(markdown).toContain('## Active programs');
    expect(markdown).toContain('**gbrain-core-build**');
    expect(markdown).toContain('## Ready backlog');
    expect(markdown).toContain('ready-a2');

    const cliJson = JSON.parse(await capture(() => runOpsCommand(null, ['dashboard', '--store', store, '--json'])));
    expect(cliJson.schema).toBe('gbrain.ops.dashboard.v1');
    expect(cliJson.dashboard.active_programs.length).toBe(2);
    const cliMarkdown = await capture(() => runOpsCommand(null, ['dashboard', '--store', store, '--markdown']));
    expect(cliMarkdown).toContain('# Always-On Intelligence OS Dashboard');
  });
});
