import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildScoutQueryPlan,
  buildScoutSignalFromSource,
  BUILTIN_SCOUT_RECIPES,
  listTopicTracks,
  validateScoutRecipe,
} from '../src/core/scout/pipeline.ts';
import { runScoutCommand } from '../src/commands/scout.ts';

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
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

describe('scout pipeline', () => {
  test('built-in recipes exist', () => {
    expect(BUILTIN_SCOUT_RECIPES.map(r => r.id)).toEqual([
      'sovereign-ai-india',
      'agent-memory-systems',
      'ai-agent-infra',
    ]);
    for (const recipe of BUILTIN_SCOUT_RECIPES) {
      expect(validateScoutRecipe(recipe)).toEqual([]);
      expect(recipe.objective.length).toBeGreaterThan(20);
      expect(recipe.seed_queries.length).toBeGreaterThan(0);
      expect(recipe.watch_entities.length).toBeGreaterThan(0);
      expect(recipe.budgets.max_external_fetches).toBe(0);
      expect(recipe.outputs.review_only).toBe(true);
    }
  });

  test('topic tracks mirror recipes', () => {
    const tracks = listTopicTracks();
    expect(tracks.map(t => t.slug)).toEqual(BUILTIN_SCOUT_RECIPES.map(r => r.slug));
    expect(tracks.every(t => t.schema === 'gbrain.topic_track.v1' && t.privacy === 'public')).toBe(true);
  });

  test('dry-run plan emits bounded query plan without fetching', () => {
    const plan = buildScoutQueryPlan(BUILTIN_SCOUT_RECIPES[0]!);
    expect(plan.schema).toBe('gbrain.scout.query_plan.v1');
    expect(plan.mode).toBe('dry-run');
    expect(plan.fetching_allowed).toBe(false);
    expect(plan.query_count).toBeLessThanOrEqual(BUILTIN_SCOUT_RECIPES[0]!.budgets.max_queries_per_run);
    expect(plan.queries.length).toBeGreaterThan(0);
    expect(plan.queries[0]!.query).toContain('India');
  });

  test('invalid recipes fail with actionable diagnostics', () => {
    const invalid = { schema: 'gbrain.scout.recipe.v1', slug: 'Bad Slug' };
    const errors = validateScoutRecipe(invalid);
    expect(errors.join('\n')).toContain('slug must be kebab-case');
    expect(errors.join('\n')).toContain('objective must be a substantive string');
    expect(errors.join('\n')).toContain('budgets must be an object');
    expect(errors.join('\n')).toContain('topic_track must be an object');
  });

  test('scoring is stable', () => {
    const recipe = BUILTIN_SCOUT_RECIPES[2]!;
    const input = { recipe, source: { source_url: 'https://example.com/a', claim: 'agent infra update', excerpt: 'A deterministic agent infra system with memory and evals.', entities: ['memory', 'evals'] } };
    const a = buildScoutSignalFromSource(input);
    const b = buildScoutSignalFromSource(input);
    expect(a).toEqual(b);
  });

  test('missing source rejected', () => {
    const recipe = BUILTIN_SCOUT_RECIPES[0]!;
    expect(() => buildScoutSignalFromSource({ recipe, source: { claim: 'x', excerpt: 'y' } })).toThrow(/source_url or source_title/);
  });

  test('suggested actions constrained and review-only', () => {
    const recipe = BUILTIN_SCOUT_RECIPES[1]!;
    const signal = buildScoutSignalFromSource({ recipe, source: { source_title: 'Agent memory memo', claim: 'urgent memory launch', excerpt: 'Agent memory systems with source-grounded recall and eval loops.', entities: ['memory', 'evals'] } });
    expect(signal.suggested_actions.length).toBeLessThanOrEqual(4);
    expect(signal.suggested_actions.every(a => !a.includes('publish') && !a.includes('send') && !a.includes('edit trusted'))).toBe(true);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe('scout CLI recipes', () => {
  test('lists and gets recipes as json', async () => {
    const list = JSON.parse(await captureStdout(() => runScoutCommand(null, ['recipes', 'list', '--json'])));
    expect(list.ok).toBe(true);
    expect(list.recipes.map((r: any) => r.slug)).toContain('agent-memory-systems');

    const get = JSON.parse(await captureStdout(() => runScoutCommand(null, ['recipes', 'get', 'sovereign-ai-india', '--json'])));
    expect(get.recipe.objective).toContain('India');
  });

  test('validates recipe file and plans slug as json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-scout-'));
    const file = join(dir, 'recipe.json');
    writeFileSync(file, JSON.stringify(BUILTIN_SCOUT_RECIPES[0]), 'utf8');

    const validation = JSON.parse(await captureStdout(() => runScoutCommand(null, ['recipes', 'validate', '--file', file, '--json'])));
    expect(validation).toEqual({ ok: true, errors: [] });

    const planned = JSON.parse(await captureStdout(() => runScoutCommand(null, ['plan', 'sovereign-ai-india', '--json'])));
    expect(planned.ok).toBe(true);
    expect(planned.plan.fetching_allowed).toBe(false);
    expect(planned.plan.queries.length).toBeGreaterThan(0);
  });

  test('lists topic tracks as json', async () => {
    const out = JSON.parse(await captureStdout(() => runScoutCommand(null, ['topics', 'list', '--json'])));
    expect(out.tracks.map((t: any) => t.slug)).toEqual(['sovereign-ai-india', 'agent-memory-systems', 'ai-agent-infra']);
  });
});
