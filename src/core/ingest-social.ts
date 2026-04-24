import type { BrainEngine } from './engine.ts';
import { importFromContent, type ImportResult } from './import-file.ts';
import { parseSocialPostJsonl, normalizeSocialPost, type SocialPost, type ParseLineError } from './social-post.ts';

export interface SocialIngestOpts {
  noEmbed?: boolean;
  sourceRef?: string;   // free-form label, e.g. 'linkedin-export-2026-04' or 'browser-capture'
  storeRawData?: boolean; // store original JSON via putRawData (default: true)
}

export interface SocialIngestResult {
  imported: number;
  skipped: number;
  errors: number;
  results: ImportResult[];
  parseErrors: ParseLineError[];  // only populated when ingesting from JSONL
}

/**
 * Ingest an array of SocialPost objects into the brain.
 * Each post becomes a `type: source` page with all social metadata in frontmatter.
 */
export async function ingestSocialPosts(
  engine: BrainEngine,
  posts: SocialPost[],
  opts: SocialIngestOpts = {},
): Promise<SocialIngestResult> {
  const results: ImportResult[] = [];

  for (const post of posts) {
    const { slug, markdown } = normalizeSocialPost(post);
    const result = await importFromContent(engine, slug, markdown, { noEmbed: opts.noEmbed });
    results.push(result);

    // Store original JSON as raw data for later retrieval (matching source-material pattern)
    if (opts.storeRawData !== false && result.status === 'imported') {
      const source = buildSourceRef(post, opts.sourceRef);
      await engine.putRawData(slug, source, post);
    }
  }

  const imported = results.filter(r => r.status === 'imported').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors = results.filter(r => r.status === 'error').length;
  const pages = results.filter(r => r.status === 'imported').map(r => r.slug);

  if (pages.length > 0) {
    await engine.logIngest({
      source_type: 'social',
      source_ref: opts.sourceRef ?? 'unknown',
      pages_updated: pages,
      summary: `Ingested ${imported} social post(s) — ${skipped} skipped, ${errors} errors`,
    });
  }

  return { imported, skipped, errors, results, parseErrors: [] };
}

/**
 * Parse a JSONL string and ingest all valid posts in one pass.
 * Parse errors are collected and returned without aborting ingestion.
 */
export async function ingestSocialPostsFromJsonl(
  engine: BrainEngine,
  jsonl: string,
  opts: SocialIngestOpts = {},
): Promise<SocialIngestResult> {
  const { posts: parsedLines, errors: parseErrors } = parseSocialPostJsonl(jsonl);
  const posts = parsedLines.map(p => p.post);

  const result = await ingestSocialPosts(engine, posts, opts);
  return { ...result, parseErrors };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a source identifier for putRawData.
 *
 * Convention: `social/<platform>/<user-provided-ref>`.
 * If no user-provided ref, falls back to the platform name.
 * This matches the source convention used by other ingestion paths
 * (e.g. `crustdata`, `happenstance`).
 */
export function buildSourceRef(post: SocialPost, userRef?: string): string {
  const platform = (post.platform || 'unknown').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const ref = userRef ? `${userRef}/${platform}` : platform;
  return `social/${ref}`;
}
