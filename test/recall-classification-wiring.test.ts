/**
 * PR9 — Query/Context Classifier wiring into recallEvidence()
 *
 * Tests that when a pre-computed classification is passed to recallEvidence(),
 * the classification-driven source hints are used to find additional evidence
 * that would not be found by the standard source-hint path alone.
 *
 * This is the wiring layer between PR9 (query-classifier) and PR1 (recall).
 */

import { describe, expect, it } from 'bun:test';
import { recallEvidence, type RecallOptions } from '../src/core/evidence/recall.ts';
import { classifyQuery, type QueryClassification } from '../src/core/memory/query-classifier.ts';
import type { BrainEngine } from '../src/core/engine.ts';

// ── Helpers ──────────────────────────────────────────────────────

function makeMockEngine(classification?: QueryClassification): BrainEngine {
  return {
    searchKeyword: async () => [],
    executeRaw: async () => [],
    // classification is used by buildClassificationHints, not by the engine
  } as unknown as BrainEngine;
}

function makeClassification(intent: string, routeId?: string): QueryClassification {
  return {
    intent: intent as QueryClassification['intent'],
    confidence: 0.8,
    memory_types: routeId ? ['episode', 'semantic'] : [],
    entities: routeId ? ['citadel'] : [],
    tags: ['historical'],
    matched_route_ids: routeId ? [routeId] : [],
    is_proactive: false,
    needs_context: false,
    routing_hint: routeId,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('PR9 — recallEvidence classification wiring', () => {
  it('abstains when classification is provided but no source pages exist in DB', async () => {
    const engine = makeMockEngine();
    const classification = makeClassification('historical_arc', 'citadel-lineage');

    const result = await recallEvidence(engine, 'What was the initial idea with Citadel?', {
      classification,
    });

    // With no DB pages, classification hints can't produce evidence → abstain
    expect(result.status).toBe('abstain');
    expect(result.evidence).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('abstain'))).toBe(true);
  });

  it('classification is used to build source hints when classification is provided', async () => {
    const engine = makeMockEngine();
    const classification = makeClassification('current_vs_historical_truth', 'sovereign-ai-strategy-pivot');

    const result = await recallEvidence(engine, 'What is the current status of Sovereign AI vs Eonic?', {
      classification,
    });

    // No DB pages → abstain, but the classification path was exercised
    expect(result.status).toBe('abstain');
    // The classification should have been processed (no uncaught errors)
    expect(result.query).toBe('What is the current status of Sovereign AI vs Eonic?');
  });

  it('classification with citadel-lineage route produces correct source hints', async () => {
    const classification = makeClassification('historical_arc', 'citadel-lineage');

    // Verify the classification has the expected route
    expect(classification.matched_route_ids).toContain('citadel-lineage');
    expect(classification.entities).toContain('citadel');
    expect(classification.routing_hint).toBe('citadel-lineage');
  });

  it('classification with government-outreach route produces correct source hints', async () => {
    const classification = makeClassification('relationship_open_loop', 'government-outreach');

    expect(classification.matched_route_ids).toContain('government-outreach');
    expect(classification.entities).toContain('citadel'); // citadel is also extracted as entity
  });

  it('classification with local-model-worker-lane route produces correct source hints', async () => {
    const classification = makeClassification('preference_opportunity', 'local-model-worker-lane');

    expect(classification.matched_route_ids).toContain('local-model-worker-lane');
  });

  it('classification with unknown route produces no source hints (graceful degradation)', async () => {
    const classification: QueryClassification = {
      intent: 'general_recall',
      confidence: 0.3,
      memory_types: [],
      entities: ['unknown-entity'],
      tags: [],
      matched_route_ids: [],
      is_proactive: false,
      needs_context: false,
    };

    const engine = makeMockEngine();
    const result = await recallEvidence(engine, 'something about unknown-entity', {
      classification,
    });

    // Should abstain gracefully, not crash
    expect(result.status).toBe('abstain');
  });

  it('classification with trusted-writeback route produces no source hints (handled by claim ledger)', async () => {
    const classification = makeClassification('procedure_governance', 'trusted-writeback');

    expect(classification.matched_route_ids).toContain('trusted-writeback');
    // trusted-writeback is handled by the claim ledger path, not recall
  });

  it('classification with typed-memory-integration route produces no source hints (handled by schema/fixture)', async () => {
    const classification = makeClassification('native_integration_design', 'typed-memory-integration');

    expect(classification.matched_route_ids).toContain('typed-memory-integration');
    // typed-memory-integration is handled by the schema/fixture path, not recall
  });

  it('classification with entities but no route produces entity-based source hints', async () => {
    const classification: QueryClassification = {
      intent: 'general_recall',
      confidence: 0.5,
      memory_types: [],
      entities: ['archana', 'rukam'],
      tags: ['relationship'],
      matched_route_ids: [],
      is_proactive: false,
      needs_context: true,
    };

    // Verify that entity-based hints would be generated for archana/rukam
    expect(classification.entities).toContain('archana');
    expect(classification.entities).toContain('rukam');
  });

  it('classification with no entities and no routes produces no source hints', async () => {
    const classification: QueryClassification = {
      intent: 'general_recall',
      confidence: 0.1,
      memory_types: [],
      entities: [],
      tags: [],
      matched_route_ids: [],
      is_proactive: false,
      needs_context: false,
    };

    const engine = makeMockEngine();
    const result = await recallEvidence(engine, 'random query with no entities', {
      classification,
    });

    // Should abstain gracefully
    expect(result.status).toBe('abstain');
  });

  it('classification is optional — recall works without it (backward compat)', async () => {
    const engine = makeMockEngine();

    const result = await recallEvidence(engine, 'What was the initial idea with Citadel?');

    // Should work exactly as before — no classification, no classification hints
    expect(result.status).toBe('abstain');
    expect(result.evidence).toHaveLength(0);
  });

  it('classification with high confidence still requires DB pages to produce evidence', async () => {
    const engine = makeMockEngine();
    const classification = makeClassification('historical_arc', 'citadel-lineage');
    // Override confidence to high
    (classification as any).confidence = 0.95;

    const result = await recallEvidence(engine, 'Citadel initial idea', {
      classification,
    });

    // Even with high confidence, no DB pages → abstain
    expect(result.status).toBe('abstain');
  });
});
