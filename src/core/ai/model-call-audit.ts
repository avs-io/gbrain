import { createHash } from 'node:crypto';

export type ModelCallPrivacy = 'P0_PRIVATE_RAW' | 'P1_PRIVATE' | 'P2_PRIVATE' | 'P3_PUBLIC';
export type ModelCallStatus = 'recorded' | 'completed' | 'failed' | 'redacted';
export const KNOWN_MODEL_CALL_PROVIDERS = ['qwen-local', 'minimax-m27', 'codex', 'gpt-pro', 'claude-pro', 'local', 'anthropic', 'openai-embedding', 'ollama-embedding'] as const;
export const KNOWN_MODEL_CALL_ENTRYPOINTS = ['prepareProviderRun', 'runLocalIntelligenceJob', 'expandQueryHaiku', 'embedOpenAI', 'embedOllama', 'subagentAnthropicTurn'] as const;
export type KnownModelCallEntrypoint = typeof KNOWN_MODEL_CALL_ENTRYPOINTS[number];

export interface ModelCallAuditInput {
  provider: string;
  model?: string;
  prompt: string;
  privacy: ModelCallPrivacy;
  namespace: string;
  input_refs: string[];
  output_refs?: string[];
  status?: ModelCallStatus;
  cost?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  job_key?: string;
  created_at?: string;
  retain_raw_prompt_text?: boolean;
}

export interface ModelCallAuditRecord {
  schema: 'gbrain.model_call_audit.v1';
  call_key: string;
  provider: string;
  model: string;
  privacy: ModelCallPrivacy;
  namespace: string;
  prompt_hash: string;
  prompt_redacted: boolean;
  raw_prompt_retained: boolean;
  input_refs: string[];
  output_refs: string[];
  status: ModelCallStatus;
  cost: Record<string, unknown>;
  metadata: Record<string, unknown>;
  job_key?: string;
  created_at: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function nonEmpty(value: string, name: string): string {
  const out = value.trim();
  if (!out) throw new Error(`${name} is required`);
  return out;
}

function normalizePrivacy(value: unknown): ModelCallPrivacy {
  if (value === 'P0_PRIVATE_RAW' || value === 'P1_PRIVATE' || value === 'P2_PRIVATE' || value === 'P3_PUBLIC') return value;
  throw new Error('privacy must be one of P0_PRIVATE_RAW|P1_PRIVATE|P2_PRIVATE|P3_PUBLIC');
}

function stringArray(value: string[], name: string): string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim())) throw new Error(`${name} must be a non-empty string[] of refs`);
  const out = [...new Set(value.map(v => v.trim()))];
  if (!out.length) throw new Error(`${name} must be a non-empty string[] of refs`);
  return out;
}

export function buildModelCallAuditRecord(input: ModelCallAuditInput): ModelCallAuditRecord {
  const provider = nonEmpty(input.provider, 'provider');
  if (!(KNOWN_MODEL_CALL_PROVIDERS as readonly string[]).includes(provider)) throw new Error(`unknown provider: ${provider}`);
  const namespace = nonEmpty(input.namespace, 'namespace');
  const prompt = nonEmpty(input.prompt, 'prompt');
  const privacy = normalizePrivacy(input.privacy);
  const inputRefs = stringArray(input.input_refs, 'input_refs');
  const outputRefs = input.output_refs ? stringArray(input.output_refs, 'output_refs') : [];
  const status = input.status || (privacy === 'P0_PRIVATE_RAW' || privacy === 'P1_PRIVATE' ? 'redacted' : 'recorded');
  if (status === 'completed' && outputRefs.length === 0) throw new Error('completed model calls must include non-empty output_refs');
  const sensitive = privacy === 'P0_PRIVATE_RAW' || privacy === 'P1_PRIVATE';
  const rawRetained = sensitive ? false : Boolean(input.retain_raw_prompt_text);
  const createdAt = input.created_at || new Date().toISOString();
  const promptHash = sha256(prompt);
  return {
    schema: 'gbrain.model_call_audit.v1',
    call_key: `mc_${sha256(JSON.stringify({ provider, model: input.model || '', privacy: input.privacy, namespace, inputRefs, outputRefs, promptHash, job_key: input.job_key || '' })).slice(0, 16)}`,
    provider,
    model: input.model?.trim() || '',
    privacy,
    namespace,
    prompt_hash: promptHash,
    prompt_redacted: sensitive,
    raw_prompt_retained: rawRetained,
    input_refs: inputRefs,
    output_refs: outputRefs,
    status,
    cost: input.cost || {},
    metadata: input.metadata || {},
    job_key: input.job_key,
    created_at: createdAt,
  };
}

export function requireEntrypointAudit(input: { entrypoint: KnownModelCallEntrypoint; audit: ModelCallAuditInput }): ModelCallAuditRecord {
  if (!input || typeof input !== 'object') throw new Error('audit contract is required');
  if (!(KNOWN_MODEL_CALL_ENTRYPOINTS as readonly string[]).includes(input.entrypoint)) throw new Error(`unknown model-call entrypoint: ${String(input.entrypoint)}`);
  if (!input.audit || typeof input.audit !== 'object') throw new Error(`audit metadata is required for ${input.entrypoint}`);
  const record = buildModelCallAuditRecord(input.audit);
  const validation = validateModelCallAuditRecord(record);
  if (validation.length) throw new Error(validation.join('; '));
  return record;
}

export function validateModelCallAuditRecord(record: unknown): string[] {
  const errors: string[] = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['record must be an object'];
  const r = record as Partial<ModelCallAuditRecord>;
  if (r.schema !== 'gbrain.model_call_audit.v1') errors.push('schema must be gbrain.model_call_audit.v1');
  if (typeof r.call_key !== 'string' || !/^mc_[a-f0-9]{16}$/.test(r.call_key)) errors.push('call_key must be stable mc_ hash');
  if (typeof r.provider !== 'string' || !r.provider.trim()) errors.push('provider is required');
  if (typeof r.provider === 'string' && !(KNOWN_MODEL_CALL_PROVIDERS as readonly string[]).includes(r.provider)) errors.push(`provider is unknown: ${r.provider}`);
  if (r.privacy !== 'P0_PRIVATE_RAW' && r.privacy !== 'P1_PRIVATE' && r.privacy !== 'P2_PRIVATE' && r.privacy !== 'P3_PUBLIC') errors.push('privacy must be one of P0_PRIVATE_RAW|P1_PRIVATE|P2_PRIVATE|P3_PUBLIC');
  if (typeof r.prompt_hash !== 'string' || !/^[a-f0-9]{64}$/.test(r.prompt_hash)) errors.push('prompt_hash must be sha256 hex');
  if (!Array.isArray(r.input_refs) || r.input_refs.length === 0) errors.push('input_refs must be non-empty');
  if (!Array.isArray(r.output_refs)) errors.push('output_refs must be an array');
  if (r.status === 'completed' && (!Array.isArray(r.output_refs) || r.output_refs.length === 0)) errors.push('completed model calls must include non-empty output_refs');
  if ((r.privacy === 'P0_PRIVATE_RAW' || r.privacy === 'P1_PRIVATE') && (r.prompt_redacted !== true || r.raw_prompt_retained !== false)) errors.push('P0/P1 prompt text must be redacted/not retained');
  if (typeof r.created_at !== 'string' || Number.isNaN(Date.parse(r.created_at))) errors.push('created_at must be ISO timestamp');
  return errors;
}
