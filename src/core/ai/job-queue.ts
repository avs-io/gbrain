import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { routeModel } from './model-router.ts';
import type { ModelProvider, PrivacyTier, WorkKind } from './privacy-policy.ts';

export type IntelligenceJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface IntelligenceJob {
  id: string;
  work_kind: WorkKind;
  privacy_tier: PrivacyTier;
  namespace: string;
  input_ref: string;
  provider?: ModelProvider;
  status: IntelligenceJobStatus;
  priority: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  output_ref?: string;
  cost_estimate?: number;
  retry_count: number;
  idempotency_key: string;
}

export interface QueueStore {
  path: string;
}

export interface EnqueueJobInput {
  work_kind: WorkKind;
  privacy_tier: PrivacyTier;
  namespace: string;
  input_ref: string;
  provider?: ModelProvider;
  priority?: number;
  allowCloudEscalation?: boolean;
  now?: Date;
}

export interface UpdateJobInput {
  id: string;
  status?: IntelligenceJobStatus;
  provider?: ModelProvider;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  output_ref?: string | null;
  cost_estimate?: number | null;
}

export interface RetryJobInput {
  id: string;
  now?: Date;
}

export function defaultJobQueuePath(): string {
  return resolve(process.cwd(), '.gbrain', 'ai', 'job-queue.jsonl');
}

