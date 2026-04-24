import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { importFile, importFromContent } from '../src/core/import-file.ts';
import {
  detectJsonlSchema,
  dispatchJsonl,
  aggregateSocialPostsToMarkdown,
  type JsonlDispatchResult,
} from '../src/core/jsonl-dispatch.ts';
import type { BrainEngine } from '../src/core/engine.ts';
import type { SocialPost } from '../src/core/social-post.ts';

const TMP = join(import.meta.dir, '.tmp-jsonl-dispatch-test');

// ─── Mock engine (mirrors the pattern in import-file.test.ts) ─────────────────

function mockEngine(overrides: Partial<Record<string, any>> = {}): BrainEngine {
  const calls: { method: string; args: any[] }[] = [];
  const track = (method: string) => (...args: any[]) => {
    calls.push({ method, args });
    if (overrides[method]) return overrides[method](...args);
    return Promise.resolve(null);
  };

  const engine = new Proxy({} as any, {
    get(_, prop: string) {
      if (prop === '_calls') return calls;
      if (prop === 'getTags') return overrides.getTags || (() => Promise.resolve([]));
      if (prop === 'getPage') return overrides.getPage || (() => Promise.resolve(null));
      if (prop === 'transaction') return async (fn: (tx: BrainEngine) => Promise<any>) => fn(engine);
      return track(prop);
    },
  });
  return engine;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const browserJsonl = [
  JSON.stringify({
    version: 'browser_capture_event_v1',
    event_type: 'session_start',
    session_id: 'sess-abc',
    timestamp: '2026-04-24T10:00:00Z',
    url: 'https://example.com',
    title: 'Example Site',
  }),
  JSON.stringify({
    version: 'browser_capture_event_v1',
    event_type: 'page_content',
    session_id: 'sess-abc',
    url: 'https://example.com/page',
    content: 'Captured page content here.',
  }),
].join('\n');

const socialJsonlSingle = JSON.stringify({
  platform: 'x',
  post_id: '1234567890',
  text: 'Hello world from X',
  author_handle: '@testuser',
});

const socialJsonlMulti = [
  JSON.stringify({
    platform: 'x',
    post_id: '111',
    text: 'First tweet',
    author_handle: '@alice',
  }),
  JSON.stringify({
    platform: 'linkedin',
    post_id: '222',
    text: 'Second post on LinkedIn',
    author_name: 'Bob Smith',
  }),
].join('\n');

const mixedJsonl = [
  JSON.stringify({ event_type: 'page_content', content: 'browser content' }),
  JSON.stringify({ platform: 'x', text: 'social post' }),
].join('\n');

const unknownJsonl = [
  JSON.stringify({ foo: 'bar', baz: 42 }),
  JSON.stringify({ another: 'field' }),
].join('\n');

const emptyJsonl = '';

// ─── Schema Detection ─────────────────────────────────────────────────────────

describe('detectJsonlSchema', () => {
  test('detects browser capture by event_type', () => {
    const result = detectJsonlSchema(browserJsonl);
    expect(result.parser).toBe('browser');
  });

  test('detects social post by platform + text', () => {
    const result = detectJsonlSchema(socialJsonlSingle);
    expect(result.parser).toBe('social');
  });

  test('detects social post with multiple posts', () => {
    const result = detectJsonlSchema(socialJsonlMulti);
    expect(result.parser).toBe('social');
  });

  test('returns unknown for unrecognized schema', () => {
    const result = detectJsonlSchema(unknownJsonl);
    expect(result.parser).toBe('unknown');
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('event_type');
  });

  test('handles empty content', () => {
    const result = detectJsonlSchema(emptyJsonl);
    expect(result.parser).toBe('unknown');
  });

  test('skips malformed lines to find first valid JSON', () => {
    const jsonl = '{bad json}\n' + socialJsonlSingle;
    const result = detectJsonlSchema(jsonl);
    expect(result.parser).toBe('social');
  });

  test('first line determines dispatch (event_type first → browser)', () => {
    const jsonl = [
      JSON.stringify({ event_type: 'page_content', content: 'browser' }),
      JSON.stringify({ platform: 'x', text: 'social' }),
    ].join('\n');
    const result = detectJsonlSchema(jsonl);
    expect(result.parser).toBe('browser');
  });

  test('first line determines dispatch (platform+text first → social)', () => {
    const jsonl = [
      JSON.stringify({ platform: 'x', text: 'social' }),
      JSON.stringify({ event_type: 'page_content', content: 'browser' }),
    ].join('\n');
    const result = detectJsonlSchema(jsonl);
    expect(result.parser).toBe('social');
  });
});

// ─── Full Dispatch ────────────────────────────────────────────────────────────

describe('dispatchJsonl', () => {
  test('browser dispatch returns ParsedMarkdown', () => {
    const result = dispatchJsonl(browserJsonl, 'browser-capture/test.jsonl');
    expect(result.parser).toBe('browser');
    expect(result.parsed).toBeDefined();
    expect(result.parsed!.slug).toBe('browser-capture/test');
    expect(result.parsed!.compiled_truth).toContain('Captured page content');
  });

  test('social dispatch returns SocialPost array', () => {
    const result = dispatchJsonl(socialJsonlSingle);
    expect(result.parser).toBe('social');
    expect(result.socialPosts).toHaveLength(1);
    expect(result.socialPosts![0].platform).toBe('x');
    expect(result.socialPosts![0].text).toBe('Hello world from X');
  });

  test('social dispatch with multiple posts returns all', () => {
    const result = dispatchJsonl(socialJsonlMulti);
    expect(result.parser).toBe('social');
    expect(result.socialPosts).toHaveLength(2);
    expect(result.socialPosts![0].platform).toBe('x');
    expect(result.socialPosts![1].platform).toBe('linkedin');
  });

  test('unknown schema returns reason', () => {
    const result = dispatchJsonl(unknownJsonl);
    expect(result.parser).toBe('unknown');
    expect(result.reason).toBeDefined();
  });

  test('social dispatch collects parse errors', () => {
    const jsonl = [
      JSON.stringify({ platform: 'x', text: 'valid' }),
      JSON.stringify({ platform: 'x' }), // missing text
      JSON.stringify({ text: 'hi' }),    // missing platform
    ].join('\n');
    const result = dispatchJsonl(jsonl);
    expect(result.parser).toBe('social');
    expect(result.socialPosts).toHaveLength(1);
    expect(result.parseErrors).toHaveLength(2);
  });
});

// ─── Aggregation ──────────────────────────────────────────────────────────────

describe('aggregateSocialPostsToMarkdown', () => {
  test('single post produces valid ParsedMarkdown', () => {
    const posts: SocialPost[] = [{ platform: 'x', text: 'Hello' }];
    const result = aggregateSocialPostsToMarkdown(posts, 'social/test.jsonl');
    expect(result.slug).toBe('social/test');
    expect(result.type).toBe('source');
    expect(result.compiled_truth).toContain('Hello');
  });

  test('multiple posts are concatenated', () => {
    const posts: SocialPost[] = [
      { platform: 'x', post_id: '111', text: 'First' },
      { platform: 'linkedin', post_id: '222', text: 'Second' },
    ];
    const result = aggregateSocialPostsToMarkdown(posts, 'social/multi.jsonl');
    expect(result.compiled_truth).toContain('First');
    expect(result.compiled_truth).toContain('Second');
    expect(result.frontmatter.post_count).toBe(2);
  });

  test('empty posts returns minimal ParsedMarkdown', () => {
    const result = aggregateSocialPostsToMarkdown([], 'social/empty.jsonl');
    expect(result.slug).toBe('social/empty');
    expect(result.compiled_truth).toBe('');
    expect(result.title).toContain('empty');
  });

  test('tags include all platforms and "social"', () => {
    const posts: SocialPost[] = [
      { platform: 'x', text: 'hi', tags: ['tech'] },
      { platform: 'linkedin', text: 'bye', tags: ['business'] },
    ];
    const result = aggregateSocialPostsToMarkdown(posts, 'social/tags.jsonl');
    const tags = result.tags;
    expect(tags).toContain('social');
    expect(tags).toContain('x');
    expect(tags).toContain('linkedin');
    expect(tags).toContain('tech');
    expect(tags).toContain('business');
  });
});

// ─── Integration: importFromFile with JSONL ────────────────────────────────────

describe('importFromFile with JSONL dispatch', () => {
  beforeAll(() => {
    mkdirSync(TMP, { recursive: true });
  });

  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  test('browser JSONL still imports correctly', async () => {
    const filePath = join(TMP, 'session-2026-04-24.jsonl');
    writeFileSync(filePath, browserJsonl);

    const engine = mockEngine();
    const result = await importFile(engine, filePath, 'browser-capture/session-2026-04-24.jsonl', {
      noEmbed: true,
    });

    expect(result.status).toBe('imported');
    expect(result.slug).toBe('browser-capture/session-2026-04-24');
    expect(result.chunks).toBeGreaterThanOrEqual(1);
  });

  test('single social JSONL imports as one page', async () => {
    const filePath = join(TMP, 'social-single.jsonl');
    writeFileSync(filePath, socialJsonlSingle);

    const engine = mockEngine();
    const result = await importFile(engine, filePath, 'social/test-single.jsonl', {
      noEmbed: true,
    });

    expect(result.status).toBe('imported');
    expect(result.slug).toBe('social/test-single');
    expect(result.chunks).toBeGreaterThanOrEqual(1);
  });

  test('multi-post social JSONL aggregates into one page', async () => {
    const filePath = join(TMP, 'social-multi.jsonl');
    writeFileSync(filePath, socialJsonlMulti);

    const engine = mockEngine();
    const result = await importFile(engine, filePath, 'social/test-multi.jsonl', {
      noEmbed: true,
    });

    expect(result.status).toBe('imported');
    expect(result.slug).toBe('social/test-multi');
    // Should be one page, not two — aggregation preserves single-page semantics
    expect(result.chunks).toBeGreaterThanOrEqual(1);
  });

  test('social JSONL frontmatter safely round-trips YAML-special strings', async () => {
    const filePath = join(TMP, 'social-yaml-special.jsonl');
    writeFileSync(filePath, JSON.stringify({
      platform: 'linkedin',
      post_id: 'special-1',
      text: 'Founder\'s note: ship > polish, but don\'t break YAML',
      tags: ['founder\'s-note', 'ai:strategy'],
      engagement: { likes: 12, comments: 3 },
    }));

    const engine = mockEngine();
    const result = await importFile(engine, filePath, 'social/yaml-special.jsonl', {
      noEmbed: true,
    });

    expect(result.status).toBe('imported');
    expect(result.parsedPage?.title).toContain('Founder\'s note:');
    expect(result.parsedPage?.tags).toContain('founder\'s-note');
    expect(result.parsedPage?.tags).toContain('ai:strategy');
    expect(result.parsedPage?.frontmatter.platforms).toEqual(['linkedin']);
  });

  test('unknown JSONL schema returns error status', async () => {
    const filePath = join(TMP, 'unknown.jsonl');
    writeFileSync(filePath, unknownJsonl);

    const engine = mockEngine();
    const result = await importFile(engine, filePath, 'unknown/test.jsonl', {
      noEmbed: true,
    });

    // Unknown schema produces a ParsedMarkdown with error title,
    // which then flows through importFromContent and gets imported
    // (it's a valid page with type: source, just with error content).
    // This is intentional: we don't reject unknown JSONL, we import it
    // as a source page so the error is visible in the brain.
    expect(result.status).toBe('imported');
    expect(result.parsedPage?.title).toContain('Unknown JSONL schema');
  });

  test('preserves existing browser JSONL behavior (slug, tags, chunks)', async () => {
    const filePath = join(TMP, 'browser-tags.jsonl');
    const jsonlContent = [
      JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'session_start',
        session_id: 'sess-tags',
        timestamp: '2026-04-24T10:00:00Z',
        url: 'https://example.com',
        title: 'Tagged Session',
        tags: ['browser', 'test'],
      }),
      JSON.stringify({
        version: 'browser_capture_event_v1',
        event_type: 'page_content',
        session_id: 'sess-tags',
        url: 'https://example.com/page',
        content: 'Page content with tags.',
      }),
    ].join('\n');
    writeFileSync(filePath, jsonlContent);

    const engine = mockEngine();
    const result = await importFile(engine, filePath, 'browser-capture/tagged-session.jsonl', {
      noEmbed: true,
    });

    expect(result.status).toBe('imported');
    expect(result.slug).toBe('browser-capture/tagged-session');

    // Tags from session_start should be reconciled
    const calls = (engine as any)._calls;
    const tagCalls = calls.filter((c: any) => c.method === 'addTag');
    const tagNames = tagCalls.map((c: any) => c.args[1]).sort();
    expect(tagNames).toEqual(['browser', 'test']);
  });

  test('path-authoritative slug safety preserved for JSONL', async () => {
    const filePath = join(TMP, 'random-name.jsonl');
    writeFileSync(filePath, browserJsonl);

    const engine = mockEngine();
    const result = await importFile(engine, filePath, 'browser-capture/session-2026-04-24.jsonl', {
      noEmbed: true,
    });

    // The slug comes from the path, not from frontmatter
    expect(result.slug).toBe('browser-capture/session-2026-04-24');
  });
});
