import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runTopicsCommand } from '../src/commands/topics.ts';
import type { TopicCandidateExtractionReport, TopicClaimCandidate } from '../src/core/topics/extractor.ts';
import { reduceTopicClaimsFromExtraction, validateTopicClaimReductionReport } from '../src/core/topics/claim-reducer.ts';

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

function report(claims: TopicClaimCandidate[]): TopicCandidateExtractionReport {
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
      topic_entities_extracted: 0,
      topic_events_extracted: 0,
      topic_problem_signals_extracted: 0,
      unsupported_candidates: claims.filter(c => c.support_status === 'unsupported').length,
      rejected_candidates: 0,
      warnings: [],
    },
    topic_claims: claims,
    topic_entities: [],
    topic_events: [],
    topic_problem_signals: [],
  };
}

describe('TopicTrack claim reducer', () => {
  test('reduces directly quoted supported candidate claim to supported/direct_quote with scoring', () => {
    const reduced = reduceTopicClaimsFromExtraction(report([
      claim({ id: 'c1', claim: 'IndiaAI Mission announced a sovereign AI GPU procurement update.', quote: 'IndiaAI Mission announced a sovereign AI GPU procurement update.', source_item_id: 'web:official' }),
    ]), { now: new Date('2026-04-30T11:00:00.000Z') });

    expect(validateTopicClaimReductionReport(reduced)).toEqual([]);
    expect(reduced.trusted_personal_memory_mutated).toBe(false);
    expect(reduced.claims).toHaveLength(1);
    expect(reduced.claims[0]).toMatchObject({ status: 'supported', support_level: 'direct_quote', support_status: 'supported', source_diversity: 1 });
    expect(reduced.claims[0]!.authority_score).toBeGreaterThan(0);
  });

  test('keeps uncited or unsupported candidate claim draft/unsupported or rejected', () => {
    const reduced = reduceTopicClaimsFromExtraction(report([
      claim({ id: 'c1', claim: 'IndiaAI approved a private startup grant.', quote: 'The post is speculation with no evidence for a startup grant.', support_status: 'unsupported', unsupported_reason: 'speculative lure' }),
      claim({ id: 'c2', claim: 'Missing evidence claim.', support_status: 'unsupported', source_span_ids: [], evidence_refs: [], unsupported_reason: 'no evidence' }),
    ]));

    expect(validateTopicClaimReductionReport(reduced)).toEqual([]);
    expect(reduced.claims.map(c => c.status)).toEqual(['draft', 'rejected']);
    expect(reduced.claims.every(c => c.support_level === 'unsupported')).toBe(true);
  });

  test('dedupes duplicate claims from the same topic/source and merges evidence', () => {
    const reduced = reduceTopicClaimsFromExtraction(report([
      claim({ id: 'c1', claim: 'IndiaAI Mission announced a sovereign AI GPU procurement update.', quote: 'IndiaAI Mission announced a sovereign AI GPU procurement update.', source_item_id: 'web:official', source_span_id: 'srcspan1:web:official#char:0-63' }),
      claim({ id: 'c2', claim: 'IndiaAI Mission announced a sovereign AI GPU procurement update', quote: 'IndiaAI Mission announced a sovereign AI GPU procurement update in April.', source_item_id: 'web:official', source_span_id: 'srcspan1:web:official#char:64-132' }),
    ]));

    expect(reduced.claims).toHaveLength(1);
    expect(reduced.diagnostics.duplicate_merges).toBe(1);
    expect(reduced.claims[0]!.candidate_ids.sort()).toEqual(['c1', 'c2']);
    expect(reduced.claims[0]!.source_span_ids).toHaveLength(2);
  });

  test('marks contradicting evidence as contested rather than overwriting', () => {
    const reduced = reduceTopicClaimsFromExtraction(report([
      claim({ id: 'c1', claim: 'IndiaAI Mission announced a sovereign AI GPU procurement update.', quote: 'IndiaAI Mission announced a sovereign AI GPU procurement update.', source_item_id: 'web:official' }),
      claim({ id: 'c2', claim: 'IndiaAI Mission did not announce a sovereign AI GPU procurement update.', quote: 'IndiaAI Mission did not announce a sovereign AI GPU procurement update.', source_item_id: 'web:news', source_span_id: 'srcspan1:web:news#char:0-70' }),
    ]));

    expect(reduced.claims).toHaveLength(2);
    expect(reduced.claims.map(c => c.status).sort()).toEqual(['contested', 'contested']);
    expect(reduced.claims.every(c => c.contested_by?.length === 1)).toBe(true);
  });

  test('CLI stores review-only reducer artifact and does not mutate trusted memory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-topic-reduce-'));
    const inputPath = join(dir, 'topic-extraction.json');
    const outPath = join(dir, 'claim-reduction.json');
    const artifactPath = join(dir, 'ops', 'intelligence', 'topic-claim-reductions.jsonl');
    const trustedMemoryPath = join(dir, 'MEMORY.md');
    writeFileSync(inputPath, JSON.stringify(report([claim({ id: 'c1', claim: 'IndiaAI Mission announced a sovereign AI GPU procurement update.', quote: 'IndiaAI Mission announced a sovereign AI GPU procurement update.' })])), 'utf8');
    writeFileSync(trustedMemoryPath, 'trusted\n', 'utf8');

    const stdout = await captureStdout(() => runTopicsCommand(null, ['reduce-claims', '--topic', 'world-sovereign-ai-india', '--from-extraction', inputPath, '--artifact-store', artifactPath, '--out', outPath, '--json']));
    const parsed = JSON.parse(stdout);

    expect(parsed.ok).toBe(true);
    expect(parsed.report.schema).toBe('gbrain.topics.claim_reduction_report.v1');
    expect(parsed.report.trusted_personal_memory_mutated).toBe(false);
    expect(existsSync(outPath)).toBe(true);
    expect(existsSync(artifactPath)).toBe(true);
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8').trim());
    expect(artifact.record_type).toBe('topic_claim_reduction');
    expect(artifact.report.mode).toBe('review-only');
    expect(readFileSync(trustedMemoryPath, 'utf8')).toBe('trusted\n');
  });
});