export function deterministicIdempotencyKey(input: Pick<IntelligenceJob, 'work_kind' | 'privacy_tier' | 'namespace' | 'input_ref'>): string {
  return createHash('sha256').update(JSON.stringify({
    work_kind: input.work_kind,
    privacy_tier: input.privacy_tier,
    namespace: input.namespace,
    input_ref: input.input_ref,
  })).digest('hex');
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validIso(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function validateJobRecord(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ['job must be an object'];
  if (typeof value.id !== 'string' || !value.id) errors.push('id is required');
  if (typeof value.work_kind !== 'string' || !value.work_kind) errors.push('work_kind is required');
  if (typeof value.privacy_tier !== 'string' || !value.privacy_tier) errors.push('privacy_tier is required');
  if (typeof value.namespace !== 'string' || !value.namespace) errors.push('namespace is required');
  if (typeof value.input_ref !== 'string' || !value.input_ref) errors.push('input_ref is required');
  if (value.provider !== undefined && typeof value.provider !== 'string') errors.push('provider must be a string');
  if (!['queued', 'running', 'succeeded', 'failed'].includes(String(value.status))) errors.push('status must be queued, running, succeeded, or failed');
  if (typeof value.priority !== 'number') errors.push('priority must be a number');
  if (!validIso(value.created_at)) errors.push('created_at must be an ISO date string');
  if (value.started_at !== undefined && value.started_at !== null && !validIso(value.started_at)) errors.push('started_at must be an ISO date string when present');
  if (value.completed_at !== undefined && value.completed_at !== null && !validIso(value.completed_at)) errors.push('completed_at must be an ISO date string when present');
  if (value.error !== undefined && value.error !== null && typeof value.error !== 'string') errors.push('error must be a string when present');
  if (value.output_ref !== undefined && value.output_ref !== null && typeof value.output_ref !== 'string') errors.push('output_ref must be a string when present');
  if (value.cost_estimate !== undefined && value.cost_estimate !== null && typeof value.cost_estimate !== 'number') errors.push('cost_estimate must be a number when present');
  if (typeof value.retry_count !== 'number') errors.push('retry_count must be a number');
  if (typeof value.idempotency_key !== 'string' || !value.idempotency_key) errors.push('idempotency_key is required');
  return errors;
}

function readQueue(path: string): { jobs: IntelligenceJob[]; errors: string[] } {
  if (!existsSync(path)) return { jobs: [], errors: [] };
  const jobs: IntelligenceJob[] = [];
  const errors: string[] = [];
  const content = readFileSync(path, 'utf8');
  for (const [idx, line] of content.split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const validation = validateJobRecord(parsed);
      if (validation.length) errors.push(`line ${idx + 1}: ${validation.join('; ')}`);
      else jobs.push(parsed as IntelligenceJob);
    } catch (err) {
      errors.push(`line ${idx + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { jobs, errors };
}

function writeQueue(path: string, jobs: IntelligenceJob[]): void {
  ensureParent(path);
  writeFileSync(path, jobs.map(job => JSON.stringify(job)).join('\n') + (jobs.length ? '\n' : ''), 'utf8');
}

export function listJobs(opts: { path?: string; status?: IntelligenceJobStatus; namespace?: string; work_kind?: WorkKind } = {}): { ok: boolean; jobs: IntelligenceJob[]; errors?: string[]; path: string } {
  const path = opts.path || defaultJobQueuePath();
  const { jobs, errors } = readQueue(path);
  const filtered = jobs.filter(job => (!opts.status || job.status === opts.status) && (!opts.namespace || job.namespace === opts.namespace) && (!opts.work_kind || job.work_kind === opts.work_kind));
  return { ok: errors.length === 0, jobs: filtered, errors: errors.length ? errors : undefined, path };
}

export function enqueueJob(input: EnqueueJobInput, opts: { path?: string } = {}): { ok: boolean; job: IntelligenceJob; duplicate: boolean; path: string; errors?: string[] } {
  const path = opts.path || defaultJobQueuePath();
  const { jobs, errors } = readQueue(path);
  const idempotency_key = deterministicIdempotencyKey(input);
  const existing = jobs.find(job => job.idempotency_key === idempotency_key);
  if (existing) return { ok: true, job: existing, duplicate: true, path, errors: errors.length ? errors : undefined };

  const route = routeModel({ kind: input.work_kind, privacy: input.privacy_tier, allowCloudEscalation: input.allowCloudEscalation });
  const now = (input.now || new Date()).toISOString();
  const chosenProvider = input.provider && input.provider !== route.preferred_provider ? input.provider : route.preferred_provider;
  const job: IntelligenceJob = {
    id: `job_${createHash('sha256').update(idempotency_key).digest('hex').slice(0, 12)}`,
    work_kind: input.work_kind,
    privacy_tier: input.privacy_tier,
    namespace: input.namespace,
    input_ref: input.input_ref,
    provider: chosenProvider,
    status: 'queued',
    priority: input.priority ?? 100,
    created_at: now,
    retry_count: 0,
    idempotency_key,
  };
  const validation = validateJobRecord(job);
  if (validation.length) return { ok: false, job, duplicate: false, path, errors: [...errors, ...validation] };
  jobs.push(job);
  writeQueue(path, jobs);
  return { ok: true, job, duplicate: false, path, errors: errors.length ? errors : undefined };
}

export function updateJob(input: UpdateJobInput, opts: { path?: string } = {}): { ok: boolean; job?: IntelligenceJob; path: string; errors?: string[] } {
  const path = opts.path || defaultJobQueuePath();
  const { jobs, errors } = readQueue(path);
  const idx = jobs.findIndex(job => job.id === input.id);
  if (idx < 0) return { ok: false, path, errors: [...errors, `job not found: ${input.id}`] };
  const current = jobs[idx];
  const updated: IntelligenceJob = {
    ...current,
    ...(input.status ? { status: input.status } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.started_at !== undefined ? { started_at: input.started_at || undefined } : {}),
    ...(input.completed_at !== undefined ? { completed_at: input.completed_at || undefined } : {}),
    ...(input.error !== undefined ? { error: input.error || undefined } : {}),
    ...(input.output_ref !== undefined ? { output_ref: input.output_ref || undefined } : {}),
    ...(input.cost_estimate !== undefined ? { cost_estimate: input.cost_estimate ?? undefined } : {}),
  };
  const validation = validateJobRecord(updated);
  if (validation.length) return { ok: false, path, errors: [...errors, ...validation] };
  jobs[idx] = updated;
  writeQueue(path, jobs);
  return { ok: true, job: updated, path, errors: errors.length ? errors : undefined };
}

export function retryJob(input: RetryJobInput, opts: { path?: string } = {}): { ok: boolean; job?: IntelligenceJob; path: string; errors?: string[] } {
  const path = opts.path || defaultJobQueuePath();
  const { jobs, errors } = readQueue(path);
  const idx = jobs.findIndex(job => job.id === input.id);
  if (idx < 0) return { ok: false, path, errors: [...errors, `job not found: ${input.id}`] };
  const current = jobs[idx];
  const next = { ...current, status: 'queued' as const, retry_count: current.retry_count + 1, started_at: undefined, completed_at: undefined, error: undefined };
  const validation = validateJobRecord(next);
  if (validation.length) return { ok: false, path, errors: [...errors, ...validation] };
  jobs[idx] = next;
  writeQueue(path, jobs);
  return { ok: true, job: next, path, errors: errors.length ? errors : undefined };
}
