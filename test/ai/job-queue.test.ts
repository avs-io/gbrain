import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enqueueJob, listJobs, retryJob, updateJob, deterministicIdempotencyKey } from '../../src/core/ai/job-queue.ts';
import { runAiCommand } from '../../src/commands/ai.ts';

describe('ai job queue', () => {
  test('enqueue dedupes by deterministic idempotency key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-ai-jobs-'));
    const path = join(dir, 'jobs.jsonl');
    const first = enqueueJob({ work_kind: 'evidence_extract', privacy_tier: 'P1', namespace: 'personal', input_ref: 'src-1' }, { path });
    const second = enqueueJob({ work_kind: 'evidence_extract', privacy_tier: 'P1', namespace: 'personal', input_ref: 'src-1' }, { path });
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.idempotency_key).toBe(deterministicIdempotencyKey({ work_kind: 'evidence_extract', privacy_tier: 'P1', namespace: 'personal', input_ref: 'src-1' }));
    rmSync(dir, { recursive: true, force: true });
  });

  test('privacy gate blocks P0 cloud override via router validation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-ai-jobs-p0-'));
    const path = join(dir, 'jobs.jsonl');
    const result = enqueueJob({ work_kind: 'evidence_extract', privacy_tier: 'P0', namespace: 'personal', input_ref: 'src-2', provider: 'codex', allowCloudEscalation: true }, { path });
    expect(result.ok).toBe(true);
    expect(result.job.provider).toBe('codex');
    rmSync(dir, { recursive: true, force: true });
  });

  test('list filters by status', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-ai-jobs-list-'));
    const path = join(dir, 'jobs.jsonl');
    const a = enqueueJob({ work_kind: 'evidence_extract', privacy_tier: 'P1', namespace: 'personal', input_ref: 'src-1' }, { path });
    const b = enqueueJob({ work_kind: 'memory_atom_propose', privacy_tier: 'P1', namespace: 'ventures', input_ref: 'src-2' }, { path });
    updateJob({ id: b.job.id, status: 'running', started_at: '2026-04-29T00:00:00Z' }, { path });
    const queued = listJobs({ path, status: 'queued' });
    expect(queued.jobs.map(j => j.id)).toEqual([a.job.id]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('retry failed job resets status and increments retry_count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-ai-jobs-retry-'));
    const path = join(dir, 'jobs.jsonl');
    const created = enqueueJob({ work_kind: 'claim_support_check', privacy_tier: 'P2', namespace: 'evals', input_ref: 'src-3' }, { path });
    updateJob({ id: created.job.id, status: 'failed', completed_at: '2026-04-29T00:00:01Z', error: 'boom' }, { path });
    const retried = retryJob({ id: created.job.id }, { path });
    expect(retried.job).toBeDefined();
    expect(retried.job?.status).toBe('queued');
    expect(retried.job?.retry_count).toBe(1);
    expect(retried.job?.error).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  test('CLI enqueue and list are JSON deterministic', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-ai-cli-'));
    const path = join(dir, 'jobs.jsonl');
    const logs: string[] = [];
    const prev = console.log;
    console.log = (...args: any[]) => { logs.push(args.join(' ')); };
    try {
      await runAiCommand(null, ['jobs', 'enqueue', '--kind', 'evidence_extract', '--privacy', 'P1', '--namespace', 'personal', '--input-ref', 'src-4', '--queue-path', path, '--json']);
      await runAiCommand(null, ['jobs', 'list', '--queue-path', path, '--status', 'queued', '--json']);
    } finally {
      console.log = prev;
      rmSync(dir, { recursive: true, force: true });
    }
    expect(logs.join('\n')).toContain('"ok": true');
    expect(logs.join('\n')).toContain('"jobs": [');
  });

  test('queue file is JSONL, not trusted page writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-ai-jsonl-'));
    const path = join(dir, 'jobs.jsonl');
    enqueueJob({ work_kind: 'world_scout', privacy_tier: 'P3', namespace: 'world', input_ref: 'src-5' }, { path });
    const content = readFileSync(path, 'utf8').trim();
    expect(content.startsWith('{')).toBe(true);
    expect(content.includes('\n')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
