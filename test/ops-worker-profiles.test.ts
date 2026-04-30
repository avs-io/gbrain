import { describe, expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import {
  enqueueWorkPacket,
  parseWorkerProfilesYaml,
  readOpsState,
  routeWorkItemToWorkerProfile,
  superviseOps,
  syncWorkerProfilesFromYamlFile,
} from '../src/core/ops/kernel.ts';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'gbrain-ops-workers-')); }
function tempStore(): string { return join(tempDir(), 'ops.jsonl'); }

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
    lane: 'public_scout',
    worker_kind: 'minimax',
    privacy_tier: 'P3_PUBLIC',
    priority: 50,
    acceptance_criteria: ['route deterministically'],
    budget: {},
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

describe('ops worker profiles and budget governor', () => {
  test('parses worker_profiles.yaml and routes public scout to MiniMax, code PR to Codex', () => {
    const profiles = parseWorkerProfilesYaml(`
workers:
  - id: minimax-public-scout
    kind: cloud_model
    provider: minimax-m27
    model: minimax-m2.7
    privacy_allowed: [P2, P3, P2_LIMITED_CLOUD, P3_PUBLIC]
    lanes: [public_scout]
    max_concurrent: 20
    budgets:
      calls_per_day: 5000
  - id: codex-pr-engineer
    kind: acp
    provider: codex
    runtime: codex
    model: openai-codex/default
    privacy_allowed: [P1, P2, P1_PRIVATE, P2_LIMITED_CLOUD]
    lanes: [code_pr, code]
    max_concurrent: 2
    budgets:
      tasks_per_day: 20
`).workers;
    const store = tempStore();
    enqueueWorkPacket(packet(
      work('public-a8'),
      work('code-a8', { lane: 'code_pr', worker_kind: 'acp_codex', privacy_tier: 'P1_PRIVATE' }),
    ), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });
    const state = readOpsState(store);

    const scout = routeWorkItemToWorkerProfile(state.work_items.find(w => w.id === 'public-a8')!, state, { profiles });
    expect(scout.ok).toBe(true);
    expect(scout.profile?.id).toBe('minimax-public-scout');
    expect(scout.provider).toBe('minimax-m27');

    const code = routeWorkItemToWorkerProfile(state.work_items.find(w => w.id === 'code-a8')!, state, { profiles });
    expect(code.ok).toBe(true);
    expect(code.profile?.id).toBe('codex-pr-engineer');
    expect(code.runtime).toBe('codex');
  });

  test('privacy routing denies P0/P1 raw tasks to MiniMax unless an explicit redacted profile allows it', () => {
    const profiles = parseWorkerProfilesYaml(`
workers:
  - id: minimax-public-scout
    kind: cloud_model
    provider: minimax-m27
    model: minimax-m2.7
    privacy_allowed: [P2, P3]
    lanes: [public_scout]
    max_concurrent: 20
  - id: minimax-redacted-review
    kind: cloud_model
    provider: minimax-m27
    model: minimax-m2.7
    privacy_allowed: [P1_redacted, P2, P3]
    lanes: [redacted_scout]
    max_concurrent: 2
`).workers;
    const store = tempStore();
    enqueueWorkPacket(packet(
      work('raw-private-a8', { privacy_tier: 'P1_PRIVATE' }),
      work('redacted-private-a8', { lane: 'redacted_scout', privacy_tier: 'P1_PRIVATE', budget: { redacted: true } }),
    ), { path: store });
    const state = readOpsState(store);

    const raw = routeWorkItemToWorkerProfile(state.work_items.find(w => w.id === 'raw-private-a8')!, state, { profiles });
    expect(raw.ok).toBe(false);
    expect(raw.defer).toBe('privacy_route_denied');

    const redacted = routeWorkItemToWorkerProfile(state.work_items.find(w => w.id === 'redacted-private-a8')!, state, { profiles });
    expect(redacted.ok).toBe(true);
    expect(redacted.profile?.id).toBe('minimax-redacted-review');
  });

  test('private extraction selects local Qwen and P0 cannot dispatch to MiniMax override', async () => {
    const profiles = parseWorkerProfilesYaml(`
workers:
  - id: qwen-private-extractor
    kind: local_model
    provider: qwen-local
    model: qwen3.6-35b-a3b
    privacy_allowed: [P0_LOCAL_ONLY, P1_PRIVATE]
    lanes: [private_extraction]
    max_concurrent: 2
  - id: minimax-public-scout
    kind: cloud_model
    provider: minimax-m27
    model: minimax-m2.7
    privacy_allowed: [P3_PUBLIC]
    lanes: [private_extraction, public_scout]
    max_concurrent: 20
`).workers;
    const store = tempStore();
    enqueueWorkPacket(packet(work('private-extract-a8', { lane: 'private_extraction', worker_kind: 'qwen_local', privacy_tier: 'P0_LOCAL_ONLY' })), { path: store });
    const state = readOpsState(store);

    const routed = routeWorkItemToWorkerProfile(state.work_items.find(w => w.id === 'private-extract-a8')!, state, { profiles });
    expect(routed.ok).toBe(true);
    expect(routed.profile?.id).toBe('qwen-private-extractor');
    expect(routed.provider).toBe('qwen-local');

    await expect(runOpsCommand(null, ['dispatch', '--id', 'private-extract-a8', '--dry-run', '--store', store, '--json', '--provider', 'minimax-m27', '--model', 'minimax-m2.7'])).rejects.toThrow(/route denied/);
  });

  test('supervisor claims through matching profiles and respects max concurrency', () => {
    const dir = tempDir();
    const profilesPath = join(dir, 'worker_profiles.yaml');
    writeFileSync(profilesPath, `
workers:
  - id: minimax-one
    kind: cloud_model
    provider: minimax-m27
    model: minimax-m2.7
    privacy_allowed: [P3_PUBLIC]
    lanes: [public_scout]
    max_concurrent: 1
`);
    const store = join(dir, 'ops.jsonl');
    syncWorkerProfilesFromYamlFile(profilesPath, { path: store });
    enqueueWorkPacket(packet(work('first-a8'), work('second-a8', { priority: 40 })), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });

    const result = superviseOps({ path: store, now: new Date('2026-04-30T06:01:00.000Z'), maxClaims: 2, maxRunning: 2 });
    expect(result.claimed.map(c => c.work_item.id)).toEqual(['first-a8']);
    expect(result.claimed[0].run.worker_id).toBe('minimax-one');
    expect(result.claimed[0].run.provider).toBe('minimax-m27');
    expect(result.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'defer_work_item', work_item_id: 'second-a8', defer: 'concurrency_full' })]));
    expect(readOpsState(store).work_items.find(w => w.id === 'second-a8')?.state).toBe('ready');
  });

  test('budget exceeded defers ready tasks without failing or silently claiming them', () => {
    const dir = tempDir();
    const profilesPath = join(dir, 'worker_profiles.yaml');
    writeFileSync(profilesPath, `
workers:
  - id: minimax-budgeted
    kind: cloud_model
    provider: minimax-m27
    model: minimax-m2.7
    privacy_allowed: [P3_PUBLIC]
    lanes: [public_scout]
    max_concurrent: 10
    budgets:
      calls_per_day: 1
`);
    const store = join(dir, 'ops.jsonl');
    syncWorkerProfilesFromYamlFile(profilesPath, { path: store });
    const now = new Date('2026-04-30T06:00:00.000Z');
    enqueueWorkPacket(packet(work('budget-a8')), { path: store, now });
    appendFileSync(store, JSON.stringify({
      schema: 'gbrain.ops.event.v1',
      type: 'budget_ledger',
      at: now.toISOString(),
      payload: { id: 1, provider: 'minimax-m27', model: 'minimax-m2.7', calls: 1, occurred_at: now.toISOString(), metadata: {} },
    }) + '\n');

    const result = superviseOps({ path: store, now: new Date('2026-04-30T06:01:00.000Z'), maxClaims: 1, maxRunning: 1 });
    expect(result.claimed).toEqual([]);
    expect(result.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'defer_work_item', work_item_id: 'budget-a8', defer: 'budget_exceeded' })]));
    expect(readOpsState(store).work_items.find(w => w.id === 'budget-a8')?.state).toBe('ready');
  });

  test('CLI can list profiles and route a work item from worker_profiles.yaml', async () => {
    const dir = tempDir();
    const profilesPath = join(dir, 'worker_profiles.yaml');
    writeFileSync(profilesPath, `workers:\n  - id: codex-pr-engineer\n    kind: acp\n    provider: codex\n    runtime: codex\n    model: openai-codex/default\n    privacy_allowed: [P1_PRIVATE, P2_LIMITED_CLOUD]\n    lanes: [code_pr]\n    max_concurrent: 2\n`);
    const store = join(dir, 'ops.jsonl');
    enqueueWorkPacket(packet(work('cli-code-a8', { lane: 'code_pr', worker_kind: 'acp_codex', privacy_tier: 'P1_PRIVATE' })), { path: store });

    const listed = JSON.parse(await capture(() => runOpsCommand(null, ['workers', 'list', '--profiles', profilesPath, '--json'])));
    expect(listed.worker_profiles[0].id).toBe('codex-pr-engineer');
    const synced = JSON.parse(await capture(() => runOpsCommand(null, ['workers', 'sync', '--file', profilesPath, '--store', store, '--json'])));
    expect(synced.upserted_count).toBe(1);
    const storeListed = JSON.parse(await capture(() => runOpsCommand(null, ['workers', 'list', '--store', store, '--json'])));
    expect(storeListed.worker_profiles[0].id).toBe('codex-pr-engineer');
    const routed = JSON.parse(await capture(() => runOpsCommand(null, ['workers', 'route', '--id', 'cli-code-a8', '--store', store, '--profiles', profilesPath, '--json'])));
    expect(routed.route.worker_profile_id).toBe('codex-pr-engineer');
  });
});
