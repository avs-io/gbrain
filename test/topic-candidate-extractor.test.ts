import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runTopicsCommand } from '../src/commands/topics.ts';
import { BUILTIN_SCOUT_RECIPES } from '../src/core/scout/pipeline.ts';
import { runPublicScout } from '../src/core/scout/runner.ts';
import {
  extractTopicCandidatesFromScout,
  extractTopicCandidatesFromSourceSpans,
  validateTopicCandidateExtractionReport,
} from '../src/core/topics/extractor.ts';

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

function publicScout() {
  return runPublicScout({
    recipe: BUILTIN_SCOUT_RECIPES[0]!,
    now: new Date('2026-04-30T09:00:00.000Z'),
    sources: [
      {
        source_url: 'https://example.com/indiaai-gpu-procurement',
        source_title: 'IndiaAI GPU procurement update',
        published_at: '2026-04-30',
        claim: 'IndiaAI Mission announced a sovereign AI GPU procurement update.',
        excerpt: 'On 2026-04-30 IndiaAI Mission announced a sovereign AI GPU procurement update, but startups still face a compute shortage and capacity bottleneck.',
        content: 'Briefing. On 2026-04-30 IndiaAI Mission announced a sovereign AI GPU procurement update, but startups still face a compute shortage and capacity bottleneck. End.',
        entities: ['IndiaAI Mission'],
      },
    ],
  });
}

describe('TopicTrack v2 candidate extraction', () => {
  test('extracts schema-valid topic claims, entities, events, and problem signals from public scout spans', () => {
    const scout = publicScout();
    const report = extractTopicCandidatesFromScout(scout, { topic_id: 'world-sovereign-ai-india', now: new Date('2026-04-30T10:00:00.000Z') });

    expect(validateTopicCandidateExtractionReport(report)).toEqual([]);
    expect(report.schema).toBe('gbrain.topics.candidate_extraction_report.v1');
    expect(report.mode).toBe('review-only');
    expect(report.trusted_world_truth).toBe(false);
    expect(report.trusted_personal_memory_mutated).toBe(false);
    expect(report.topic_claims).toHaveLength(1);
    expect(report.topic_entities.length).toBeGreaterThan(0);
    expect(report.topic_events).toHaveLength(1);
    expect(report.topic_problem_signals).toHaveLength(1);

    for (const candidate of [...report.topic_claims, ...report.topic_entities, ...report.topic_events, ...report.topic_problem_signals]) {
      expect(candidate.topic_id).toBe('world-sovereign-ai-india');
      expect(candidate.source_span_ids).toContain(scout.source_spans[0]!.ref);
      expect(candidate.evidence_refs[0]!.source_span_id).toBe(scout.source_spans[0]!.ref);
      expect(candidate.evidence_refs[0]!.quote).toContain('IndiaAI Mission');
      expect(candidate.status).toBe('review_only');
    }
  });

  test('missing evidence is rejected before candidate construction', () => {
    const scout = publicScout();
    const span = { ...scout.source_spans[0]!, quote: undefined, quote_hash: undefined };
    const report = extractTopicCandidatesFromSourceSpans({ topic_id: 'world-sovereign-ai-india', source_items: scout.source_items, source_spans: [span] });

    expect(report.topic_claims).toEqual([]);
    expect(report.topic_entities).toEqual([]);
    expect(report.topic_events).toEqual([]);
    expect(report.topic_problem_signals).toEqual([]);
    expect(report.diagnostics.rejected_candidates).toBe(1);
    expect(validateTopicCandidateExtractionReport(report)).toEqual([]);
  });

  test('private or non-public input is rejected fail-closed', () => {
    const scout = publicScout();
    const privateSpan = { ...scout.source_spans[0]!, privacy: 'P1_PRIVATE' as const };
    expect(() => extractTopicCandidatesFromSourceSpans({ topic_id: 'world-sovereign-ai-india', source_items: scout.source_items, source_spans: [privateSpan] })).toThrow(/P3_PUBLIC source_spans/);

    const personalItem = { ...scout.source_items[0]!, namespace: 'personal' as const };
    expect(() => extractTopicCandidatesFromSourceSpans({ topic_id: 'world-sovereign-ai-india', source_items: [personalItem], source_spans: scout.source_spans })).toThrow(/world source_items/);
  });

  test('CLI writes only review-only ops intelligence artifacts and does not mutate trusted state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-topic-extract-'));
    const scout = publicScout();
    const inputPath = join(dir, 'scout-report.json');
    const outPath = join(dir, 'topic-extraction.json');
    const artifactPath = join(dir, 'ops', 'intelligence', 'topic-candidates.jsonl');
    const trustedMemoryPath = join(dir, 'MEMORY.md');
    writeFileSync(inputPath, JSON.stringify(scout), 'utf8');
    writeFileSync(trustedMemoryPath, 'trusted\n', 'utf8');

    const stdout = await captureStdout(() => runTopicsCommand(null, ['extract', '--topic', 'world-sovereign-ai-india', '--from-scout-report', inputPath, '--artifact-store', artifactPath, '--out', outPath, '--json']));
    const parsed = JSON.parse(stdout);

    expect(parsed.ok).toBe(true);
    expect(parsed.report.trusted_personal_memory_mutated).toBe(false);
    expect(existsSync(outPath)).toBe(true);
    expect(existsSync(artifactPath)).toBe(true);
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8').trim());
    expect(artifact.record_type).toBe('topic_candidate_extraction');
    expect(artifact.report.mode).toBe('review-only');
    expect(readFileSync(trustedMemoryPath, 'utf8')).toBe('trusted\n');
  });
});
