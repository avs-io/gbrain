import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runTopicsCommand } from '../src/commands/topics.ts';
import { compileTopicAnswerPack, validateTopicAnswerPack } from '../src/core/topics/answer-pack.ts';
import type { SourceItemRecord, SourceSpanRecord } from '../src/core/evidence/source-bridge.ts';
import type { TopicClaimCandidate, TopicCandidateExtractionReport } from '../src/core/topics/extractor.ts';
import { reduceTopicClaimsFromExtraction } from '../src/core/topics/claim-reducer.ts';
import { compileTopicCurrentState } from '../src/core/topics/state-delta.ts';

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

function sourceItem(overrides: Partial<SourceItemRecord> = {}): SourceItemRecord {
  return { id: 'web:official', kind: 'web_document', namespace: 'world', privacy: 'P3_PUBLIC', authority: 'raw_source', title: 'Official AI Mission', url: 'https://example.test/ai', metadata: { domain: 'sovereign-ai' }, ...overrides };
}

function sourceSpan(item: SourceItemRecord, quote = 'IndiaAI Mission announced a sovereign AI compute update.'): SourceSpanRecord {
  return { ref: `srcspan1:${item.id}#char:0-${quote.length}`, ref_kind: 'srcspan1', source_item_id: item.id, namespace: item.namespace, privacy: item.privacy, authority: 'source_span', start_char: 0, end_char: quote.length, quote, quote_hash: 'hash', line_basis: 'external_char_range', metadata: { domain: item.metadata?.domain } };
}

function claim(overrides: Partial<TopicClaimCandidate> & { claim: string; quote?: string; item?: SourceItemRecord; span?: SourceSpanRecord }): TopicClaimCandidate {
  const item = overrides.item || sourceItem();
  const span = overrides.span || sourceSpan(item, overrides.quote || overrides.claim);
  return {
    schema: 'gbrain.topic_candidate.claim.v1',
    kind: 'topic_claim',
    id: overrides.id || 'cand-1',
    topic_id: 'world-sovereign-ai-india',
    status: 'review_only',
    support_status: overrides.support_status || 'supported',
    confidence: overrides.confidence ?? 0.84,
    observed_at: '2026-04-30T10:00:00.000Z',
    source_span_ids: overrides.source_span_ids || [span.ref],
    evidence_refs: overrides.evidence_refs || [{ source_span_id: span.ref, source_item_id: item.id, quote: span.quote || overrides.claim, quote_hash: 'hash', authority_tier: 'primary' } as any],
    claim_type: 'world_claim',
    metadata: { domain: 'sovereign-ai' },
    ...overrides,
  } as TopicClaimCandidate;
}

function extraction(claims: TopicClaimCandidate[]): TopicCandidateExtractionReport {
  return {
    schema: 'gbrain.topics.candidate_extraction_report.v1',
    mode: 'review-only',
    trusted_world_truth: false,
    trusted_personal_memory_mutated: false,
    topic_id: 'world-sovereign-ai-india',
    generated_at: '2026-04-30T10:00:00.000Z',
    source: { kind: 'source_spans' },
    diagnostics: { source_items_seen: 1, source_spans_seen: claims.length, topic_claims_extracted: claims.length, topic_entities_extracted: 0, topic_events_extracted: 0, topic_problem_signals_extracted: 0, unsupported_candidates: 0, rejected_candidates: 0, warnings: [] },
    topic_claims: claims,
    topic_entities: [],
    topic_events: [],
    topic_problem_signals: [],
  };
}

