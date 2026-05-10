import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { candidateFromScoutSignal, evaluateScoutRadarCandidates, opportunityReportJson } from '../src/core/radar/opportunity.ts';
import { buildScoutSignalFromSource, scoutRecipeById } from '../src/core/scout/pipeline.ts';
import { runRadarCommand } from '../src/commands/radar.ts';

function signal(overrides: Partial<ReturnType<typeof buildScoutSignalFromSource>> = {}) {
  const recipe = scoutRecipeById('sovereign-ai-india')!;
  return {
    ...buildScoutSignalFromSource({
      recipe,
      source: {
        source_url: 'https://example.com/signal',
        source_title: 'India sovereign AI compute window',
        claim: 'India opened a sovereign AI compute procurement window now.',
        excerpt: 'A public procurement signal creates urgency for sovereign AI infrastructure vendors.',
        entities: ['IndiaAI', 'MeitY'],
      },
    }),
    ...overrides,
  };
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

describe('opportunity radar', () => {
  test('formula is stable and review-only', () => {
    const candidate = candidateFromScoutSignal(signal(), { active_bets: ['sovereign AI'], memory_refs: ['memory:sovereign-ai'] });
    const report = opportunityReportJson(candidate);

    expect(candidate.schema).toBe('gbrain.radar.opportunity.v1');
    expect(candidate.opportunity_score).toBeGreaterThan(0);
    expect(candidate.score_breakdown).toHaveProperty('distraction_penalty');
    expect(candidate.matched_memory_refs).toContain('memory:sovereign-ai');
    expect(report.trusted_world_truth).toBe(false);
  });

  test('distraction penalty lowers weak signals', () => {
    const strong = candidateFromScoutSignal(signal({ confidence: 0.9, novelty_score: 0.8, relevance_score: 0.8 }), { active_bets: ['sovereign AI'] });
    const weak = candidateFromScoutSignal(signal({ confidence: 0.2, novelty_score: 0.1, relevance_score: 0.1 }), { active_bets: ['unrelated bet'] });

    expect(weak.score_breakdown.distraction_penalty).toBeGreaterThan(strong.score_breakdown.distraction_penalty);
    expect(strong.opportunity_score).toBeGreaterThan(weak.opportunity_score);
  });

  test('scout/radar evaluation measures useful rate, false urgency, duplicates, stale sources, citations, and conversion', () => {
    const candidates = [
      candidateFromScoutSignal(signal({ id: 'sig-useful', urgency_score: 0.8, published_at: '2026-05-08' }), { active_bets: ['sovereign AI'] }),
      candidateFromScoutSignal(signal({ id: 'sig-converted', urgency_score: 0.4, published_at: '2026-05-07' }), { active_bets: ['sovereign AI'] }),
    ];
    const report = evaluateScoutRadarCandidates(candidates, [
      { scout_signal_id: 'sig-useful', useful: true, false_urgency: false, stale_source: false, action_converted: false },
      { scout_signal_id: 'sig-converted', useful: true, false_urgency: false, stale_source: false, action_converted: true },
    ]);

    expect(report.schema).toBe('gbrain.radar.scout_evaluation.v1');
    expect(report.useful_surfacing_rate).toBe(1);
    expect(report.false_urgency_rate).toBe(0);
    expect(report.duplicate_rate).toBe(0);
    expect(report.stale_source_rate).toBe(0);
    expect(report.public_citation_coverage).toBe(1);
    expect(report.action_conversion_rate).toBe(0.5);
    expect(report.passed).toBe(true);

    const bad = evaluateScoutRadarCandidates(candidates, [
      { scout_signal_id: 'sig-useful', useful: false, false_urgency: true, duplicate_of: 'older', stale_source: true, public_citation_present: false, action_converted: false },
      { scout_signal_id: 'sig-converted', useful: true, false_urgency: false, stale_source: false, action_converted: false },
    ]);
    expect(bad.passed).toBe(false);
    expect(bad.false_urgency_rate).toBeGreaterThan(0);
    expect(bad.duplicate_rate).toBeGreaterThan(0);
  });

  test('CLI creates dry-run JSON and writes only with --yes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-radar-'));
    const signalPath = join(dir, 'signal.json');
    const outPath = join(dir, 'radar.jsonl');
    writeFileSync(signalPath, JSON.stringify({ signal: signal() }), 'utf8');

    const dry = JSON.parse(await capture(() => runRadarCommand(null, ['opportunity', '--signal-json', signalPath, '--active-bet', 'sovereign AI', '--memory-ref', 'memory:sovereign-ai', '--out', outPath, '--json'])));
    expect(dry.ok).toBe(true);
    expect(dry.written).toBe(false);
    expect(existsSync(outPath)).toBe(false);

    const written = JSON.parse(await capture(() => runRadarCommand(null, ['opportunity', '--signal-json', signalPath, '--active-bet=sovereign AI', '--memory-ref=memory:sovereign-ai', '--out', outPath, '--yes', '--json'])));
    expect(written.written).toBe(true);
    expect(readFileSync(outPath, 'utf8')).toContain('gbrain.radar.opportunity.report.v1');
  });
});
