import { describe, expect, test } from 'bun:test';
import { routeModel } from '../../src/core/ai/model-router.ts';

describe('model router', () => {
  test('P0 stays local-only', () => {
    const route = routeModel({ kind: 'source_normalize', privacy: 'P0' });
    expect(route.preferred_provider).toBe('qwen-local');
    expect(route.fallback_providers).toEqual([]);
    expect(route.allow_external_network).toBe(false);
  });

  test('P1 cloud requires escalation', () => {
    expect(routeModel({ kind: 'world_scout', privacy: 'P1' }).preferred_provider).toBe('qwen-local');
    const escalated = routeModel({ kind: 'world_scout', privacy: 'P1', allowCloudEscalation: true });
    expect(escalated.preferred_provider).toBe('minimax-m27');
    expect(escalated.allow_raw_private_context).toBe(false);
  });

  test('public scout routes to minimax', () => {
    expect(routeModel({ kind: 'world_scout', privacy: 'P3' }).preferred_provider).toBe('minimax-m27');
  });

  test('coding routes to codex', () => {
    expect(routeModel({ kind: 'code_pr_draft', privacy: 'P2' }).preferred_provider).toBe('codex');
    expect(routeModel({ kind: 'code_pr_review', privacy: 'P2' }).preferred_provider).toBe('codex');
  });

  test('architecture review routes to gpt or claude tier', () => {
    expect(['gpt-pro', 'claude-pro']).toContain(routeModel({ kind: 'architecture_review', privacy: 'P2' }).preferred_provider);
  });

  test('route shape is stable json-friendly', () => {
    const route = routeModel({ kind: 'bookmark_enrich', privacy: 'P2' });
    expect(route).toHaveProperty('preferred_provider');
    expect(route).toHaveProperty('fallback_providers');
    expect(route).toHaveProperty('require_json_schema');
  });
});
