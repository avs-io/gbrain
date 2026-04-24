import { createHash } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SocialPlatform = 'x' | 'linkedin' | string;

export interface SocialEngagement {
  likes?: number;
  reposts?: number;   // retweets on X, reposts on LinkedIn
  replies?: number;
  views?: number;
  bookmarks?: number;
  quotes?: number;
}

/**
 * Normalised representation of a saved social post.
 * Compatible with browser capture extensions and local JSONL ingestion.
 * All fields except `text` and `platform` are optional to maximise
 * compatibility with partial captures.
 */
export interface SocialPost {
  // Identity
  platform: SocialPlatform;
  post_id?: string;
  post_url?: string;

  // Author
  author_name?: string;
  author_handle?: string;  // @-prefixed handle on X, vanity URL slug on LinkedIn
  author_url?: string;

  // Content
  text: string;
  media_urls?: string[];
  outbound_urls?: string[];

  // Timestamps (ISO 8601)
  posted_at?: string;    // when the post was originally published
  saved_at?: string;     // when the user saved / bookmarked it
  captured_at?: string;  // when the capture tool scraped it

  // Curation
  tags?: string[];
  user_note?: string;

  // Engagement snapshot (point-in-time, not authoritative)
  engagement?: SocialEngagement;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate a SocialPost, returning any structural errors.
 * A post is valid if it has `platform` and non-empty `text`.
 */
export function validateSocialPost(post: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof post !== 'object' || post === null) {
    errors.push({ field: 'root', message: 'must be a JSON object' });
    return errors;
  }

  const p = post as Record<string, unknown>;

  if (!p.platform || typeof p.platform !== 'string') {
    errors.push({ field: 'platform', message: 'required string' });
  }
  if (!p.text || typeof p.text !== 'string' || !(p.text as string).trim()) {
    errors.push({ field: 'text', message: 'required non-empty string' });
  }
  if (p.post_url !== undefined && typeof p.post_url !== 'string') {
    errors.push({ field: 'post_url', message: 'must be a string' });
  }
  if (p.engagement !== undefined && (typeof p.engagement !== 'object' || p.engagement === null)) {
    errors.push({ field: 'engagement', message: 'must be an object' });
  }
  if (p.media_urls !== undefined && !Array.isArray(p.media_urls)) {
    errors.push({ field: 'media_urls', message: 'must be an array' });
  }
  if (p.outbound_urls !== undefined && !Array.isArray(p.outbound_urls)) {
    errors.push({ field: 'outbound_urls', message: 'must be an array' });
  }
  if (p.tags !== undefined && !Array.isArray(p.tags)) {
    errors.push({ field: 'tags', message: 'must be an array' });
  }

  return errors;
}

// ─── JSONL Parser ─────────────────────────────────────────────────────────────

export interface ParsedLine {
  line: number;
  post: SocialPost;
}

export interface ParseLineError {
  line: number;
  raw: string;
  error: string;
}

export interface JsonlParseResult {
  posts: ParsedLine[];
  errors: ParseLineError[];
}

/**
 * Parse a JSONL string (one JSON object per line) into SocialPost records.
 * Empty lines and comment lines (starting with #) are skipped.
 * Malformed lines are collected in `errors` and do not abort the parse.
 */
export function parseSocialPostJsonl(jsonl: string): JsonlParseResult {
  const posts: ParsedLine[] = [];
  const errors: ParseLineError[] = [];

  const lines = jsonl.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i].trim();

    if (!raw || raw.startsWith('#')) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      errors.push({ line: lineNum, raw, error: `JSON parse error: ${(e as Error).message}` });
      continue;
    }

    const validationErrors = validateSocialPost(parsed);
    if (validationErrors.length > 0) {
      const msg = validationErrors.map(e => `${e.field}: ${e.message}`).join('; ');
      errors.push({ line: lineNum, raw, error: `Validation: ${msg}` });
      continue;
    }

    posts.push({ line: lineNum, post: parsed as SocialPost });
  }

  return { posts, errors };
}

// ─── Slug Generation ──────────────────────────────────────────────────────────

