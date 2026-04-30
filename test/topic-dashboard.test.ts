import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runTopicsCommand } from '../src/commands/topics.ts';
import { compileTopicAnswerPack } from '../src/core/topics/answer-pack.ts';
import { compileTopicDashboard, validateTopicDashboard } from '../src/core/topics/dashboard.ts';
import { compileTopicCurrentState, compileTopicDailyDelta, type TopicCurrentStateSurface } from '../src/core/topics/state-delta.ts';
import { reduceTopicClaimsFromExtraction } from '../src/core/topics/claim-reducer.ts';
import type { TopicCandidateExtractionReport } from '../src/core/topics/extractor.ts';
import type { SourceItemRecord, SourceSpanRecord } from '../src/core/evidence/source-bridge.ts';
import type { OpportunityRadarV2Report } from '../src/core/ops/opportunity-radar-v2.ts';
import type { AuditUnreducedReport } from '../src/core/ops/report-reducer.ts';

async function capture(fn: () => Promise<void> | void): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

const topic = 'world-sovereign-ai-india';
const now = new Date('2026-04-30T12:00:00.000Z');

function item(id = 'official-ai'): SourceItemRecord {
  return { id, kind: 'web_document', namespace: 'world', privacy: 'P3_PUBLIC', authority: 'raw_source', title: 'Official AI update', url: 'https://example.test/ai', metadata: { domain: 'sovereign-ai' } };
}
function span(source = item(), quote = 'Official government source says IndiaAI opened a sovereign AI pilot deadline.'): SourceSpanRecord {
  return { ref: `srcspan1:${source.id}#char:0-${quote.length}`, ref_kind: 'srcspan1', source_item_id: source.id, namespace: 'world', privacy: 'P3_PUBLIC', authority: 'source_span', start_char: 0, end_char: quote.length, quote, quote_hash: 'h', line_basis: 'external_char_range', metadata: { domain: 'sovereign-ai' } };
}
function extraction(claims: any[]): TopicCandidateExtractionReport {
  return { schema: 'gbrain.topics.candidate_extraction_report.v1', mode: 'review-only', trusted_world_truth: false, trusted_personal_memory_mutated: false, topic_id: topic, generated_at: now.toISOString(), source: { kind: 'source_spans' }, diagnostics: { source_items_seen: 1, source_spans_seen: claims.length, topic_claims_extracted: claims.length, topic_entities_extracted: 1, topic_events_extracted: 1, topic_problem_signals_extracted: 1, unsupported_candidates: 0, rejected_candidates: 0, warnings: [] }, topic_claims: claims, topic_entities: [{ schema: 'gbrain.topic_candidate.entity.v1', kind: 'topic_entity', id: 'ent-1', topic_id: topic, status: 'review_only', support_status: 'supported', confidence: 0.8, observed_at: now.toISOString(), source_span_ids: ['srcspan1:a'], evidence_refs: [], entity_type: 'organization', name: 'IndiaAI Mission', metadata: {} } as any], topic_events: [{ schema: 'gbrain.topic_candidate.event.v1', kind: 'topic_event', id: 'ev-1', topic_id: topic, status: 'review_only', support_status: 'supported', confidence: 0.8, observed_at: now.toISOString(), source_span_ids: ['srcspan1:a'], evidence_refs: [], title: 'Pilot deadline opened', event_type: 'deadline', date: '2026-05-15', metadata: {} } as any], topic_problem_signals: [{ schema: 'gbrain.topic_candidate.problem_signal.v1', kind: 'topic_problem_signal', id: 'prob-1', topic_id: topic, status: 'review_only', support_status: 'supported', confidence: 0.8, observed_at: now.toISOString(), source_span_ids: ['srcspan1:a'], evidence_refs: [], signal: 'Procurement window needs evidence-backed local pilot', problem_type: 'procurement_gap', metadata: {} } as any] };
}
function claim(id: string, quote: string, overrides: Record<string, unknown> = {}) {
  const src = item(`official-${id}`); const sp = span(src, quote);
  return { schema: 'gbrain.topic_candidate.claim.v1', kind: 'topic_claim', id, topic_id: topic, status: 'review_only', support_status: 'supported', confidence: 0.84, observed_at: now.toISOString(), source_span_ids: [sp.ref], evidence_refs: [{ source_span_id: sp.ref, source_item_id: src.id, quote, quote_hash: 'h', authority_tier: 'primary' }], claim_type: 'world_claim', claim: quote, metadata: { domain: 'sovereign-ai' }, ...overrides };
}
function opportunityReport(): OpportunityRadarV2Report {
  return { schema: 'gbrain.ops.opportunity_radar.v2', ok: true, mode: 'review-only', generated_at: now.toISOString(), topic_id: topic, input_summary: { topic_current_state: 1, topic_daily_delta: 1, bookmark_deep_radar: 0, claim_reduction_report: 0, memory_context: 0 }, artifact_path: 'ops/intelligence/opps.jsonl', created_work_items: [], safety: { review_only: true, trusted_personal_memory_mutated: false, private_memory_read: false, memory_context_required_explicit_input: true, external_action_taken: false, ops_intelligence_only: true }, archived_candidates: [], candidates: [{ schema: 'gbrain.ops.opportunity_candidate.v2', id: 'opp-1', fingerprint: 'fp', generated_at: now.toISOString(), topic_id: topic, title: 'Prepare local-first sovereign AI pilot memo', summary: 'The deadline creates a wedge for a cited pilot memo.', candidate_class: 'draft_memo', lifecycle: 'new', fresh_signal: { id: 'sig-1', kind: 'topic_daily_delta', topic_id: topic, title: 'deadline', summary: 'deadline', observed_at: now.toISOString(), source_refs: [{ ref: 'srcspan1:a' }], tags: ['deadline'] }, old_memory_matches: [], scores: { relevance: 0.9, novelty: 0.7, urgency: 0.8, evidence_strength: 0.8, source_diversity: 0.6, strategic_fit: 0.9, actionability: 0.8, final: 0.82 }, why_now: 'official deadline is fresh', recommended_next_actions: ['Draft cited pilot memo'], work_items: [{ id: 'wi-opp', title: 'Draft cited pilot memo', rationale: 'why now', priority: 'P1', lane: 'opportunity_scoring', expected_artifacts: [], source_refs: [], approval_requirement: 'human_review_before_external_action' }], evidence: [{ ref: 'srcspan1:a', quote: 'deadline' }], approval_requirement: 'human_review_before_external_action', guardrails: { review_only: true, trusted_personal_memory_mutated: false, private_memory_read: false, memory_context_required_explicit_input: true, external_action_taken: false, ops_intelligence_only: true } }] };
}

