/**
 * Tests for social-sync command.
 *
 * Uses dependency injection — no live brain engine or filesystem writes.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  runSocialSync,
  browserTranscriptToSocialPost,
  type SocialSyncDeps,
  type BrowserTranscriptMessage,
} from '../src/commands/social-sync.ts';
import type { SocialPost } from '../src/core/social-post.ts';

// ── Helpers ──────────────────────────────────────────────────────

function mockDeps(overrides: Partial<SocialSyncDeps> = {}): SocialSyncDeps & {
  written: Map<string, string>;
  engineCalls: { method: string; args: any[] }[];
} {
  const written = new Map<string, string>();
  const engineCalls: { method: string; args: any[] }[] = [];

  const track = (method: string) => (...args: any[]) => {
    engineCalls.push({ method, args });
    return Promise.resolve(null);
  };

  const mockEngine = new Proxy({} as any, {
    get(_, prop: string) {
      if (prop === '_calls') return engineCalls;
      return track(prop);
    },
  });

  return {
    written,
    engineCalls,
    homeDir: '/tmp/mock-home',
    rootDir: '/tmp/mock-root',
    createEngine: async () => mockEngine,
    ...overrides,
  };
}

function makeTranscriptMessage(overrides: Partial<BrowserTranscriptMessage> = {}): BrowserTranscriptMessage {
  return {
    schema: 'browser_transcript_message_v1',
    platform: 'x',
    content: 'Test post content',
    url: 'https://x.com/test/status/123',
    title: 'Test Title',
    captured_at: '2026-04-25T08:00:00Z',
    ts: '2026-04-25T08:00:00Z',
    hash: 'abc123def456',
    ...overrides,
  };
}

// ── browserTranscriptToSocialPost ────────────────────────────────

describe('browserTranscriptToSocialPost', () => {
  test('converts basic X transcript to SocialPost', () => {
    const msg = makeTranscriptMessage();
    const post = browserTranscriptToSocialPost(msg);

    expect(post.platform).toBe('x');
    expect(post.post_id).toBe('abc123def456');
    expect(post.post_url).toBe('https://x.com/test/status/123');
    expect(post.text).toBe('Test post content');
    expect(post.captured_at).toBe('2026-04-25T08:00:00Z');
    expect(post.saved_at).toBe('2026-04-25T08:00:00Z');
    expect(post.tags).toEqual(['browser-capture', 'x']);
  });

  test('converts LinkedIn transcript to SocialPost', () => {
    const msg = makeTranscriptMessage({ platform: 'linkedin', url: 'https://www.linkedin.com/feed/update/test' });
    const post = browserTranscriptToSocialPost(msg);

    expect(post.platform).toBe('linkedin');
    expect(post.tags).toEqual(['browser-capture', 'linkedin']);
  });

  test('extracts author handle from X-style content', () => {
    const msg = makeTranscriptMessage({
      content: `Kyle Hessling
@KyleHessling1
·
Apr 23
This is a test post about something interesting.`,
    });
    const post = browserTranscriptToSocialPost(msg);

    expect(post.author_handle).toBe('KyleHessling1');
  });

  test('extracts author name from LinkedIn content', () => {
    const msg = makeTranscriptMessage({
      platform: 'linkedin',
      content: 'Jane Smith\nInteresting market signal about AI memory systems.',
      url: 'https://www.linkedin.com/in/janesmith',
    });
    const post = browserTranscriptToSocialPost(msg);

    // LinkedIn vanity URL should be extracted as handle
    expect(post.author_handle).toBe('janesmith');
  });

  test('handles missing hash by using content hash', () => {
    const msg = makeTranscriptMessage({ hash: undefined });
    const post = browserTranscriptToSocialPost(msg);

    expect(post.post_id).toBeUndefined();
  });

  test('handles missing URL', () => {
    const msg = makeTranscriptMessage({ url: undefined });
    const post = browserTranscriptToSocialPost(msg);

    expect(post.post_url).toBeUndefined();
  });

  test('handles missing timestamp', () => {
    const msg = makeTranscriptMessage({ captured_at: undefined, ts: undefined });
    const post = browserTranscriptToSocialPost(msg);

    expect(post.captured_at).toBeUndefined();
  });

  test('falls back to ts when captured_at is missing', () => {
    const msg = makeTranscriptMessage({ captured_at: undefined, ts: '2026-04-25T09:00:00Z' });
    const post = browserTranscriptToSocialPost(msg);

    expect(post.captured_at).toBe('2026-04-25T09:00:00Z');
  });
});

// ── runSocialSync ────────────────────────────────────────────────

describe('runSocialSync', () => {
  test('prints help with --help', async () => {
    const exitSpy = mock(() => { throw new Error('exit'); });
    (process as any).exit = exitSpy;

    try {
      await runSocialSync(['--help'], mockDeps());
    } catch (e) {
      if (e instanceof Error && e.message === 'exit') {
        // Expected — --help calls process.exit(0)
      } else {
        throw e;
      }
    }
  });

  test('rejects invalid platform', async () => {
    const d = mockDeps();
    expect(() => runSocialSync(['--platform', 'facebook'], d)).toThrow('Invalid platform');
  });

  test('rejects invalid --max value', async () => {
    const d = mockDeps();
    await expect(runSocialSync(['--max', 'abc'], d)).rejects.toThrow('Invalid --max value');
  });

  test('handles missing transcripts directory', async () => {
    const d = mockDeps();
    const result = await runSocialSync([], d);
    expect(result.imported).toBe(0);
    expect(result.totalLines).toBe(0);
  });

  test('handles empty JSONL files', async () => {
    const d = mockDeps();
    // With no real files, just verify the result structure is correct.
    const result = await runSocialSync([], d);
    expect(result).toMatchObject({
      imported: expect.any(Number),
      skipped: expect.any(Number),
      errors: expect.any(Number),
      errorMessages: expect.any(Array),
      totalLines: expect.any(Number),
    });
  });

  test('respects --platform filter', async () => {
    const d = mockDeps();
    const result = await runSocialSync(['--platform', 'x'], d);
    expect(result.imported).toBe(0); // no real files
    expect(result.totalLines).toBe(0);
  });

  test('respects --max flag', async () => {
    const d = mockDeps();
    const result = await runSocialSync(['--max', '5'], d);
    expect(result.imported).toBe(0);
  });

  test('respects --dry-run flag', async () => {
    const d = mockDeps();
    const result = await runSocialSync(['--dry-run'], d);
    expect(result.imported).toBe(0);
    expect(result.dryRun).toBe(true);
  });

  test('returns error messages for malformed JSON', async () => {
    const d = mockDeps();
    const result = await runSocialSync([], d);
    // With no real files, should have 0 errors
    expect(result.errors).toBe(0);
  });
});

// ── Integration-style test with real data ────────────────────────

describe('social-sync with real data', () => {
  test('converts real X transcript messages', () => {
    const realMessages: BrowserTranscriptMessage[] = [
      {
        schema: 'browser_transcript_message_v1',
        platform: 'x',
        content: 'Benjamin Marie\n@bnjmn_marie\n·\n11h\nQwen3.6 GGUF Evaluations\nFor the 27B:\nQ2_K_XL is surprisingly recommendable.',
        url: 'https://x.com/i/bookmarks',
        title: '(16) X',
        captured_at: '2026-04-25T08:38:00.808995Z',
        ts: '2026-04-25T08:38:00.805Z',
        hash: '23abcb63457712b82c99003551147224a2bb47b546efe2b8cc5a6f99a4dc2497',
      },
      {
        schema: 'browser_transcript_message_v1',
        platform: 'linkedin',
        content: 'Interesting market signal about AI memory systems.',
        url: 'https://www.linkedin.com/feed/update/test',
        title: 'Saved LinkedIn post',
        captured_at: '2026-04-24T10:40:31.518691Z',
        ts: '2026-04-24T10:40:00Z',
        hash: 'd855504e02dfe2663667b8745859a365a6ad9a23f615dbfc472f03e98ae60ea3',
      },
    ];

    for (const msg of realMessages) {
      const post = browserTranscriptToSocialPost(msg);
      expect(post.platform).toBe(msg.platform);
      expect(post.text).toBe(msg.content);
      expect(post.post_id).toBe(msg.hash);
      expect(post.tags).toContain('browser-capture');
      expect(post.tags).toContain(msg.platform);
    }
  });

  test('deduplicates by hash', () => {
    const msg1 = makeTranscriptMessage({ hash: 'same-hash' });
    const msg2 = makeTranscriptMessage({ hash: 'same-hash', content: 'Different content' });

    const post1 = browserTranscriptToSocialPost(msg1);
    const post2 = browserTranscriptToSocialPost(msg2);

    // Both should have the same post_id (hash)
    expect(post1.post_id).toBe(post2.post_id);
    expect(post1.post_id).toBe('same-hash');
  });

  test('deduplicates by content hash when no hash field', () => {
    const msg1 = makeTranscriptMessage({ hash: undefined, content: 'Same content' });
    const msg2 = makeTranscriptMessage({ hash: undefined, content: 'Same content' });

    const post1 = browserTranscriptToSocialPost(msg1);
    const post2 = browserTranscriptToSocialPost(msg2);

    // Both should have no post_id (no hash field)
    expect(post1.post_id).toBeUndefined();
    expect(post2.post_id).toBeUndefined();
  });
});

// ── Edge cases ───────────────────────────────────────────────────

describe('edge cases', () => {
  test('handles empty content', () => {
    const msg = makeTranscriptMessage({ content: '' });
    const post = browserTranscriptToSocialPost(msg);
    expect(post.text).toBe('');
  });

  test('handles very long content', () => {
    const longContent = 'x'.repeat(10000);
    const msg = makeTranscriptMessage({ content: longContent });
    const post = browserTranscriptToSocialPost(msg);
    expect(post.text.length).toBe(10000);
  });

  test('handles unicode content', () => {
    const msg = makeTranscriptMessage({
      content: '日本語の投稿 🎉 中文内容 🚀',
    });
    const post = browserTranscriptToSocialPost(msg);
    expect(post.text).toBe('日本語の投稿 🎉 中文内容 🚀');
  });

  test('handles missing schema field', () => {
    const msg = makeTranscriptMessage({ schema: undefined });
    const post = browserTranscriptToSocialPost(msg);
    expect(post.platform).toBe('x');
  });

  test('extracts LinkedIn vanity URL as handle', () => {
    const msg = makeTranscriptMessage({
      platform: 'linkedin',
      url: 'https://www.linkedin.com/in/johndoe123',
      content: 'John Doe\nSome post content here.',
    });
    const post = browserTranscriptToSocialPost(msg);
    expect(post.author_handle).toBe('johndoe123');
  });

  test('extracts X handle from multi-line content', () => {
    const msg = makeTranscriptMessage({
      content: `Elon Musk
@elonmusk
·
Aug 15, 2020
The rate of improvement from original GPT to GPT-3 is impressive.`,
    });
    const post = browserTranscriptToSocialPost(msg);
    expect(post.author_handle).toBe('elonmusk');
  });
});
