import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import {
  matchMemoryContext,
  readOpportunityRadarV2Store,
  runOpportunityRadarV2,
  scoreOpportunityV2,
  type OpportunityFreshSignal,
} from '../src/core/ops/opportunity-radar-v2.ts';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'gbrain-opp-v2-')); }
function now(): Date { return new Date('2026-04-30T10:00:00.000Z'); }

function state() {
  return {
    schema: 'gbrain.topics.topic_current_state.v1',
    mode: 'review-only', trusted_world_truth: false, trusted_personal_memory_mutated: false,
    topic_id: 'world-sovereign-ai-india', as_of: '2026-04-30T09:00:00.000Z', compiled_at: '2026-04-30T09:01:00.000Z',
    inputs: {}, confidence: { overall: 0.82, supported_fraction: 0.8, average_support_score: 0.8, average_authority_score: 0.7, source_diversity: 0.8 }, coverage: {}, current_claims: [], key_entities: [], key_events: [],
    problem_signals: [{ id: 'ps_compute_gap', problem_type: 'compute_bottleneck', signal: 'IndiaAI compute procurement creates a bottleneck for startups that need local-first sovereign AI evaluation pilots.', source_span_ids: ['srcspan1:gov:compute:L1-L3'], evidence_refs: [{ source_span_id: 'srcspan1:gov:compute:L1-L3', source_item_id: 'src_gov_compute', quote: 'IndiaAI compute procurement creates a startup pilot bottleneck.' }] }],
    opportunity_implications: ['compute_bottleneck: local sovereign AI evaluation pilot is newly timed'],
    next_work: [{ id: 'tw_compute_pilot', kind: 'investigate_opportunity', priority: 'P2', title: 'Investigate sovereign AI evaluation pilot wedge', rationale: 'Startup compute bottleneck may create a pilot wedge.', topic_id: 'world-sovereign-ai-india', refs: ['srcspan1:gov:compute:L1-L3'], expected_output: 'opportunity implication or discard record' }],
  };
}

function delta() {
  return {
    schema: 'gbrain.topics.topic_daily_delta.v1', mode: 'review-only', trusted_world_truth: false, trusted_personal_memory_mutated: false,
    topic_id: 'world-sovereign-ai-india', as_of: '2026-04-30T09:30:00.000Z', compiled_at: '2026-04-30T09:31:00.000Z',
    material_new: [{ id: 'delta_indiaai_pilot', kind: 'new', item_type: 'problem_signal', summary: 'Government sandbox deadline opened for sovereign AI pilots needing evaluation infrastructure.', rationale: 'New deadline changes timing.', source_refs: ['srcspan1:gov:sandbox:L4-L8'] }],
    changed: [], repeated: [], stale: [], contradicted: [], diagnostics: { current_items: 1, previous_items: 0, warnings: [] }, next_work: [], open_unknowns: [],
  };
}

function bookmarkReport() {
  return {
    schema: 'gbrain.ops.bookmark_deep_radar.v1', ok: true, generated_at: '2026-04-30T09:40:00.000Z', input_count: 1, deduped_count: 1,
    decisions: [{ schema: 'gbrain.ops.bookmark_deep_decision.v1', id: 'bookmark_eval_repo', bookmark_hash: 'hash1', url: 'https://x.com/i/bookmarks', title: 'Open-source sovereign AI eval harness', content: 'Build local evaluation harness for India sovereign AI pilots.', platform: 'x', captured_at: '2026-04-30T09:39:00.000Z', dedupe_key: 'hash1', category: 'ai', decision: 'act', score: 0.86, reason: 'Directly actionable eval harness', next_step: 'Prototype a local eval harness', fetch: { status: 'fetch_allowed', reason: 'fixture_provided', source_class: 'github', policy: 'manual', live_fetch_performed: false }, source_class: 'github', canonical_url: 'https://github.com/example/sovereign-evals', summary: 'Build local evaluation harness for India sovereign AI pilots.', evidence_refs: [{ source_span_id: 'srcspan1:gh:evals:L1-L4', source_item_id: 'src_gh_evals', quote: 'local evaluation harness for India sovereign AI pilots' }], topic_links: [{ topic_id: 'world-sovereign-ai-india', reason: 'matched topic', matched_terms: ['sovereign', 'evaluation', 'pilot'] }] }],
    source_items: [], source_spans: [], topic_extractions: [], archived_decisions: [], surfaced_candidates: [], created_work_items: [], artifact_path: 'fixture', safety: {},
  };
}

