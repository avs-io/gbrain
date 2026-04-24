import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBrowserCaptureJsonl } from '../src/core/browser-capture.ts';

const FIXTURES = join(import.meta.dir, 'fixtures/browser-capture');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

describe('parseBrowserCaptureJsonl', () => {
  describe('session_start event', () => {
    test('extracts title, tags, and session metadata', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'session_start',
        session_id: 'sess-001',
        timestamp: '2026-04-24T10:00:00Z',
        url: 'https://example.com',
        title: 'My Research Session',
        tags: ['research', 'ai'],
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.title).toBe('My Research Session');
      expect(parsed.tags).toContain('research');
      expect(parsed.tags).toContain('ai');
      expect(parsed.frontmatter.session_id).toBe('sess-001');
      expect(parsed.frontmatter.source_url).toBe('https://example.com');
    });

    test('adds session start to timeline', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'session_start',
        session_id: 'sess-002',
        timestamp: '2026-04-24T10:00:00Z',
        url: 'https://example.com',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.timeline).toContain('Session started');
      expect(parsed.timeline).toContain('https://example.com');
    });

    test('uses explicit slug when provided', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'session_start',
        session_id: 'sess-003',
        slug: 'browser/my-custom-slug',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.slug).toBe('browser/my-custom-slug');
    });
  });

  describe('page_content event', () => {
    test('adds content to compiled_truth', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'page_content',
        session_id: 'sess-004',
        url: 'https://example.com/page',
        title: 'Example Page',
        content: 'This is the main page content.',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.compiled_truth).toContain('This is the main page content.');
    });

    test('includes page title as section heading', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'page_content',
        session_id: 'sess-004',
        url: 'https://example.com/page',
        title: 'Great Article',
        content: 'The article body.',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.compiled_truth).toContain('## Great Article');
    });

    test('adds visit to timeline', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'page_content',
        session_id: 'sess-004',
        timestamp: '2026-04-24T10:01:00Z',
        url: 'https://example.com/page',
        title: 'Test Page',
        content: 'Body.',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.timeline).toContain('Visited');
      expect(parsed.timeline).toContain('https://example.com/page');
    });

    test('infers title from first page_content if no session_start', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'page_content',
        session_id: 'sess-005',
        url: 'https://example.com',
        title: 'Inferred Title',
        content: 'Body.',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.title).toBe('Inferred Title');
    });
  });

  describe('text_selection event', () => {
    test('wraps selected text in blockquote', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'text_selection',
        session_id: 'sess-006',
        url: 'https://example.com',
        text: 'This is a highlighted quote.',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.compiled_truth).toContain('> This is a highlighted quote.');
    });

    test('includes source url in attribution', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'text_selection',
        session_id: 'sess-006',
        url: 'https://example.com/source',
        text: 'Quote text.',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.compiled_truth).toContain('https://example.com/source');
    });
  });

  describe('annotation event', () => {
    test('adds annotation as bold note', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'annotation',
        session_id: 'sess-007',
        text: 'Remember to follow up on this.',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.compiled_truth).toContain('**Note:** Remember to follow up on this.');
    });
  });

  describe('transcript event', () => {
    test('adds transcript text directly to compiled_truth', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'transcript',
        session_id: 'sess-008',
        text: 'Voice note: this concept is important.',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.compiled_truth).toContain('Voice note: this concept is important.');
    });
  });

  describe('navigation event', () => {
    test('adds navigation to timeline but not compiled_truth', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'navigation',
        session_id: 'sess-009',
        timestamp: '2026-04-24T10:05:00Z',
        url: 'https://example.com/next',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.timeline).toContain('Navigated to');
      expect(parsed.timeline).toContain('https://example.com/next');
      expect(parsed.compiled_truth).toBe('');
    });
  });

  describe('slug and title inference', () => {
    test('infers slug from file path', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'page_content',
        session_id: 'sess-010',
        content: 'Body.',
      });
      const parsed = parseBrowserCaptureJsonl(content, 'sessions/research-ai-agents.jsonl');
      expect(parsed.slug).toBe('sessions/research-ai-agents');
    });

    test('infers title from file path when no events provide one', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'navigation',
        session_id: 'sess-011',
        url: 'https://example.com',
      });
      const parsed = parseBrowserCaptureJsonl(content, 'sessions/my-research-session.jsonl');
      expect(parsed.title).toBe('My Research Session');
    });

    test('falls back to session_id in slug when no filePath', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'page_content',
        session_id: 'sess-xyz',
        content: 'Body.',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.slug).toContain('sess-xyz');
    });
  });

  describe('multi-event JSONL files', () => {
    test('parses the research-session fixture correctly', () => {
      const content = fixture('research-session.jsonl');
      const parsed = parseBrowserCaptureJsonl(content, 'browser-capture/research-session.jsonl');

      expect(parsed.title).toBe('AI Agents Research Session');
      expect(parsed.type).toBe('source');
      expect(parsed.tags).toEqual(expect.arrayContaining(['ai', 'agents', 'research']));
      expect(parsed.slug).toBe('browser-capture/research-session');
      expect(parsed.frontmatter.session_id).toBe('sess-abc123');

      // compiled_truth has content from page_content, text_selection, annotation, transcript
      expect(parsed.compiled_truth).toContain('What Are AI Agents?');
      expect(parsed.compiled_truth).toContain('AI agents combine language models');
      expect(parsed.compiled_truth).toContain('> AI agents combine language models');
      expect(parsed.compiled_truth).toContain('**Note:** This is the key definition');
      expect(parsed.compiled_truth).toContain('Voice note: I think CrewAI');

      // timeline has session_start + page visits + navigation
      expect(parsed.timeline).toContain('Session started');
      expect(parsed.timeline).toContain('Visited');
      expect(parsed.timeline).toContain('Navigated to');
    });

    test('parses the minimal fixture correctly', () => {
      const content = fixture('minimal.jsonl');
      const parsed = parseBrowserCaptureJsonl(content, 'browser-capture/minimal.jsonl');
      expect(parsed.title).toBe('Minimal Capture');
      expect(parsed.compiled_truth).toContain('Just one page captured.');
      expect(parsed.slug).toBe('browser-capture/minimal');
    });
  });

  describe('resilience', () => {
    test('skips malformed JSON lines without throwing', () => {
      const content = [
        '{"version":"browser_capture_event_v1","event_type":"page_content","content":"Good line."}',
        'not valid json {{{',
        '{"version":"browser_capture_event_v1","event_type":"annotation","text":"Also good."}',
      ].join('\n');
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.compiled_truth).toContain('Good line.');
      expect(parsed.compiled_truth).toContain('Also good.');
    });

    test('skips lines missing event_type', () => {
      const content = [
        '{"version":"browser_capture_event_v1","content":"no type field"}',
        '{"version":"browser_capture_event_v1","event_type":"annotation","text":"Has type."}',
      ].join('\n');
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.compiled_truth).toContain('Has type.');
    });

    test('handles unknown event types gracefully', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'future_unknown_type',
        session_id: 'sess-unk',
        data: 'something new',
      });
      expect(() => parseBrowserCaptureJsonl(content)).not.toThrow();
    });

    test('handles empty file', () => {
      const parsed = parseBrowserCaptureJsonl('');
      expect(parsed.compiled_truth).toBe('');
      expect(parsed.timeline).toBe('');
      expect(parsed.type).toBe('source');
    });

    test('handles whitespace-only lines', () => {
      const content = '\n   \n\t\n';
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.compiled_truth).toBe('');
    });
  });

  describe('output shape', () => {
    test('always returns PageType source', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'page_content',
        content: 'body',
      });
      const parsed = parseBrowserCaptureJsonl(content);
      expect(parsed.type).toBe('source');
    });

    test('returns ParsedMarkdown-compatible shape', () => {
      const content = JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'page_content',
        title: 'Test',
        content: 'Test body.',
      });
      const parsed = parseBrowserCaptureJsonl(content, 'test.jsonl');
      // Verify all required fields of ParsedMarkdown are present
      expect(typeof parsed.slug).toBe('string');
      expect(typeof parsed.title).toBe('string');
      expect(typeof parsed.type).toBe('string');
      expect(typeof parsed.compiled_truth).toBe('string');
      expect(typeof parsed.timeline).toBe('string');
      expect(Array.isArray(parsed.tags)).toBe(true);
      expect(typeof parsed.frontmatter).toBe('object');
    });
  });
});

describe('isSyncable with .jsonl', () => {
  // Integration check: confirm the sync system accepts .jsonl paths
  test('isSyncable accepts .jsonl files', async () => {
    const { isSyncable } = await import('../src/core/sync.ts');
    expect(isSyncable('browser-capture/session-2026-04-24.jsonl')).toBe(true);
  });

  test('isSyncable still rejects hidden directories', async () => {
    const { isSyncable } = await import('../src/core/sync.ts');
    expect(isSyncable('.hidden/session.jsonl')).toBe(false);
  });

  test('isSyncable still accepts .md files', async () => {
    const { isSyncable } = await import('../src/core/sync.ts');
    expect(isSyncable('people/alice.md')).toBe(true);
  });
});
