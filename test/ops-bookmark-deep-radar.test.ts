import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import { readOpsState } from '../src/core/ops/kernel.ts';
import { decideOutboundFetch, readBookmarkDeepRadarInputFile, runBookmarkDeepRadar, type BookmarkDeepInput } from '../src/core/ops/bookmark-deep-radar.ts';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'gbrain-bookmark-deep-radar-')); }
function tempStore(dir = tempDir()): string { return join(dir, 'ops.jsonl'); }

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

function inputs(): BookmarkDeepInput[] {
  return [
    {
      url: 'https://x.com/saved/1',
      title: 'Sovereign AI procurement thread',
      content: 'Saved post says IndiaAI Mission sovereign AI compute procurement has a new official update.',
      hash: 'deep-high',
      platform: 'x',
      capturedAt: '2026-04-30T08:00:00.000Z',
      outbound_url: 'https://example.gov.in/indiaai-compute-update',
      outbound_title: 'IndiaAI compute capacity update',
      source_class: 'article',
      topic_ids: ['world-sovereign-ai-india'],
      outbound_content: '<html><title>IndiaAI compute update</title><body>IndiaAI Mission announced sovereign AI compute procurement for on-premise GPU capacity for Indian builders. The update creates a deadline and demand signal for infrastructure partners. MeitY said the procurement will expand public AI compute access.</body></html>',
    },
    {
      url: 'https://example.com/recipe',
      title: 'Weekend recipe',
      content: 'A cooking recipe and shopping list for a weekend dinner.',
      hash: 'deep-low',
      platform: 'web',
      capturedAt: '2026-04-30T08:01:00.000Z',
      outbound_url: 'https://example.com/recipe-full',
      outbound_content: 'This article is a simple recipe for dinner shopping and cooking. It has no mission relevance.',
    },
  ];
}

