/**
 * bookmark-enrichment-writer.ts
 *
 * Wires the complete bookmark pipeline:
 *   enrichment-queue.jsonl → enriched JSON files → bookmark-deep-radar → GBrain pages
 *
 * For "remember" and "act" decisions, writes a GBrain page at:
 *   wiki/sources/bookmarks/{platform}/{author}/{slug}
 *
 * The pipeline:
 *   1. Read enrichment-queue.jsonl (350+ items, all platform x)
 *   2. Cross-reference with enrichment-status.jsonl to find "enriched" (not "snippet_only") outcomes
 *   3. Read each enriched JSON file (~3KB each, full_post + media + outbound links)
 *   4. Normalize into BookmarkDeepInput format
 *   5. Run bookmark-deep-radar classification + scoring
 *   6. For "remember" and "act" decisions → write GBrain pages via writeBookmarkPagesAsBrainPages()
 *   7. For "investigate" and "act" → also enqueue work items (existing behavior preserved)
 *
 * LinkedIn/GitHub: stub parsers included (parse what we can, skip what we can't).
 * The normalization step maps LinkedIn/GitHub JSON structures into BookmarkDeepInput.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

import { runBookmarkDeepRadar, writeBookmarkPagesAsBrainPages, type BookmarkDeepInput, type BookmarkDeepDecision, type BookmarkDeepRadarReport } from './bookmark-deep-radar.ts';
import { readOpsState } from './kernel.ts';
import type { BrainEngine } from '../engine.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface EnrichmentPipelineOptions {
  /** Path to enrichment-queue.jsonl (default: ~/.gbrain/integrations/enrichment-queue.jsonl) */
  queuePath?: string;
  /** Path to enrichment-status.jsonl (default: ~/.gbrain/integrations/enrichment-status.jsonl) */
  statusPath?: string;
  /** Directory containing enriched JSON files (default: ~/.gbrain/integrations/enriched/x) */
  enrichedDir?: string;
  /** Path to ops kernel state (default: ~/.gbrain/ops/ops.jsonl) */
  opsStorePath?: string;
  /** Brain engine for writing pages */
  engine: BrainEngine;
  /** Surface-min score for classification (default: 70) */
  surfaceMinScore?: number;
  /** Interrupt-min score for classification (default: 90) */
  interruptMinScore?: number;
  /** Limit to N items for testing (default: all) */
  limit?: number;
  /** Only write pages, skip work item enqueuement (default: false) */
  pagesOnly?: boolean;
  now?: Date;
}

