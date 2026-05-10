import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseSpanId } from '../evidence/source-window.ts';
import { routeModel } from './model-router.ts';
import { verifyClaimSupport } from './claim-support-verifier.ts';
import { buildMemoryAtomProposal } from './memory-atom-proposal.ts';
import type { IntelligenceJob } from './job-queue.ts';
import type { PrivacyTier, WorkKind } from './privacy-policy.ts';
import { requireEntrypointAudit, type ModelCallAuditInput } from './model-call-audit.ts';

export type LocalRunnerStatus = 'succeeded' | 'failed' | 'needs_review' | 'unsupported';

export interface LocalRunnerOptions {
  queuePath?: string;
  inputRefBaseDir?: string;
  now?: Date;
  audit: ModelCallAuditInput;
}

export interface LocalRunnerEnvelope {
  schema: 'gbrain.ai.local-runner.v1';
  job_id: string;
  status: LocalRunnerStatus;
  route: ReturnType<typeof routeModel>;
  outputs: Record<string, unknown>;
  errors: string[];
  guardrails: string[];
}

export interface EvidenceExtractInput {
  source_item_id?: string;
  span_id?: string;
  quote?: string;
  direct_quote_claim?: string;
  input_ref?: string;
}

function safeKind(kind: unknown): WorkKind | string {
  return typeof kind === 'string' ? kind : 'unknown';
}

function safePrivacy(privacy: unknown): PrivacyTier {
  return privacy === 'P0' || privacy === 'P1' || privacy === 'P2' || privacy === 'P3' ? privacy : 'P1';
}

function stableId(input: unknown): string {
  return `local_${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12)}`;
}

function loadInputRef(inputRef?: string, baseDir?: string): Record<string, unknown> | undefined {
  if (!inputRef) return undefined;
  const candidates = [inputRef, baseDir ? `${baseDir}/${inputRef}` : undefined].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const raw = readFileSync(candidate, 'utf8');
    try { return JSON.parse(raw); } catch { return { raw }; }
  }
  return undefined;
}

function buildGuardrails(job: IntelligenceJob, route: ReturnType<typeof routeModel>): string[] {
  const guardrails = ['deterministic local-only runner', 'no provider/model/network calls', 'review-only outputs only'];
  if (job.privacy_tier === 'P0' || job.privacy_tier === 'P1') guardrails.push('P0/P1 privacy isolation enforced');
  if (route.preferred_provider !== 'qwen-local') guardrails.push('route inspected and non-local preference rejected for local runner');
  return guardrails;
}

function extractEvidencePayload(job: IntelligenceJob, opts: LocalRunnerOptions): EvidenceExtractInput & { raw_input?: Record<string, unknown> } {
  const loaded = loadInputRef(job.input_ref, opts.inputRefBaseDir);
  const raw = loaded && typeof loaded === 'object' ? loaded : undefined;
  return {
    source_item_id: typeof raw?.source_item_id === 'string' ? raw.source_item_id : undefined,
    span_id: typeof raw?.span_id === 'string' ? raw.span_id : undefined,
    quote: typeof raw?.quote === 'string' ? raw.quote : undefined,
    direct_quote_claim: typeof raw?.direct_quote_claim === 'string' ? raw.direct_quote_claim : undefined,
    input_ref: job.input_ref,
    raw_input: raw,
  };
}