describe('Bookmark deep radar', () => {
  test('deep-reads fixture outbound content, emits source spans/topic extraction, and creates WorkItems for high-signal items', () => {
    const dir = tempDir();
    const store = tempStore(dir);
    const artifact = join(dir, 'bookmark-deep.jsonl');

    const report = runBookmarkDeepRadar({ bookmarks: inputs(), storePath: store, artifactPath: artifact, now: new Date('2026-04-30T09:00:00.000Z') });

    expect(report.schema).toBe('gbrain.ops.bookmark_deep_radar.v1');
    expect(report.safety.review_only).toBe(true);
    expect(report.safety.live_fetch_performed).toBe(false);
    expect(report.safety.trusted_personal_memory_mutated).toBe(false);
    expect(report.input_count).toBe(2);
    expect(report.source_items).toHaveLength(2);
    expect(report.source_spans.length).toBeGreaterThanOrEqual(2);
    expect(report.decisions[0]?.fetch).toMatchObject({ status: 'fetch_allowed', reason: 'fixture_provided' });
    expect(report.decisions[0]?.decision).toBe('investigate');
    expect(report.decisions[0]?.evidence_refs.length).toBeGreaterThan(0);
    expect(report.decisions[0]?.topic_links.map(t => t.topic_id)).toContain('world-sovereign-ai-india');
    expect(report.topic_extractions).toHaveLength(1);
    expect(report.topic_extractions[0]?.topic_claims.length).toBeGreaterThan(0);
    expect(report.created_work_items.length).toBeGreaterThanOrEqual(1);
    expect(report.created_work_items[0]?.source_refs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'bookmark_deep_radar' })]));

    expect(existsSync(artifact)).toBe(true);
    const archived = JSON.parse(readFileSync(artifact, 'utf8').trim()).report;
    expect(archived.safety.trusted_personal_memory_mutated).toBe(false);
    const state = readOpsState(store);
    expect(state.work_items.length).toBe(report.created_work_items.length);
  });

  test('low-signal deep-read item is archived with evidence and no WorkItem', () => {
    const dir = tempDir();
    const report = runBookmarkDeepRadar({ bookmarks: [inputs()[1]!], storePath: tempStore(dir), artifactPath: join(dir, 'a.jsonl'), now: new Date('2026-04-30T09:00:00.000Z') });
    expect(report.decisions).toHaveLength(1);
    expect(report.decisions[0]?.decision).toBe('archive');
    expect(report.archived_decisions).toHaveLength(1);
    expect(report.decisions[0]?.reason).toContain('Personal-interest');
    expect(report.decisions[0]?.evidence_refs.length).toBeGreaterThan(0);
    expect(report.created_work_items).toHaveLength(0);
  });

  test('private or non-public outbound URLs fail closed and do not create source spans', () => {
    const item: BookmarkDeepInput = { ...inputs()[0]!, outbound_url: 'http://127.0.0.1/admin', outbound_content: 'IndiaAI Mission announced sovereign AI compute procurement.' };
    const decision = decideOutboundFetch(item);
    expect(decision.status).toBe('fetch_skipped');
    expect(decision.reason).toBe('private');
    const report = runBookmarkDeepRadar({ bookmarks: [item], storePath: tempStore(), artifactPath: join(tempDir(), 'a.jsonl') });
    expect(report.decisions[0]?.fetch.reason).toBe('private');
    expect(report.source_items).toHaveLength(0);
    expect(report.source_spans).toHaveLength(0);
  });

  test('fixture PDF and GitHub-like content are parsed into source classes and spans', () => {
    const dir = tempDir();
    const pdfPath = join(dir, 'paper.txt');
    writeFileSync(pdfPath, 'Sovereign AI PDF paper: IndiaAI Mission procurement creates on-premise compute constraints and demand for GPU clusters. The paper describes policy risks and capacity bottlenecks.');
    const report = runBookmarkDeepRadar({ bookmarks: [
      { url: 'https://example.org/paper.pdf', title: 'Sovereign AI paper', content: 'PDF about sovereign AI policy risks.', hash: 'pdf', platform: 'web', capturedAt: '', outbound_url: 'https://example.org/paper.pdf', outbound_content_path: pdfPath, source_class: 'pdf', topic_ids: ['world-sovereign-ai-india'] },
      { url: 'https://github.com/acme/agent', title: 'OpenClaw agent repo', content: 'GitHub repo for OpenClaw GBrain orchestration.', hash: 'gh', platform: 'github', capturedAt: '', outbound_url: 'https://github.com/acme/agent', outbound_content: '# Agent Repo\nOpenClaw GBrain orchestration adds benchmark and routing support for local AI workers.', source_class: 'github', topic_ids: ['gbrain'] },
    ], storePath: tempStore(dir), artifactPath: join(dir, 'a.jsonl') });
    expect(report.source_items.map(i => i.metadata?.source_class)).toEqual(['pdf', 'github']);
    expect(report.source_spans.length).toBeGreaterThanOrEqual(2);
    expect(report.decisions.every(d => d.fetch.status === 'fetch_allowed')).toBe(true);
  });

  test('ops CLI runs deep-radar from JSON and keeps ops/intelligence separate from trusted memory', async () => {
    const dir = tempDir();
    const input = join(dir, 'bookmarks.json');
    const artifact = join(dir, 'ops', 'intelligence', 'bookmark-deep.jsonl');
    writeFileSync(input, JSON.stringify({ bookmarks: inputs() }, null, 2));

    const output = JSON.parse(await capture(() => runOpsCommand(null, ['bookmarks', 'deep-radar', '--input', input, '--store', tempStore(dir), '--artifact-store', artifact, '--json'])));
    expect(output.source_spans.length).toBeGreaterThan(0);
    expect(output.created_work_items.length).toBeGreaterThan(0);
    expect(output.artifact_path).toBe(artifact);
    expect(output.safety.trusted_personal_memory_mutated).toBe(false);
    expect(artifact).toContain(`${join('ops', 'intelligence')}`);
  });

  test('deep-radar reader preserves outbound fixture fields', () => {
    const dir = tempDir();
    const fixture = join(dir, 'article.txt');
    writeFileSync(fixture, 'IndiaAI Mission announced sovereign AI compute procurement for builders.');
    const input = join(dir, 'bookmarks.json');
    writeFileSync(input, JSON.stringify([{ url: 'https://x.com/saved/1', title: 'Saved', content: 'sovereign AI', hash: 'h', platform: 'x', captured_at: '2026-04-30T00:00:00.000Z', outbound_url: 'https://example.com/a', outbound_content_path: 'article.txt' }]));
    const items = readBookmarkDeepRadarInputFile(input);
    expect(items[0]?.outbound_url).toBe('https://example.com/a');
    expect(items[0]?.outbound_content).toContain('IndiaAI Mission');
  });
});
