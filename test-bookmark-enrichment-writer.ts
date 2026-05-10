/**
 * Test: verify bookmark-enrichment-writer with one enriched X JSON file.
 *
 * Run: cd ~/.openclaw/workspace/gbrain && bun run test-bookmark-enrichment-writer.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Import from the actual module
import type { BookmarkDeepInput } from './src/core/ops/bookmark-deep-radar.ts';
import { runBookmarkDeepRadar } from './src/core/ops/bookmark-deep-radar.ts';

// ---------------------------------------------------------------------------
// Test helpers — copy the parsing logic so we can run standalone
// ---------------------------------------------------------------------------

interface XEnrichedData {
  id: string;
  platform: 'x';
  permalink: string;
  author_name?: string;
  author_url?: string;
  full_text: string;
  posted_at?: string;
  media: Array<{ type: string; url: string }>;
  links: Array<{ url: string; title?: string }>;
  errors: string[];
}

function parseXEnrichedFile(filePath: string): XEnrichedData | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const r = parsed as Record<string, unknown>;

    let fullText = '';
    if (typeof r.full_text === 'string' && r.full_text.length > 10) {
      fullText = r.full_text;
    } else if (Array.isArray(r.extractors)) {
      for (const ext of r.extractors) {
        if (ext && typeof ext === 'object' && typeof (ext as Record<string, unknown>).full_text === 'string') {
          const ft = (ext as Record<string, unknown>).full_text as string;
          if (ft.length > fullText.length) fullText = ft;
        }
      }
    }

    const media = Array.isArray(r.media)
      ? r.media.filter((m): m is { type: string; url: string } => typeof m === 'object' && m !== null).map(m => ({ type: String((m as Record<string, unknown>).type || 'unknown'), url: String((m as Record<string, unknown>).url) }))
      : [];

    const links = Array.isArray(r.links)
      ? r.links.filter((l): l is { url: string; title?: string } => typeof l === 'object' && l !== null).map(l => ({ url: String((l as Record<string, unknown>).url), title: typeof (l as Record<string, unknown>).title === 'string' ? (l as Record<string, unknown>).title as string : undefined }))
      : [];

    const errors = Array.isArray(r.errors) ? r.errors.filter(e => typeof e === 'string') : [];

    function extractAuthorName(r: Record<string, unknown>): string | undefined {
      if (Array.isArray(r.extractors) && r.extractors[0] && typeof r.extractors[0] === 'object') {
        const ext = r.extractors[0] as Record<string, unknown>;
        if (typeof ext.author_name === 'string') return ext.author_name;
      }
      if (typeof r.metadata === 'object' && r.metadata && typeof (r.metadata as Record<string, unknown>).author_name === 'string') {
        return (r.metadata as Record<string, unknown>).author_name as string;
      }
      return undefined;
    }

    function extractPostedAt(r: Record<string, unknown>): string | undefined {
      if (typeof r.metadata === 'object' && r.metadata) {
        const m = r.metadata as Record<string, unknown>;
        if (typeof m.posted_at === 'string') return m.posted_at;
      }
      return undefined;
    }

    return {
      id: String(r.id || ''),
      platform: 'x',
      permalink: String(r.permalink || ''),
      author_name: extractAuthorName(r),
      author_url: undefined,
      full_text: fullText,
      posted_at: extractPostedAt(r),
      media,
      links,
      errors,
    };
  } catch {
    return null;
  }
}

function normalizeXEnrichedToDeepInput(data: XEnrichedData, sourceFilePath: string): BookmarkDeepInput | null {
  if (!data.permalink || !data.full_text) return null;

  const url = data.permalink;
  const content = data.full_text;
  const title = data.author_name ? `${data.author_name}: ${content.slice(0, 80)}...` : content.slice(0, 80);
  const hash = createHash('sha256').update(`${url}${content}`).digest('hex').slice(0, 24);

  const extra = [
    data.media.length ? `Media: ${data.media.map(m => m.url).join(', ')}` : '',
    data.links.length ? `Links: ${data.links.map(l => l.url).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  return {
    url,
    title: title.slice(0, 180),
    content: content + (extra ? `\n\n${extra}` : ''),
    hash,
    platform: 'x',
    capturedAt: data.posted_at || '',
    outbound_url: data.permalink,
    canonical_url: data.permalink,
    outbound_title: data.author_name || title,
    outbound_content: content + (extra ? `\n\n${extra}` : ''),
    outbound_content_path: sourceFilePath,
    outbound_content_type: 'text/plain',
    source_class: 'social_saved',
    fetch_policy: 'manual',
    robots_allowed: false,
    topic_ids: [],
    topics: [],
  };
}

// ---------------------------------------------------------------------------
// Slug generation (copy from bookmark-deep-radar.ts)
// ---------------------------------------------------------------------------

function extractAuthorFromUrl(url: string, platform: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\//, '').replace(/\/$/, '');
    const parts = path.split('/').filter(Boolean);

    if (platform === 'x' || platform === 'twitter') {
      return parts[0]?.replace(/[^a-zA-Z0-9_]/g, '') || 'unknown';
    }
    return parts[0]?.replace(/[^a-zA-Z0-9\-]/g, '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

function extractSlugPart(url: string, fallbackId: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (/^\d+$/.test(last)) return last;
      return last.replace(/[^a-zA-Z0-9\-]/g, '').slice(0, 60);
    }
    const hash = createHash('sha256').update(u.pathname).digest('hex').slice(0, 12);
    return `${u.hostname.replace(/[^a-zA-Z0-9]/g, '')}-${hash}`;
  } catch {
    return fallbackId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  }
}

function slugForDecision(url: string, platform: string, id: string): string {
  const author = extractAuthorFromUrl(url, platform);
  const slugPart = extractSlugPart(url, id);
  return `wiki/sources/bookmarks/${platform}/${author}/${slugPart}`;
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runTest() {
  const home = process.env.HOME || '';
  const enrichedDir = join(home, '.gbrain/integrations/enriched/x');

  // Pick the first enriched file
  const files = (await import('node:fs')).readdirSync(enrichedDir).filter(f => f.endsWith('.json')).slice(0, 3);

  console.log(`Testing with ${files.length} enriched X files\n`);

  for (const file of files) {
    const filePath = join(enrichedDir, file);
    console.log(`=== ${file} ===`);

    const data = parseXEnrichedFile(filePath);
    if (!data) {
      console.log('  PARSE FAILED\n');
      continue;
    }

    console.log(`  platform: ${data.platform}`);
    console.log(`  author_name: ${data.author_name || 'N/A'}`);
    console.log(`  full_text (first 120 chars): "${data.full_text.slice(0, 120)}..."`);
    console.log(`  posted_at: ${data.posted_at || 'N/A'}`);
    console.log(`  media: ${data.media.length} item(s), links: ${data.links.length} item(s)`);

    const input = normalizeXEnrichedToDeepInput(data, filePath);
    if (!input) {
      console.log('  NORMALIZE FAILED\n');
      continue;
    }

    console.log(`  normalized input:`);
    console.log(`    url: ${input.url.slice(0, 80)}`);
    console.log(`    title: ${input.title.slice(0, 60)}`);
    console.log(`    content (${input.content.length} chars)`);
    console.log(`    hash: ${input.hash}`);
    console.log(`    platform: ${input.platform}`);
    console.log(`    capturedAt: ${input.capturedAt}`);

    // Run deep-radar
    const report = runBookmarkDeepRadar({
      bookmarks: [input],
      surfaceMinScore: 70,
      interruptMinScore: 90,
      now: new Date(),
    });

    console.log(`\n  Deep Radar Report:`);
    console.log(`    input_count: ${report.input_count}, deduped_count: ${report.deduped_count}`);
    console.log(`    decisions: ${report.decisions.length}`);

    for (const d of report.decisions) {
      const wouldBeSlug = slugForDecision(d.canonical_url || d.url, d.platform, d.id);
      console.log(`\n    Decision: ${d.decision}`);
      console.log(`      score: ${d.score}, reason: ${d.reason.slice(0, 80)}...`);
      console.log(`      canonical_url: ${(d.canonical_url || d.url).slice(0, 80)}`);
      console.log(`      GBrain page slug: ${wouldBeSlug}`);
      console.log(`      topic_links: ${d.topic_links.length}, evidence_refs: ${d.evidence_refs.length}`);
      if (d.summary) console.log(`      summary: ${d.summary.slice(0, 80)}...`);
    }

    console.log();
  }

  console.log('Test complete.');
}

runTest().catch(console.error);