/**
 * Embedding Service
 * Ported from production Ruby implementation (embedding_service.rb, 190 LOC)
 *
 * Backend selection (env-based):
 *   OLLAMA_EMBEDDING_MODEL=nomic-embed-text  → Ollama (local, zero cost)
 *   OPENAI_API_KEY set, no OLLAMA_EMBEDDING_MODEL → OpenAI text-embedding-3-large
 *   Neither set → keyword-only search (graceful degradation)
 *
 * Ollama: nomic-embed-text at 768 dimensions, F16
 * OpenAI: text-embedding-3-large at 1536 dimensions
 *
 * Retry with exponential backoff (4s base, 120s cap, 5 retries).
 * 8000 character input truncation.
 */

import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { requireEntrypointAudit } from './ai/model-call-audit.ts';
export { embedMultimodal } from "./ai/gateway.ts";
export type { MultimodalInput } from "./ai/types.ts";

// --- Configuration ---

const OLLAMA_URL = process.env.OLLAMA_HOST || 'http://localhost:11434';

const USE_OLLAMA = !!process.env.OLLAMA_EMBEDDING_MODEL;
const USE_OPENAI = !USE_OLLAMA && !!process.env.OPENAI_API_KEY;

const OLLAMA_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
const OPENAI_MODEL = 'text-embedding-3-large';

const OLLAMA_DIMENSIONS = 768;
const OPENAI_DIMENSIONS = 1536;

const MAX_CHARS = 8000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 4000;
const MAX_DELAY_MS = 120000;
const BATCH_SIZE = 100; // Ollama embed API handles batches natively

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function auditEmbeddingBatch(entrypoint: 'embedOpenAI' | 'embedOllama', provider: 'openai-embedding' | 'ollama-embedding', model: string, texts: string[]): void {
  requireEntrypointAudit({
    entrypoint,
    audit: {
      provider,
      model,
      prompt: texts.join('\n---gbrain-embedding-input---\n'),
      privacy: 'P1_PRIVATE',
      namespace: 'embedding',
      input_refs: texts.map((text, index) => `embedding-input:${index}:sha256:${sha256(text)}`),
      status: 'recorded',
    },
  });
}

// --- Ollama Embedding Client ---

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
}

async function ollamaEmbed(text: string): Promise<Float32Array> {
  const truncated = text.slice(0, MAX_CHARS);
  auditEmbeddingBatch('embedOllama', 'ollama-embedding', OLLAMA_MODEL, [truncated]);
  const body = JSON.stringify({
    model: OLLAMA_MODEL,
    prompt: truncated,
    options: {
      num_batch: 1,
    },
  });

  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama embed failed (${res.status}): ${text}`);
  }

  const data: OllamaEmbedResponse = await res.json();
  if (!data.embeddings || data.embeddings.length === 0) {
    throw new Error('Ollama returned empty embeddings');
  }

  return new Float32Array(data.embeddings[0]);
}

async function ollamaEmbedBatch(texts: string[]): Promise<Float32Array[]> {
  const truncated = texts.map(t => t.slice(0, MAX_CHARS));
  auditEmbeddingBatch('embedOllama', 'ollama-embedding', OLLAMA_MODEL, truncated);
  const body = JSON.stringify({
    model: OLLAMA_MODEL,
    input: truncated,
    options: {
      num_batch: Math.min(truncated.length, 32), // Ollama default batch size
    },
  });

  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama embed failed (${res.status}): ${text}`);
  }

  const data: OllamaEmbedResponse = await res.json();
  if (!data.embeddings || data.embeddings.length === 0) {
    throw new Error('Ollama returned empty embeddings');
  }

  return data.embeddings.map(e => new Float32Array(e));
}

// --- OpenAI Embedding Client ---

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

async function openaiEmbed(text: string): Promise<Float32Array> {
  const truncated = text.slice(0, MAX_CHARS);
  const result = await openaiEmbedBatch([truncated]);
  return result[0];
}

async function openaiEmbedBatch(texts: string[]): Promise<Float32Array[]> {
  const truncated = texts.map(t => t.slice(0, MAX_CHARS));
  auditEmbeddingBatch('embedOpenAI', 'openai-embedding', OPENAI_MODEL, truncated);
  const response = await getOpenAIClient().embeddings.create({
    model: OPENAI_MODEL,
    input: truncated,
    dimensions: OPENAI_DIMENSIONS,
  });

  const sorted = response.data.sort((a, b) => a.index - b.index);
  return sorted.map(d => new Float32Array(d.embedding));
}

