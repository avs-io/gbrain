import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runTopicsCommand } from '../src/commands/topics.ts';
import { readOpsState, validateTopicTracksYaml } from '../src/core/ops/kernel.ts';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'gbrain-topics-v2-')); }
async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

function validYaml(): string {
  return `topic_tracks:
  - id: world-sovereign-ai-india
    slug: sovereign-ai-india
    tier: T0
    program_id: world-sovereign-ai-india
    title: Sovereign AI India
    status: active
    priority: 95
    objective: Maintain public-world intelligence on Indian sovereign AI policy, compute, and company signals.
    why_it_matters_to_chief: This topic changes Chief's strategic timing around Indian AI policy, compute procurement, partnerships, and product opportunities.
    decision_surfaces: [weekly strategy brief, opportunity radar]
    standing_questions:
      - What policy or procurement signal changed?
      - What opportunity is newly timed for Chief?
    watch_entities: [MeitY, IndiaAI Mission, Sarvam AI]
    source_classes: [government_release, news, company_announcement]
    research_plan:
      maps:
        institutions: [MeitY, IndiaAI Mission]
        companies: [Sarvam AI]
      discovery_queries:
        - IndiaAI sovereign AI compute procurement
        - MeitY sovereign AI foundation model
      extraction_targets: [claim, entity, event, problem_signal]
      opportunity_lenses: [policy timing, compute access, partnership wedge]
    cadence:
      discovery_hours: 2
      delta_compile_hours: 6
    budgets:
      minimax_calls_per_day: 5000
      max_external_fetches: 0
    lanes:
      privacy_tier: P3_PUBLIC
      namespace: world
      model_lanes: [minimax-public-regular]
      worker_lanes: [public_discovery, public_fetch, world_extraction, topic_reduce, opportunity_scoring]
    approval_gates: [external_message_send, trusted_memory_mutation]
    success_metrics:
      - Reduced state exists with source refs.
      - WorkItems cover the full factory path.
    autonomy:
      can_ingest_public_sources: true
      can_mutate_trusted_memory: false
      can_contact_people: false
`;
}

describe('TopicTrack v2 registry and Research Plan DSL', () => {
  test('validates TopicTrack v2 schema and research plan DSL', () => {
    const result = validateTopicTracksYaml(validYaml());
    expect(result.ok).toBe(true);
    expect(result.topic_tracks[0]?.schema).toBe('gbrain.ops.topic_track.v2');
    expect(result.topic_tracks[0]?.tier).toBe('T0');
    expect(result.topic_tracks[0]?.research_plan.discovery_queries).toHaveLength(2);
    expect(result.topic_tracks[0]?.research_plan.opportunity_lenses).toContain('compute access');
    expect(result.topic_tracks[0]?.privacy_tier).toBe('P3_PUBLIC');
    expect(result.topic_tracks[0]?.lanes.model_lanes).not.toContain('minimax-highspeed');
  });

  test('rejects invalid topics missing research plan maps and standing fields', () => {
    const invalid = `topic_tracks:
  - id: bad-topic
    title: Bad
    status: active
    watch_entities: [X]
    source_classes: [news]
    seed_queries: [x]
    extraction_targets: [claim]
`;
    const result = validateTopicTracksYaml(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('research_plan.maps');
  });

  test('CLI lists and gets topics from a registry file', async () => {
    const dir = tempDir();
    const file = join(dir, 'topic_tracks.yaml');
    writeFileSync(file, validYaml());

    const listed = JSON.parse(await capture(() => runTopicsCommand(null, ['list', '--file', file, '--json'])));
    expect(listed.schema).toBe('gbrain.topics.list.v2');
    expect(listed.topic_tracks.map((t: any) => t.id)).toEqual(['world-sovereign-ai-india']);

    const got = JSON.parse(await capture(() => runTopicsCommand(null, ['get', 'world-sovereign-ai-india', '--file', file, '--json'])));
    expect(got.topic_track.tier).toBe('T0');
    expect(got.topic_track.decision_surfaces).toContain('opportunity radar');
  });

  test('seed-work creates discovery, fetch, extract, reduce, and scoring WorkItems through ops kernel', async () => {
    const dir = tempDir();
    const file = join(dir, 'topic_tracks.yaml');
    const store = join(dir, 'ops.jsonl');
    writeFileSync(file, validYaml());

    const seeded = JSON.parse(await capture(() => runTopicsCommand(null, ['seed-work', 'world-sovereign-ai-india', '--file', file, '--store', store, '--json'])));
    expect(seeded.schema).toBe('gbrain.topics.seed_work.v2');
    expect(seeded.created_count).toBe(5);
    expect(seeded.work_items.map((w: any) => w.lane)).toEqual(['public_discovery', 'public_fetch', 'world_extraction', 'topic_reduce', 'opportunity_scoring']);
    expect(seeded.work_items.every((w: any) => w.privacy_tier === 'P3_PUBLIC')).toBe(true);

    const state = readOpsState(store);
    expect(state.programs.find(p => p.id === 'world-sovereign-ai-india')).toBeTruthy();
    expect(state.topic_tracks[0]?.id).toBe('world-sovereign-ai-india');
    expect(state.work_items).toHaveLength(5);
    expect(state.work_items.find(w => w.id.endsWith('-discovery'))?.state).toBe('ready');
    expect(state.work_items.find(w => w.id.endsWith('-fetch'))?.dependencies).toEqual(['topic-world-sovereign-ai-india-discovery']);
    expect(state.work_items.flatMap(w => w.guardrails || [])).toContain('no broad live web fetch in tests');
  });
});