export interface EnrichmentPipelineResult {
  ok: boolean;
  total_queue_items: number;
  processed: number;
  enriched_found: number;
  decisions_by_type: Record<string, number>;
  pages_written: number;
  skipped_non_actionable: number;
  work_items_created: number;
  errors: string[];
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// LinkedIn / GitHub stub parsers
// ---------------------------------------------------------------------------

interface LinkedInEnrichedData {
  id: string;
  platform: 'linkedin';
  permalink: string;
  author_name?: string;
  author_url?: string;
  full_text?: string;
  posted_at?: string;
  media?: Array<{ type: string; url: string }>;
  links?: Array<{ url: string; title?: string }>;
  errors?: string[];
}

interface GitHubEnrichedData {
  id: string;
  platform: 'github';
  permalink: string;
  repo?: string;
  author?: string;
  title?: string;
  body_text?: string;
  posted_at?: string;
  errors?: string[];
}

/**
 * Parse a LinkedIn enriched JSON file. Returns null if unparseable.
 * LinkedIn JSON structure (stub): we extract what we can.
 */
function parseLinkedInEnrichedFile(filePath: string): LinkedInEnrichedData | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const r = parsed as Record<string, unknown>;
    return {
      id: `linkedin:${String(r.id || r.item_id || '')}`,
      platform: 'linkedin',
      permalink: String(r.permalink || r.url || ''),
      author_name: typeof r.author_name === 'string' ? r.author_name : undefined,
      author_url: typeof r.author_url === 'string' ? r.author_url : undefined,
      full_text: typeof r.full_text === 'string' ? r.full_text : typeof r.text === 'string' ? r.text : undefined,
      posted_at: typeof r.posted_at === 'string' ? r.posted_at : typeof r.created_at === 'string' ? r.created_at : undefined,
      media: Array.isArray(r.media) ? r.media.filter((m): m is { type: string; url: string } => typeof m === 'object' && m !== null && typeof (m as Record<string, unknown>).url === 'string').map(m => ({ type: String((m as Record<string, unknown>).type || 'unknown'), url: String((m as Record<string, unknown>).url) })) : undefined,
      links: Array.isArray(r.links) ? r.links.filter((l): l is { url: string; title?: string } => typeof l === 'object' && l !== null && typeof (l as Record<string, unknown>).url === 'string').map(l => ({ url: String((l as Record<string, unknown>).url), title: typeof (l as Record<string, unknown>).title === 'string' ? (l as Record<string, unknown>).title as string : undefined })) : undefined,
      errors: Array.isArray(r.errors) ? r.errors.filter(e => typeof e === 'string') as string[] : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a GitHub enriched JSON file. Returns null if unparseable.
 * GitHub JSON structure (stub): we extract what we can.
 */
function parseGitHubEnrichedFile(filePath: string): GitHubEnrichedData | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const r = parsed as Record<string, unknown>;
    return {
      id: `github:${String(r.id || r.item_id || '')}`,
      platform: 'github',
      permalink: String(r.permalink || r.url || r.html_url || ''),
      repo: typeof r.repo === 'string' ? r.repo : (typeof r.repository === 'object' && r.repository ? String((r.repository as Record<string, unknown>).full_name || (r.repository as Record<string, unknown>).name || '') : undefined),
      author: typeof r.author === 'string' ? r.author : typeof r.user === 'string' ? r.user : undefined,
      title: typeof r.title === 'string' ? r.title : undefined,
      body_text: typeof r.body_text === 'string' ? r.body_text : typeof r.body === 'string' ? r.body : undefined,
      posted_at: typeof r.posted_at === 'string' ? r.posted_at : typeof r.created_at === 'string' ? r.created_at : undefined,
      errors: Array.isArray(r.errors) ? r.errors.filter(e => typeof e === 'string') as string[] : undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// X (Twitter) enriched JSON parser
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

/**
 * Parse an X-enriched JSON file (format: browser_enriched_bookmark_v1).
 * Returns null if unparseable.
 */
function parseXEnrichedFile(filePath: string): XEnrichedData | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const r = parsed as Record<string, unknown>;

    // Normalize extractors: try oembed full_text first, then top-level full_text
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

    return {
      id: String(r.id || ''),
      platform: 'x',
      permalink: String(r.permalink || ''),
      author_name: extractAuthorName(r),
      author_url: extractAuthorUrl(r),
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

function extractAuthorName(r: Record<string, unknown>): string | undefined {
  // Try extractors[0].author_name
  if (Array.isArray(r.extractors) && r.extractors[0] && typeof r.extractors[0] === 'object') {
    const ext = r.extractors[0] as Record<string, unknown>;
    if (typeof ext.author_name === 'string') return ext.author_name;
  }
  // Try metadata.author
  if (typeof r.metadata === 'object' && r.metadata && typeof (r.metadata as Record<string, unknown>).author_name === 'string') {
    return (r.metadata as Record<string, unknown>).author_name as string;
  }
  return undefined;
}

function extractAuthorUrl(r: Record<string, unknown>): string | undefined {
  if (Array.isArray(r.extractors) && r.extractors[0] && typeof r.extractors[0] === 'object') {
    const ext = r.extractors[0] as Record<string, unknown>;
    if (typeof ext.author_url === 'string') return ext.author_url;
  }
  if (typeof r.metadata === 'object' && r.metadata && typeof (r.metadata as Record<string, unknown>).author_url === 'string') {
    return (r.metadata as Record<string, unknown>).author_url as string;
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

// ---------------------------------------------------------------------------
// Enrichment status lookup
// ---------------------------------------------------------------------------

interface EnrichmentStatusEntry {
  ts: string;
  id: string;
  platform: string;
  status: 'queued' | 'enriched' | 'snippet_only' | 'failed';
  output?: string;
  errors?: string[];
}

/**
 * Build a map of id → EnrichmentStatusEntry from enrichment-status.jsonl.
 * Only includes entries that have status === 'enriched' (not snippet_only).
 */
function loadEnrichmentStatusMap(statusPath: string): Map<string, EnrichmentStatusEntry> {
  const map = new Map<string, EnrichmentStatusEntry>();
  if (!existsSync(statusPath)) return map;

  try {
    const raw = readFileSync(statusPath, 'utf8');
    const lines = raw.trim().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const entry: EnrichmentStatusEntry = JSON.parse(line);
        // Only include enriched (not snippet_only) with a valid output path
        if (entry.status === 'enriched' && entry.output) {
          map.set(entry.id, entry);
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* empty or unreadable */ }

  return map;
}

// ---------------------------------------------------------------------------
// Normalize enriched JSON → BookmarkDeepInput
// ---------------------------------------------------------------------------

/**
 * Normalize an X-enriched data record into BookmarkDeepInput format.
 */
function normalizeXEnrichedToDeepInput(data: XEnrichedData, sourceFilePath: string): BookmarkDeepInput | null {
  if (!data.permalink || !data.full_text) return null;

  const url = data.permalink;
  const content = data.full_text;
  const title = data.author_name ? `${data.author_name}: ${content.slice(0, 80)}...` : content.slice(0, 80);
  const hash = createHash('sha256').update(`${url}${content}`).digest('hex').slice(0, 24);

  // Build outbound_content with media + links context
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

/**
 * Normalize a LinkedIn-enriched data record into BookmarkDeepInput format (stub).
 */
function normalizeLinkedInEnrichedToDeepInput(data: LinkedInEnrichedData, sourceFilePath: string): BookmarkDeepInput | null {
  if (!data.permalink || !data.full_text) return null;

  const url = data.permalink;
  const content = data.full_text;
  const hash = createHash('sha256').update(`${url}${content}`).digest('hex').slice(0, 24);

  return {
    url,
    title: (data.author_name ? `${data.author_name}: ` : '') + content.slice(0, 80),
    content,
    hash,
    platform: 'linkedin',
    capturedAt: data.posted_at || '',
    outbound_url: data.permalink,
    canonical_url: data.permalink,
    outbound_title: data.author_name,
    outbound_content: content,
    outbound_content_path: sourceFilePath,
    outbound_content_type: 'text/plain',
    source_class: 'social_saved',
    fetch_policy: 'manual',
    robots_allowed: false,
    topic_ids: [],
    topics: [],
  };
}

/**
 * Normalize a GitHub-enriched data record into BookmarkDeepInput format (stub).
 */
function normalizeGitHubEnrichedToDeepInput(data: GitHubEnrichedData, sourceFilePath: string): BookmarkDeepInput | null {
  if (!data.permalink || !data.body_text) return null;

  const url = data.permalink;
  const content = data.body_text;
  const hash = createHash('sha256').update(`${url}${content}`).digest('hex').slice(0, 24);

  return {
    url,
    title: data.title || data.repo || url,
    content,
    hash,
    platform: 'github',
    capturedAt: data.posted_at || '',
    outbound_url: data.permalink,
    canonical_url: data.permalink,
    outbound_title: data.title,
    outbound_content: content,
    outbound_content_path: sourceFilePath,
    outbound_content_type: 'text/plain',
    source_class: 'github',
    fetch_policy: 'manual',
    robots_allowed: true,
    topic_ids: [],
    topics: [],
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runEnrichmentPipeline(
  options: EnrichmentPipelineOptions,
): Promise<EnrichmentPipelineResult> {
  const start = Date.now();
  const home = process.env.HOME || '';
  const queuePath = options.queuePath || join(home, '.gbrain/integrations/enrichment-queue.jsonl');
  const statusPath = options.statusPath || join(home, '.gbrain/integrations/enrichment-status.jsonl');
  const enrichedDir = options.enrichedDir || join(home, '.gbrain/integrations/enriched');
  const opsPath = options.opsStorePath || join(home, '.gbrain/ops/ops.jsonl');
  const now = options.now || new Date();

  const errors: string[] = [];
  const decisionsByType: Record<string, number> = {};

  // 1. Load enrichment status map (id → output path for enriched items)
  const statusMap = loadEnrichmentStatusMap(statusPath);

  // 2. Read queue items (all are platform x based on context)
  let queueRaw = '';
  try {
    queueRaw = readFileSync(queuePath, 'utf8');
  } catch (err) {
    return { ok: false, total_queue_items: 0, processed: 0, enriched_found: 0, decisions_by_type: {}, pages_written: 0, skipped_non_actionable: 0, work_items_created: 0, errors: [`Failed to read queue: ${err instanceof Error ? err.message : String(err)}`], duration_ms: Date.now() - start };
  }

  const queueLines = queueRaw.trim().split('\n').filter(l => l.trim());
  const totalQueueItems = queueLines.length;

  // 3. Process each queue item if it has an enriched output
  const deepInputs: BookmarkDeepInput[] = [];

  for (const line of queueLines) {
    try {
      const task = JSON.parse(line);
      const id = String(task.id || task.item_id || '');
      const statusEntry = statusMap.get(id);

      if (!statusEntry || !statusEntry.output) continue; // not yet enriched

      const outputPath = statusEntry.output;
      if (!existsSync(outputPath)) {
        errors.push(`Enriched output missing: ${outputPath}`);
        continue;
      }

      const platform = task.platform || 'x';

      // Parse based on platform
      if (platform === 'x') {
        const data = parseXEnrichedFile(outputPath);
        if (!data) {
          errors.push(`Failed to parse X enriched file: ${outputPath}`);
          continue;
        }
        const input = normalizeXEnrichedToDeepInput(data, outputPath);
        if (input) deepInputs.push(input);
      } else if (platform === 'linkedin') {
        const data = parseLinkedInEnrichedFile(outputPath);
        if (!data) {
          errors.push(`Failed to parse LinkedIn enriched file: ${outputPath}`);
          continue;
        }
        const input = normalizeLinkedInEnrichedToDeepInput(data, outputPath);
        if (input) deepInputs.push(input);
      } else if (platform === 'github') {
        const data = parseGitHubEnrichedFile(outputPath);
        if (!data) {
          errors.push(`Failed to parse GitHub enriched file: ${outputPath}`);
          continue;
        }
        const input = normalizeGitHubEnrichedToDeepInput(data, outputPath);
        if (input) deepInputs.push(input);
      } else {
        // Unknown platform — still try to parse generically
        const raw = readFileSync(outputPath, 'utf8');
        const parsed = JSON.parse(raw);
        const r = parsed as Record<string, unknown>;
        const url = String(r.permalink || r.url || r.id || '');
        const content = String(r.full_text || r.text || r.body_text || r.content || '');
        if (url && content) {
          deepInputs.push({
            url,
            title: String(r.title || url).slice(0, 180),
            content,
            hash: createHash('sha256').update(`${url}${content}`).digest('hex').slice(0, 24),
            platform,
            capturedAt: String(r.posted_at || r.created_at || ''),
            outbound_url: url,
            canonical_url: url,
            outbound_content: content,
            outbound_content_path: outputPath,
            source_class: 'unknown',
            fetch_policy: 'manual',
            robots_allowed: false,
            topic_ids: [],
            topics: [],
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Error processing queue line: ${msg}`);
    }

    if (options.limit && deepInputs.length >= options.limit) break;
  }

  const enrichedFound = deepInputs.length;

  if (deepInputs.length === 0) {
    return {
      ok: true,
      total_queue_items: totalQueueItems,
      processed: 0,
      enriched_found: 0,
      decisions_by_type: {},
      pages_written: 0,
      skipped_non_actionable: 0,
      work_items_created: 0,
      errors: errors.length ? errors : ['No enriched bookmark inputs found'],
      duration_ms: Date.now() - start,
    };
  }

  // 4. Run bookmark-deep-radar
  let report: BookmarkDeepRadarReport;
  try {
    report = runBookmarkDeepRadar({
      bookmarks: deepInputs,
      storePath: opsPath,
      surfaceMinScore: options.surfaceMinScore ?? 70,
      interruptMinScore: options.interruptMinScore ?? 90,
      now,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, total_queue_items: totalQueueItems, processed: deepInputs.length, enriched_found: enrichedFound, decisions_by_type: {}, pages_written: 0, skipped_non_actionable: 0, work_items_created: 0, errors: [...errors, `Deep radar failed: ${msg}`], duration_ms: Date.now() - start };
  }

  // Count decisions by type
  for (const d of report.decisions) {
    decisionsByType[d.decision] = (decisionsByType[d.decision] || 0) + 1;
  }

  // 5. Write GBrain pages for remember/act decisions
  let pagesWritten = 0;
  let skippedNonActionable = 0;

  if (options.engine) {
    const writeResult = await writeBookmarkPagesAsBrainPages({
      decisions: report.decisions,
      engine: options.engine,
      now,
    });
    pagesWritten = writeResult.pages_written;
    skippedNonActionable = writeResult.skipped_non_actionable;
    errors.push(...writeResult.errors);
  }

  // 6. Work items were already created inside runBookmarkDeepRadar
  // (preserving existing behavior — investigate/act create work items)
  const workItemsCreated = report.created_work_items?.length ?? 0;

  return {
    ok: errors.length === 0,
    total_queue_items: totalQueueItems,
    processed: deepInputs.length,
    enriched_found: enrichedFound,
    decisions_by_type: decisionsByType,
    pages_written: pagesWritten,
    skipped_non_actionable: skippedNonActionable,
    work_items_created: workItemsCreated,
    errors,
    duration_ms: Date.now() - start,
  };
}