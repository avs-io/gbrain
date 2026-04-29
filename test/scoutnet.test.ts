import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadScoutInputs,
  runScoutDryRun,
  validateScoutObservation,
  validateScoutRecipe,
  type ScoutObservation,
  type ScoutRecipe,
} from '../src/core/memory/scoutnet.ts';

const recipe: ScoutRecipe = {
  schema: 'gbrain.scout.recipe.v1',
  id: 'sovereign-ai-india',
  title: 'India Sovereign AI ScoutNet',
  topic: 'India sovereign AI signals',
  default_policy: { namespace: 'scouts', privacy: 'internal', sensitivity: 'medium' },
  cadence: { freshness_window_days: 7, dry_run_only_until_review: true },
  sources: [
    { id: 'local-authority-map', name: 'Local authority map', kind: 'local_report', check_mode: 'local_sample', priority: 'high' },
    { id: 'gem-procurement', name: 'GeM', kind: 'procurement_portal', check_mode: 'future_live_fetch', priority: 'high' },
  ],
  queries: ['IndiaAI procurement leadership', 'GeM AI tender'],
  blind_spots: ['logged-in procurement details not checked in dry-run'],
  failure_policy: { live_web_crawl_allowed: false, trusted_world_model_updates_allowed: false, external_actions_allowed: false },
};

const observation: ScoutObservation = {
  schema: 'gbrain.scout.observation.v1',
  id: 'scout_obs_test_001',
  recipe_id: 'sovereign-ai-india',
  observed_at: '2026-04-29T07:05:00.000Z',
  namespace: 'scouts',
  privacy: 'internal',
  sensitivity: 'medium',
  status: 'proposed',
  source: {
    source_id: 'local-authority-map',
    name: 'Local authority map',
    kind: 'local_report',
    title: 'README',
    retrieved_at: '2026-04-29T07:05:00.000Z',
    citation: 'ops/reports/sovereign-ai-authority/README.md lists unresolved authority-map questions.',
  },
  coverage: {
    query: 'IndiaAI leadership unresolved questions',
    checked_at: '2026-04-29T07:05:00.000Z',
    freshness_window_days: 7,
    method: 'local_sample',
  },
  signal: {
    summary: 'Local authority map has unresolved questions that should be refreshed before trusted updates.',
    quote: 'Known open questions include IndiaAI CEO successor and DG NIC discrepancy.',
    novelty: 0.4,
    relevance: 0.9,
    confidence: 0.8,
  },
  recommended_next_action: { type: 'research', rationale: 'Refresh later via reviewed source checks.' },
  guardrails: {
    observation_is_proposal: true,
    trusted_world_model_updated: false,
    trusted_pages_edited: false,
    external_messages_sent: false,
    live_web_crawl_performed: false,
  },
};

describe('ScoutNet MVP', () => {
  test('validates conservative sovereign-ai recipe and observation', () => {
    expect(validateScoutRecipe(recipe)).toEqual([]);
    expect(validateScoutObservation(observation, recipe)).toEqual([]);
  });

  test('rejects trusted world-model updates and live-fetch dry-run observations', () => {
    const bad = structuredClone(observation) as any;
    bad.status = 'trusted';
    bad.coverage.method = 'future_live_fetch';
    bad.guardrails.trusted_world_model_updated = true;
    const errors = validateScoutObservation(bad, recipe);
    expect(errors.join('\n')).toContain('status must be proposed');
    expect(errors.join('\n')).toContain('future_live_fetch is not allowed');
    expect(errors.join('\n')).toContain('trusted_world_model_updated must be false');
  });

  test('dry-run produces proposals and coverage without checking missing sources', () => {
    const result = runScoutDryRun({ recipe, observations: [observation], now: new Date('2026-04-29T07:10:00.000Z') });
    expect(result.ok).toBe(true);
    expect(result.proposals).toHaveLength(1);
    expect(result.coverage_report.schema).toBe('gbrain.scout.coverage_report.v1');
    expect(result.coverage_report.dry_run).toBe(true);
    expect(result.coverage_report.sources_checked.map(s => s.id)).toEqual(['local-authority-map']);
    expect(result.coverage_report.sources_not_checked.map(s => s.id)).toEqual(['gem-procurement']);
    expect(result.coverage_report.guardrails.live_web_crawl_performed).toBe(false);
  });

  test('loads local recipe and observation files for CLI substrate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-scoutnet-'));
    try {
      const recipePath = join(dir, 'recipe.json');
      const obsPath = join(dir, 'observations.json');
      writeFileSync(recipePath, JSON.stringify(recipe), 'utf-8');
      writeFileSync(obsPath, JSON.stringify({ observations: [observation] }), 'utf-8');
      const loaded = loadScoutInputs(recipePath, obsPath);
      expect((loaded.recipe as any).id).toBe('sovereign-ai-india');
      expect(loaded.observations).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
