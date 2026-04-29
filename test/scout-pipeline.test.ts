import { describe, expect, test } from 'bun:test';
import { buildScoutSignalFromSource, BUILTIN_SCOUT_RECIPES } from '../src/core/scout/pipeline.ts';

describe('scout pipeline', () => {
  test('built-in recipes exist', () => {
    expect(BUILTIN_SCOUT_RECIPES.map(r => r.id)).toEqual([
      'sovereign-ai-india',
      'ai-agent-infra',
      'health-os-personalization',
    ]);
  });

  test('scoring is stable', () => {
    const recipe = BUILTIN_SCOUT_RECIPES[1];
    const input = { recipe, source: { source_url: 'https://example.com/a', claim: 'agent infra update', excerpt: 'A deterministic agent infra system with memory and evals.', entities: ['memory', 'evals'] } };
    const a = buildScoutSignalFromSource(input);
    const b = buildScoutSignalFromSource(input);
    expect(a).toEqual(b);
  });

  test('missing source rejected', () => {
    const recipe = BUILTIN_SCOUT_RECIPES[0];
    expect(() => buildScoutSignalFromSource({ recipe, source: { claim: 'x', excerpt: 'y' } })).toThrow(/source_url or source_title/);
  });

  test('suggested actions constrained and review-only', () => {
    const recipe = BUILTIN_SCOUT_RECIPES[2];
    const signal = buildScoutSignalFromSource({ recipe, source: { source_title: 'Health OS memo', claim: 'urgent personalization launch', excerpt: 'Personalized health OS with sensors and clinical loops.', entities: ['health', 'sensors'] } });
    expect(signal.suggested_actions.length).toBeLessThanOrEqual(4);
    expect(signal.suggested_actions.every(a => !a.includes('publish') && !a.includes('send') && !a.includes('edit trusted'))).toBe(true);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
  });
});
