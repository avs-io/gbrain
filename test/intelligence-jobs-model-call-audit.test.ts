import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MIGRATIONS } from '../src/core/migrate.ts';
import { buildModelCallAuditRecord, validateModelCallAuditRecord, requireEntrypointAudit, KNOWN_MODEL_CALL_ENTRYPOINTS } from '../src/core/ai/model-call-audit.ts';
import { prepareProviderRun } from '../src/core/ai/provider-runner.ts';
import { runLocalIntelligenceJob } from '../src/core/ai/local-runner.ts';

const repoRoot = join(import.meta.dir, '..');

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...listTsFiles(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('intelligence jobs and model-call audit substrate', () => {
  test('v31 migration defines durable intelligence_jobs and model_calls indexes', () => {
    const migration = MIGRATIONS.find(m => m.version === 31);
    expect(migration?.name).toBe('intelligence_jobs_and_model_calls');
    const sql = migration?.sql || '';
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS intelligence_jobs');
    expect(sql).toContain('work_kind');
    expect(sql).toContain('privacy');
    expect(sql).toContain('namespace');
    expect(sql).toContain('input_refs');
    expect(sql).toContain('provider');
    expect(sql).toContain('status');
    expect(sql).toContain('priority');
    expect(sql).toContain('retry_count');
    expect(sql).toContain('idx_intelligence_jobs_status_priority');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS model_calls');
    expect(sql).toContain('prompt_hash');
    expect(sql).toContain('idx_model_calls_privacy_namespace');
  });

  test('model-call audit records hash prompts and redact private raw prompt text', () => {
    const record = buildModelCallAuditRecord({
      provider: 'qwen-local',
      model: 'qwen3-local',
      prompt: 'private raw memory text',
      privacy: 'P1_PRIVATE',
      namespace: 'personal.memory',
      input_refs: ['gbs1:default:sources/test/private#compiled_truth:L1-L2'],
      output_refs: ['artifact:proposal.json'],
      job_key: 'job_private_atom_proposal',
      created_at: '2026-05-08T09:40:00.000Z',
    });

    expect(record.prompt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain('private raw memory text');
    expect(record.prompt_redacted).toBe(true);
    expect(record.raw_prompt_retained).toBe(false);
    expect(validateModelCallAuditRecord(record)).toEqual([]);
  });

  test('P3/public records provider/model/prompt_hash/refs and raw retention follows policy flag', () => {
    const kept = buildModelCallAuditRecord({
      provider: 'minimax-m27',
      model: 'm27',
      prompt: 'public content prompt',
      privacy: 'P3_PUBLIC',
      namespace: 'world',
      input_refs: ['src:world:1'],
      output_refs: ['out:world:1'],
      status: 'completed',
      retain_raw_prompt_text: true,
    });
    expect(kept.provider).toBe('minimax-m27');
    expect(kept.model).toBe('m27');
    expect(kept.prompt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(kept.input_refs).toEqual(['src:world:1']);
    expect(kept.output_refs).toEqual(['out:world:1']);
    expect(kept.raw_prompt_retained).toBe(true);
    expect(validateModelCallAuditRecord(kept)).toEqual([]);
  });

  test('P0/P1 never retain raw prompt text', () => {
    const p0 = buildModelCallAuditRecord({
      provider: 'qwen-local',
      model: 'qwen3-local',
      prompt: 'sensitive p0 text',
      privacy: 'P0_PRIVATE_RAW',
      namespace: 'personal',
      input_refs: ['src:p0:1'],
      retain_raw_prompt_text: true,
    });
    const p1 = buildModelCallAuditRecord({
      provider: 'qwen-local',
      model: 'qwen3-local',
      prompt: 'sensitive p1 text',
      privacy: 'P1_PRIVATE',
      namespace: 'personal',
      input_refs: ['src:p1:1'],
      retain_raw_prompt_text: true,
    });
    expect(p0.raw_prompt_retained).toBe(false);
    expect(p1.raw_prompt_retained).toBe(false);
    expect(validateModelCallAuditRecord(p0)).toEqual([]);
    expect(validateModelCallAuditRecord(p1)).toEqual([]);
  });

  test('completed model calls require output_refs', () => {
    expect(() => buildModelCallAuditRecord({
      provider: 'qwen-local',
      prompt: 'done',
      privacy: 'P2_PRIVATE',
      namespace: 'personal',
      input_refs: ['src:x:1'],
      status: 'completed',
    })).toThrow(/output_refs/);
  });

  test('known model-call entrypoints fail closed without valid audit metadata', () => {
    expect(() => requireEntrypointAudit({
      entrypoint: 'prepareProviderRun',
      audit: {
        provider: 'unknown-provider',
        prompt: 'x',
        privacy: 'P2_PRIVATE',
        namespace: 'personal',
        input_refs: ['ref:1'],
      },
    })).toThrow(/unknown provider/);

    expect(() => prepareProviderRun({
      kind: 'world_scout',
      privacy: 'P3',
      prompt: 'public text',
      allowCloudEscalation: true,
    } as any)).toThrow(/audit metadata is required/);

    expect(() => runLocalIntelligenceJob({
      id: 'job_missing_audit',
      work_kind: 'claim_support_check',
      privacy_tier: 'P1',
      namespace: 'personal',
      input_ref: 'ref:claim',
      status: 'queued',
      priority: 1,
      created_at: '2026-05-08T00:00:00.000Z',
      retry_count: 0,
      idempotency_key: 'k',
    } as any, {} as any)).toThrow(/audit metadata is required/);
  });

  test('source guard enumerates known provider/model callsites and requires audit contracts', () => {
    const expectedEntrypoints = [
      'prepareProviderRun',
      'runLocalIntelligenceJob',
      'expandQueryHaiku',
      'embedOpenAI',
      'embedOllama',
      'subagentAnthropicTurn',
    ] as const;
    expect([...KNOWN_MODEL_CALL_ENTRYPOINTS].sort()).toEqual([...expectedEntrypoints].sort());

    const modelCallPatterns = [
      /new Anthropic\(/,
      /messages\.create\(/,
      /client\.create\(params/,
      /new OpenAI\(/,
      /embeddings\.create\(/,
      /api\/embed/,
      /export function prepareProviderRun\(/,
      /export function runLocalIntelligenceJob\(/,
    ];
    const files = listTsFiles(join(repoRoot, 'src'))
      .map(path => ({ path, rel: relative(repoRoot, path), text: readFileSync(path, 'utf8') }))
      .filter(file => modelCallPatterns.some(pattern => pattern.test(file.text)))
      .map(file => file.rel)
      .sort();

    expect(files).toEqual([
      'src/core/ai/local-runner.ts',
      'src/core/ai/provider-runner.ts',
      'src/core/embedding.ts',
      'src/core/minions/handlers/subagent.ts',
      'src/core/search/expansion.ts',
    ]);

    const contracts: Record<string, string[]> = {
      'src/core/ai/local-runner.ts': [`entrypoint: 'runLocalIntelligenceJob'`, 'audit: options.audit'],
      'src/core/ai/provider-runner.ts': [`entrypoint: 'prepareProviderRun'`, 'audit: input.audit'],
      'src/core/embedding.ts': [`entrypoint,`, `auditEmbeddingBatch('embedOpenAI'`, `auditEmbeddingBatch('embedOllama'`],
      'src/core/minions/handlers/subagent.ts': [`entrypoint: 'subagentAnthropicTurn'`, `status: 'completed'`, 'output_refs:'],
      'src/core/search/expansion.ts': [`entrypoint: 'expandQueryHaiku'`, `namespace: 'search.expansion'`],
    };

    for (const [rel, tokens] of Object.entries(contracts)) {
      const text = readFileSync(join(repoRoot, rel), 'utf8');
      expect(text).toContain('requireEntrypointAudit');
      for (const token of tokens) expect(text).toContain(token);
    }
  });

  test('validation fails closed on unknown provider, empty refs, and missing privacy', () => {
    expect(() => buildModelCallAuditRecord({
      provider: 'unknown-provider',
      prompt: 'x',
      privacy: 'P2_PRIVATE',
      namespace: 'personal',
      input_refs: ['ref:1'],
    })).toThrow(/unknown provider/);

    expect(() => buildModelCallAuditRecord({
      provider: 'qwen-local',
      prompt: 'x',
      privacy: 'P2_PRIVATE',
      namespace: 'personal',
      input_refs: [],
    })).toThrow(/input_refs/);

    expect(() => buildModelCallAuditRecord({
      provider: 'qwen-local',
      prompt: 'x',
      privacy: '' as any,
      namespace: 'personal',
      input_refs: ['ref:1'],
    })).toThrow(/privacy/);
  });
});
