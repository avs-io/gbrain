import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runTopicsCommand } from '../src/commands/topics.ts';
import type { TopicCandidateExtractionReport, TopicClaimCandidate, TopicEntityCandidate, TopicEventCandidate, TopicProblemSignalCandidate } from '../src/core/topics/extractor.ts';
import { reduceTopicClaimsFromExtraction } from '../src/core/topics/claim-reducer.ts';
import { compileTopicCurrentState, compileTopicDailyDelta, generateTopicUnknownsAndNextWork, validateTopicCurrentStateSurface, validateTopicDailyDeltaSurface } from '../src/core/topics/state-delta.ts';

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

function claim(overrides: Partial<TopicClaimCandidate> & { claim: string; quote?: string; source_item_id?: string; source_span_id?: string }): TopicClaimCandidate {
  const quote = overrides.quote ?? overrides.claim;
  const source_item_id = overrides.source_item_id ?? 'web:test-primary';
  const source_span_id = overrides.source_span_id ?? `srcspan1:${source_item_id}#char:0-${Math.max(quote.length, 1)}`;
  return {
    schema: 'gbrain.topic_candidate.claim.v1',
    kind: 'topic_claim',
    id: overrides.id ?? `cand-${Math.random().toString(16).slice(2)}`,
    topic_id: 'world-sovereign-ai-india',
    status: 'review_only',
    support_status: overrides.support_status ?? 'supported',
    confidence: overrides.confidence ?? 0.82,
    observed_at: '2026-04-30T10:00:00.000Z',
    source_span_ids: overrides.source_span_ids ?? [source_span_id],
    evidence_refs: overrides.evidence_refs ?? [{ source_span_id, source_item_id, quote, quote_hash: 'hash' }],
    claim_type: 'world_claim',
    ...overrides,
  };
}

function report(claims: TopicClaimCandidate[], extras: Partial<TopicCandidateExtractionReport> = {}): TopicCandidateExtractionReport {
  return {
    schema: 'gbrain.topics.candidate_extraction_report.v1',
    mode: 'review-only',
    trusted_world_truth: false,
    trusted_personal_memory_mutated: false,
    topic_id: 'world-sovereign-ai-india',
    generated_at: '2026-04-30T10:00:00.000Z',
    source: { kind: 'source_spans' },
    diagnostics: {
      source_items_seen: 1,
      source_spans_seen: claims.length,
      topic_claims_extracted: claims.length,
      topic_entities_extracted: extras.topic_entities?.length || 0,
      topic_events_extracted: extras.topic_events?.length || 0,
      topic_problem_signals_extracted: extras.topic_problem_signals?.length || 0,
      unsupported_candidates: claims.filter(c => c.support_status === 'unsupported').length,
      rejected_candidates: 0,
      warnings: [],
    },
    topic_claims: claims,
    topic_entities: [],
    topic_events: [],
    topic_problem_signals: [],
    ...extras,
  };
}

function entity(): TopicEntityCandidate {
  return { schema: 'gbrain.topic_candidate.entity.v1', kind: 'topic_entity', id: 'ent-indiaai', topic_id: 'world-sovereign-ai-india', entity: 'IndiaAI Mission', entity_type: 'program', context: 'IndiaAI Mission announced compute work', status: 'review_only', support_status: 'supported', confidence: 0.8, observed_at: '2026-04-30T10:00:00.000Z', source_span_ids: ['srcspan1:web:official#char:0-10'], evidence_refs: [{ source_span_id: 'srcspan1:web:official#char:0-10', source_item_id: 'web:official', quote: 'IndiaAI Mission announced compute work' }] };
}

function event(): TopicEventCandidate {
  return { schema: 'gbrain.topic_candidate.event.v1', kind: 'topic_event', id: 'ev-compute', topic_id: 'world-sovereign-ai-india', title: 'IndiaAI Mission announced compute work', event_type: 'announcement', event_at: '2026-04-30T00:00:00.000Z', entities: ['IndiaAI Mission'], status: 'review_only', support_status: 'supported', confidence: 0.8, observed_at: '2026-04-30T10:00:00.000Z', source_span_ids: ['srcspan1:web:official#char:0-10'], evidence_refs: [{ source_span_id: 'srcspan1:web:official#char:0-10', source_item_id: 'web:official', quote: 'IndiaAI Mission announced compute work' }] };
}

function problemSignal(): TopicProblemSignalCandidate {
  return { schema: 'gbrain.topic_candidate.problem_signal.v1', kind: 'topic_problem_signal', id: 'prob-gpu', topic_id: 'world-sovereign-ai-india', signal: 'GPU supply is a bottleneck for sovereign AI teams.', problem_type: 'bottleneck', entities: ['GPU'], status: 'review_only', support_status: 'supported', confidence: 0.77, observed_at: '2026-04-30T10:00:00.000Z', source_span_ids: ['srcspan1:web:news#char:0-10'], evidence_refs: [{ source_span_id: 'srcspan1:web:news#char:0-10', source_item_id: 'web:news', quote: 'GPU supply is a bottleneck for sovereign AI teams.' }] };
}

