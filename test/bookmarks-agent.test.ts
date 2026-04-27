import { describe, test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  dedupeSignals,
  extractSignals,
  loadSignalState,
  partitionSignalsBySeen,
  runBookmarksAgent,
  type Signal,
} from '../src/tasks/bookmarks-agent.ts';

describe('bookmarks-agent helpers', () => {
  test('extractSignals classifies sovereign AI as critical', () => {
    const signals = extractSignals('We should track sovereign AI and on-premise deployments.');
    expect(signals).toHaveLength(1);
    expect(signals[0]?.type).toBe('critical');
    expect(signals[0]?.relevance).toContain('Sovereign AI');
  });

  test('extractSignals can surface multiple keyword classes from one item', () => {
    const signals = extractSignals('India AI Mission updates mention Sarvam and MLX benchmarks for local AI.');
    expect(signals.map(signal => signal.type)).toEqual(['critical', 'notable']);
  });

  test('dedupeSignals suppresses identical duplicate signals', () => {
    const duplicate: Signal = {
      type: 'critical',
      source: 'bookmarks',
      content: 'Same source snippet',
      relevance: 'Sovereign AI / data infrastructure',
      timestamp: '2026-04-27T00:00:00.000Z',
    };

    expect(dedupeSignals([
      duplicate,
      { ...duplicate, timestamp: '2026-04-27T00:01:00.000Z' },
    ])).toEqual([duplicate]);
  });

  test('partitionSignalsBySeen suppresses persisted dedupe keys', () => {
    const known: Signal = {
      type: 'critical',
      source: 'bookmarks',
      content: 'Known sovereign AI item',
      relevance: 'sovereign-ai / actionable',
      timestamp: '2026-04-27T10:00:00.000Z',
      dedupeKey: 'sovereign-ai::actionable::known',
    };
    const fresh: Signal = {
      ...known,
      content: 'Fresh judicial AI item',
      relevance: 'judicial-ai / actionable',
      dedupeKey: 'judicial-ai::actionable::fresh',
    };

    expect(partitionSignalsBySeen([known, fresh], ['sovereign-ai::actionable::known'])).toEqual({
      fresh: [fresh],
      seen: [known],
    });
  });

  test('runBookmarksAgent is idempotent across reruns using persisted state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookmarks-agent-'));
    const bookmarkDir = join(root, 'bookmarks');
    const signalsDir = join(root, 'signals');
    const archiveDir = join(root, 'archive');
    const statePath = join(root, 'state', 'bookmarks-agent-state.json');

    mkdirSync(bookmarkDir, { recursive: true });
    mkdirSync(archiveDir, { recursive: true });

    writeFileSync(join(bookmarkDir, '2026-04-27-bookmarks.md'), `# bookmarks\n\n## Body\n\n{"schema":"browser_transcript_message_v1","captured_at":"2026-04-27T10:00:00.000Z","platform":"x","url":"https://x.com/i/bookmarks","title":"(16) X","content":"India AI Mission update on sovereign AI deployment.","hash":"hash-relevant-1"}\n`);

    const firstRun = await runBookmarksAgent({ bookmarkDir, signalsDir, archiveDir, statePath });
    expect(firstRun).toHaveLength(1);
    expect(firstRun[0]?.dedupeKey).toBe('sovereign-ai::actionable::hash-relevant-1');

    const secondRun = await runBookmarksAgent({ bookmarkDir, signalsDir, archiveDir, statePath });
    expect(secondRun).toEqual([]);

    const log = readFileSync(join(signalsDir, `signals-${new Date().toISOString().slice(0, 10)}.md`), 'utf-8');
    expect(log.match(/\[CRITICAL\]/g)?.length ?? 0).toBe(1);

    const state = loadSignalState(statePath);
    expect(state.seenDedupeKeys).toEqual(['sovereign-ai::actionable::hash-relevant-1']);
  });
});
