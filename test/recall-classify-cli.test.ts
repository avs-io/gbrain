/**
 * PR9 — CLI --classify flag integration test
 *
 * Verifies that `gbrain recall --classify` runs the classifier,
 * passes the classification to recallEvidence(), and includes
 * classification info in both JSON and human output.
 */

import { describe, expect, it, afterEach } from 'bun:test';
import { runRecallCommand } from '../src/commands/recall.ts';
import type { BrainEngine } from '../src/core/engine.ts';

// ── Helpers ──────────────────────────────────────────────────────

function fakeEngine(
  hitOn: (query: string) => Array<{ slug: string; section: string; start_line: number; end_line: number; quote: string; score: number }>,
): BrainEngine {
  return {
    searchKeyword: async (q: string) => hitOn(q).map((h) => ({
      slug: h.slug, section: h.section, start_line: h.start_line,
      end_line: h.end_line, quote: h.quote, score: h.score,
    })),
    executeRaw: async () => [],
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

// ── Tests ────────────────────────────────────────────────────────

describe('PR9 — CLI --classify flag', () => {
  it('classifies a Citadel query and includes classification in JSON output', async () => {
    const engine = fakeEngine(() => []);
    const stdout = await captureStdout(() => runRecallCommand(engine, ['Citadel initial idea', '--json', '--classify']));
    const payload = JSON.parse(stdout);

    expect(payload.classification).toBeDefined();
    expect(payload.classification.intent).toBe('historical_arc');
    expect(payload.classification.matched_route_ids).toContain('citadel-lineage');
    expect(payload.classification.entities).toContain('citadel');
    expect(payload.result.status).toBe('abstain');
  });

  it('classifies a Sovereign AI query and routes to correct route', async () => {
    const engine = fakeEngine(() => []);
    const stdout = await captureStdout(() => runRecallCommand(engine, ['Sovereign AI current status', '--json', '--classify']));
    const payload = JSON.parse(stdout);

    expect(payload.classification).toBeDefined();
    expect(payload.classification.matched_route_ids).toContain('sovereign-ai-strategy-pivot');
  });

  it('classifies a government outreach query and routes correctly', async () => {
    const engine = fakeEngine(() => []);
    const stdout = await captureStdout(() => runRecallCommand(engine, ['Government outreach Archana', '--json', '--classify']));
    const payload = JSON.parse(stdout);

    expect(payload.classification).toBeDefined();
    expect(payload.classification.matched_route_ids).toContain('government-outreach');
  });

  it('classifies a local model query and routes correctly', async () => {
    const engine = fakeEngine(() => []);
    const stdout = await captureStdout(() => runRecallCommand(engine, ['Local model setup', '--json', '--classify']));
    const payload = JSON.parse(stdout);

    expect(payload.classification).toBeDefined();
    expect(payload.classification.matched_route_ids).toContain('local-model-worker-lane');
  });

  it('classifies a general query with no specific route', async () => {
    const engine = fakeEngine(() => []);
    const stdout = await captureStdout(() => runRecallCommand(engine, ['What is the weather today', '--json', '--classify']));
    const payload = JSON.parse(stdout);

    expect(payload.classification).toBeDefined();
    expect(payload.classification.intent).toBe('general_recall');
  });

  it('works without --classify (backward compat) — no classification key in output', async () => {
    const engine = fakeEngine(() => []);
    const stdout = await captureStdout(() => runRecallCommand(engine, ['test query', '--json']));
    const payload = JSON.parse(stdout);

    // Without --classify, the JSON output should not have a classification key
    expect(payload.classification).toBeUndefined();
    // The result should still work (abstain is valid when no DB pages)
    expect(payload.result.status).toBe('abstain');
  });

  it('human output includes classification when --classify is used', async () => {
    const engine = fakeEngine(() => []);
    const stdout = await captureStdout(() => runRecallCommand(engine, ['Citadel initial idea', '--classify']));

    expect(stdout).toContain('classification:');
    expect(stdout).toContain('historical_arc');
    expect(stdout).toContain('citadel-lineage');
  });

  it('human output includes classification routes when --classify is used', async () => {
    const engine = fakeEngine(() => []);
    const stdout = await captureStdout(() => runRecallCommand(engine, ['Sovereign AI Eonic strategy', '--classify']));

    expect(stdout).toContain('classification:');
    expect(stdout).toContain('sovereign-ai-strategy-pivot');
  });
});
