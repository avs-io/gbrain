/**
 * gbrain social-sync — ingest browser-captured LinkedIn/X posts.
 *
 * Reads JSONL files from `~/.gbrain/integrations/browser-transcripts/{linkedin,x}/`,
 * converts `browser_transcript_message_v1` records to `SocialPost` format,
 * and ingests through the existing `ingestSocialPosts()` pipeline.
 *
 * Usage:
 *   gbrain social-sync [--dry-run] [--platform linkedin|x|all] [--max N]
 *
 * Does NOT access live data when tests run (inject mock deps).
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

import { ingestSocialPosts, type SocialIngestResult } from '../core/ingest-social.ts';
import { normalizeSocialPost, type SocialPost } from '../core/social-post.ts';
import type { BrainEngine } from '../core/engine.ts';

// ── Root dir (ESM-safe) ──────────────────────────────────────────
const GBRAIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ── Injectable deps (for testing without module-level patching) ─

export interface SocialSyncDeps {
  /** Resolve the home directory (defaults to $HOME). */
  homeDir: string;
  /** Resolve the project root (defaults to GBRAIN_ROOT). */
  rootDir: string;
  /** Create a mock BrainEngine for testing. */
  createEngine: () => Promise<BrainEngine>;
}

function defaultDeps(): SocialSyncDeps {
  return {
    homeDir: process.env.HOME || process.env.USERPROFILE || '/tmp',
    rootDir: GBRAIN_ROOT,
    createEngine: async () => {
      // Lazy import to avoid pulling in engine deps during test imports
      const { createEngine: ce } = await import('../core/engine-factory.ts');
      const { loadConfig, toEngineConfig } = await import('../core/config.ts');
      const config = loadConfig();
      if (!config) {
        throw new Error('No brain configured. Run: gbrain init');
      }
      const engineConfig = toEngineConfig(config);
      const engine = await ce(engineConfig);
      await engine.connect(engineConfig);
      return engine;
    },
  };
}

// ── Types ───────────────────────────────────────────────────────

/** Schema emitted by the browser capture extension. */
export interface BrowserTranscriptMessage {
  schema?: string;
  platform: string;
  content: string;
  url?: string;
  title?: string;
  captured_at?: string;
  ts?: string;
  hash?: string;
  conv_id?: string;
  [k: string]: unknown;
}

export interface SocialSyncResult {
  /** Number of posts successfully converted and ingested. */
  imported: number;
  /** Number of posts skipped (wrong platform, missing content, etc.). */
  skipped: number;
  /** Number of posts that caused errors (malformed JSON, etc.). */
  errors: number;
  /** Whether this sync was executed as a dry run. */
  dryRun: boolean;
  /** List of error messages for debugging. */
  errorMessages: string[];
  /** Total raw lines read across all JSONL files. */
  totalLines: number;
}

// ── Conversion ───────────────────────────────────────────────────

/**
 * Extract an author handle from a browser transcript message.
 *
 * For X posts, the content often contains the author name and handle
 * (e.g. "Kyle Hessling\n@KyleHessling1\n·\nApr 23\n...").
 * For LinkedIn, the content may contain the author name.
 *
 * Returns the best-effort handle or name.
 */
function extractAuthorFromMessage(msg: BrowserTranscriptMessage): { name?: string; handle?: string } {
  const content = msg.content || '';
  const url = msg.url || '';

  // Try to extract handle from X-style content: "Name\n@handle\n·\n..."
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const handleMatch = line.match(/^@([a-zA-Z0-9_]{1,15})$/);
    if (handleMatch) {
      return { handle: handleMatch[1] };
    }
  }

  // Try to extract from URL (LinkedIn vanity URL)
  const linkedinMatch = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (linkedinMatch) {
    return { handle: linkedinMatch[1] };
  }

  // Fallback: first line might be the author name
  if (lines.length > 0) {
    const firstLine = lines[0];
    // If it looks like a name (no @, no special chars), use it
    if (!firstLine.startsWith('@') && !firstLine.match(/^[\d.]+[kM]$/)) {
      return { name: firstLine };
    }
  }

  return {};
}

/**
 * Convert a browser transcript message to a SocialPost.
 *
 * Maps:
 *   platform  → platform
 *   content   → text
 *   url       → post_url
 *   hash      → post_id (for dedup)
 *   captured_at / ts → captured_at
 *   title   → used for author extraction
 */
export function browserTranscriptToSocialPost(msg: BrowserTranscriptMessage): SocialPost {
  const author = extractAuthorFromMessage(msg);

  return {
    platform: msg.platform as SocialPost['platform'],
    post_id: msg.hash,
    post_url: msg.url,
    text: msg.content,
    author_name: author.name,
    author_handle: author.handle,
    captured_at: msg.captured_at || msg.ts,
    saved_at: msg.captured_at || msg.ts,
    tags: ['browser-capture', msg.platform],
  };
}

// ── Core logic ───────────────────────────────────────────────────

export interface SocialSyncArgs {
  dryRun: boolean;
  platform: 'linkedin' | 'x' | 'all';
  max: number;
}

