import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import { readOpsState } from '../src/core/ops/kernel.ts';
import { readBookmarkBatchFile, runBookmarkActionRadar } from '../src/core/ops/bookmark-action-radar.ts';
import type { RawBookmarkItem } from '../src/tasks/bookmarks-agent-core.ts';

function tempDir(): string { return mkdtempSync(join(tmpdir(), 'gbrain-bookmark-radar-')); }
function tempStore(dir = tempDir()): string { return join(dir, 'ops.jsonl'); }

function bookmarks(): RawBookmarkItem[] {
  return [
    {
      url: 'https://www.meity.gov.in/indiaai-compute',
      title: 'IndiaAI compute procurement update',
      content: 'IndiaAI Mission update on sovereign AI on-premise compute procurement for builders.',
      hash: 'hash-sovereign-action',
      platform: 'web',
      capturedAt: '2026-04-30T07:00:00.000Z',
    },
    {
      url: 'https://x.com/i/bookmarks',
      title: 'Qwen benchmark thread',
      content: 'Qwen MLX benchmark and latency notes for local AI worker routing.',
      hash: 'hash-local-investigate',
      platform: 'x',
      capturedAt: '2026-04-30T07:01:00.000Z',
    },
    {
      url: 'https://shop.example.com/widget',
      title: 'Shopping widget',
      content: 'Shopping landing page for a travel gadget vendor.',
      hash: 'hash-shopping-archive',
      platform: 'web',
      capturedAt: '2026-04-30T07:02:00.000Z',
    },
    {
      url: 'https://example.com/random',
      title: 'Random vendor page',
      content: 'Completely unrelated vendor landing page.',
      hash: 'hash-ignore',
      platform: 'web',
      capturedAt: '2026-04-30T07:03:00.000Z',
    },
  ];
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

describe('Bookmark action radar v1', () => {
  test('processes bookmark batches into decisions, archive records, work items, and high-score surfaced candidates', () => {
    const dir = tempDir();
    const store = tempStore(dir);
    const archive = join(dir, 'bookmark-decisions.jsonl');

    const report = runBookmarkActionRadar({
      bookmarks: bookmarks(),
      storePath: store,
      archivePath: archive,
      now: new Date('2026-04-30T08:00:00.000Z'),
    });

    expect(report.schema).toBe('gbrain.ops.bookmark_action_radar.v1');
    expect(report.safety.review_only).toBe(true);
    expect(report.safety.external_action_taken).toBe(false);
    expect(report.safety.trusted_personal_memory_mutated).toBe(false);
    expect(report.input_count).toBe(4);
    expect(report.deduped_count).toBe(4);
    expect(report.decisions.map(d => d.decision)).toEqual(['interrupt', 'investigate', 'archive', 'ignore']);
    expect(report.archived_decisions.map(d => d.decision)).toEqual(['archive', 'ignore']);
    expect(report.surfaced_candidates.map(d => d.decision)).toEqual(['interrupt', 'investigate']);
    expect(report.surfaced_candidates.every(d => d.score >= report.thresholds.surface_min_score)).toBe(true);
    expect(report.created_work_items).toHaveLength(1);
    expect(report.created_work_items[0]?.privacy_tier).toBe('P1_PRIVATE');
    expect(report.created_work_items[0]?.worker_kind).toBe('qwen_local');

    expect(existsSync(archive)).toBe(true);
    const archived = readFileSync(archive, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(archived).toHaveLength(2);
    expect(archived.every(d => typeof d.reason === 'string' && d.reason.length > 10)).toBe(true);

    const state = readOpsState(store);
    expect(state.work_items).toHaveLength(1);
    expect(state.work_items[0]?.source_refs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'bookmark', hash: 'hash-local-investigate' })]));
  });

  test('ops CLI runs bookmark radar from JSON batch', async () => {
    const dir = tempDir();
    const store = tempStore(dir);
    const input = join(dir, 'bookmarks.json');
    writeFileSync(input, JSON.stringify(bookmarks(), null, 2));

    const output = JSON.parse(await capture(() => runOpsCommand(null, ['bookmarks', 'radar', '--input', input, '--store', store, '--json'])));
    expect(output.created_work_items).toHaveLength(1);
    expect(output.archived_decisions).toHaveLength(2);
    expect(output.surfaced_candidates.map((d: { decision: string }) => d.decision)).toEqual(['interrupt', 'investigate']);
  });

  test('reads browser bookmark markdown batches through the existing parser', () => {
    const dir = tempDir();
    const input = join(dir, 'bookmarks.md');
    writeFileSync(input, `# bookmarks\n\n## Body\n\n{"schema":"browser_transcript_message_v1","captured_at":"2026-04-30T07:00:00.000Z","platform":"x","url":"https://x.com/i/bookmarks","title":"X","content":"India AI Mission update on sovereign AI deployment.","hash":"hash-md"}\n`);

    const items = readBookmarkBatchFile(input);
    expect(items).toHaveLength(1);
    expect(items[0]?.hash).toBe('hash-md');
  });
});
