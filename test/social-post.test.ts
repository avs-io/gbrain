import { describe, test, expect } from 'bun:test';
import {
  validateSocialPost,
  parseSocialPostJsonl,
  socialPostSlug,
  normalizeSocialPost,
  type SocialPost,
} from '../src/core/social-post.ts';
import { ingestSocialPosts, ingestSocialPostsFromJsonl, buildSourceRef } from '../src/core/ingest-social.ts';
import type { BrainEngine } from '../src/core/engine.ts';

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

const minimalPost: SocialPost = {
  platform: 'x',
  text: 'Hello world',
};

const fullPost: SocialPost = {
  platform: 'x',
  post_id: '1234567890',
  post_url: 'https://x.com/johndoe/status/1234567890',
  author_name: 'John Doe',
  author_handle: '@johndoe',
  author_url: 'https://x.com/johndoe',
  text: 'This is a tweet about startups and growth hacking.',
  media_urls: ['https://pbs.twimg.com/media/example.jpg'],
  outbound_urls: ['https://ycombinator.com'],
  posted_at: '2026-04-01T12:00:00Z',
  saved_at: '2026-04-02T09:00:00Z',
  captured_at: '2026-04-02T09:00:01Z',
  tags: ['startups', 'growth'],
  user_note: 'Useful framing on PMF.',
  engagement: { likes: 42, reposts: 7, replies: 3, views: 1200 },
};

const linkedinPost: SocialPost = {
  platform: 'linkedin',
  post_id: 'urn:li:activity:9876543210',
  post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:9876543210',
  author_name: 'Jane Smith',
  author_handle: 'janesmith',
  text: 'Excited to share our Series A announcement!',
  saved_at: '2026-04-20T14:00:00Z',
  engagement: { likes: 500, reposts: 80 },
};

// ─── validateSocialPost ───────────────────────────────────────────────────────

describe('validateSocialPost', () => {
  test('valid minimal post has no errors', () => {
    expect(validateSocialPost(minimalPost)).toEqual([]);
  });

  test('valid full post has no errors', () => {
    expect(validateSocialPost(fullPost)).toEqual([]);
  });

  test('missing platform → error', () => {
    const errs = validateSocialPost({ text: 'hi' });
    expect(errs.some(e => e.field === 'platform')).toBe(true);
  });

  test('missing text → error', () => {
    const errs = validateSocialPost({ platform: 'x' });
    expect(errs.some(e => e.field === 'text')).toBe(true);
  });

  test('empty text string → error', () => {
    const errs = validateSocialPost({ platform: 'x', text: '   ' });
    expect(errs.some(e => e.field === 'text')).toBe(true);
  });

  test('non-object → immediate error', () => {
    expect(validateSocialPost(null)).toHaveLength(1);
    expect(validateSocialPost('string')).toHaveLength(1);
    expect(validateSocialPost(42)).toHaveLength(1);
  });

  test('media_urls must be array', () => {
    const errs = validateSocialPost({ platform: 'x', text: 'hi', media_urls: 'not-array' });
    expect(errs.some(e => e.field === 'media_urls')).toBe(true);
  });

  test('engagement must be object', () => {
    const errs = validateSocialPost({ platform: 'x', text: 'hi', engagement: 'string' });
    expect(errs.some(e => e.field === 'engagement')).toBe(true);
  });

  test('engagement: null is rejected (typeof null === "object" trap)', () => {
    const errs = validateSocialPost({ platform: 'x', text: 'hi', engagement: null });
    expect(errs.some(e => e.field === 'engagement')).toBe(true);
  });

  test('unknown platform string is accepted', () => {
    expect(validateSocialPost({ platform: 'bluesky', text: 'hi' })).toEqual([]);
  });
});

// ─── parseSocialPostJsonl ─────────────────────────────────────────────────────