export async function runSocialSync(args: string[], deps?: Partial<SocialSyncDeps>): Promise<SocialSyncResult> {
  const d = { ...defaultDeps(), ...deps };

  let dryRun = false;
  let platform: 'linkedin' | 'x' | 'all' = 'all';
  let max = 50;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--platform' && args[i + 1]) {
      const p = args[++i].toLowerCase();
      if (p !== 'linkedin' && p !== 'x' && p !== 'all') {
        throw new Error(`Invalid platform: ${p}. Must be 'linkedin', 'x', or 'all'.`);
      }
      platform = p as 'linkedin' | 'x' | 'all';
    } else if (a === '--max' && args[i + 1]) {
      max = parseInt(args[++i], 10);
      if (isNaN(max) || max < 1) {
        throw new Error(`Invalid --max value: ${args[i - 1]}. Must be a positive integer.`);
      }
    }
  }

  const transcriptsDir = join(d.homeDir, '.gbrain', 'integrations', 'browser-transcripts');
  const result: SocialSyncResult = {
    imported: 0,
    skipped: 0,
    errors: 0,
    dryRun,
    errorMessages: [],
    totalLines: 0,
  };

  const platformsToSync = platform === 'all' ? ['linkedin', 'x'] : [platform];

  // Collect all messages from all JSONL files
  const allMessages: BrowserTranscriptMessage[] = [];

  for (const plat of platformsToSync) {
    const platformDir = join(transcriptsDir, plat);
    let files: string[];
    try {
      files = readdirSync(platformDir);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  No JSONL files found for platform "${plat}" at ${platformDir} (${msg})`);
      continue;
    }

    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    if (jsonlFiles.length === 0) {
      console.log(`  No JSONL files found for platform "${plat}"`);
      continue;
    }

    console.log(`  Platform: ${plat} — ${jsonlFiles.length} file(s)`);

    for (const file of jsonlFiles) {
      const filePath = join(platformDir, file);
      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors++;
        result.errorMessages.push(`Failed to read ${file}: ${msg}`);
        continue;
      }

      const lines = content.split('\n').filter(l => l.trim());
      result.totalLines += lines.length;

      for (const line of lines) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (e) {
          result.errors++;
          result.errorMessages.push(`Malformed JSON in ${file}: ${(e as Error).message}`);
          continue;
        }

        if (typeof parsed !== 'object' || parsed === null) {
          result.errors++;
          result.errorMessages.push(`Non-object line in ${file}`);
          continue;
        }

        const msg = parsed as BrowserTranscriptMessage;

        // Validate schema
        if (msg.schema !== 'browser_transcript_message_v1' && !msg.platform) {
          result.skipped++;
          continue;
        }

        // Validate required fields
        if (!msg.content || typeof msg.content !== 'string') {
          result.skipped++;
          continue;
        }

        if (!msg.platform || typeof msg.platform !== 'string') {
          result.skipped++;
          continue;
        }

        allMessages.push(msg);
      }
    }
  }

  // Deduplicate by hash (or content hash if no hash)
  const seen = new Set<string>();
  const uniqueMessages: BrowserTranscriptMessage[] = [];
  for (const msg of allMessages) {
    const dedupKey = msg.hash || createHash('sha256').update(msg.content).digest('hex').slice(0, 16);
    if (seen.has(dedupKey)) {
      result.skipped++;
      continue;
    }
    seen.add(dedupKey);
    uniqueMessages.push(msg);
  }

  // Apply --max per platform
  const platformCounts = new Map<string, number>();
  const filteredMessages: BrowserTranscriptMessage[] = [];
  for (const msg of uniqueMessages) {
    const count = platformCounts.get(msg.platform) || 0;
    if (count >= max) {
      result.skipped++;
      continue;
    }
    platformCounts.set(msg.platform, count + 1);
    filteredMessages.push(msg);
  }

  // Convert to SocialPost and ingest
  const posts: SocialPost[] = filteredMessages.map(browserTranscriptToSocialPost);

  if (posts.length === 0) {
    console.log('  No posts to ingest.');
    return result;
  }

  if (dryRun) {
    console.log(`  [dry-run] would ingest ${posts.length} post(s):`);
    for (const post of posts.slice(0, 10)) {
      const preview = (post.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      console.log(`    [${post.platform}] ${post.author_handle || post.author_name || '?'}: ${preview}${post.text.length > 80 ? '…' : ''}`);
    }
    if (posts.length > 10) {
      console.log(`    ... and ${posts.length - 10} more`);
    }
    result.imported = posts.length;
    return result;
  }

  // Real ingestion
  const engine = await d.createEngine();
  try {
    const ingestResult: SocialIngestResult = await ingestSocialPosts(engine, posts, {
      sourceRef: 'browser-capture',
      storeRawData: true,
    });
    result.imported = ingestResult.imported;
    result.skipped += ingestResult.skipped;
    result.errors += ingestResult.errors;
    if (ingestResult.errors > 0) {
      result.errorMessages.push(`${ingestResult.errors} post(s) failed during ingestion`);
    }
  } finally {
    await engine.disconnect();
  }

  return result;
}

// ── CLI entry ────────────────────────────────────────────────────

const USAGE = `
Usage: gbrain social-sync [options]

Ingest saved/bookmarked LinkedIn and X posts from browser capture JSONL
into GBrain's social-post pipeline.

Options:
  --dry-run           Show what would be ingested without writing
  --platform <plat>   Filter to platform: 'linkedin', 'x', or 'all' (default: all)
  --max N             Max posts per platform (default: 50)
  --help              Show this help message

Input: ~/.gbrain/integrations/browser-transcripts/{linkedin,x}/*.jsonl
Output: raw/sources/social/<platform>/<date>/<slug>.md
`.trimStart();

export async function runSocialSyncCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
    return;
  }
  try {
    const result = await runSocialSync(args);
    console.log(
      `\nSocial sync complete: ${result.imported} imported, ` +
      `${result.skipped} skipped, ${result.errors} errors, ` +
      `${result.totalLines} total lines read${result.dryRun ? ' (dry-run)' : ''}`,
    );
    if (result.errorMessages.length > 0) {
      console.error(`Errors (${result.errorMessages.length}):`);
      for (const err of result.errorMessages) console.error(`  - ${err}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`social-sync failed: ${msg}`);
    process.exit(1);
  }
}
