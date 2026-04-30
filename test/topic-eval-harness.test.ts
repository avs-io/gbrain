import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runTopicsCommand } from '../src/commands/topics.ts';
import { readTopicEvalSuite, readTopicEvalSuiteFromFixtureDir, runTopicEvalSuite, type TopicEvalSuite } from '../src/core/topics/eval.ts';
import type { SourceItemRecord, SourceSpanRecord } from '../src/core/evidence/source-bridge.ts';

async function capture(fn: () => Promise<void> | void): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

const topic = 'world-sovereign-ai-india';
const now = '2026-04-30T12:00:00.000Z';

function item(id: string, url: string): SourceItemRecord {
  return { id, kind: 'web_document', namespace: 'world', privacy: 'P3_PUBLIC', authority: 'raw_source', title: id, url, metadata: { domain: 'sovereign-ai' } };
}
function span(source: SourceItemRecord, quote: string, ix: number): SourceSpanRecord {
  return { ref: `srcspan1:${source.id}#char:${ix * 100}-${ix * 100 + quote.length}`, ref_kind: 'srcspan1', source_item_id: source.id, namespace: 'world', privacy: 'P3_PUBLIC', authority: 'source_span', start_char: ix * 100, end_char: ix * 100 + quote.length, quote, quote_hash: `h${ix}`, line_basis: 'external_char_range', metadata: { domain: 'sovereign-ai', published_at: now } };
}

function suite(): TopicEvalSuite {
  const official = item('official-indiaai', 'https://example.test/indiaai');
  const lab = item('public-lab', 'https://example.test/lab');
  const source_spans = [
    span(official, 'Official government source announced a sovereign AI pilot deadline for IndiaAI on 2026-05-15, creating a procurement opportunity for local-first compute partners.', 1),
    span(lab, 'Public lab report says GPU compute capacity is a bottleneck and agencies need a cited pilot memo before procurement can start.', 2),
  ];
  return {
    schema: 'gbrain.topics.eval_suite.v1',
    suite_id: 'ptif-fixture-green',
    topic_id: topic,
    domain: 'sovereign-ai',
    fixture: {
      now,
      source_items: [official, lab],
      source_spans,
      bookmarks: [{ platform: 'x', url: 'https://x.example/saved', title: 'Sovereign AI pilot memo', content: 'Investigate IndiaAI procurement opportunity', hash: 'bm-1', capturedAt: now, outbound_url: 'https://example.test/bookmark-article', outbound_title: 'IndiaAI pilot article', outbound_content: 'IndiaAI procurement pilot needs local compute. This is an opportunity to draft a cited memo and run a small tool experiment for agencies.', outbound_content_type: 'text/html', source_class: 'article', fetch_policy: 'crawl_allowed', robots_allowed: true, topic_ids: [topic] }],
      memory_context: { items: [{ id: 'mem-1', kind: 'open_loop', title: 'Parked sovereign AI pilot idea', text: 'Old opportunity to draft a sovereign AI procurement pilot memo with local compute partners and government agencies.', source_ref: 'memory:test:1', confidence: 0.8, tags: ['sovereign', 'pilot', 'compute', 'memo'] }] },
      report_texts: [{ filename: 'sovereign-ai-report.md', text: '# Evidence\nOfficial source reported a policy deadline and compute bottleneck for IndiaAI pilot procurement.\n\n# Opportunity\nWhy now: this creates a wedge for a pilot partnership and startup memo.\n\n# Action\nRecommended next step: draft the cited memo for review; do not send externally.' }],
    },
    cases: [
      { id: 'candidate-extraction', category: 'candidate_extraction', expect: { min: { topic_claims: 2, topic_entities: 1, topic_events: 1, topic_problem_signals: 1 }, equals: { trusted_personal_memory_mutated: false } } },
      { id: 'claim-reduction', category: 'claim_reduction', expect: { min: { reduced_claims: 2, supported_claims: 2 } } },
      { id: 'state-delta', category: 'topic_state_delta', expect: { min: { current_claims: 2, delta_new: 1 } } },
      { id: 'opportunity-radar', category: 'opportunity_radar_v2', expect: { min: { opportunities: 1 } } },
      { id: 'answer-pack', category: 'answer_pack_guard', expect: { equals: { answerable: true, answer_status: 'answerable' }, max: { excluded_sources: 0 } } },
      { id: 'bookmark-deep-radar', category: 'bookmark_deep_radar', expect: { min: { bookmark_decisions: 1, bookmark_source_spans: 1, bookmark_topic_extractions: 1 } } },
      { id: 'report-reducer-audit', category: 'report_reducer_audit', expect: { min: { report_reduced_records: 2 }, equals: { report_unreduced_artifacts: 0 } } },
      { id: 'topic-dashboard', category: 'topic_dashboard', expect: { min: { dashboard_top_opportunities: 1 }, equals: { dashboard_status: 'healthy' }, coverage_categories: ['candidate_extraction','claim_reduction','topic_state_delta','opportunity_radar_v2','answer_pack_guard','bookmark_deep_radar','report_reducer_audit','topic_dashboard'] } },
    ],
  };
}

describe('Topic eval harness', () => {
  test('passing suite covers PTIF surfaces and preserves trusted memory boundary', () => {
    const report = runTopicEvalSuite(suite(), { now: new Date(now) });
    expect(report.ok).toBe(true);
    expect(report.fail_count).toBe(0);
    expect(report.coverage_categories).toEqual(expect.arrayContaining(['candidate_extraction','claim_reduction','topic_state_delta','opportunity_radar_v2','answer_pack_guard','bookmark_deep_radar','report_reducer_audit','topic_dashboard']));
    expect(report.trusted_personal_memory_mutated).toBe(false);
    expect(report.cases.every(c => c.metrics.trusted_personal_memory_mutated === false)).toBe(true);
  });

  test('failing assertion reports deterministic case failure without throwing', () => {
    const s = suite();
    s.suite_id = 'ptif-fixture-red';
    s.cases = [{ id: 'too-many-claims-required', category: 'candidate_extraction', expect: { min: { topic_claims: 99 } } }];
    const report = runTopicEvalSuite(s, { now: new Date(now) });
    expect(report.ok).toBe(false);
    expect(report.fail_count).toBe(1);
    expect(report.failures[0].message).toContain('topic_claims expected >= 99');
    expect(report.trusted_personal_memory_mutated).toBe(false);
  });

  test('suite reader and CLI JSON output work with review-only artifact write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-topic-eval-cli-'));
    const suitePath = join(dir, 'suite.json');
    const outPath = join(dir, 'ops', 'intelligence', 'eval-report.json');
    writeFileSync(suitePath, JSON.stringify(suite(), null, 2));
    expect(readTopicEvalSuite(suitePath).suite_id).toBe('ptif-fixture-green');
    expect(readTopicEvalSuiteFromFixtureDir(dir).suite_id).toBe('ptif-fixture-green');

    const stdout = await capture(() => runTopicsCommand(null, ['eval', '--suite', suitePath, '--artifact-dir', join(dir, 'run'), '--out', outPath, '--json']));
    const parsed = JSON.parse(stdout);

    expect(parsed.schema).toBe('gbrain.topics.eval_report.v1');
    expect(parsed.ok).toBe(true);
    expect(parsed.suite_id).toBe('ptif-fixture-green');
    expect(parsed.trusted_personal_memory_mutated).toBe(false);
    expect(existsSync(outPath)).toBe(true);
    expect(JSON.parse(readFileSync(outPath, 'utf8')).safety.ops_intelligence_only).toBe(true);
  });
});
