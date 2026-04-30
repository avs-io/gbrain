import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorldCommand } from '../src/commands/world.ts';
import { BUILTIN_SCOUT_RECIPES } from '../src/core/scout/pipeline.ts';
import { runPublicScout } from '../src/core/scout/runner.ts';
import { extractWorldCandidatesFromScout } from '../src/core/world/extractor.ts';
import { compileTopicState } from '../src/core/world/topic-state.ts';
import { analyzeIntelligenceSubstrateStores, backfillTimelineEntriesFromExtractions, TIMELINE_ENTRY_SCHEMA } from '../src/core/intelligence/data-hygiene.ts';
import { buildClaimLedgerRecord, evidenceRefFromSpan } from '../src/core/claims/claim-ledger.ts';

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

function fixtureExtraction() {
  const recipe = BUILTIN_SCOUT_RECIPES[0]!;
  const scout = runPublicScout({
    recipe,
    now: new Date('2026-04-30T04:00:00.000Z'),
    sources: [
      {
        source_url: 'https://example.com/indiaai-compute',
        source_title: 'IndiaAI compute announcement',
        published_at: '2026-04-29T00:00:00.000Z',
        claim: 'IndiaAI Mission announced a sovereign AI compute procurement update.',
        excerpt: 'On 2026-04-29 IndiaAI Mission announced a sovereign AI compute procurement update with new GPU capacity for startups.',
        content: 'Briefing. On 2026-04-29 IndiaAI Mission announced a sovereign AI compute procurement update with new GPU capacity for startups. End.',
        entities: ['IndiaAI Mission'],
      },
      {
        source_url: 'https://example.com/indiaai-policy',
        source_title: 'IndiaAI policy launch',
        published_at: '2026-04-30T00:00:00.000Z',
        claim: 'IndiaAI Mission launched a startup compute policy update.',
        excerpt: 'On 2026-04-30 IndiaAI Mission launched a startup compute policy update for sovereign AI builders.',
        content: 'On 2026-04-30 IndiaAI Mission launched a startup compute policy update for sovereign AI builders.',
        entities: ['IndiaAI Mission'],
      },
    ],
  });
  return extractWorldCandidatesFromScout(scout, { topic: 'sovereign-ai-india', now: new Date('2026-04-30T05:00:00.000Z') });
}

describe('PR27 intelligence substrate hygiene and timeline hardening', () => {
  test('timeline backfill materially increases fixture-backed local timeline entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-pr27-timeline-'));
    const timelinePath = join(dir, 'timeline-entries.jsonl');
    const extraction = fixtureExtraction();

    const result = backfillTimelineEntriesFromExtractions([extraction], { path: timelinePath });
    expect(result.before).toBe(0);
    expect(result.added).toBeGreaterThanOrEqual(2);
    expect(result.after).toBe(result.added);
    expect(existsSync(timelinePath)).toBe(true);
    const entries = readFileSync(timelinePath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(entries.every(e => e.schema === TIMELINE_ENTRY_SCHEMA)).toBe(true);
    expect(entries.every(e => e.mode === 'review-only' && e.trusted_world_truth === false)).toBe(true);
    expect(entries.every(e => e.source_refs.length > 0 && e.source_refs[0].source_span_id.startsWith('srcspan1:'))).toBe(true);
  });

  test('world timeline CLI backfills from extraction report JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-pr27-cli-'));
    const extractionPath = join(dir, 'world-extraction.json');
    const timelinePath = join(dir, 'timeline-entries.jsonl');
    writeFileSync(extractionPath, JSON.stringify({ extraction: fixtureExtraction() }), 'utf8');

    const stdout = await captureStdout(() => runWorldCommand(null, ['timeline', 'backfill', '--from-extraction', extractionPath, '--out', timelinePath, '--json']));
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.before).toBe(0);
    expect(parsed.added).toBeGreaterThanOrEqual(2);
    expect(parsed.after).toBe(parsed.added);
  });

  test('doctor hygiene analyzer reports PR27 coverage checks and flags weak baselines deterministically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-pr27-doctor-'));
    const extraction = fixtureExtraction();
    const surface = compileTopicState({ topic: 'sovereign-ai-india', extractions: [extraction], now: new Date('2026-04-30T06:00:00.000Z'), since: '2026-04-29T00:00:00.000Z' });
    const synthesisPath = join(dir, 'synthesis-surfaces.jsonl');
    const claimsPath = join(dir, 'claim-ledger.jsonl');
    const timelinePath = join(dir, 'timeline-entries.jsonl');
    writeFileSync(synthesisPath, JSON.stringify(surface) + '\n');
    const badClaim = { ...buildClaimLedgerRecord({ claim: 'Unsupported world claim', namespace: 'world', privacy: 'public', evidence: [evidenceRefFromSpan(extraction.claims[0]!.source_refs[0]!.source_span_id, extraction.claims[0]!.source_refs[0]!.quote)] }), evidence: [] };
    writeFileSync(claimsPath, JSON.stringify(badClaim) + '\n');

    const results = analyzeIntelligenceSubstrateStores({ paths: { timeline: timelinePath, synthesis: synthesisPath, claims: claimsPath, surfacing: join(dir, 'surfacing.jsonl'), actions: join(dir, 'actions.jsonl') }, now: new Date('2026-04-30T06:00:00.000Z'), timelineMinimumEntries: 2 });
    const byName = Object.fromEntries(results.map(r => [r.name, r]));
    expect(Object.keys(byName).sort()).toEqual(['claim_evidence_coverage', 'privacy_route_violations', 'source_span_resolution_coverage', 'stale_topic_surfaces', 'timeline_coverage'].sort());
    expect(byName.timeline_coverage.status).toBe('warn');
    expect(byName.claim_evidence_coverage.status).toBe('warn');
    expect(byName.privacy_route_violations.status).toBe('ok');

    backfillTimelineEntriesFromExtractions([extraction], { path: timelinePath });
    const fixed = analyzeIntelligenceSubstrateStores({ paths: { timeline: timelinePath, synthesis: synthesisPath, claims: claimsPath, surfacing: join(dir, 'surfacing.jsonl'), actions: join(dir, 'actions.jsonl') }, now: new Date('2026-04-30T06:00:00.000Z'), timelineMinimumEntries: 2 });
    expect(fixed.find(r => r.name === 'timeline_coverage')!.status).toBe('ok');
  });

  test('release gate script includes typecheck, build, workflow evals, and doctor', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts['release:gate']).toBe('scripts/release-gate.sh');
    const script = readFileSync(join(process.cwd(), 'scripts/release-gate.sh'), 'utf8');
    expect(script).toContain('bun run typecheck');
    expect(script).toContain('bun run build');
    for (const evalScript of ['eval-recall.ts', 'eval-topic-tracks.ts', 'eval-context-packs.ts', 'eval-radar.ts', 'eval-privacy.ts']) {
      expect(script).toContain(evalScript);
    }
    expect(script).toContain('doctor --fast --json');
  });
});