describe('TopicTrack domain-scoped answer-pack compiler', () => {
  test('compiles a clean P3/world domain answer pack with constrained context and citations', () => {
    const item = sourceItem();
    const span = sourceSpan(item);
    const reduction = reduceTopicClaimsFromExtraction(extraction([claim({ id: 'c1', claim: span.quote!, item, span })]));
    const state = compileTopicCurrentState({ topic_id: 'world-sovereign-ai-india', reduction });
    const pack = compileTopicAnswerPack({ topic_id: 'world-sovereign-ai-india', domain: 'sovereign-ai', state, reduction, source_items: [item], source_spans: [span], now: new Date('2026-04-30T12:00:00.000Z') });

    expect(validateTopicAnswerPack(pack)).toEqual([]);
    expect(pack.schema).toBe('gbrain.topics.answer_pack.v1');
    expect(pack.readiness.status).toBe('answerable');
    expect(pack.readiness.supported_claims).toBe(1);
    expect(pack.answer_context.allowed_claims[0].citations[0].source_span_id).toBe(span.ref);
    expect(pack.answer_context.boundaries).toContain('topic_id=world-sovereign-ai-india');
    expect(pack.answer_context.boundaries).toContain('domain=sovereign-ai');
    expect(pack.trusted_personal_memory_mutated).toBe(false);
  });

  test('rejects/excludes mismatched topic and domain contamination', () => {
    const item = sourceItem();
    const span = sourceSpan(item);
    const other = claim({ id: 'wrong-domain', claim: 'Noise Labs launched a creator tool.', item, span, topic_id: 'world-noise' } as any);
    (other as any).metadata = { domain: 'creator-tools' };
    const pack = compileTopicAnswerPack({ topic_id: 'world-sovereign-ai-india', domain: 'sovereign-ai', reduction: { ...reduceTopicClaimsFromExtraction(extraction([claim({ id: 'c1', claim: span.quote!, item, span })])), claims: [other as any] }, source_items: [item], source_spans: [span] });

    expect(pack.readiness.status).toBe('unanswerable');
    expect(pack.answer_context.allowed_claims).toHaveLength(0);
    expect(pack.unsupported_claims[0].reason).toContain('claim topic_id world-noise does not match');
    expect(pack.excluded_sources[0].kind).toBe('claim');
  });

  test('flags unsupported claims without evidence refs and withholds them from answer context', () => {
    const unsupported = { schema: 'gbrain.topics.reduced_claim.v1', id: 'r-unsupported', topic_id: 'world-sovereign-ai-india', claim: 'Uncited sovereign AI claim.', normalized_claim: 'uncited sovereign ai claim', status: 'supported', support_level: 'direct_quote', support_status: 'supported', support_score: 0.8, authority_score: 0.8, source_diversity: 1, source_item_ids: [], source_span_ids: [], evidence_refs: [], candidate_ids: [], observed_at: '2026-04-30T10:00:00.000Z', reduced_at: '2026-04-30T10:00:00.000Z' } as any;
    const pack = compileTopicAnswerPack({ topic_id: 'world-sovereign-ai-india', domain: 'sovereign-ai', reduction: { schema: 'gbrain.topics.claim_reduction_report.v1', mode: 'review-only', trusted_world_truth: false, trusted_personal_memory_mutated: false, topic_id: 'world-sovereign-ai-india', reduced_at: '2026-04-30T10:00:00.000Z', diagnostics: {} as any, claims: [unsupported] } });

    expect(pack.readiness.unanswerable).toBe(true);
    expect(pack.readiness.citation_coverage).toBe(0);
    expect(pack.unsupported_claims[0].reason).toContain('lacks evidence_refs');
    expect(pack.answer_context.allowed_claims).toHaveLength(0);
  });

  test('fails closed on private or non-public source inputs for P3/world answer requests', () => {
    const item = sourceItem({ id: 'page:private', kind: 'gbrain_page', namespace: 'personal', privacy: 'P1_PRIVATE', metadata: { domain: 'sovereign-ai' } });
    const span = sourceSpan(item, 'Private note says IndiaAI Mission announced a sovereign AI compute update.');
    const reduction = reduceTopicClaimsFromExtraction(extraction([claim({ id: 'private-c', claim: span.quote!, item, span })]));
    const pack = compileTopicAnswerPack({ topic_id: 'world-sovereign-ai-india', domain: 'sovereign-ai', reduction, source_items: [item], source_spans: [span] });

    expect(pack.readiness.unanswerable).toBe(true);
    expect(pack.diagnostics.errors.some(e => e.includes('outside requested P3_PUBLIC/world'))).toBe(true);
    expect(pack.excluded_sources.map(s => s.id)).toContain(item.id);
    expect(pack.excluded_sources.map(s => s.id)).toContain(span.ref);
  });

  test('marks empty or non-source-backed state as unanswerable', () => {
    const pack = compileTopicAnswerPack({ topic_id: 'world-sovereign-ai-india', domain: 'sovereign-ai', state: { schema: 'gbrain.topics.topic_current_state.v1', mode: 'review-only', trusted_world_truth: false, trusted_personal_memory_mutated: false, topic_id: 'world-sovereign-ai-india', as_of: '2026-04-30T10:00:00.000Z', compiled_at: '2026-04-30T10:00:00.000Z', inputs: {}, confidence: { overall: 0, supported_fraction: 0, average_support_score: 0, average_authority_score: 0, source_diversity: 0 }, coverage: { claims_seen: 0, current_claims: 0, supported_claims: 0, contested_or_contradicted_claims: 0, stale_claims: 0, source_items: 0, source_spans: 0, entities: 0, events: 0, problem_signals: 0 }, current_claims: [], key_entities: [], key_events: [], problem_signals: [], open_unknowns: [], opportunity_implications: [], next_work: [] } });

    expect(pack.readiness.status).toBe('unanswerable');
    expect(pack.caveats.some(c => c.includes('no supported in-scope claims'))).toBe(true);
  });

  test('CLI writes review-only answer-pack artifact and preserves trusted memory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-topic-answer-pack-'));
    const item = sourceItem();
    const span = sourceSpan(item);
    const reduction = reduceTopicClaimsFromExtraction(extraction([claim({ id: 'c1', claim: span.quote!, item, span })]));
    const state = compileTopicCurrentState({ topic_id: 'world-sovereign-ai-india', reduction });
    const statePath = join(dir, 'state.json');
    const reductionPath = join(dir, 'reduction.json');
    const spansPath = join(dir, 'spans.json');
    const outPath = join(dir, 'answer-pack.json');
    const artifactPath = join(dir, 'ops', 'intelligence', 'topic-answer-packs.jsonl');
    const trustedMemoryPath = join(dir, 'MEMORY.md');
    writeFileSync(statePath, JSON.stringify(state), 'utf8');
    writeFileSync(reductionPath, JSON.stringify(reduction), 'utf8');
    writeFileSync(spansPath, JSON.stringify({ source_items: [item], source_spans: [span] }), 'utf8');
    writeFileSync(trustedMemoryPath, 'trusted\n', 'utf8');

    const stdout = await captureStdout(() => runTopicsCommand(null, ['answer-pack', '--topic', 'world-sovereign-ai-india', '--domain', 'sovereign-ai', '--from-state', statePath, '--from-reduction', reductionPath, '--from-source-spans', spansPath, '--artifact-store', artifactPath, '--out', outPath, '--json']));
    const parsed = JSON.parse(stdout);

    expect(parsed.ok).toBe(true);
    expect(parsed.pack.schema).toBe('gbrain.topics.answer_pack.v1');
    expect(existsSync(outPath)).toBe(true);
    expect(JSON.parse(readFileSync(artifactPath, 'utf8').trim()).record_type).toBe('topic_answer_pack');
    expect(readFileSync(trustedMemoryPath, 'utf8')).toBe('trusted\n');
  });
});
