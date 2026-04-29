import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function memoryRecord(overrides: Record<string, any> = {}): any {
  return {
    id: 'fact:typed-memory:native-query',
    memory_type: 'semantic_fact',
    title: 'Native typed-memory query integration',
    claim: 'GBrain query can include typed-memory context only when explicitly flagged.',
    source: { kind: 'test', path: 'typed-memory.jsonl', quote: 'explicit opt-in typed memory context' },
    sensitivity: 'medium',
    permission_scope: 'private',
    surfacing_policy: 'on_query',
    entities: ['GBrain', 'typed memory'],
    tags: ['typed-memory', 'native gbrain'],
    status: 'candidate',
    ...overrides,
  };
}

function fixturePath(records: any[] = [memoryRecord()]): string {
  const dir = mkdtempSync(join(tmpdir(), 'gbrain-query-typed-memory-'));
  const path = join(dir, 'typed-memory.jsonl');
  writeFileSync(path, records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');
  return path;
}

function engine(hit = true): any {
  return {
    searchKeyword: async (query: string) => hit ? [{
      slug: 'notes/native-query',
      title: 'Native query',
      type: 'note',
      chunk_text: `normal search hit for ${query}`,
      score: 1,
      source_id: 'test',
    }] : [],
    getBacklinkCounts: async () => new Map(),
  };
}

describe('query --with-typed-memory opt-in integration', () => {
  test('default query shape remains the existing result array', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_EMBEDDING_MODEL;
    const { operationsByName } = await import('../src/core/operations.ts');

    const out = await operationsByName.query.handler({ engine: engine(), dryRun: false } as any, {
      query: 'native gbrain typed-memory route',
      limit: 10,
      expand: false,
    });

    expect(Array.isArray(out)).toBe(true);
    expect((out as any[])[0].slug).toBe('notes/native-query');
  });

  test('flagged query includes read-only typed-memory context with provenance and guardrails', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_EMBEDDING_MODEL;
    process.env.GBRAIN_TYPED_MEMORY_FIXTURES = fixturePath();
    const { operationsByName } = await import('../src/core/operations.ts');

    const out = await operationsByName.query.handler({ engine: engine(), dryRun: false } as any, {
      query: 'native gbrain typed-memory route',
      limit: 10,
      expand: false,
      with_typed_memory: true,
    }) as any;

    expect(Array.isArray(out)).toBe(false);
    expect(out.results[0].slug).toBe('notes/native-query');
    expect(out.typed_memory.schema).toBe('gbrain.typed_memory.context_pack.v1');
    expect(out.typed_memory.status).toBe('hit');
    expect(out.typed_memory.items[0].id).toBe('fact:typed-memory:native-query');
    expect(out.typed_memory.items[0].provenance.quote).toBeTruthy();
    expect(out.typed_memory.items[0].provenance.source_label).toBe('typed-memory.jsonl');
    expect(out.typed_memory.guardrails.read_only).toBe(true);
    expect(out.integration.guardrails).toMatchObject({
      trusted_pages_edited: false,
      external_messages_sent: false,
      global_config_changed: false,
    });
  });

  test('flagged query response keeps a safe result contract without raw context or fixture paths', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_EMBEDDING_MODEL;
    process.env.GBRAIN_TYPED_MEMORY_FIXTURES = fixturePath([
      memoryRecord({ id: 'fact:typed-memory:safe', claim: 'Safe typed-memory context belongs in the bounded result pack.' }),
      memoryRecord({
        id: 'fact:typed-memory:hidden-high',
        claim: 'High sensitivity typed-memory context must not enter the default query context pack.',
        sensitivity: 'high',
        surfacing_policy: 'never',
      }),
    ]);
    const { operationsByName } = await import('../src/core/operations.ts');

    const out = await operationsByName.query.handler({ engine: engine(), dryRun: false } as any, {
      query: 'native gbrain typed-memory route',
      limit: 10,
      expand: false,
      with_typed_memory: true,
      typed_memory_limit: 1,
    }) as any;

    expect(Object.keys(out).sort()).toEqual(['integration', 'query', 'results', 'typed_memory']);
    expect(out.typed_memory.context).toBeUndefined();
    expect(out.typed_memory.fixture).toBeUndefined();
    expect(out.typed_memory.results).toBeUndefined();
    expect(out.typed_memory.items.map((r: any) => r.id)).toEqual(['fact:typed-memory:safe']);
    expect(out.typed_memory.items).toHaveLength(1);
    expect(out.typed_memory.items[0].provenance.source_label).not.toContain('/Users/');
  });

  test('high-sensitivity context requires explicit inclusion and carries review metadata', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_EMBEDDING_MODEL;
    process.env.GBRAIN_TYPED_MEMORY_FIXTURES = fixturePath([
      memoryRecord({
        id: 'fact:typed-memory:included-high',
        claim: 'High sensitivity typed-memory context is included only behind the explicit MCP/API flag.',
        sensitivity: 'high',
        surfacing_policy: 'never',
      }),
    ]);
    const { operationsByName } = await import('../src/core/operations.ts');

    const out = await operationsByName.query.handler({ engine: engine(), dryRun: false } as any, {
      query: 'native gbrain typed-memory route',
      limit: 10,
      expand: false,
      with_typed_memory: true,
      include_high_typed_memory: true,
    }) as any;

    expect(out.typed_memory.request.include_high_typed_memory).toBe(true);
    expect(out.typed_memory.items[0]).toMatchObject({
      id: 'fact:typed-memory:included-high',
      sensitivity: 'high',
      review_required: true,
    });
  });
});