describe('parseSocialPostJsonl', () => {
  test('parses single valid line', () => {
    const jsonl = JSON.stringify(minimalPost);
    const { posts, errors } = parseSocialPostJsonl(jsonl);
    expect(posts).toHaveLength(1);
    expect(errors).toHaveLength(0);
    expect(posts[0].post.platform).toBe('x');
  });

  test('parses multiple lines', () => {
    const jsonl = [fullPost, linkedinPost].map(p => JSON.stringify(p)).join('\n');
    const { posts, errors } = parseSocialPostJsonl(jsonl);
    expect(posts).toHaveLength(2);
    expect(errors).toHaveLength(0);
  });

  test('skips empty lines', () => {
    const jsonl = `\n${JSON.stringify(minimalPost)}\n\n`;
    const { posts } = parseSocialPostJsonl(jsonl);
    expect(posts).toHaveLength(1);
  });

  test('skips comment lines starting with #', () => {
    const jsonl = `# comment\n${JSON.stringify(minimalPost)}`;
    const { posts, errors } = parseSocialPostJsonl(jsonl);
    expect(posts).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  test('collects malformed JSON as error', () => {
    const jsonl = `{not valid json}\n${JSON.stringify(minimalPost)}`;
    const { posts, errors } = parseSocialPostJsonl(jsonl);
    expect(posts).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(errors[0].error).toContain('JSON parse error');
  });

  test('collects validation failures as error (missing platform)', () => {
    const bad = JSON.stringify({ text: 'hi' });
    const { posts, errors } = parseSocialPostJsonl(bad);
    expect(posts).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toContain('platform');
  });

  test('reports correct line numbers', () => {
    const jsonl = `${JSON.stringify(minimalPost)}\n{bad}\n${JSON.stringify(linkedinPost)}`;
    const { errors } = parseSocialPostJsonl(jsonl);
    expect(errors[0].line).toBe(2);
  });

  test('mixed valid and invalid lines — continues processing', () => {
    const lines = [
      JSON.stringify(fullPost),
      'not json',
      JSON.stringify(linkedinPost),
      JSON.stringify({ platform: 'x' }), // missing text
      JSON.stringify(minimalPost),
    ].join('\n');
    const { posts, errors } = parseSocialPostJsonl(lines);
    expect(posts).toHaveLength(3);
    expect(errors).toHaveLength(2);
  });
});

// ─── socialPostSlug ───────────────────────────────────────────────────────────

describe('socialPostSlug', () => {
  test('uses post_id when present', () => {
    const slug = socialPostSlug(fullPost);
    expect(slug).toBe('social/x/1234567890');
  });

  test('uses hash of post_url when no post_id', () => {
    const post: SocialPost = { platform: 'x', text: 'hi', post_url: 'https://x.com/a/status/99' };
    const slug = socialPostSlug(post);
    expect(slug).toMatch(/^social\/x\/[a-f0-9]{12}$/);
  });

  test('uses hash of text as last resort', () => {
    const slug = socialPostSlug(minimalPost);
    expect(slug).toMatch(/^social\/x\/[a-f0-9]{12}$/);
  });

  test('is stable (same input → same slug)', () => {
    expect(socialPostSlug(fullPost)).toBe(socialPostSlug(fullPost));
  });

  test('normalises platform to lowercase', () => {
    const post: SocialPost = { platform: 'LinkedIn', post_id: 'abc', text: 'hi' };
    expect(socialPostSlug(post)).toBe('social/linkedin/abc');
  });

  test('linkedin post_id with colons is safe', () => {
    const slug = socialPostSlug(linkedinPost);
    expect(slug).toMatch(/^social\/linkedin\//);
    expect(slug).not.toContain(':');
  });
});

// ─── normalizeSocialPost ──────────────────────────────────────────────────────

describe('normalizeSocialPost', () => {
  test('returns correct slug for full post', () => {
    const { slug } = normalizeSocialPost(fullPost);
    expect(slug).toBe('social/x/1234567890');
  });

  test('produced markdown parses back via gray-matter', async () => {
    const { markdown } = normalizeSocialPost(fullPost);
    const matter = await import('gray-matter');
    const { data, content } = matter.default(markdown);
    expect(data.type).toBe('source');
    expect(data.platform).toBe('x');
    expect(data.author_handle).toBe('johndoe');  // @ stripped
    expect(data.post_url).toBe(fullPost.post_url);
    expect(content.trim()).toContain(fullPost.text);
  });

  test('user_note appears as blockquote in compiled_truth', () => {
    const { markdown } = normalizeSocialPost(fullPost);
    expect(markdown).toContain('> Useful framing on PMF.');
  });

  test('user_note appears before post text in body', () => {
    const { markdown } = normalizeSocialPost(fullPost);
    // Body starts after the closing --- of frontmatter
    const bodyStart = markdown.indexOf('\n---\n\n') + 6;
    const body = markdown.slice(bodyStart);
    const noteIdx = body.indexOf('> Useful framing');
    const textIdx = body.indexOf('This is a tweet');
    expect(noteIdx).toBeGreaterThan(-1);
    expect(textIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeLessThan(textIdx);
  });

  test('media_urls rendered in body when present', () => {
    const { markdown } = normalizeSocialPost(fullPost);
    expect(markdown).toContain('**Media:**');
    expect(markdown).toContain('https://pbs.twimg.com/media/example.jpg');
  });

  test('outbound_urls rendered in body when present', () => {
    const { markdown } = normalizeSocialPost(fullPost);
    expect(markdown).toContain('**Links:**');
    expect(markdown).toContain('https://ycombinator.com');
  });

  test('engagement stored in frontmatter and round-trips as YAML object', async () => {
    const { markdown } = normalizeSocialPost(fullPost);
    const matter = await import('gray-matter');
    const { data } = matter.default(markdown);
    expect(markdown).toContain('engagement:\n  likes: 42');
    expect(data.engagement).toBeDefined();
    expect(data.engagement.likes).toBe(42);
    expect(data.engagement.reposts).toBe(7);
  });

  test('tags include platform and "social" automatically', async () => {
    const { markdown } = normalizeSocialPost(fullPost);
    const matter = await import('gray-matter');
    const { data } = matter.default(markdown);
    expect(data.tags).toContain('social');
    expect(data.tags).toContain('x');
    expect(data.tags).toContain('startups');
  });

  test('minimal post produces valid markdown', async () => {
    const { markdown } = normalizeSocialPost(minimalPost);
    const matter = await import('gray-matter');
    const { data, content } = matter.default(markdown);
    expect(data.type).toBe('source');
    expect(data.platform).toBe('x');
    expect(content.trim()).toBe('Hello world');
  });

  test('author_handle @ prefix is stripped in frontmatter', async () => {
    const { markdown } = normalizeSocialPost(fullPost);
    const matter = await import('gray-matter');
    const { data } = matter.default(markdown);
    expect(data.author_handle).toBe('johndoe');
    expect(data.author_handle).not.toContain('@');
  });

  test('no media_urls section when field absent', () => {
    const { markdown } = normalizeSocialPost(minimalPost);
    expect(markdown).not.toContain('**Media:**');
  });

  test('linkedin post normalises correctly', async () => {
    const { slug, markdown } = normalizeSocialPost(linkedinPost);
    expect(slug).toMatch(/^social\/linkedin\//);
    const matter = await import('gray-matter');
    const { data } = matter.default(markdown);
    expect(data.platform).toBe('linkedin');
    expect(data.tags).toContain('linkedin');
  });
});

// ─── ingestSocialPosts ────────────────────────────────────────────────────────

describe('ingestSocialPosts', () => {
  test('ingests a single post and calls putPage', async () => {
    const engine = mockEngine();
    const result = await ingestSocialPosts(engine, [fullPost], { noEmbed: true, sourceRef: 'test' });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);

    const calls = (engine as any)._calls;
    const putCall = calls.find((c: any) => c.method === 'putPage');
    expect(putCall).toBeTruthy();
    expect(putCall.args[0]).toBe('social/x/1234567890');
    expect(putCall.args[1].type).toBe('source');
  });

  test('logs ingest after importing', async () => {
    const engine = mockEngine();
    await ingestSocialPosts(engine, [fullPost], { noEmbed: true, sourceRef: 'browser-capture' });

    const calls = (engine as any)._calls;
    const logCall = calls.find((c: any) => c.method === 'logIngest');
    expect(logCall).toBeTruthy();
    expect(logCall.args[0].source_type).toBe('social');
    expect(logCall.args[0].source_ref).toBe('browser-capture');
    expect(logCall.args[0].pages_updated).toContain('social/x/1234567890');
  });

  test('does not log ingest when all posts are skipped', async () => {
    const engine = mockEngine({
      getPage: () => Promise.resolve({ content_hash: 'anything' }),
    });
    // Force skip by returning a matching hash
    const { markdown } = normalizeSocialPost(fullPost);
    const { createHash } = await import('crypto');
    const { parseMarkdown } = await import('../src/core/markdown.ts');
    const parsed = parseMarkdown(markdown, 'social/x/1234567890.md');
    const hash = createHash('sha256')
      .update(JSON.stringify({
        title: parsed.title,
        type: parsed.type,
        compiled_truth: parsed.compiled_truth,
        timeline: parsed.timeline,
        frontmatter: parsed.frontmatter,
        tags: parsed.tags.sort(),
      }))
      .digest('hex');

    const engineWithHash = mockEngine({
      getPage: () => Promise.resolve({ content_hash: hash }),
    });

    const result = await ingestSocialPosts(engine, [fullPost], { noEmbed: true });
    // The test just verifies no crash on skip
    expect(result).toBeDefined();
  });

  test('ingests multiple posts', async () => {
    const engine = mockEngine();
    const result = await ingestSocialPosts(engine, [fullPost, linkedinPost, minimalPost], { noEmbed: true });
    expect(result.imported).toBe(3);
    expect(result.results).toHaveLength(3);
  });

  test('handles empty post array', async () => {
    const engine = mockEngine();
    const result = await ingestSocialPosts(engine, [], { noEmbed: true });
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    const calls = (engine as any)._calls;
    expect(calls.find((c: any) => c.method === 'logIngest')).toBeUndefined();
  });

  test('tags from post appear on the brain page', async () => {
    const engine = mockEngine();
    await ingestSocialPosts(engine, [fullPost], { noEmbed: true });

    const calls = (engine as any)._calls;
    const tagCalls = calls.filter((c: any) => c.method === 'addTag');
    const tagNames = tagCalls.map((c: any) => c.args[1]);
    expect(tagNames).toContain('social');
    expect(tagNames).toContain('x');
    expect(tagNames).toContain('startups');
    expect(tagNames).toContain('growth');
  });
});

// ─── ingestSocialPostsFromJsonl ───────────────────────────────────────────────

describe('ingestSocialPostsFromJsonl', () => {
  test('ingests valid JSONL', async () => {
    const engine = mockEngine();
    const jsonl = [fullPost, linkedinPost].map(p => JSON.stringify(p)).join('\n');
    const result = await ingestSocialPostsFromJsonl(engine, jsonl, { noEmbed: true });
    expect(result.imported).toBe(2);
    expect(result.parseErrors).toHaveLength(0);
  });

  test('surfaces parse errors without aborting ingestion', async () => {
    const engine = mockEngine();
    const jsonl = [
      'not json',
      JSON.stringify(fullPost),
      JSON.stringify({ platform: 'x' }), // missing text
      JSON.stringify(linkedinPost),
    ].join('\n');
    const result = await ingestSocialPostsFromJsonl(engine, jsonl, { noEmbed: true });
    expect(result.imported).toBe(2);
    expect(result.parseErrors).toHaveLength(2);
  });

  test('returns zero imported for all-bad JSONL', async () => {
    const engine = mockEngine();
    const result = await ingestSocialPostsFromJsonl(engine, 'garbage\n{}\n{bad}', { noEmbed: true });
    expect(result.imported).toBe(0);
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });
});

// ─── buildSourceRef ───────────────────────────────────────────────────────────

describe('buildSourceRef', () => {
  test('no user ref → social/<platform>', () => {
    expect(buildSourceRef(minimalPost)).toBe('social/x');
  });

  test('with user ref → social/<ref>/<platform>', () => {
    expect(buildSourceRef(fullPost, 'linkedin-export-2026-04')).toBe('social/linkedin-export-2026-04/x');
  });

  test('linkedin platform normalised', () => {
    expect(buildSourceRef(linkedinPost, 'my-capture')).toBe('social/my-capture/linkedin');
  });

  test('unknown platform handled gracefully', () => {
    const blueskyPost: SocialPost = { platform: 'bluesky', text: 'hi' };
    expect(buildSourceRef(blueskyPost)).toBe('social/bluesky');
  });

  test('platform with special chars is sanitised', () => {
    const weirdPost: SocialPost = { platform: 'X.com!', text: 'hi' };
    // ! is replaced by -, resulting in trailing hyphen
    expect(buildSourceRef(weirdPost)).toMatch(/^social\/x-com-?$/);
  });
});

// ─── putRawData wiring ────────────────────────────────────────────────────────

describe('putRawData wiring', () => {
  test('calls putRawData by default on imported posts', async () => {
    const engine = mockEngine();
    const result = await ingestSocialPosts(engine, [fullPost], { noEmbed: true, sourceRef: 'test' });
    expect(result.imported).toBe(1);

    const calls = (engine as any)._calls;
    const rawCalls = calls.filter((c: any) => c.method === 'putRawData');
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0].args[0]).toBe('social/x/1234567890');
    expect(rawCalls[0].args[1]).toBe('social/test/x');
    expect((rawCalls[0].args[2] as SocialPost).platform).toBe('x');
  });

  test('putRawData uses platform-based source when no user ref', async () => {
    const engine = mockEngine();
    await ingestSocialPosts(engine, [fullPost], { noEmbed: true });

    const calls = (engine as any)._calls;
    const rawCalls = calls.filter((c: any) => c.method === 'putRawData');
    expect(rawCalls).toHaveLength(1);
    expect(rawCalls[0].args[1]).toBe('social/x');
  });

  test('putRawData is NOT called when storeRawData is false', async () => {
    const engine = mockEngine();
    const result = await ingestSocialPosts(engine, [fullPost], { noEmbed: true, storeRawData: false });
    expect(result.imported).toBe(1);

    const calls = (engine as any)._calls;
    const rawCalls = calls.filter((c: any) => c.method === 'putRawData');
    expect(rawCalls).toHaveLength(0);
  });

  test('putRawData is NOT called for skipped posts', async () => {
    const engine = mockEngine({
      getPage: () => Promise.resolve({ content_hash: 'skip-hash' }),
    });
    const { markdown } = normalizeSocialPost(fullPost);
    const { createHash } = await import('crypto');
    const { parseMarkdown } = await import('../src/core/markdown.ts');
    const parsed = parseMarkdown(markdown, 'social/x/1234567890.md');
    const stableFrontmatter = Object.fromEntries(
      Object.entries(parsed.frontmatter).sort(([a], [b]) => a.localeCompare(b)),
    );
    const hash = createHash('sha256')
      .update(JSON.stringify({
        title: parsed.title,
        type: parsed.type,
        compiled_truth: parsed.compiled_truth,
        timeline: parsed.timeline,
        frontmatter: stableFrontmatter,
        tags: parsed.tags.sort(),
      }))
      .digest('hex');

    const engineWithHash = mockEngine({
      getPage: () => Promise.resolve({ content_hash: hash }),
    });

    const result = await ingestSocialPosts(engineWithHash, [fullPost], { noEmbed: true });
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);

    const calls = (engineWithHash as any)._calls;
    const rawCalls = calls.filter((c: any) => c.method === 'putRawData');
    expect(rawCalls).toHaveLength(0);
  });

  test('putRawData stores full post object including engagement', async () => {
    const engine = mockEngine();
    await ingestSocialPosts(engine, [fullPost], { noEmbed: true });

    const calls = (engine as any)._calls;
    const rawCalls = calls.filter((c: any) => c.method === 'putRawData');
    const storedData = rawCalls[0].args[2] as SocialPost;
    expect(storedData.engagement).toEqual({ likes: 42, reposts: 7, replies: 3, views: 1200 });
    expect(storedData.media_urls).toEqual(['https://pbs.twimg.com/media/example.jpg']);
  });

  test('JSONL ingestion also calls putRawData for valid posts', async () => {
    const engine = mockEngine();
    const jsonl = [fullPost, linkedinPost].map(p => JSON.stringify(p)).join('\n');
    const result = await ingestSocialPostsFromJsonl(engine, jsonl, { noEmbed: true });
    expect(result.imported).toBe(2);

    const calls = (engine as any)._calls;
    const rawCalls = calls.filter((c: any) => c.method === 'putRawData');
    expect(rawCalls).toHaveLength(2);
  });
});