/**
 * Generate a stable, human-readable slug for a social post.
 *
 * Priority:
 *   1. platform + post_id (canonical)
 *   2. platform + short hash of post_url
 *   3. platform + short hash of text
 */
export function socialPostSlug(post: SocialPost): string {
  const platform = post.platform.replace(/[^a-z0-9]/gi, '-').toLowerCase();

  if (post.post_id) {
    const safe = post.post_id.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    return `social/${platform}/${safe}`;
  }

  const source = post.post_url || post.text;
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  return `social/${platform}/${hash}`;
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

function titleFromPost(post: SocialPost): string {
  const handle = post.author_handle ? `@${post.author_handle.replace(/^@/, '')}` : post.author_name;
  const platform = post.platform.charAt(0).toUpperCase() + post.platform.slice(1);
  const prefix = handle ? `${handle} on ${platform}` : `${platform} post`;
  // Trim text preview to ~60 chars
  const preview = post.text.replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${prefix}: ${preview}${post.text.length > 60 ? '…' : ''}`;
}

/**
 * Normalise a SocialPost into gbrain markdown format.
 *
 * - `type: source` — a saved post is source material, not compiled truth
 * - All social metadata lives in frontmatter (queryable via JSONB)
 * - `compiled_truth` = user_note (if present) + post text + URLs
 * - `timeline` = empty (engagement history can be added by enrichment)
 */
export function normalizeSocialPost(post: SocialPost): { slug: string; markdown: string } {
  const slug = socialPostSlug(post);

  // ── Build frontmatter ──
  const fm: Record<string, unknown> = {
    type: 'source',
    title: titleFromPost(post),
    platform: post.platform,
  };

  if (post.post_url) fm.post_url = post.post_url;
  if (post.post_id) fm.post_id = post.post_id;
  if (post.author_name) fm.author_name = post.author_name;
  if (post.author_handle) fm.author_handle = post.author_handle.replace(/^@/, '');
  if (post.author_url) fm.author_url = post.author_url;
  if (post.posted_at) fm.posted_at = post.posted_at;
  if (post.saved_at) fm.saved_at = post.saved_at;
  if (post.captured_at) fm.captured_at = post.captured_at;
  if (post.media_urls?.length) fm.media_urls = post.media_urls;
  if (post.outbound_urls?.length) fm.outbound_urls = post.outbound_urls;
  if (post.engagement && Object.keys(post.engagement).length > 0) fm.engagement = post.engagement;

  // Tags: merge user-supplied tags + platform tag
  const tags = Array.from(new Set(['social', post.platform, ...(post.tags ?? [])]));
  fm.tags = tags;

  // ── Build body (compiled_truth) ──
  const sections: string[] = [];

  if (post.user_note?.trim()) {
    sections.push(`> ${post.user_note.trim().replace(/\n/g, '\n> ')}`);
  }

  sections.push(post.text.trim());

  if (post.media_urls?.length) {
    sections.push('**Media:**\n' + post.media_urls.map(u => `- ${u}`).join('\n'));
  }

  if (post.outbound_urls?.length) {
    sections.push('**Links:**\n' + post.outbound_urls.map(u => `- ${u}`).join('\n'));
  }

  const compiled_truth = sections.join('\n\n');

  // ── Serialise to markdown ──
  const frontmatterLines = serializeFrontmatter(fm);
  const markdown = `---\n${frontmatterLines}\n---\n\n${compiled_truth}\n`;

  return { slug, markdown };
}

// ─── Frontmatter serialiser (minimal, no dep on gray-matter for writing) ──────

function serializeFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (typeof value[0] === 'string') {
        lines.push(`${key}: [${value.map(v => JSON.stringify(v)).join(', ')}]`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${JSON.stringify(item)}`);
        }
      }
    } else if (typeof value === 'object') {
      // Inline YAML object (engagement stats)
      const pairs = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      lines.push(`${key}: {${pairs}}`);
    } else if (typeof value === 'string') {
      // Quote strings that contain special YAML characters
      const needsQuote = /[:#\[\]{},|>&*!'"\\]/.test(value) || value.includes('\n');
      lines.push(`${key}: ${needsQuote ? JSON.stringify(value) : value}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}
