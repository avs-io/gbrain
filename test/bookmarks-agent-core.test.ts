import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifyBookmarkItem,
  dedupeRawBookmarks,
  dedupeStructuredSignals,
  extractEmbeddedJsonObjects,
  extractMarkdownBody,
  parseBookmarkMarkdown,
} from '../src/tasks/bookmarks-agent-core.ts';

const FIXTURES = join(import.meta.dir, 'fixtures/bookmarks');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

describe('bookmarks-agent-core', () => {
  test('extractMarkdownBody isolates the Body section', () => {
    const body = extractMarkdownBody(fixture('relevant-bookmarks.md'));
    expect(body).toContain('hash-relevant-1');
    expect(body).not.toContain('## Metadata');
  });

  test('extractEmbeddedJsonObjects parses concatenated JSON objects', () => {
    const body = extractMarkdownBody(fixture('relevant-bookmarks.md'));
    const objects = extractEmbeddedJsonObjects(body);
    expect(objects).toHaveLength(2);
  });

  test('parseBookmarkMarkdown normalizes relevant and irrelevant bookmark items', () => {
    const items = parseBookmarkMarkdown(fixture('relevant-bookmarks.md'));
    expect(items).toEqual([
      {
        url: 'https://x.com/i/bookmarks',
        title: '(16) X',
        content: 'India AI Mission update on sovereign AI deployment.',
        hash: 'hash-relevant-1',
        platform: 'x',
        capturedAt: '2026-04-27T10:00:00.000Z',
      },
      {
        url: 'https://www.linkedin.com/feed/',
        title: 'LinkedIn',
        content: 'Completely unrelated vendor landing page.',
        hash: 'hash-irrelevant-1',
        platform: 'linkedin',
        capturedAt: '2026-04-27T10:01:00.000Z',
      },
    ]);
  });

  test('parseBookmarkMarkdown ignores non-bookmark JSON objects and dedupes duplicates when requested', () => {
    const items = parseBookmarkMarkdown(fixture('duplicates-bookmarks.md'));
    expect(items).toHaveLength(2);
    expect(dedupeRawBookmarks(items)).toEqual([
      {
        url: 'https://x.com/i/bookmarks',
        title: '(16) X',
        content: 'Qwen 3.6 27B benchmark notes.',
        hash: 'hash-duplicate-1',
        platform: 'x',
        capturedAt: '2026-04-27T11:00:00.000Z',
      },
    ]);
  });

  test('classifyBookmarkItem marks sovereign AI items as critical actionable signals', () => {
    const [item] = parseBookmarkMarkdown(fixture('relevant-bookmarks.md'));
    const signal = classifyBookmarkItem(item!);

    expect(signal.type).toBe('critical');
    expect(signal.domain).toBe('sovereign-ai');
    expect(signal.intent).toBe('actionable');
    expect(signal.confidence).toBe('high');
    expect(signal.dedupeKey).toContain('sovereign-ai::actionable');
  });

  test('classifyBookmarkItem ignores irrelevant items with a stable low-confidence taxonomy', () => {
    const [, item] = parseBookmarkMarkdown(fixture('relevant-bookmarks.md'));
    const signal = classifyBookmarkItem(item!);

    expect(signal.type).toBe('background');
    expect(signal.domain).toBe('other');
    expect(signal.intent).toBe('ignore');
    expect(signal.confidence).toBe('low');
  });

  test('dedupeStructuredSignals suppresses duplicate classified bookmark signals', () => {
    const items = dedupeRawBookmarks(parseBookmarkMarkdown(fixture('duplicates-bookmarks.md')));
    const duplicateSourceItems = [items[0]!, { ...items[0]!, capturedAt: '2026-04-27T11:00:30.000Z' }];
    const signals = duplicateSourceItems.map(classifyBookmarkItem);

    expect(dedupeStructuredSignals(signals)).toHaveLength(1);
    expect(signals[0]?.domain).toBe('local-llm');
  });
});