describe('Topic dashboard', () => {
  test('aggregates state, delta, opportunities, readiness, bookmark/report health, and next actions', () => {
    const src = item('official-main'); const sp = span(src);
    const reduction = reduceTopicClaimsFromExtraction(extraction([claim('c1', sp.quote!, { source_span_ids: [sp.ref], evidence_refs: [{ source_span_id: sp.ref, source_item_id: src.id, quote: sp.quote!, quote_hash: 'h', authority_tier: 'primary' }] })]));
    const state = compileTopicCurrentState({ topic_id: topic, reduction, extraction: extraction([]), now });
    const delta = compileTopicDailyDelta({ topic_id: topic, current: state, now });
    const answerPack = compileTopicAnswerPack({ topic_id: topic, domain: 'sovereign-ai', state, reduction, source_items: [src], source_spans: [sp], now });
    const dashboard = compileTopicDashboard({ topic_id: topic, state, delta, opportunities: opportunityReport(), answerPack, bookmarkRadar: { schema: 'gbrain.ops.bookmark_deep_radar.v1', ok: true, generated_at: now.toISOString(), input_count: 1, deduped_count: 1, decisions: [{ topic_links: [{ topic_id: topic }] } as any], source_items: [], source_spans: [sp], topic_extractions: [], archived_decisions: [], surfaced_candidates: [{} as any], created_work_items: [], artifact_path: 'bookmarks.jsonl', safety: { review_only: true, trusted_personal_memory_mutated: false, external_action_taken: false, live_fetch_performed: false, private_sources_fail_closed: true } }, now });

    expect(validateTopicDashboard(dashboard)).toEqual([]);
    expect(dashboard.schema).toBe('gbrain.topics.dashboard.v1');
    expect(dashboard.coverage.supported_claims).toBe(1);
    expect(dashboard.latest_material_deltas.new.length).toBeGreaterThan(0);
    expect(dashboard.top_opportunities[0].score).toBe(0.82);
    expect(dashboard.answer_readiness.answerable).toBe(true);
    expect(dashboard.bookmark_radar.surfaced_candidates).toBe(1);
    expect(dashboard.next_actions.some(a => a.title.includes('Draft cited pilot memo'))).toBe(true);
  });

  test('flags stale, contradicted, unreduced, low-readiness risks and produces next-action summary', () => {
    const staleClaim = claim('stale', 'Official source says the pilot deadline was May 2024.', { expires_at: '2025-01-01T00:00:00.000Z' });
    const contradicted = claim('contradicted', 'Official source says no sovereign AI pilot exists.', { status: 'review_only' });
    const reduction = reduceTopicClaimsFromExtraction(extraction([staleClaim, contradicted]));
    (reduction.claims[1] as any).status = 'contradicted';
    (reduction.claims[1] as any).contradicts = ['older-claim'];
    const state = compileTopicCurrentState({ topic_id: topic, reduction, now });
    const delta = compileTopicDailyDelta({ topic_id: topic, current: state, now });
    const badAnswer = compileTopicAnswerPack({ topic_id: topic, domain: 'sovereign-ai', reduction: { ...reduction, claims: [{ ...reduction.claims[0], evidence_refs: [] } as any] }, now });
    const audit: AuditUnreducedReport = { schema: 'gbrain.ops.unreduced_artifact_audit.v1', ok: true, audited_at: now.toISOString(), artifact_count: 2, covered_count: 1, unreduced_count: 1, unreduced_artifacts: [{ path: 'ops/reports/unreduced.md', absolute_path: '/tmp/unreduced.md', sha256: 'abc', reason: 'no record' }], covered_artifacts: [], reduction_store_path: 'reductions.jsonl', safety: { review_only: true, trusted_memory_mutated: false, trusted_personal_memory_mutated: false, external_action_taken: false, live_web_fetch_performed: false, ops_intelligence_only: true } };
    const dashboard = compileTopicDashboard({ topic_id: topic, state, delta, answerPack: badAnswer, reportAudit: audit, now });

    expect(dashboard.risks.map(r => r.kind)).toEqual(expect.arrayContaining(['stale_claim', 'contradicted_claim', 'unreduced_artifact', 'answer_not_ready']));
    expect(dashboard.status).toBe('needs_review');
    expect(dashboard.next_actions.some(a => a.source === 'report_audit')).toBe(true);
    expect(dashboard.next_actions.some(a => a.source === 'answer_pack')).toBe(true);
  });

  test('handles missing optional inputs gracefully', () => {
    const dashboard = compileTopicDashboard({ topic_id: topic, now });
    expect(validateTopicDashboard(dashboard)).toEqual([]);
    expect(dashboard.status).toBe('watch');
    expect(dashboard.inputs.state).toBe(false);
    expect(dashboard.answer_readiness.status).toBe('missing');
    expect(dashboard.diagnostics.missing_optional_inputs).toContain('state');
  });

  test('CLI writes review-only dashboard artifact and does not mutate trusted memory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-topic-dashboard-'));
    const trusted = join(dir, 'MEMORY.md');
    writeFileSync(trusted, 'trusted\n');
    const state: TopicCurrentStateSurface = { schema: 'gbrain.topics.topic_current_state.v1', mode: 'review-only', trusted_world_truth: false, trusted_personal_memory_mutated: false, topic_id: topic, as_of: now.toISOString(), compiled_at: now.toISOString(), inputs: {}, confidence: { overall: 0.7, supported_fraction: 1, average_support_score: 0.8, average_authority_score: 0.8, source_diversity: 2 }, coverage: { claims_seen: 1, current_claims: 1, supported_claims: 1, contested_or_contradicted_claims: 0, stale_claims: 0, source_items: 1, source_spans: 1, entities: 0, events: 0, problem_signals: 0 }, current_claims: [], key_entities: [], key_events: [], problem_signals: [], open_unknowns: [], opportunity_implications: [], next_work: [] };
    const statePath = join(dir, 'state.json');
    const outPath = join(dir, 'dashboard.json');
    const artifactPath = join(dir, 'ops', 'intelligence', 'topic-dashboards.jsonl');
    writeFileSync(statePath, JSON.stringify(state));

    const stdout = await capture(() => runTopicsCommand(null, ['dashboard', '--topic', topic, '--from-state', statePath, '--artifact-store', artifactPath, '--out', outPath, '--json']));
    const parsed = JSON.parse(stdout);

    expect(parsed.ok).toBe(true);
    expect(parsed.surface.schema).toBe('gbrain.topics.dashboard.v1');
    expect(parsed.surface.trusted_personal_memory_mutated).toBe(false);
    expect(existsSync(outPath)).toBe(true);
    expect(JSON.parse(readFileSync(artifactPath, 'utf8').trim()).record_type).toBe('topic_dashboard');
    expect(readFileSync(trusted, 'utf8')).toBe('trusted\n');
  });
});
