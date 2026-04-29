import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { operationsByName } from '../src/core/operations.ts';
import { __resetConceptAliasCacheForTests, resolveConceptAliasQueries } from '../src/core/search/concept-alias.ts';

function withIndex(lines: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'gbrain-concept-alias-'));
  const dir = join(root, 'projects/gbrain-living-memory/implementation');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'concept-index.jsonl'), lines.join('\n'));
  process.env.GBRAIN_LIVING_MEMORY_ROOT = root;
  delete process.env.GBRAIN_LIVING_MEMORY_CONCEPT_INDEX;
  __resetConceptAliasCacheForTests();
  return root;
}

function result(slug: string, text = 'compiled truth') {
  return {
    slug,
    title: slug,
    type: 'concept',
    chunk_text: text,
    score: 1,
    source_id: 'test',
    compiled_truth: text,
  };
}

afterEach(() => {
  const root = process.env.GBRAIN_LIVING_MEMORY_ROOT;
  delete process.env.GBRAIN_LIVING_MEMORY_ROOT;
  delete process.env.GBRAIN_LIVING_MEMORY_CONCEPT_INDEX;
  delete process.env.GBRAIN_TYPED_MEMORY_FIXTURES;
  __resetConceptAliasCacheForTests();
  if (root?.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
});

describe('living-memory concept alias fallback', () => {
  it('resolves conversational Citadel query to explicit concept aliases without absolute workspace paths', () => {
    withIndex([
      JSON.stringify({ slug: '_concepts/citadel', title: 'Citadel', aliases: ['citadel design audit', 'Inner Citadel'] }),
    ]);

    expect(resolveConceptAliasQueries('Isn’t that what we did with the initial Citadel idea?')).toContain('Citadel');
  });

  it('search operation retries concept aliases only after direct keyword retrieval is empty', async () => {
    withIndex([
      JSON.stringify({ slug: '_concepts/citadel', title: 'Citadel', aliases: ['citadel design audit'] }),
    ]);
    const calls: string[] = [];
    const engine = {
      searchKeyword: async (q: string) => {
        calls.push(q);
        return q === 'Citadel' ? [result('_concepts/citadel', 'Citadel timeline')] : [];
      },
    };

    const out = await operationsByName.search.handler({ engine, dryRun: false } as any, {
      query: 'what was the initial citadel idea and why did we move away?',
      limit: 10,
    });

    expect((out as any[])[0].slug).toBe('_concepts/citadel');
    expect(calls[0]).toBe('what was the initial citadel idea and why did we move away?');
    expect(calls).toContain('Citadel');
  });

  it('query operation retries concept aliases and records alias source for opt-in typed-memory packs', async () => {
    withIndex([
      JSON.stringify({ slug: '_concepts/citadel', title: 'Citadel', aliases: ['citadel design audit'] }),
    ]);
    process.env.GBRAIN_TYPED_MEMORY_FIXTURES = join(process.env.GBRAIN_LIVING_MEMORY_ROOT!, 'projects/gbrain-living-memory/implementation/typed-memory-fixtures.jsonl');
    writeFileSync(process.env.GBRAIN_TYPED_MEMORY_FIXTURES, JSON.stringify({
      id: 'fact:citadel:lineage',
      memory_type: 'semantic_fact',
      title: 'Citadel lineage',
      claim: 'Citadel is a historical root-stock for sovereign cognition work.',
      source: { kind: 'test', path: 'typed-memory.jsonl', quote: 'Citadel root-stock evidence' },
      sensitivity: 'medium',
      surfacing_policy: 'on_query',
      entities: ['Citadel', 'sovereign cognition'],
      tags: ['citadel'],
      status: 'candidate',
    }) + '\n', 'utf-8');

    const calls: string[] = [];
    const engine = {
      searchKeyword: async (q: string) => {
        calls.push(q);
        return q === 'Citadel' ? [result('_concepts/citadel', 'Citadel timeline')] : [];
      },
      getBacklinkCounts: async () => new Map(),
    };

    const out = await operationsByName.query.handler({ engine, dryRun: false } as any, {
      query: 'what was the initial citadel idea and why did we move away?',
      limit: 10,
      expand: false,
      with_typed_memory: true,
    }) as any;

    expect(out.results[0].slug).toBe('_concepts/citadel');
    expect(out.integration.search_source).toBe('alias');
    expect(out.integration.alias).toBe('Citadel');
    expect(out.typed_memory.items.map((item: any) => item.id)).toContain('fact:citadel:lineage');
    expect(calls[0]).toBe('what was the initial citadel idea and why did we move away?');
    expect(calls).toContain('Citadel');
  });

  it('recalls Verdict worldview / North-Star correction from approximate World 8 wording', async () => {
    withIndex([]);
    const targetSlug = 'sources/chatgpt/full-export-all/2025-12-24-analysis-of-project-options-690b6edf';
    const genericSlug = 'sources/chatgpt/full-export-all/generic-final-verdict';
    const calls: string[] = [];
    const engine = {
      searchKeyword: async (q: string) => {
        calls.push(q);
        if (q === "I don't want rails receipts compliance North Star") {
          return [result(
            targetSlug,
            "USER: I don't want rails. I don't want receipts. I don't want compliance. What is my North Star if you remove all this? ASSISTANT: Verdict: build the system that turns reality and values into the best possible decision.",
          )];
        }
        if (q === 'Final Verdict') return [result(genericSlug, 'Final Verdict: unrelated generic mention')];
        return [];
      },
      getBacklinkCounts: async () => new Map(),
    };

    const out = await operationsByName.query.handler({ engine, dryRun: false } as any, {
      query: 'World 8 North Star real options uncertainty Verdict',
      limit: 5,
      expand: false,
      with_typed_memory: true,
    }) as any;

    expect(out.results[0].slug).toBe(targetSlug);
    expect(out.results[0].slug).not.toBe(genericSlug);
    expect(out.integration.search_source).toBe('alias');
    expect(out.integration.alias).toBe("I don't want rails receipts compliance North Star");
    expect(calls).toContain("I don't want rails receipts compliance North Star");
    expect(calls).not.toContain('Final Verdict');
  });

  it('does not call aliases when direct keyword retrieval already has results', async () => {
    withIndex([
      JSON.stringify({ slug: '_concepts/citadel', title: 'Citadel', aliases: ['citadel design audit'] }),
    ]);
    const calls: string[] = [];
    const engine = {
      searchKeyword: async (q: string) => {
        calls.push(q);
        return [result('direct/hit', 'direct hit')];
      },
    };

    const out = await operationsByName.search.handler({ engine, dryRun: false } as any, {
      query: 'citadel',
      limit: 10,
    });

    expect((out as any[])[0].slug).toBe('direct/hit');
    expect(calls).toEqual(['citadel']);
  });

  it('ignores malformed JSONL and unknown concepts without changing baseline retrieval', async () => {
    withIndex([
      '{not json',
      JSON.stringify({ slug: '_concepts/citadel', title: 'Citadel', aliases: ['citadel design audit'] }),
    ]);
    const calls: string[] = [];
    const engine = {
      searchKeyword: async (q: string) => {
        calls.push(q);
        return [];
      },
    };

    const out = await operationsByName.search.handler({ engine, dryRun: false } as any, {
      query: 'unmapped question about some unknown thing',
      limit: 10,
    });

    expect(out).toEqual([]);
    expect(calls).toEqual(['unmapped question about some unknown thing']);
  });
});