// --- Unified API ---

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function exponentialDelay(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_DELAY_MS);
}

export async function embed(text: string): Promise<Float32Array> {
  const truncated = text.slice(0, MAX_CHARS);
  const result = await embedBatch([truncated]);
  return result[0];
}

export interface EmbedBatchOptions {
  /**
   * Optional callback fired after each 100-item sub-batch completes.
   * CLI wrappers tick a reporter; Minion handlers can call
   * job.updateProgress here instead of hooking the per-page callback.
   */
  onBatchComplete?: (done: number, total: number) => void;
}

export async function embedBatch(
  texts: string[],
  options: EmbedBatchOptions = {},
): Promise<Float32Array[]> {
  const truncated = texts.map(t => t.slice(0, MAX_CHARS));
  const results: Float32Array[] = [];

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < truncated.length; i += BATCH_SIZE) {
    const batch = truncated.slice(i, i + BATCH_SIZE);
    const batchResults = await embedBatchWithRetry(batch);
    results.push(...batchResults);
    options.onBatchComplete?.(results.length, truncated.length);
  }

  return results;
}

async function embedBatchWithRetry(texts: string[]): Promise<Float32Array[]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (USE_OLLAMA) {
        return await ollamaEmbedBatch(texts);
      } else if (USE_OPENAI) {
        auditEmbeddingBatch('embedOpenAI', 'openai-embedding', OPENAI_MODEL, texts);
        const response = await getOpenAIClient().embeddings.create({
          model: OPENAI_MODEL,
          input: texts,
          dimensions: OPENAI_DIMENSIONS,
        });
        const sorted = response.data.sort((a, b) => a.index - b.index);
        return sorted.map(d => new Float32Array(d.embedding));
      } else {
        throw new Error('No embedding backend configured. Set OLLAMA_EMBEDDING_MODEL or OPENAI_API_KEY.');
      }
    } catch (e: unknown) {
      if (attempt === MAX_RETRIES - 1) throw e;

      let delay = exponentialDelay(attempt);

      // Check for rate limit with Retry-After header (OpenAI)
      if (USE_OPENAI && e instanceof OpenAI.APIError && e.status === 429) {
        const retryAfter = e.headers?.['retry-after'];
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed)) {
            delay = parsed * 1000;
          }
        }
      }

      await sleep(delay);
    }
  }

  throw new Error('Embedding failed after all retries');
}

// --- Diagnostics ---

export function getEmbeddingConfig(): {
  backend: 'ollama' | 'openai' | 'none';
  model: string;
  dimensions: number;
} {
  if (USE_OLLAMA) {
    return { backend: 'ollama', model: OLLAMA_MODEL, dimensions: OLLAMA_DIMENSIONS };
  } else if (USE_OPENAI) {
    return { backend: 'openai', model: OPENAI_MODEL, dimensions: OPENAI_DIMENSIONS };
  }
  return { backend: 'none', model: '', dimensions: 0 };
}

// --- Exports ---

export const EMBEDDING_MODEL = USE_OLLAMA ? OLLAMA_MODEL : OPENAI_MODEL;
export const EMBEDDING_DIMENSIONS = USE_OLLAMA ? OLLAMA_DIMENSIONS : OPENAI_DIMENSIONS;

/**
 * v0.20.0 Cathedral II Layer 8 (D1): USD cost per 1k tokens for
 * text-embedding-3-large. Used by `gbrain sync --all` cost preview and
 * the reindex-code backfill command to surface expected spend before
 * the agent/user accepts an expensive operation.
 *
 * Value: $0.00013 / 1k tokens as of 2026. Update when OpenAI changes
 * pricing. Single source of truth — every cost-preview surface reads
 * this constant, so a pricing change is a one-line edit.
 */
export const EMBEDDING_COST_PER_1K_TOKENS = 0.00013;

/** Compute USD cost estimate for embedding `tokens` at current model rate. */
export function estimateEmbeddingCostUsd(tokens: number): number {
  return (tokens / 1000) * EMBEDDING_COST_PER_1K_TOKENS;
}
