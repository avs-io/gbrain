import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorldCommand } from '../src/commands/world.ts';
import { buildClaimLedgerRecord, evidenceRefFromSpan } from '../src/core/claims/claim-ledger.ts';
import { BUILTIN_SCOUT_RECIPES } from '../src/core/scout/pipeline.ts';
import { runPublicScout } from '../src/core/scout/runner.ts';
import { extractWorldCandidatesFromScout } from '../src/core/world/extractor.ts';
import { compileTopicState, validateTopicStateSurface } from '../src/core/world/topic-state.ts';

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

describe('world topic state compiler', () => {
  test('compiles cited candidate and verified world inputs into a topic_state surface', () => {
    const recipe = BUILTIN_SCOUT_RECIPES[0]!;
    const scout = runPublicScout({
      recipe,
      now: new Date('2026-04-30T03:00:00.000Z'),
      sources: [
        {
          source_url: 'https://example.com/indiaai-compute-1',
          source_title: 'IndiaAI compute announcement',
          published_at: '2026-04-29T00:00:00.000Z',
          claim: 'IndiaAI Mission announced a sovereign AI compute procurement update.',
          excerpt: 'On 2026-04-29 IndiaAI Mission announced a sovereign AI compute procurement update with new GPU capacity for startups.',
          content: 'On 2026-04-29 IndiaAI Mission announced a sovereign AI compute procurement update with new GPU capacity for startups.',
          entities: ['IndiaAI Mission'],
        },
        {
          source_url: 'https://example.com/indiaai-compute-2',
          source_title: 'IndiaAI compute repeated',
          published_at: '2026-04-30T00:00:00.000Z',
          claim: 'IndiaAI Mission announced a sovereign AI compute procurement update.',
          excerpt: 'On 2026-04-30 IndiaAI Mission announced a sovereign AI compute procurement update with new GPU capacity for startups.',
          content: 'On 2026-04-30 IndiaAI Mission announced a sovereign AI compute procurement update with new GPU capacity for startups.',
          entities: ['IndiaAI Mission'],
        },
        {
          source_url: 'https://example.com/sarvam-launch',
          source_title: 'Sarvam launch',
          published_at: '2026-04-30T01:00:00.000Z',
          claim: 'Sarvam AI launched a sovereign AI model for Indian languages.',
          excerpt: 'Sarvam AI launched a sovereign AI model for Indian languages and announced enterprise access.',
          content: 'Sarvam AI launched a sovereign AI model for Indian languages and announced enterprise access.',
          entities: ['Sarvam AI'],
        },
        {
          source_url: 'https://example.com/unsupported',
          source_title: 'Rumor roundup',
          published_at: '2026-04-30T02:00:00.000Z',
          claim: 'MeitY confirmed a secret sovereign AI procurement winner.',
          excerpt: 'A false rumor claimed MeitY confirmed a secret winner, but the report says it was not confirmed and denied by officials.',
          content: 'A false rumor claimed MeitY confirmed a secret winner, but the report says it was not confirmed and denied by officials.',
          entities: ['MeitY'],
        },
      ],
    });
    const extraction = extractWorldCandidatesFromScout(scout, { topic: 'sovereign-ai-india', now: new Date('2026-04-30T04:00:00.000Z') });
    const verified = buildClaimLedgerRecord({
      claim: 'IndiaAI Mission maintains a public sovereign AI compute program for India.',
      type: 'world_claim',
      status: 'verified',
      namespace: 'world',
      privacy: 'public',
      sensitivity: 'low',
      confidence: 0.8,
      observedAt: '2026-04-20T00:00:00.000Z',
      evidence: [evidenceRefFromSpan(scout.source_spans[0]!.ref, scout.source_spans[0]!.quote!, scout.source_spans[0]!.quote_hash || undefined)],
      now: new Date('2026-04-30T04:00:00.000Z'),
    });

    const surface = compileTopicState({ topic: 'sovereign-ai-india', extractions: [extraction], claims: [verified], since: '2026-04-29T00:00:00.000Z', staleAfterDays: 7, now: new Date('2026-04-30T05:00:00.000Z'), activeProjects: ['GBrain'] });

    expect(validateTopicStateSurface(surface)).toEqual([]);
    expect(surface.surface_type).toBe('topic_state');
    expect(surface.trusted_world_truth).toBe(false);
    expect(surface.inputs.verified_claims).toBe(1);
    expect(surface.current_state.every(c => c.source_refs.length > 0)).toBe(true);
    expect(surface.entity_map.map(e => e.entity)).toContain('IndiaAI Mission');
    expect(surface.watchlist.find(w => w.entity === 'IndiaAI Mission')!.status).toBe('active');
    expect(surface.recent_deltas.new.length).toBeGreaterThan(0);
    expect(surface.recent_deltas.changed.length).toBeGreaterThan(0);
    expect(surface.recent_deltas.repeated.length).toBeGreaterThan(0);
    expect(surface.unresolved_questions.some(q => q.includes('unsupported'))).toBe(true);
    expect(surface.relevance_to_active_projects[0]!.project).toBe('GBrain');
  });

  test('flags stale claims and rejects uncited major claims', () => {
    const recipe = BUILTIN_SCOUT_RECIPES[2]!;
    const scout = runPublicScout({
      recipe,
      sources: [{ source_url: 'https://example.com/old', claim: 'LangGraph announced an agent workflow update.', excerpt: 'LangGraph announced an agent workflow update for production agents.', entities: ['LangGraph'] }],
    });
    const extraction = extractWorldCandidatesFromScout(scout, { topic: 'ai-agent-infra', now: new Date('2026-01-01T00:00:00.000Z') });
    extraction.claims.push({ ...extraction.claims[0]!, id: 'uncited', text: 'Uncited major factual claim.', source_refs: [] });

    const surface = compileTopicState({ topic: 'ai-agent-infra', extractions: [extraction], staleAfterDays: 10, now: new Date('2026-04-30T00:00:00.000Z') });
    expect(surface.diagnostics.stale_claims).toBeGreaterThan(0);
    expect(surface.diagnostics.uncited_rejected).toBeGreaterThan(0);
    expect(surface.current_state.some(c => c.id === 'uncited')).toBe(false);
    expect(surface.current_state.some(c => c.stale)).toBe(true);
  });

  test('CLI world topic state emits JSON and can avoid default surface store', async () => {
    const recipe = BUILTIN_SCOUT_RECIPES[0]!;
    const scout = runPublicScout({
      recipe,
      sources: [{ source_url: 'https://example.com/indiaai', claim: 'IndiaAI Mission announced a sovereign AI compute update.', excerpt: 'IndiaAI Mission announced a sovereign AI compute update for startups.', entities: ['IndiaAI Mission'] }],
    });
    const extraction = extractWorldCandidatesFromScout(scout, { topic: 'sovereign-ai-india' });
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-world-topic-state-'));
    const extractionPath = join(dir, 'world-extraction.json');
    writeFileSync(extractionPath, JSON.stringify({ extraction }), 'utf8');
    process.env.GBRAIN_HOME = dir;
    const stdout = await captureStdout(() => runWorldCommand(null, ['topic', 'state', 'sovereign-ai-india', '--from-extraction', extractionPath, '--json', '--no-store']));
    delete process.env.GBRAIN_HOME;
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.stored_at).toBeUndefined();
    expect(parsed.surface.schema).toBe('gbrain.synthesis_surface.topic_state.v1');
    expect(parsed.surface.current_state[0].source_refs[0].source_span_id).toBe(scout.source_spans[0]!.ref);
  });
});
