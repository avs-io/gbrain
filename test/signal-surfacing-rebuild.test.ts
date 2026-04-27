import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifyBookmarkItem,
  dedupeRawBookmarks,
  dedupeStructuredSignals,
  type RawBookmarkItem,
} from '../src/tasks/bookmarks-agent-core.ts';

const FIXTURES = join(import.meta.dir, 'fixtures/signal-surfacing-rebuild');

type RawFixtureRecord = {
  schema: string;
  captured_at: string;
  platform: string;
  url: string;
  title: string;
  content: string;
  hash: string;
};

function loadFixture(name: string): RawFixtureRecord[] {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf-8')) as RawFixtureRecord[];
}

function toRawBookmarkItem(record: RawFixtureRecord): RawBookmarkItem {
  return {
    url: record.url,
    title: record.title,
    content: record.content,
    hash: record.hash,
    platform: record.platform,
    capturedAt: record.captured_at,
  };
}

describe('signal surfacing rebuild fixtures', () => {
  test('case 1: obvious keyword match is classified as critical sovereign AI', () => {
    const [record] = loadFixture('case-01-obvious-keyword-match.json');
    const signal = classifyBookmarkItem(toRawBookmarkItem(record!));

    expect(signal.type).toBe('critical');
    expect(signal.domain).toBe('sovereign-ai');
    expect(signal.intent).toBe('actionable');
    expect(signal.confidence).toBe('high');
    expect(signal.dedupeKey).toContain('sovereign-ai::actionable::case-01-hash');
  });

  test.skip('TODO: case 2 should classify semantic equivalents without keyword overlap', () => {
    const [record] = loadFixture('case-02-semantic-equivalent-without-keywords.json');
    const signal = classifyBookmarkItem(toRawBookmarkItem(record!));

    expect(signal.domain).toBe('sovereign-ai');
    expect(signal.confidence).toBe('medium');
  });

  test('case 3: keyword-heavy noise still trips the current local-LLM lane', () => {
    const [record] = loadFixture('case-03-irrelevant-keyword-heavy.json');
    const signal = classifyBookmarkItem(toRawBookmarkItem(record!));

    expect(signal.type).toBe('notable');
    expect(signal.domain).toBe('local-llm');
    expect(signal.intent).toBe('watch');
    expect(signal.confidence).toBe('high');
    expect(signal.dedupeKey).toContain('local-llm::watch::case-03-hash');
  });

  test('case 4: duplicate saves collapse to one raw item and one structured signal', () => {
    const rawItems = loadFixture('case-04-duplicate-save.json').map(toRawBookmarkItem);
    const dedupedRawItems = dedupeRawBookmarks(rawItems);
    const signals = dedupedRawItems.map(classifyBookmarkItem);

    expect(rawItems).toHaveLength(2);
    expect(dedupedRawItems).toHaveLength(1);
    expect(signals).toHaveLength(1);
    expect(dedupeStructuredSignals(signals)).toHaveLength(1);
    expect(signals[0]?.domain).toBe('local-llm');
  });

  test.skip('TODO: case 5 should merge updated items instead of forking clusters', () => {
    const rawItems = loadFixture('case-05-updated-item.json').map(toRawBookmarkItem);
    const signals = rawItems.map(classifyBookmarkItem);

    expect(signals).toHaveLength(1);
  });

  test('case 6: critical contact unlock stays on the critical sovereign AI lane', () => {
    const [record] = loadFixture('case-06-critical-contact-unlock.json');
    const signal = classifyBookmarkItem(toRawBookmarkItem(record!));

    expect(signal.type).toBe('critical');
    expect(signal.domain).toBe('sovereign-ai');
    expect(signal.intent).toBe('actionable');
    expect(signal.confidence).toBe('medium');
  });

  test('case 7: low-confidence ambiguity stays quiet', () => {
    const [record] = loadFixture('case-07-low-confidence-ambiguous.json');
    const signal = classifyBookmarkItem(toRawBookmarkItem(record!));

    expect(signal.type).toBe('background');
    expect(signal.domain).toBe('other');
    expect(signal.intent).toBe('ignore');
    expect(signal.confidence).toBe('low');
  });

  test('same input is deterministic across reruns', () => {
    const [record] = loadFixture('case-01-obvious-keyword-match.json');
    const item = toRawBookmarkItem(record!);

    expect(classifyBookmarkItem(item)).toEqual(classifyBookmarkItem(item));
  });
});
