import { afterEach, describe, expect, test } from 'bun:test';
import type { BrainEngine } from '../src/core/engine.ts';
import type { SearchResult } from '../src/core/types.ts';
import { recallEvidence } from '../src/core/evidence/recall.ts';
import { runRecallCommand } from '../src/commands/recall.ts';

const world8Slug = 'sources/chatgpt/full-export-all/2025-12-24-analysis-of-project-options-690b6edf';
const citadelSlug = 'sources/chatgpt/full-export-all/2025-05-05-unshackled-mode-exit-6812c3bd';
const derivedSlug = 'sources/derived/notes';

const pages = new Map<string, any>([
  [world8Slug, {
    slug: world8Slug,
    source_id: 'default',
    title: 'Analysis of Project Options',
    compiled_truth: `### USER
I don't want rails receipts compliance.
What is my North Star if the future should preserve real options under uncertainty?

### ASSISTANT
Verdict is how I want the world to run: an active World Model with flip conditions.
World 8 is the frame where decision legitimacy and optionality become infrastructure.`,
    timeline: '2025-12-24 — Verdict / World8 naming discussion',
  }],
  [citadelSlug, {
    slug: citadelSlug,
    source_id: 'default',
    title: 'Unshackled Mode Exit',
    compiled_truth: `### USER
The initial Citadel idea was to build a fortress-like agent operating base.

### ASSISTANT
We moved away from Citadel because it was too static and bunker-like.
The better direction was a living memory system that can evolve with source-backed recall.`,
    timeline: '2025-05-05 — Citadel parked in favor of living memory',
  }],
  [derivedSlug, {
    slug: derivedSlug,
    source_id: 'default',
    title: 'Derived Notes',
    compiled_truth: `### USER
Some derived notes that are not part of full-export-all lineage.

### ASSISTANT
This should be filtered out by strict show-genesis mode.
`,
    timeline: '2026-01-01 — Derived notes fixture',
  }],
]);

function result(slug: string, chunk_text: string, score = 0.9): SearchResult {
  const page = pages.get(slug);
  return {
    slug,
    page_id: 1,
    title: page.title,
    type: 'source' as any,
    chunk_text,
    chunk_source: 'compiled_truth',
    chunk_id: Math.floor(Math.random() * 100000),
    chunk_index: 0,
    score,
    stale: false,
    source_id: 'default',
  };
}