function reductionReport() {
  return {
    schema: 'gbrain.topics.claim_reduction_report.v1', mode: 'review-only', trusted_world_truth: false, trusted_personal_memory_mutated: false, topic_id: 'world-sovereign-ai-india', reduced_at: '2026-04-30T09:20:00.000Z', diagnostics: {},
    claims: [{ schema: 'gbrain.topics.reduced_claim.v1', id: 'claim_pilot_gap', topic_id: 'world-sovereign-ai-india', claim: 'Sovereign AI startups need evaluation pilots because compute and policy bottlenecks are unresolved.', normalized_claim: 'x', status: 'supported', support_level: 'strong_inference', support_status: 'supported', support_score: 0.78, authority_score: 0.7, source_diversity: 2, source_item_ids: ['src_policy', 'src_compute'], source_span_ids: ['srcspan1:policy:L1-L2'], evidence_refs: [{ source_span_id: 'srcspan1:policy:L1-L2', source_item_id: 'src_policy', quote: 'evaluation pilots are needed while compute and policy bottlenecks remain' }], candidate_ids: [], observed_at: '2026-04-30T09:15:00.000Z', reduced_at: '2026-04-30T09:20:00.000Z' }],
  };
}

function memoryContext() {
  return {
    items: [{ id: 'mem_eval_harness_old', kind: 'opportunity_memory', title: 'Parked sovereign AI evaluation harness', text: 'Revisit building a local-first sovereign AI evaluation harness when India AI policy and compute access create a startup pilot wedge.', source_ref: 'gbs1:notes:sovereign-ai-eval:L1-L3', confidence: 0.82, tags: ['sovereign ai', 'evaluation', 'pilot', 'compute'], evidence: [{ span_id: 'gbs1:notes:sovereign-ai-eval:L1-L3', quote: 'Revisit building a local-first sovereign AI evaluation harness when India AI policy and compute access create a startup pilot wedge.' }] }],
  };
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

describe('Opportunity radar v2', () => {
  test('high-fit opportunity from state/delta/bookmark/reduction receives memory boost and work item', () => {
    const dir = tempDir();
    const artifactPath = join(dir, 'ops', 'intelligence', 'opps-v2.jsonl');
    const storePath = join(dir, 'ops.jsonl');
    const report = runOpportunityRadarV2({ topicId: 'world-sovereign-ai-india', topicState: [state() as any], topicDelta: [delta() as any], bookmarkReports: [bookmarkReport() as any], reductionReports: [reductionReport() as any], memoryContext: memoryContext(), artifactPath, storePath, now: now() });

    expect(report.schema).toBe('gbrain.ops.opportunity_radar.v2');
    expect(report.candidates.length).toBeGreaterThanOrEqual(3);
    const top = report.candidates[0];
    expect(top.schema).toBe('gbrain.ops.opportunity_candidate.v2');
    expect(top.old_memory_matches[0]?.source_ref).toBe('gbs1:notes:sovereign-ai-eval:L1-L3');
    expect(top.scores.final).toBeGreaterThan(0.58);
    expect(top.approval_requirement).toBe('human_review_before_external_action');
    expect(top.guardrails.trusted_personal_memory_mutated).toBe(false);
    expect(report.created_work_items.length).toBeGreaterThan(0);
    expect(readFileSync(artifactPath, 'utf8')).toContain('gbrain.ops.opportunity_candidate.v2');
  });

  test('low-fit signal is archived/discarded instead of creating work', () => {
    const dir = tempDir();
    const staleNoise: OpportunityFreshSignal = { id: 'noise', kind: 'topic_daily_delta', topic_id: 'world-sovereign-ai-india', title: 'Viral crypto trick launches', summary: 'A viral crypto trick has no relation to sovereign AI, evaluation, India policy, compute, or Chief projects.', observed_at: '2026-04-30T09:00:00.000Z', source_refs: [], tags: ['viral'] };
    const candidate = runOpportunityRadarV2({ topicId: 'world-sovereign-ai-india', topicDelta: [{ ...delta(), material_new: [{ id: staleNoise.id, kind: 'new', item_type: 'claim', summary: staleNoise.summary, rationale: 'noise', source_refs: [] }] } as any], memoryContext: { items: [] }, artifactPath: join(dir, 'opps.jsonl'), storePath: join(dir, 'ops.jsonl'), now: now(), minScore: 0.85 });
    expect(candidate.candidates).toHaveLength(0);
    expect(candidate.archived_candidates[0].candidate_class).toBe('discard');
    expect(candidate.archived_candidates[0].discard_reason).toContain('low relevance');
    expect(candidate.created_work_items).toHaveLength(0);
  });

  test('old-memory match boosting annotates source refs and confidence deterministically', () => {
    const signal: OpportunityFreshSignal = { id: 's1', kind: 'topic_current_state', topic_id: 'world-sovereign-ai-india', title: 'sovereign AI evaluation pilot', summary: 'compute access creates pilot wedge', observed_at: now().toISOString(), source_refs: [{ ref: 'srcspan1:x' }], tags: ['compute', 'pilot'] };
    const matches = matchMemoryContext(signal, (memoryContext() as any).items.map((i: any) => ({ ...i, evidence: [{ ref: i.source_ref, quote: i.text }] })) as any);
    expect(matches[0].schema).toBe('gbrain.ops.opportunity_context_match.v1');
    expect(matches[0].confidence).toBeGreaterThan(0.5);
    expect(matches[0].matched_terms).toEqual(expect.arrayContaining(['sovereign', 'evaluation', 'pilot']));
  });

  test('dedupe marks repeated opportunity as continuing and stale old opportunity as stale', () => {
    const dir = tempDir();
    const artifactPath = join(dir, 'opps.jsonl');
    const first = runOpportunityRadarV2({ topicId: 'world-sovereign-ai-india', topicDelta: [delta() as any], memoryContext: memoryContext(), artifactPath, storePath: join(dir, 'ops.jsonl'), now: now(), createWorkItems: false });
    const second = runOpportunityRadarV2({ topicId: 'world-sovereign-ai-india', topicDelta: [delta() as any], memoryContext: memoryContext(), artifactPath, storePath: join(dir, 'ops.jsonl'), now: new Date('2026-05-01T10:00:00.000Z'), createWorkItems: false });
    expect(second.candidates[0].lifecycle).toBe('continuing');
    expect(second.candidates[0].duplicate_of).toBe(first.candidates[0].id);

    const old = { ...delta(), as_of: '2026-02-01T09:30:00.000Z', material_new: [{ ...delta().material_new[0], id: 'delta_old_pilot' }] };
    const stale = runOpportunityRadarV2({ topicId: 'world-sovereign-ai-india', topicDelta: [old as any], memoryContext: memoryContext(), artifactPath: join(dir, 'stale.jsonl'), storePath: join(dir, 'ops2.jsonl'), now: now(), createWorkItems: false });
    expect(stale.candidates[0].lifecycle).toBe('stale');
    expect(stale.candidates[0].stale_reason).toContain('days old');
  });

  test('CLI accepts explicit memory context file and does not touch trusted memory', async () => {
    const dir = tempDir();
    const statePath = join(dir, 'state.json');
    const deltaPath = join(dir, 'delta.json');
    const bookmarksPath = join(dir, 'bookmarks.json');
    const memoryPath = join(dir, 'memory-context.json');
    const artifactPath = join(dir, 'ops', 'intelligence', 'opps.jsonl');
    const opsStore = join(dir, 'ops.jsonl');
    const trustedMemory = join(dir, 'MEMORY.md');
    writeFileSync(statePath, JSON.stringify(state(), null, 2));
    writeFileSync(deltaPath, JSON.stringify(delta(), null, 2));
    writeFileSync(bookmarksPath, JSON.stringify(bookmarkReport(), null, 2));
    writeFileSync(memoryPath, JSON.stringify(memoryContext(), null, 2));
    writeFileSync(trustedMemory, 'do not mutate me');

    const out = JSON.parse(await capture(() => runOpsCommand(null, ['opportunities', 'v2', '--topic', 'world-sovereign-ai-india', '--from-state', statePath, '--from-delta', deltaPath, '--from-bookmarks', bookmarksPath, '--from-memory-context', memoryPath, '--artifact-store', artifactPath, '--store', opsStore, '--json'])));
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.safety.private_memory_read).toBe(false);
    expect(readFileSync(trustedMemory, 'utf8')).toBe('do not mutate me');
    expect(readOpportunityRadarV2Store(artifactPath).length).toBeGreaterThan(0);
    expect(existsSync(opsStore)).toBe(true);
  });

  test('score surface exposes required dimensions', () => {
    const s: OpportunityFreshSignal = { id: 's', kind: 'topic_daily_delta', topic_id: 't', title: 'local-first agent pilot deadline', summary: 'deadline to build evidence-backed meeting brief pilot', observed_at: now().toISOString(), source_refs: [{ ref: 'srcspan1:a', quote: 'deadline to build evidence-backed meeting brief pilot' }], tags: ['agent'] };
    const scores = scoreOpportunityV2(s, [], now());
    expect(Object.keys(scores).sort()).toEqual(['actionability', 'evidence_strength', 'final', 'novelty', 'relevance', 'source_diversity', 'strategic_fit', 'urgency'].sort());
    expect(scores.actionability).toBeGreaterThan(0.5);
  });
});