function evidenceExtract(job: IntelligenceJob, route: ReturnType<typeof routeModel>, opts: LocalRunnerOptions): LocalRunnerEnvelope {
  const payload = extractEvidencePayload(job, opts);
  const errors: string[] = [];
  const outputs: Record<string, unknown> = { kind: 'evidence_extract', input_ref: job.input_ref, payload };
  const guardrails = buildGuardrails(job, route);
  if (job.privacy_tier === 'P0' || job.privacy_tier === 'P1') guardrails.push('no trusted write path available');

  if (!payload.span_id || !payload.quote || !payload.direct_quote_claim) {
    return { schema: 'gbrain.ai.local-runner.v1', job_id: job.id, status: 'needs_review', route, outputs: { ...outputs, reason: 'direct quote claim, quote, and span are required' }, errors: ['evidence_extract requires a direct quote claim with gbs1 span and quote'], guardrails };
  }
  if (!payload.span_id.startsWith('gbs1:')) {
    return { schema: 'gbrain.ai.local-runner.v1', job_id: job.id, status: 'unsupported', route, outputs: { ...outputs, reason: 'non-gbs1 span rejected' }, errors: ['synthetic/non-gbs1 evidence is rejected'], guardrails };
  }

  let parsed;
  try {
    parsed = parseSpanId(payload.span_id);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { schema: 'gbrain.ai.local-runner.v1', job_id: job.id, status: 'failed', route, outputs, errors, guardrails };
  }

  const support = verifyClaimSupport({
    claim: payload.direct_quote_claim,
    evidence_spans: [{ span_id: payload.span_id, quote: payload.quote, source_item_id: payload.source_item_id || `${parsed.sourceId}:${parsed.slug}` }],
  });

  outputs.claim_support = support;
  if (!support.ok || support.support_level !== 'direct_quote') {
    return { schema: 'gbrain.ai.local-runner.v1', job_id: job.id, status: 'needs_review', route, outputs: { ...outputs, reason: 'support verifier did not pass direct_quote' }, errors: support.reasons.length ? support.reasons : ['claim support verification failed'], guardrails };
  }

  try {
    const proposal = buildMemoryAtomProposal({
      source_item_id: payload.source_item_id || `${parsed.sourceId}:${parsed.slug}`,
      evidence_span_ids: [payload.span_id],
      atom_type: 'semantic_fact',
      subject_entities: [],
      claim: payload.direct_quote_claim,
      temporal: {},
      confidence: 1,
      support_level: 'direct_quote',
      sensitivity: 'P1',
      suggested_namespace: job.namespace,
      now: opts.now,
    });
    return { schema: 'gbrain.ai.local-runner.v1', job_id: job.id, status: 'succeeded', route, outputs: { ...outputs, memory_atom_proposal: proposal, review_only: true }, errors, guardrails };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { schema: 'gbrain.ai.local-runner.v1', job_id: job.id, status: 'failed', route, outputs, errors, guardrails };
  }
}

function claimVerify(job: IntelligenceJob, route: ReturnType<typeof routeModel>, opts: LocalRunnerOptions): LocalRunnerEnvelope {
  const payload = extractEvidencePayload(job, opts);
  const guardrails = buildGuardrails(job, route);
  if (!payload.span_id || !payload.quote || !payload.direct_quote_claim) {
    return { schema: 'gbrain.ai.local-runner.v1', job_id: job.id, status: 'needs_review', route, outputs: { kind: 'claim_verify', input_ref: job.input_ref }, errors: ['claim_verify requires span, quote, and claim'], guardrails };
  }
  if (!payload.span_id.startsWith('gbs1:')) {
    return { schema: 'gbrain.ai.local-runner.v1', job_id: job.id, status: 'unsupported', route, outputs: { kind: 'claim_verify', input_ref: job.input_ref }, errors: ['synthetic/non-gbs1 evidence is rejected'], guardrails };
  }
  const support = verifyClaimSupport({ claim: payload.direct_quote_claim, evidence_spans: [{ span_id: payload.span_id, quote: payload.quote, source_item_id: payload.source_item_id }], explanation: typeof payload.raw_input?.explanation === 'string' ? payload.raw_input.explanation : undefined });
  return { schema: 'gbrain.ai.local-runner.v1', job_id: job.id, status: support.ok ? 'succeeded' : 'needs_review', route, outputs: { kind: 'claim_verify', input_ref: job.input_ref, claim_support: support }, errors: support.ok ? [] : support.reasons, guardrails };
}

export function runLocalIntelligenceJob(job: IntelligenceJob, options: LocalRunnerOptions): LocalRunnerEnvelope {
  requireEntrypointAudit({ entrypoint: 'runLocalIntelligenceJob', audit: options.audit });
  const route = routeModel({ kind: safeKind(job.work_kind) as WorkKind, privacy: safePrivacy(job.privacy_tier), allowCloudEscalation: false });
  const guardrails = buildGuardrails(job, route);
  if (job.privacy_tier === 'P0' || job.privacy_tier === 'P1') guardrails.push('privacy tier does not allow cloud escalation');

  if (job.privacy_tier === 'P0' && route.preferred_provider !== 'qwen-local') {
    return { schema: 'gbrain.ai.local-runner.v1', job_id: job.id, status: 'failed', route, outputs: {}, errors: ['P0 local-only routing violated'], guardrails };
  }

  if (job.work_kind === 'evidence_extract') return evidenceExtract(job, route, options);
  if (job.work_kind === 'claim_support_check') return claimVerify(job, route, options);
  return { schema: 'gbrain.ai.local-runner.v1', job_id: job.id, status: 'unsupported', route, outputs: { kind: safeKind(job.work_kind), input_ref: job.input_ref }, errors: [`unsupported work kind: ${String(job.work_kind)}`], guardrails };
}