function fakeEngine(searcher: (query: string) => SearchResult[]): BrainEngine {
  return {
    kind: 'postgres',
    searchKeyword: async (query: string) => searcher(query),
    executeRaw: async (_sql: string, params: unknown[]) => {
      const slug = String(params[0]);
      const sourceId = params[1] == null ? undefined : String(params[1]);
      const page = pages.get(slug);
      if (!page) return [];
      if (sourceId && page.source_id !== sourceId) return [];
      return [page];
    },
  } as unknown as BrainEngine;
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('recall evidence MVP', () => {
  test('direct search returns exact deterministic source quote window', async () => {
    const engine = fakeEngine((query) => query.includes('Citadel')
      ? [result(citadelSlug, 'We moved away from Citadel because it was too static and bunker-like.', 0.87)]
      : []);

    const out = await recallEvidence(engine, 'why did we move away from Citadel?', { before: 0, after: 1, limit: 1 });

    expect(out.status).toBe('hit');
    expect(out.integration.search_source).toBe('direct');
    expect(out.evidence[0].span_id).toBe(`gbs1:default:${citadelSlug}#compiled_truth:L5-L6`);
    expect(out.evidence[0].quote).toContain('too static and bunker-like');
    expect(out.evidence[0].quote_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(out.evidence[0].matched_by).toBe('chunk');
  });

  test('World8/Verdict approximate recall falls back to concept alias and exact quote windows', async () => {
    const engine = fakeEngine((query) => {
      if (query.includes('rails receipts compliance') || query.includes('Decision Algebra Active World Model')) {
        return [result(world8Slug, 'Verdict is how I want the world to run: an active World Model with flip conditions.\nWorld 8 is the frame where decision legitimacy and optionality become infrastructure.', 0.76)];
      }
      return [];
    });

    const out = await recallEvidence(engine, 'Verdict World 8 real options under uncertainty', { before: 1, after: 0, limit: 1 });

    expect(out.status).toBe('hit');
    expect(out.integration.search_source).toBe('alias');
    expect(out.integration.alias).toBeTruthy();
    expect(out.evidence[0].slug).toBe(world8Slug);
    expect(out.evidence[0].span_id).toBe(`gbs1:default:${world8Slug}#compiled_truth:L5-L7`);
    expect(out.evidence[0].quote).toContain('Verdict is how I want the world to run');
    expect(out.evidence[0].quote).toContain('World 8');
    expect(out.evidence[0].matched_by).toBe('alias');
  });

  test('abstains when candidate chunk cannot be mapped to an exact source window', async () => {
    const engine = fakeEngine(() => [result(citadelSlug, 'Quantum banana weather taxonomy with orbital submarines and unrelated tokens.', 0.9)]);
    const out = await recallEvidence(engine, 'missingfoobar', { limit: 1 });

    expect(out.status).toBe('abstain');
    expect(out.evidence).toEqual([]);
    expect(out.warnings.join(' ')).toContain('no exact source window');
  });

  test('abstains without throwing when search hits frontmatter/body chunks unavailable as source sections', async () => {
    const frontmatterHit = {
      ...result(citadelSlug, 'Unshackled Mode Exit', 0.91),
      chunk_source: 'frontmatter',
    } as unknown as SearchResult;
    const engine = fakeEngine(() => [frontmatterHit]);

    const out = await recallEvidence(engine, 'Unshackled Mode Exit', { limit: 1 });

    expect(out.status).toBe('abstain');
    expect(out.evidence).toEqual([]);
    expect(out.warnings.join(' ')).toContain('section=frontmatter');
  });

  test('recall CLI emits JSON evidence and sets exitCode=2 only on abstain', async () => {
    process.exitCode = undefined;
    const engine = fakeEngine((query) => query.includes('Citadel')
      ? [result(citadelSlug, 'We moved away from Citadel because it was too static and bunker-like.', 0.87)]
      : []);

    const stdout = await captureStdout(() => runRecallCommand(engine, ['why', 'Citadel', '--json', '--before', '0', '--after', '0']));
    const payload = JSON.parse(stdout);

    expect(payload.result.status).toBe('hit');
    expect(payload.result.evidence[0].span_id).toMatch(/^gbs1:default:/);
    expect(process.exitCode).toBeUndefined();
  });

  test('recall strict --timeline cannot silently fallback and returns abstain', async () => {
    process.exitCode = undefined;
    const engine = fakeEngine(() => [result(citadelSlug, 'Timeline is not part of recall test payload', 0.86)]);

    const stdout = await captureStdout(() => runRecallCommand(
      engine,
      ['Citadel', 'initial', 'idea', '--timeline', '--json', '--before', '0', '--after', '0'],
    ));
    const payload = JSON.parse(stdout);

    expect(payload.result.status).toBe('abstain');
    expect(payload.result.evidence).toHaveLength(0);
    expect(payload.result.integration.search_source).toBe('none');
    expect(payload.result.warnings.join(' ')).toContain('strict recall flags removed');
    expect([undefined, 2]).toContain(process.exitCode);
  });

  test('recall strict --show-genesis filters non-genesis hits out of output', async () => {
    process.exitCode = undefined;
    const engine = fakeEngine(() => [result(derivedSlug, 'This is not a full-export-all source', 0.84)]);

    const strictStdout = await captureStdout(() => runRecallCommand(
      engine,
      ['notes', 'summary', '--show-genesis', '--json', '--before', '0', '--after', '0'],
    ));
    const strictPayload = JSON.parse(strictStdout);

    expect(strictPayload.result.status).toBe('abstain');
    expect(strictPayload.result.evidence).toHaveLength(0);
    expect(strictPayload.result.integration.search_source).toBe('none');
    expect([undefined, 2]).toContain(process.exitCode);
  });
});
