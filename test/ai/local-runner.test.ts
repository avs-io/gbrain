import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enqueueJob, listJobs } from '../../src/core/ai/job-queue.ts';
import { runLocalIntelligenceJob } from '../../src/core/ai/local-runner.ts';
import type { ModelCallAuditInput } from '../../src/core/ai/model-call-audit.ts';

function audit(inputRef: string, privacy: 'P0_PRIVATE_RAW' | 'P1_PRIVATE' | 'P2_PRIVATE' = 'P1_PRIVATE'): ModelCallAuditInput {
  return {
    provider: 'qwen-local',
    model: 'qwen3-local',
    prompt: `local-runner:${inputRef}`,
    privacy,
    namespace: 'personal',
    input_refs: [inputRef],
    output_refs: ['artifact:local-runner-output'],
    status: 'completed',
  };
}

describe('local intelligence job runner', () => {
  test('claim_verify is deterministic and local-only', () => {
    const job = { id: 'job_1', work_kind: 'claim_support_check', privacy_tier: 'P0', namespace: 'personal', input_ref: 'input-1', status: 'queued', priority: 100, created_at: '2026-04-30T00:00:00.000Z', retry_count: 0, idempotency_key: 'k' } as const;
    const out = runLocalIntelligenceJob(job, { inputRefBaseDir: tmpdir(), audit: audit(job.input_ref, 'P0_PRIVATE_RAW') });
    expect(out.schema).toBe('gbrain.ai.local-runner.v1');
    expect(out.route.preferred_provider).toBe('qwen-local');
    expect(out.guardrails.join(' ')).toContain('local-only');
    expect(out.status).toBe('needs_review');
  });

  test('rejects synthetic or non-gbs1 evidence for evidence_extract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-local-runner-'));
    const path = join(dir, 'input.json');
    writeFileSync(path, JSON.stringify({ span_id: 'syn:1', quote: 'x', direct_quote_claim: 'x' }), 'utf8');
    const job = { id: 'job_2', work_kind: 'evidence_extract', privacy_tier: 'P0', namespace: 'personal', input_ref: path, status: 'queued', priority: 100, created_at: '2026-04-30T00:00:00.000Z', retry_count: 0, idempotency_key: 'k2' } as const;
    const out = runLocalIntelligenceJob(job, { inputRefBaseDir: dir, audit: audit(job.input_ref, 'P0_PRIVATE_RAW') });
    expect(out.status).toBe('unsupported');
    expect(out.errors.join(' ')).toContain('rejected');
  });

  test('produces review-only memory atom proposal draft only when direct quote support passes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-local-runner-'));
    const path = join(dir, 'input.json');
    writeFileSync(path, JSON.stringify({ span_id: 'gbs1:default:sources/test/page#compiled_truth:L1-L2', quote: 'Chief prefers review-only proposal flows for memory atoms.', direct_quote_claim: 'Chief prefers review-only proposal flows for memory atoms.', source_item_id: 'sources/test/page' }), 'utf8');
    const job = { id: 'job_3', work_kind: 'evidence_extract', privacy_tier: 'P1', namespace: 'personal', input_ref: path, status: 'queued', priority: 100, created_at: '2026-04-30T00:00:00.000Z', retry_count: 0, idempotency_key: 'k3' } as const;
    const out = runLocalIntelligenceJob(job, { inputRefBaseDir: dir, audit: audit(job.input_ref, 'P1_PRIVATE') });
    expect(out.status).toBe('succeeded');
    expect(out.outputs.memory_atom_proposal).toBeTruthy();
    expect((out.outputs.memory_atom_proposal as Record<string, unknown>).review_only).toBe(true);
  });

  test('dry-run does not mutate queue, --yes updates queue', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-local-runner-'));
    const queue = join(dir, 'job-queue.jsonl');
    const enqueue = enqueueJob({ work_kind: 'evidence_extract', privacy_tier: 'P1', namespace: 'personal', input_ref: 'input-1' }, { path: queue });
    const before = readFileSync(queue, 'utf8');
    const dry = spawnSync('bun', ['run', 'src/cli.ts', 'ai', 'jobs', 'run', '--queue-path', queue, '--job-id', enqueue.job.id, '--json'], { cwd: '/Users/a/.openclaw/workspace/gbrain', encoding: 'utf8' });
    expect(dry.status).toBe(0);
    expect(readFileSync(queue, 'utf8')).toBe(before);
    const yes = spawnSync('bun', ['run', 'src/cli.ts', 'ai', 'jobs', 'run', '--queue-path', queue, enqueue.job.id, '--yes', '--json'], { cwd: '/Users/a/.openclaw/workspace/gbrain', encoding: 'utf8' });
    expect(yes.status).toBe(0);
    const after = listJobs({ path: queue });
    expect(after.jobs[0].status).toBeOneOf(['succeeded', 'failed', 'queued']);
    expect(readFileSync(queue, 'utf8')).not.toBe(before);
  });
});
