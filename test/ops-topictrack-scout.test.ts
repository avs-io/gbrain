import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import { readOpsState, syncTopicTracksFromYamlFile } from '../src/core/ops/kernel.ts';
import { runTopicTrackScoutCycle } from '../src/core/scout/topic-track-cycle.ts';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'gbrain-topictrack-')); }
function tempStore(dir = tempDir()): string { return join(dir, 'ops.jsonl'); }

function topicYaml(): string {
  return `topic_tracks:
  - id: world-sovereign-ai-india
    slug: sovereign-ai-india
    recipe_slug: sovereign-ai-india
    program_id: world-sovereign-ai-india
    title: Sovereign AI India
    status: active
    priority: 90
    objective: Maintain dynamic public-world intelligence on Indian sovereign AI policy, compute, procurement, and institutional signals.
    seed_queries:
      - India sovereign AI compute policy IndiaAI GPU tender
      - MeitY sovereign AI foundation model India
    watch_entities: [MeitY, IndiaAI Mission, Sarvam AI, Krutrim]
    source_classes: [government_release, news, procurement_tender]
    extraction_targets: [entities, claims, events, procurement_signal]
    budgets:
      max_external_fetches: 0
      max_queries_per_run: 4
    autonomy:
      can_ingest_public_sources: true
      can_create_world_claim_proposals: true
      can_mutate_trusted_memory: false
      can_contact_people: false
`;
}

function publicSources() {
  return [
    {
      source_url: 'https://example.com/indiaai-compute',
      source_title: 'IndiaAI compute policy update',
      published_at: '2026-04-30',
      claim: 'IndiaAI Mission announced a GPU compute procurement update for sovereign AI builders.',
      excerpt: 'IndiaAI Mission announced a GPU compute procurement update for sovereign AI builders on 2026-04-30.',
      content: 'Brief. IndiaAI Mission announced a GPU compute procurement update for sovereign AI builders on 2026-04-30. End.',
      entities: ['IndiaAI Mission'],
      source_kind: 'government_release',
    },
    {
      source_url: 'https://example.com/sarvam-meity',
      source_title: 'Sarvam and MeitY model collaboration',
      published_at: '2026-04-30',
      claim: 'Sarvam AI launched a sovereign model collaboration with MeitY.',
      excerpt: 'Sarvam AI launched a sovereign model collaboration with MeitY for Indian language AI.',
      content: 'Sarvam AI launched a sovereign model collaboration with MeitY for Indian language AI.',
      entities: ['Sarvam AI', 'MeitY'],
      source_kind: 'company_announcement',
    },
  ];
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

describe('TopicTrack scout v1', () => {
  test('syncs topic_tracks config into ops state', () => {
    const dir = tempDir();
    const file = join(dir, 'topic_tracks.yaml');
    const store = tempStore(dir);
    writeFileSync(file, topicYaml());

    const result = syncTopicTracksFromYamlFile(file, { path: store, now: new Date('2026-04-30T07:00:00.000Z') });
    expect(result.upserted_count).toBe(1);
    const state = readOpsState(store);
    expect(state.topic_tracks[0]?.id).toBe('world-sovereign-ai-india');
    expect(state.topic_tracks[0]?.privacy_tier).toBe('P3_PUBLIC');
    expect(state.topic_tracks[0]?.autonomy.can_mutate_trusted_memory).toBe(false);
  });

  test('runs one scout cycle and outputs sources, claims, deltas, surfacing candidates, and review-only topic state', () => {
    const dir = tempDir();
    const file = join(dir, 'topic_tracks.yaml');
    const store = tempStore(dir);
    writeFileSync(file, topicYaml());
    syncTopicTracksFromYamlFile(file, { path: store, now: new Date('2026-04-30T07:00:00.000Z') });

    const report = runTopicTrackScoutCycle({
      topicTrackId: 'world-sovereign-ai-india',
      sources: publicSources(),
      storePath: store,
      now: new Date('2026-04-30T07:05:00.000Z'),
      since: '2026-04-29T00:00:00.000Z',
    });

    expect(report.schema).toBe('gbrain.ops.topic_track.scout_cycle.v1');
    expect(report.trusted_personal_memory_mutated).toBe(false);
    expect(report.trusted_world_truth).toBe(false);
    expect(report.scout_report.source_items).toHaveLength(2);
    expect(report.scout_report.source_items.every(s => s.namespace === 'world' && s.privacy === 'P3_PUBLIC')).toBe(true);
    expect(report.extraction.claims.length).toBeGreaterThanOrEqual(2);
    expect(report.extraction.trusted_world_truth).toBe(false);
    expect(report.recent_deltas.new.length + report.recent_deltas.changed.length + report.recent_deltas.repeated.length).toBeGreaterThan(0);
    expect(report.surfacing_candidates.length).toBeGreaterThan(0);
    expect(report.topic_state_draft.mode).toBe('review-only');
    expect(report.topic_state_draft.trusted_world_truth).toBe(false);

    const state = readOpsState(store);
    expect(state.scout_source_queue.filter(q => q.topic_track_id === 'world-sovereign-ai-india' && q.status === 'queued')).toHaveLength(2);
    expect(state.scout_source_queue.filter(q => q.topic_track_id === 'world-sovereign-ai-india' && q.status === 'fetched')).toHaveLength(2);
  });

  test('ops CLI syncs tracks and runs a scout cycle', async () => {
    const dir = tempDir();
    const trackFile = join(dir, 'topic_tracks.yaml');
    const sourceFile = join(dir, 'sources.json');
    const store = tempStore(dir);
    writeFileSync(trackFile, topicYaml());
    writeFileSync(sourceFile, JSON.stringify(publicSources()), 'utf8');

    const synced = JSON.parse(await capture(() => runOpsCommand(null, ['topic-tracks', 'sync', '--file', trackFile, '--store', store, '--json'])));
    expect(synced.upserted_count).toBe(1);

    const report = JSON.parse(await capture(() => runOpsCommand(null, ['scout', 'cycle', '--topic-track', 'world-sovereign-ai-india', '--input', sourceFile, '--store', store, '--json'])));
    expect(report.scout_report.source_items).toHaveLength(2);
    expect(report.extraction.claims.length).toBeGreaterThan(0);
    expect(report.surfacing_candidates.length).toBeGreaterThan(0);
  });
});