describe('TopicTrack current-state and daily-delta reducer', () => {
  test('compiles review-only current state with confidence, coverage, entities/events/problem signals, unknowns, and next work', () => {
    const extraction = report([
      claim({ id: 'c1', claim: 'IndiaAI Mission announced a sovereign AI compute update.', quote: 'IndiaAI Mission announced a sovereign AI compute update.', source_item_id: 'web:official-gov' }),
      claim({ id: 'c2', claim: 'A private GPU grant is confirmed.', quote: 'Rumour says a private GPU grant may happen.', support_status: 'unsupported', unsupported_reason: 'rumour' }),
    ], { topic_entities: [entity()], topic_events: [event()], topic_problem_signals: [problemSignal()] });
    const reduction = reduceTopicClaimsFromExtraction(extraction, { now: new Date('2026-04-30T11:00:00.000Z') });
    const state = compileTopicCurrentState({ reduction, extraction, now: new Date('2026-04-30T12:00:00.000Z') });

    expect(validateTopicCurrentStateSurface(state)).toEqual([]);
    expect(state.schema).toBe('gbrain.topics.topic_current_state.v1');
    expect(state.mode).toBe('review-only');
    expect(state.trusted_personal_memory_mutated).toBe(false);
    expect(state.coverage.current_claims).toBe(2);
    expect(state.coverage.entities).toBe(1);
    expect(state.coverage.events).toBe(1);
    expect(state.coverage.problem_signals).toBe(1);
    expect(state.confidence.overall).toBeGreaterThan(0);
    expect(state.open_unknowns.map(u => u.kind)).toContain('unverified_claim');
    expect(state.open_unknowns.map(u => u.kind)).toContain('low_source_diversity');
    expect(state.next_work.some(w => w.kind === 'verify_claim')).toBe(true);
    expect(state.next_work.some(w => w.kind === 'investigate_opportunity')).toBe(true);
    expect(state.opportunity_implications[0]).toContain('bottleneck');
  });

  test('classifies daily deltas as new, changed, repeated, stale, and contradicted', () => {
    const previousReduction = reduceTopicClaimsFromExtraction(report([
      claim({ id: 'p1', claim: 'IndiaAI Mission announced a sovereign AI compute update.', quote: 'IndiaAI Mission announced a sovereign AI compute update.', source_item_id: 'web:official-gov' }),
      claim({ id: 'p2', claim: 'IndiaAI Mission opened a model evaluation sandbox.', quote: 'IndiaAI Mission opened a model evaluation sandbox.', source_item_id: 'web:official-gov', source_span_id: 'srcspan1:web:official-gov#char:100-150' }),
      claim({ id: 'p3', claim: 'IndiaAI Mission runs public AI programs.', quote: 'IndiaAI Mission runs public AI programs.', source_item_id: 'web:official-gov', source_span_id: 'srcspan1:web:official-gov#char:200-240' }),
    ]), { now: new Date('2026-04-29T10:00:00.000Z') });
    const currentReduction = reduceTopicClaimsFromExtraction(report([
      claim({ id: 'c1', claim: 'IndiaAI Mission announced a sovereign AI compute update.', quote: 'IndiaAI Mission announced a sovereign AI compute update.', source_item_id: 'web:official-gov' }),
      claim({ id: 'c2', claim: 'IndiaAI Mission opened a model evaluation sandbox for startups.', quote: 'IndiaAI Mission opened a model evaluation sandbox for startups.', source_item_id: 'web:official-gov', source_span_id: 'srcspan1:web:official-gov#char:100-165', confidence: 0.6 }),
      claim({ id: 'c3', claim: 'IndiaAI Mission released a new dataset program.', quote: 'IndiaAI Mission released a new dataset program.', source_item_id: 'web:news', source_span_id: 'srcspan1:web:news#char:0-50' }),
      claim({ id: 'c4', claim: 'The GPU tender window closed.', quote: 'The GPU tender window closed.', source_item_id: 'web:news2', source_span_id: 'srcspan1:web:news2#char:0-50', expires_at: '2026-04-01T00:00:00.000Z' } as Partial<TopicClaimCandidate> & { claim: string }),
      claim({ id: 'c5', claim: 'IndiaAI Mission did not announce a sovereign AI compute update.', quote: 'IndiaAI Mission did not announce a sovereign AI compute update.', source_item_id: 'web:contradict', source_span_id: 'srcspan1:web:contradict#char:0-70' }),
      claim({ id: 'c6', claim: 'IndiaAI Mission runs public AI programs.', quote: 'IndiaAI Mission runs public AI programs.', source_item_id: 'web:official-gov', source_span_id: 'srcspan1:web:official-gov#char:200-240' }),
    ]), { now: new Date('2026-04-30T10:00:00.000Z') });

    const delta = compileTopicDailyDelta({ current: currentReduction, previous: previousReduction, now: new Date('2026-04-30T12:00:00.000Z') });

    expect(validateTopicDailyDeltaSurface(delta)).toEqual([]);
    expect(delta.material_new.map(s => s.summary)).toContain('IndiaAI Mission released a new dataset program.');
    expect(delta.changed.some(s => s.summary.includes('sandbox for startups'))).toBe(true);
    expect(delta.repeated.some(s => s.summary === 'IndiaAI Mission runs public AI programs.')).toBe(true);
    expect(delta.stale.some(s => s.summary === 'The GPU tender window closed.')).toBe(true);
    expect(delta.contradicted.some(s => s.summary.includes('did not announce'))).toBe(true);
    expect(delta.trusted_personal_memory_mutated).toBe(false);
  });

  test('unknowns and next-work generator flags missing official source and contradiction verification', () => {
    const reduction = reduceTopicClaimsFromExtraction(report([
      claim({ id: 'c1', claim: 'IndiaAI Mission announced a sovereign AI compute update.', quote: 'IndiaAI Mission announced a sovereign AI compute update.', source_item_id: 'web:blog' }),
      claim({ id: 'c2', claim: 'IndiaAI Mission did not announce a sovereign AI compute update.', quote: 'IndiaAI Mission did not announce a sovereign AI compute update.', source_item_id: 'web:news', source_span_id: 'srcspan1:web:news#char:0-70' }),
    ]));
    const { open_unknowns, next_work } = generateTopicUnknownsAndNextWork({ topic_id: 'world-sovereign-ai-india', claims: reduction.claims });

    expect(open_unknowns.map(u => u.kind)).toContain('missing_official_source');
    expect(open_unknowns.map(u => u.kind)).toContain('contradiction_needs_verification');
    expect(next_work.map(w => w.kind)).toContain('find_official_source');
    expect(next_work.map(w => w.kind)).toContain('resolve_contradiction');
  });

  test('CLI stores state and delta as ops/intelligence artifacts without trusted memory mutation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-topic-state-delta-'));
    const reductionPath = join(dir, 'claim-reduction.json');
    const stateOutPath = join(dir, 'state.json');
    const deltaOutPath = join(dir, 'delta.json');
    const stateArtifactPath = join(dir, 'ops', 'intelligence', 'topic-current-states.jsonl');
    const deltaArtifactPath = join(dir, 'ops', 'intelligence', 'topic-daily-deltas.jsonl');
    const trustedMemoryPath = join(dir, 'MEMORY.md');
    const reduction = reduceTopicClaimsFromExtraction(report([claim({ id: 'c1', claim: 'IndiaAI Mission announced a sovereign AI compute update.', quote: 'IndiaAI Mission announced a sovereign AI compute update.', source_item_id: 'web:official-gov' })]));
    writeFileSync(reductionPath, JSON.stringify(reduction), 'utf8');
    writeFileSync(trustedMemoryPath, 'trusted\n', 'utf8');

    const stateStdout = await captureStdout(() => runTopicsCommand(null, ['state', '--topic', 'world-sovereign-ai-india', '--from-reduction', reductionPath, '--artifact-store', stateArtifactPath, '--out', stateOutPath, '--json']));
    const stateParsed = JSON.parse(stateStdout);
    expect(stateParsed.ok).toBe(true);
    expect(stateParsed.surface.schema).toBe('gbrain.topics.topic_current_state.v1');
    expect(existsSync(stateOutPath)).toBe(true);
    expect(JSON.parse(readFileSync(stateArtifactPath, 'utf8').trim()).record_type).toBe('topic_current_state');

    const deltaStdout = await captureStdout(() => runTopicsCommand(null, ['delta', '--topic', 'world-sovereign-ai-india', '--from-current', stateOutPath, '--from-previous', reductionPath, '--artifact-store', deltaArtifactPath, '--out', deltaOutPath, '--json']));
    const deltaParsed = JSON.parse(deltaStdout);
    expect(deltaParsed.ok).toBe(true);
    expect(deltaParsed.surface.schema).toBe('gbrain.topics.topic_daily_delta.v1');
    expect(existsSync(deltaOutPath)).toBe(true);
    expect(JSON.parse(readFileSync(deltaArtifactPath, 'utf8').trim()).record_type).toBe('topic_daily_delta');
    expect(readFileSync(trustedMemoryPath, 'utf8')).toBe('trusted\n');
  });
});
