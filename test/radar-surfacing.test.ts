import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runRadarCommand } from '../src/commands/radar.ts';
import {
  appendSurfacingCandidates,
  generateSurfacingCandidates,
  overwriteSurfacingStore,
  parseSurfacingFixture,
  readSurfacingStore,
  scoreSurfacingCandidate,
  surfacingInputsFromSources,
} from '../src/core/radar/surfacing.ts';

const now = new Date('2026-04-30T05:00:00.000Z');

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

function fixture() {
  const ref = { source_span_id: 'srcspan1:web:frontier:L1-L3', source_item_id: 'src_frontier', quote: 'New local-first agent memory systems now ship evidence-addressed context packs for meetings and opportunity review.' };
  return {
    chief_context: { now: now.toISOString(), active_projects: ['GBrain intelligence substrate', 'OpenClaw agents'], interests: ['local-first agent memory', 'meeting intelligence'] },
    world_extraction: {
      schema: 'gbrain.world.extraction_report.v1', mode: 'candidate-review-only', trusted_world_truth: false, topic: 'agent memory', diagnostics: {},
      claims: [{ schema: 'gbrain.world.candidate_claim.v1', id: 'world_claim_high_fit', topic: 'agent memory', text: 'Local-first agent memory systems now ship evidence-addressed context packs for meetings.', type: 'world_claim', status: 'candidate', support_status: 'supported', confidence: 0.82, observed_at: now.toISOString(), source_refs: [ref] }],
      events: [{ schema: 'gbrain.world.candidate_timeline_event.v1', id: 'world_event_high_fit', topic: 'agent memory', title: 'Evidence-addressed context packs launched for agent meetings', event_type: 'launch', status: 'candidate', support_status: 'supported', confidence: 0.8, observed_at: now.toISOString(), event_at: now.toISOString(), entities: ['GBrain'], source_refs: [ref] }],
      entity_updates: [],
    },
    bookmarks: [{ id: 'bookmark_shiny', title: '10x crypto AI viral trading secret', url: 'https://example.com/shiny', excerpt: 'A viral thread promises ultimate crypto AI riches without evidence.' }],
    claim_records: [{ id: 'opp_old_1', schema_version: 1, created_at: now.toISOString(), updated_at: now.toISOString(), claim: 'If local-first agent memory becomes practical, revisit GBrain meeting intelligence.', type: 'opportunity_memory', status: 'proposed', namespace: 'ventures', privacy: 'internal', sensitivity: 'medium', confidence: 0.74, observed_at: '2026-03-10T00:00:00.000Z', evidence: [{ span_id: 'gbs1:notes:gbrain#opp:L1-L2', source_item_id: 'notes:gbrain', quote: 'Revisit meeting intelligence when local-first agent memory becomes practical.', quote_hash: 'h' }], review_required: true, guardrails: {} }],
    meetings: [{ id: 'cal_1', person: 'Agent Memory Founder', title: 'Meeting with local-first agent memory founder', starts_at: '2026-04-30T08:00:00.000Z', summary: 'Discuss OpenClaw agents and evidence-addressed meeting briefs.' }],
  };
}

describe('radar surfacing v1', () => {
  test('scoreSurfacingCandidate is deterministic and high-fit evidence clears review threshold', () => {
    const parsed = parseSurfacingFixture(fixture());
    const input = surfacingInputsFromSources(parsed).find(i => i.source_id === 'world_claim_high_fit')!;
    const score = scoreSurfacingCandidate(input, parsed.chiefContext, { now });
    expect(score.personal_fit).toBeGreaterThan(0.6);
    expect(score.evidence_strength).toBeGreaterThan(0.5);
    expect(score.final).toBeGreaterThanOrEqual(0.68);
  });

  test('generates candidates from scout claims/events, bookmarks, old opportunity memories, and meeting context', () => {
    const candidates = generateSurfacingCandidates({ ...parseSurfacingFixture(fixture()), now });
    expect(candidates.some(c => c.source_kind === 'scout_claim' && c.status === 'review')).toBe(true);
    expect(candidates.some(c => c.source_kind === 'scout_event')).toBe(true);
    expect(candidates.some(c => c.source_kind === 'bookmark' && c.status === 'archived')).toBe(true);
    expect(candidates.some(c => c.source_kind === 'opportunity_memory' && ['review', 'brief'].includes(c.status))).toBe(true);
    expect(candidates.some(c => c.source_kind === 'meeting_context' && ['review', 'brief'].includes(c.status))).toBe(true);
    for (const candidate of candidates) {
      expect(candidate.evidence.length).toBeGreaterThan(0);
      expect(candidate.recommended_action.type).toBeTruthy();
      expect(candidate.guardrails.external_messages_sent).toBe(false);
    }
  });

  test('duplicate candidate enters cooldown rather than interrupt/review', () => {
    const first = generateSurfacingCandidates({ ...parseSurfacingFixture(fixture()), now });
    const dupes = generateSurfacingCandidates({ ...parseSurfacingFixture(fixture()), now: new Date('2026-05-01T05:00:00.000Z'), existingCandidates: first });
    const dup = dupes.find(c => c.source_id === 'world_claim_high_fit')!;
    expect(dup.status).toBe('cooldown');
    expect(dup.cooldown?.duplicate_of).toBeTruthy();
  });

  test('CLI review/accept/dismiss persists review-only surfacing candidates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-surface-'));
    const fixturePath = join(dir, 'fixture.json');
    const storePath = join(dir, 'surfacing.jsonl');
    writeFileSync(fixturePath, JSON.stringify(fixture()), 'utf8');

    const reviewDry = JSON.parse(await capture(() => runRadarCommand(null, ['review', '--from', fixturePath, '--store', storePath, '--limit', '20', '--json'])));
    expect(reviewDry.ok).toBe(true);
    expect(reviewDry.candidates.some((c: any) => c.source_id === 'world_claim_high_fit')).toBe(true);
    expect(readSurfacingStore(storePath).candidates).toHaveLength(0);

    const reviewWrite = JSON.parse(await capture(() => runRadarCommand(null, ['review', '--from', fixturePath, '--store', storePath, '--yes', '--json'])));
    const candidate = reviewWrite.candidates.find((c: any) => c.source_id === 'world_claim_high_fit');
    expect(candidate.id).toBeTruthy();
    expect(readSurfacingStore(storePath).candidates.length).toBeGreaterThan(0);

    const accepted = JSON.parse(await capture(() => runRadarCommand(null, ['accept', candidate.id, '--action', 'investigate', '--store', storePath, '--json'])));
    expect(accepted.decision.status).toBe('accepted');

    const other = readSurfacingStore(storePath).candidates.find(c => c.status === 'brief' || c.status === 'review' || c.status === 'cooldown')!;
    const dismissed = JSON.parse(await capture(() => runRadarCommand(null, ['dismiss', other.id, '--reason', 'irrelevant', '--store', storePath, '--json'])));
    expect(dismissed.decision.reason).toBe('irrelevant');
  });

  test('store supports repo-consistent persisted surface records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-surface-store-'));
    const storePath = join(dir, 'surfacing.jsonl');
    const candidates = generateSurfacingCandidates({ ...parseSurfacingFixture(fixture()), now });
    overwriteSurfacingStore([], storePath);
    appendSurfacingCandidates(candidates, storePath);
    const read = readSurfacingStore(storePath).candidates;
    expect(read.length).toBe(candidates.length);
    expect(read[0].schema).toBe('gbrain.radar.surfacing_candidate.v1');
  });
});
