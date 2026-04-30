import { createHash } from 'node:crypto';

import {
  readOpsState,
  upsertScoutSourceQueueItem,
  type OpsStoreOptions,
  type OpsTopicTrack,
} from '../ops/kernel.ts';
import { scoutRecipeById, type ScoutRecipe } from './pipeline.ts';
import { runPublicScout, type PublicScoutSourceInput, type ScoutRunReport } from './runner.ts';
import { extractWorldCandidatesFromScout, type WorldExtractionReport } from '../world/extractor.ts';
import { compileTopicState, type TopicDeltaItem, type TopicStateSurface } from '../world/topic-state.ts';

export interface TopicTrackSurfacingCandidate {
  id: string;
  title: string;
  why_now: string;
  suggested_action: string;
  urgency: 'low' | 'medium' | 'high';
  requires_human: boolean;
  evidence_refs: string[];
  score: number;
}

export interface TopicTrackScoutCycleReport {
  schema: 'gbrain.ops.topic_track.scout_cycle.v1';
  topic_track_id: string;
  topic: string;
  run_id: string;
  mode: 'review-only';
  trusted_personal_memory_mutated: false;
  trusted_world_truth: false;
  source_queue: {
    queued_seed_queries: number;
    fetched_sources: number;
  };
  scout_report: ScoutRunReport;
  extraction: WorldExtractionReport;
  recent_deltas: TopicStateSurface['recent_deltas'];
  surfacing_candidates: TopicTrackSurfacingCandidate[];
  topic_state_draft: TopicStateSurface;
  diagnostics: {
    warnings: string[];
  };
}

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function makeRecipe(track: OpsTopicTrack): ScoutRecipe {
  const base = scoutRecipeById(track.recipe_slug || track.slug);
  return {
    schema: 'gbrain.scout.recipe.v1',
    id: track.slug,
    slug: track.slug,
    topic: track.slug,
    title: track.title,
    objective: track.objective,
    description: track.objective,
    public: true,
    keywords: [...new Set([...track.watch_entities, ...track.extraction_targets, 'public', 'world'])].slice(0, 20),
    seed_queries: track.seed_queries,
    watch_entities: track.watch_entities,
    budgets: {
      max_queries_per_run: Number(track.budgets.max_queries_per_run || track.seed_queries.length || base?.budgets.max_queries_per_run || 8),
      max_results_per_query: Number(track.budgets.max_results_per_query || base?.budgets.max_results_per_query || 10),
      max_runtime_seconds: Number(track.budgets.max_runtime_seconds || base?.budgets.max_runtime_seconds || 90),
      max_external_fetches: Number(track.budgets.max_external_fetches || 0),
    },
    outputs: { kinds: ['query_plan', 'claim_candidates', 'radar_candidates', 'briefing_note'], review_only: true, trusted_world_updates: false },
    action_templates: base?.action_templates || ['draft internal brief', 'track source for follow-up', 'queue verification'],
    topic_track: {
      schema: 'gbrain.topic_track.v1',
      slug: track.slug,
      title: track.title,
      objective: track.objective,
      description: track.objective,
      namespace: 'world',
      privacy: 'public',
      cadence: 'daily',
      watch_entities: track.watch_entities,
      seed_queries: track.seed_queries,
    },
  };
}

function sourceQuery(source: PublicScoutSourceInput, track: OpsTopicTrack): string {
  if (typeof source.query_id === 'string' && source.query_id) return source.query_id;
  return track.seed_queries[0] || track.id;
}

function urgency(score: number): TopicTrackSurfacingCandidate['urgency'] {
  if (score >= 0.78) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}

function candidatesFromDeltas(track: OpsTopicTrack, deltas: TopicStateSurface['recent_deltas']): TopicTrackSurfacingCandidate[] {
  const all: TopicDeltaItem[] = [...deltas.new, ...deltas.changed].slice(0, 8);
  return all.map(delta => {
    const base = delta.kind === 'candidate_event' ? 0.74 : delta.kind === 'entity_update' ? 0.62 : 0.66;
    const score = Math.min(0.95, base + (delta.bucket === 'changed' ? 0.08 : 0.03));
    return {
      id: `surfacing_${sha({ track: track.id, delta: delta.id })}`,
      title: delta.summary.slice(0, 96),
      why_now: `${delta.reason}; observed ${delta.observed_at}`,
      suggested_action: 'Review cited public-world candidate and decide whether to draft an internal brief or verification task.',
      urgency: urgency(score),
      requires_human: true,
      evidence_refs: delta.source_refs.map(r => r.source_span_id),
      score: Number(score.toFixed(2)),
    };
  });
}

export function runTopicTrackScoutCycle(input: {
  topicTrackId: string;
  sources: PublicScoutSourceInput[];
  since?: string;
  now?: Date;
  storePath?: string;
}): TopicTrackScoutCycleReport {
  const opts: OpsStoreOptions = { path: input.storePath, now: input.now };
  const state = readOpsState(input.storePath);
  const track = state.topic_tracks.find(t => t.id === input.topicTrackId || t.slug === input.topicTrackId || t.recipe_slug === input.topicTrackId);
  if (!track) throw new Error(`topic track not found: ${input.topicTrackId}`);
  if (track.status !== 'active') throw new Error(`topic track is not active: ${track.id} (${track.status})`);

  for (const query of track.seed_queries) {
    upsertScoutSourceQueueItem({
      id: `scoutq_${sha({ track: track.id, query })}`,
      topic_track_id: track.id,
      query,
      status: 'queued',
      privacy_tier: 'P3_PUBLIC',
      namespace: 'world',
      metadata: { source: 'seed_query' },
    }, opts);
  }

  for (const [index, source] of input.sources.entries()) {
    upsertScoutSourceQueueItem({
      id: `scoutsrc_${sha({ track: track.id, url: source.source_url || source.url, title: source.source_title || source.title, index })}`,
      topic_track_id: track.id,
      query: sourceQuery(source, track),
      status: 'fetched',
      source_class: source.source_kind || 'public_source',
      source_url: source.source_url || source.url,
      source_title: source.source_title || source.title,
      published_at: source.published_at,
      privacy_tier: 'P3_PUBLIC',
      namespace: 'world',
      metadata: { provider: source.provider || 'fixture_public_sources' },
    }, opts);
  }

  const recipe = makeRecipe(track);
  const scoutReport = runPublicScout({ recipe, sources: input.sources, depth: 'standard', dryRun: false, provider: 'fixture_public_sources', now: input.now });
  const extraction = extractWorldCandidatesFromScout(scoutReport, { topic: track.slug, now: input.now });
  const topicStateDraft = compileTopicState({ topic: track.slug, extractions: [extraction], since: input.since, now: input.now });
  const surfacingCandidates = candidatesFromDeltas(track, topicStateDraft.recent_deltas);
  return {
    schema: 'gbrain.ops.topic_track.scout_cycle.v1',
    topic_track_id: track.id,
    topic: track.slug,
    run_id: scoutReport.run_ledger.run_id,
    mode: 'review-only',
    trusted_personal_memory_mutated: false,
    trusted_world_truth: false,
    source_queue: { queued_seed_queries: track.seed_queries.length, fetched_sources: input.sources.length },
    scout_report: scoutReport,
    extraction,
    recent_deltas: topicStateDraft.recent_deltas,
    surfacing_candidates: surfacingCandidates,
    topic_state_draft: topicStateDraft,
    diagnostics: {
      warnings: [
        'TopicTrack scout cycle writes only ops source queue records and review-only artifacts.',
        'Public-world candidates remain separate from trusted personal memory and are not promoted.',
      ],
    },
  };
}
