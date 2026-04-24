import type { ParsedMarkdown } from './markdown.ts';
import type { PageType } from './types.ts';
import { parseBrowserCaptureJsonl, type BrowserCaptureEvent } from './browser-capture.ts';
import { parseSocialPostJsonl, normalizeSocialPost, type SocialPost } from './social-post.ts';

// ─── Dispatch Result ──────────────────────────────────────────────────────────

/**
 * Result of dispatching a JSONL file to the appropriate parser.
 */
export interface JsonlDispatchResult {
  /** The parser that handled this file ('browser' | 'social' | 'unknown') */
  parser: 'browser' | 'social' | 'unknown';
  /** Parsed markdown — always present when parser !== 'unknown' */
  parsed?: ParsedMarkdown;
  /** Parsed social posts — only when parser === 'social' */
  socialPosts?: SocialPost[];
  /** Parse errors from the underlying parser */
  parseErrors?: string[];
  /** Why the file was classified as 'unknown' */
  reason?: string;
}

// ─── Schema Detection ─────────────────────────────────────────────────────────

/**
 * Detect the JSONL schema by reading the first non-empty JSON line and
 * inspecting its top-level keys.
 *
 * Dispatch rules:
 *   - `event_type` present  → browser capture (parseBrowserCaptureJsonl)
 *   - `platform` + `text`  → social post (parseSocialPostJsonl)
 *   - neither              → unknown (caller decides)
 *
 * This is a lightweight heuristic: we only read the first valid JSON line
 * to avoid parsing the entire file when the schema is obvious.
 */
export function detectJsonlSchema(content: string): JsonlDispatchResult {
  const lines = content.split('\n').filter(l => l.trim());

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // skip malformed lines
    }

    // Rule 1: browser capture — has event_type
    if (obj.event_type !== undefined) {
      return { parser: 'browser' };
    }

    // Rule 2: social post — has both platform and text
    if (obj.platform !== undefined && obj.text !== undefined) {
      return { parser: 'social' };
    }
  }

  return {
    parser: 'unknown',
    reason: 'No recognized schema found: first non-empty JSON line had neither `event_type` (browser) nor `platform`+`text` (social).',
  };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Dispatch a JSONL file to the appropriate parser based on schema detection.
 *
 * Returns a ParsedMarkdown for browser capture (single-page semantics).
 * For social JSONL, returns the array of SocialPost objects so the caller
 * can decide how to handle multi-post files.
 *
 * @param content — raw JSONL file content
 * @param filePath — optional file path for slug inference (browser parser)
 */
export function dispatchJsonl(
  content: string,
  filePath?: string,
): JsonlDispatchResult {
  const schema = detectJsonlSchema(content);

  if (schema.parser === 'unknown') {
    return schema;
  }

  if (schema.parser === 'browser') {
    const parsed = parseBrowserCaptureJsonl(content, filePath);
    return { ...schema, parsed };
  }

  // social
  const { posts, errors } = parseSocialPostJsonl(content);
  const socialPosts = posts.map(p => p.post);

  // Collect parse errors as strings for the result
  const parseErrors = errors.map(e => `Line ${e.line}: ${e.error}`);

  return {
    ...schema,
    socialPosts,
    parseErrors,
  };
}

// ─── Multi-Post Aggregation (for importFromFile) ──────────────────────────────

/**
 * Aggregate multiple social posts into a single deterministic source page.
 *
 * Strategy: concatenate all posts into one markdown document with a
 * per-post frontmatter block. This preserves one-post-one-page semantics
 * at the social-post level (each post gets its own slug via socialPostSlug)
 * while giving importFromFile a single ParsedMarkdown to work with.
 *
 * The aggregated page uses type: source and a composite title.
 * Individual posts are NOT created as separate pages — this is a
 * deliberate trade-off to keep importFromFile's signature unchanged.
 *
 * If a caller needs individual pages, they should use
 * ingestSocialPostsFromJsonl directly instead of importFromFile.
 */
export function aggregateSocialPostsToMarkdown(
  posts: SocialPost[],
  filePath?: string,
): ParsedMarkdown {
  if (posts.length === 0) {
    return {
      frontmatter: {},
      compiled_truth: '',
      timeline: '',
      slug: filePath ? slugifyPath(filePath.replace(/\.jsonl$/i, '.md')) : 'social/aggregate/untitled',
      type: 'source',
      title: 'Aggregated Social Posts (empty)',
      tags: [],
    };
  }

  // Build a composite title: platform summary + first post preview
  const platforms = Array.from(new Set(posts.map(p => p.platform))).sort();
  const platformLabel = platforms.length === 1
    ? platforms[0]
    : `${platforms.length} platforms (${platforms.join(', ')})`;

  const preview = posts[0].text.replace(/\s+/g, ' ').trim().slice(0, 80);
  const title = `Social Posts — ${platformLabel}: ${preview}${posts[0].text.length > 80 ? '…' : ''}`;
  // Quote the title to avoid YAML parsing issues with colons and special chars
  const quotedTitle = JSON.stringify(title);

  // Build frontmatter (title is emitted separately by serializeToMarkdown)
  const frontmatter: Record<string, unknown> = {
    type: 'source',
    platforms,
    post_count: posts.length,
  };

  // Collect all tags (stored in parsed.tags, NOT in frontmatter to avoid YAML duplication)
  const allTags: string[] = [];
  for (const post of posts) {
    if (Array.isArray(post.tags)) {
      for (const t of post.tags) allTags.push(t);
    }
    allTags.push('social');
    allTags.push(post.platform);
  }
  // Deduplicate while preserving order
  const uniqueTags = Array.from(new Set(allTags));

  // Build compiled_truth: each post as a markdown block
  const sections: string[] = [];
  for (const post of posts) {
    const { markdown } = normalizeSocialPost(post);
    sections.push(markdown);
  }

  return {
    frontmatter,
    compiled_truth: sections.join('\n\n'),
    timeline: '',
    slug: filePath ? slugifyPath(filePath.replace(/\.jsonl$/i, '.md')) : 'social/aggregate/untitled',
    type: 'source' as PageType,
    title,
    tags: uniqueTags,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { slugifyPath } from './sync.ts';
