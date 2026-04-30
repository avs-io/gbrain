import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import {
  auditOps,
  readOpsState,
  seedInitialWorkItemsFromProgramsYamlFile,
  superviseOps,
  syncProgramsFromYamlFile,
  syncWorkerProfilesFromYamlFile,
} from '../src/core/ops/kernel.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gbrain-ops-real-allocator-'));
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

function programsYaml(): string {
  return `programs:
  - id: gbrain-core-build
    title: GBrain Core Build
    status: active
    priority: 90
    objective: Improve GBrain through PR-sized code changes.
    lanes: [code, evals]
    budgets:
      codex_tasks_per_day: 4
    autonomy:
      can_modify_code: true
      can_push: false
      can_contact_people: false
      can_mutate_trusted_memory: false
    approval_gates:
      - push_to_remote
  - id: world-sovereign-ai-india
    title: Sovereign AI India World Intelligence
    status: active
    priority: 85
    objective: Maintain public-source topic intelligence.
    lanes: [public_scout, claim_extraction, topic_state]
    budgets:
      minimax_calls_per_day: 5000
    autonomy:
      can_ingest_public_sources: true
      can_contact_people: false
      can_mutate_trusted_memory: false
    approval_gates:
      - external_message_send
  - id: paused-track
    title: Paused Track
    status: paused
    priority: 10
    objective: Should not get seeded.
    lanes: [research]
`;
}

function workerProfilesYaml(): string {
  return `worker_profiles:
  - id: minimax-public-scout
    title: MiniMax public scout
    worker_kind: minimax
    provider: minimax
    model: MiniMax-M2.7
    public_cloud: true
    allowed_privacy_tiers: [P3]
    preferred_lanes: [public_scout, scout, research]
    task_types: [public_scout, world_scout]
    max_concurrency: 20
    daily_task_budget: 5000
  - id: codex-pr-engineer
    title: Codex PR engineer
    worker_kind: acp_codex
    runtime: codex
    provider: codex
    model: openai-codex/default
    public_cloud: false
    allowed_privacy_tiers: [P1, P2]
    preferred_lanes: [code, engineering]
    task_types: [code_pr, code]
    max_concurrency: 2
    daily_task_budget: 20
`;
}

describe('ops kernel real allocator transition', () => {
  test('active programs with no WorkItems are not green', () => {
    const dir = tempDir();
    const store = join(dir, 'ops.jsonl');
    const programs = join(dir, 'programs.yaml');
    writeFileSync(programs, programsYaml());
    syncProgramsFromYamlFile(programs, { path: store, now: new Date('2026-04-30T08:00:00.000Z') });

    const audit = auditOps({ path: store, now: new Date('2026-04-30T08:01:00.000Z') });
    expect(audit.status).toBe('red');
    expect(audit.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'active_program_without_work', severity: 'red', program_ids: ['gbrain-core-build', 'world-sovereign-ai-india'] }),
    ]));
  });

  test('seeding active programs creates allocator-owned ready work and supervisor claims through synced profiles', async () => {
    const dir = tempDir();
    const store = join(dir, 'ops.jsonl');
    const programs = join(dir, 'programs.yaml');
    const workers = join(dir, 'worker_profiles.yaml');
    writeFileSync(programs, programsYaml());
    writeFileSync(workers, workerProfilesYaml());

    const synced = syncWorkerProfilesFromYamlFile(workers, { path: store, now: new Date('2026-04-30T08:00:00.000Z') });
    expect(synced.upserted_count).toBe(2);
    const seeded = seedInitialWorkItemsFromProgramsYamlFile(programs, { path: store, now: new Date('2026-04-30T08:01:00.000Z') });
    expect(seeded.created_count).toBe(2);
    expect(seeded.work_items.map(w => w.program_id).sort()).toEqual(['gbrain-core-build', 'world-sovereign-ai-india']);
    expect(seeded.work_items.every(w => w.state === 'ready')).toBe(true);
    expect(readOpsState(store).work_items.find(w => w.program_id === 'paused-track')).toBeUndefined();

    const seededAudit = auditOps({ path: store, now: new Date('2026-04-30T08:02:00.000Z') });
    expect(seededAudit.alerts.some(a => a.kind === 'active_program_without_work')).toBe(false);
    expect(seededAudit.alerts.some(a => a.kind === 'no_idle')).toBe(true);

    const supervised = superviseOps({ path: store, now: new Date('2026-04-30T08:03:00.000Z'), maxClaims: 2, maxRunning: 2 });
    expect(supervised.claimed.map(c => c.work_item.program_id).sort()).toEqual(['gbrain-core-build', 'world-sovereign-ai-india']);
    expect(supervised.claimed.map(c => c.run.provider).sort()).toEqual(['codex', 'minimax']);

    const finalAudit = auditOps({ path: store, now: new Date('2026-04-30T08:04:00.000Z') });
    expect(finalAudit.status).toBe('green');
    expect(finalAudit.counts.active_count).toBe(2);
    expect(finalAudit.counts.supervisor_ticks).toBeGreaterThanOrEqual(2);
  });

  test('CLI seed-work is idempotent unless forced', async () => {
    const dir = tempDir();
    const store = join(dir, 'ops.jsonl');
    const programs = join(dir, 'programs.yaml');
    writeFileSync(programs, programsYaml());

    const first = JSON.parse(await capture(() => runOpsCommand(null, ['programs', 'seed-work', '--file', programs, '--store', store, '--json'])));
    expect(first.schema).toBe('gbrain.ops.programs.seed_work.v1');
    expect(first.created_count).toBe(2);

    const second = JSON.parse(await capture(() => runOpsCommand(null, ['programs', 'seed-work', '--file', programs, '--store', store, '--json'])));
    expect(second.created_count).toBe(0);
    expect(second.skipped_count).toBe(2);
  });
});
