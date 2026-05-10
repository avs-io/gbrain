/**
 * gbrain gog-gmail-sync — thin Gmail high-signal connector.
 *
 * Shells out to the `gog` CLI (not Google API clients) to fetch high-signal
 * Gmail threads (sent, starred, important, direct), archives raw JSON,
 * normalizes emails to markdown, and writes them as GBrain pages.
 *
 * Usage:
 *   gbrain gog-gmail-sync [--date YYYY-MM-DD] [--label <label>] [--dry-run]
 *   gbrain ops programs sync --file programs.yaml   # add to always-on via programs.yaml
 *
 * Output layout (relative to gbrain root):
 *   raw/sources/archive/gmail-gog/<date>/
 *     threads-<label>.json            — output of `gog gmail list --json`
 *     messages/
 *       <thread-id>.json              — output of `gog gmail get <id> --json`
 *   raw/sources/events/gmail-gog/<date>/
 *     <slug>.md                       — normalized email record per thread
 *
 * GBrain page layout:
 *   wiki/sources/gmail/<from-slug>/<subject-slug>
 *   (e.g. wiki/sources/gmail/google/re-google-ai-announcement)
 *
 * Does NOT access live Google data when tests run (inject mock deps).
 */

import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import type { BrainEngine } from '../core/engine.ts';
import type { PageInput } from '../core/types.ts';

// ── gog binary ──────────────────────────────────────────────────
const GOG_BIN = process.env.GOG_BIN || 'gog';

// ── Root dir (ESM-safe, uses import.meta.url) ──────────────────
// Two levels up from src/commands/ → project root
const GBRAIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ── High-signal labels to fetch ─────────────────────────────────
// These represent meaningful signal: sent mail (your outbox), starred
// (explicitly flagged), important (Gmail's priority inbox), and DIRECT
// (direct messages only, no bulk/newsletter noise).
const HIGH_SIGNAL_LABELS = ['SENT', 'STARRED', 'IMPORTANT'];

// ── Injectable deps (for testing without module-level patching) ─

export interface GogGmailSyncDeps {
  execGog(args: string[]): string;      // runs gog with args, returns stdout JSON
  writeFile(path: string, data: string): void;
  mkdir(path: string): void;
  rootDir: string;                       // override project root
  engine?: BrainEngine;                  // optional GBrain engine for page writes
  writePage?(slug: string, page: PageInput): Promise<void>; // optional page writer (engine-based)
}

function defaultDeps(): GogGmailSyncDeps {
  return {
    execGog: (args) => execFileSync(GOG_BIN, args, { encoding: 'utf8' }),
    writeFile: (p, d) => writeFileSync(p, d, 'utf8'),
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    rootDir: GBRAIN_ROOT,
  };
}

// ── Types ───────────────────────────────────────────────────────

interface GogThread {
  id: string;
  date?: string;
  from?: string;
  subject?: string;
  labels?: string[];
  snippet?: string;
  messageCount?: number;
  [k: string]: unknown;
}

interface GogListResponse {
  threads?: GogThread[];
  messages?: GogThread[];
  nextPageToken?: string;
  [k: string]: unknown;
}

export interface GmailSyncResult {
  labelsFetched: number;
  threadsFetched: number;
  messagesNormalized: number;
  pagesWritten: number;
  pagesSkipped: number;
  errors: string[];
}

// ── Helpers ─────────────────────────────────────────────────────

function slugifyThreadId(id: string): string {
  const slug = id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return 'thread-' + (slug || 'default');
}

function normalizeAddressList(val: string | string[] | undefined): string {
  if (!val) return '';
  if (Array.isArray(val)) return val.join(', ');
  return val;
}

// ── Page slug & input builders ──────────────────────────────────

function extractEmailDomain(from: string): string {
  // Extract domain from "User <user@example.com>" or bare email
  const match = from.match(/<([^>]+)>|@([^@]+)$/);
  if (match) return (match[1] || match[2] || '').split('@')[1] || 'unknown';
  return 'unknown';
}

function slugifyAddress(addr: string): string {
  if (!addr) return 'unknown';
  // Strip email brackets, normalize
  const clean = addr.replace(/<[^>]*>/g, '').trim().toLowerCase();
  const domain = extractEmailDomain(addr);
  // Use domain as the sender slug (privacy-safe)
  return domain.replace(/[^a-z0-9]/gi, '-').replace(/^-|-$/g, '');
}

function slugifySubject(subj: string): string {
  if (!subj) return 'no-subject';
  return subj
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-|-$/g, '');
}

/**
 * Build the GBrain page slug for an email thread.
 * Layout: wiki/sources/gmail/<from-domain>/<subject-slug>
 */
export function buildGmailPageSlug(thread: GogThread): string {
  const fromSlug = slugifyAddress(thread.from || '');
  const subjectSlug = slugifySubject(thread.subject || '');
  return `sources/gmail/${fromSlug}/${subjectSlug}`;
}

/**
 * Build the GBrain PageInput for an email thread.
 */
export function buildGmailPageInput(
  thread: GogThread,
  label: string,
  targetDate: string,
): PageInput {
  const subject = thread.subject || '(no subject)';
  const from = thread.from || '';
  const date = thread.date || '';
  const labels = (thread.labels || []).join(', ');
  const msgCount = thread.messageCount || 1;
  const threadId = thread.id || '';

  const frontmatter: Record<string, unknown> = {
    type: 'email',
    subject,
    from,
    date,
    labels,
    source_label: label,
    imported: targetDate,
    thread_id: threadId,
    message_count: msgCount,
    source: 'gmail-gog',
  };

  // Build compiled_truth body
  const bodyParts: string[] = [];
  if (from) bodyParts.push(`**From:** ${from}`);
  if (date) bodyParts.push(`**Date:** ${date}`);
  if (labels) bodyParts.push(`**Labels:** ${labels}`);
  if (msgCount > 1) bodyParts.push(`**Messages in thread:** ${msgCount}`);
  if (thread.snippet) {
    bodyParts.push('');
    bodyParts.push(thread.snippet.trim());
  }
  bodyParts.push('');
  bodyParts.push(`*Source: gmail-gog | Label: ${label} | Imported: ${targetDate}*`);

  return {
    type: 'email',
    title: subject,
    compiled_truth: bodyParts.join('\n'),
    timeline: '',
    frontmatter,
  };
}



// ── Markdown normalization ──────────────────────────────────────

function renderThreadMarkdown(thread: GogThread, label: string, targetDate: string): string {
  const subject = thread.subject || '(no subject)';
  const from = thread.from || '';
  const date = thread.date || '';
  const labels = (thread.labels || []).join(', ');
  const msgCount = thread.messageCount || 1;

  const lines: string[] = [
    '---',
    `subject: "${subject.replace(/"/g, '\\"')}"`,
    `from: "${from.replace(/"/g, '\\"')}"`,
    `date: "${date}"`,
  ];
  if (labels) lines.push(`labels: "${labels}"`);
  lines.push(`source_label: "${label}"`);
  lines.push(`imported: "${targetDate}"`);
  lines.push(`thread_id: "${thread.id || ''}"`);
  if (msgCount > 1) lines.push(`message_count: ${msgCount}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${subject}`);
  lines.push('');
  if (from) lines.push(`**From:** ${from}`);
  if (date) lines.push(`**Date:** ${date}`);
  if (labels) lines.push(`**Labels:** ${labels}`);
  if (msgCount > 1) lines.push(`**Messages in thread:** ${msgCount}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (thread.snippet) {
    lines.push(`*${thread.snippet.trim()}*`);
  }

  lines.push('');
  lines.push('---');
  lines.push(`*Source: gmail-gog | Label: ${label} | Imported: ${targetDate}*`);
  lines.push('');

  return lines.join('\n');
}

// ── Core logic ──────────────────────────────────────────────────

export async function runGogGmailSync(args: string[], deps?: Partial<GogGmailSyncDeps>): Promise<GmailSyncResult> {
  const d = { ...defaultDeps(), ...deps };
  const today = new Date().toISOString().slice(0, 10);

  let targetDate = today;
  let targetLabel: string | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--date' && args[i + 1]) {
      targetDate = args[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        throw new Error(`Invalid date format: ${targetDate}. Expected YYYY-MM-DD.`);
      }
    } else if (a === '--label' && args[i + 1]) {
      targetLabel = args[++i].toUpperCase();
    } else if (a === '--dry-run') {
      dryRun = true;
    }
  }

  const archiveBase = join(d.rootDir, 'raw', 'sources', 'archive', 'gmail-gog', targetDate);
  const eventsBase = join(d.rootDir, 'raw', 'sources', 'events', 'gmail-gog', targetDate);

  const result: GmailSyncResult = {
    labelsFetched: 0,
    threadsFetched: 0,
    messagesNormalized: 0,
    pagesWritten: 0,
    pagesSkipped: 0,
    errors: [],
  };

  const labelsToSync = targetLabel ? [targetLabel] : HIGH_SIGNAL_LABELS;
  result.labelsFetched = labelsToSync.length;

  // ── Step 1: Fetch thread list per label ──────────────────────

  for (const label of labelsToSync) {
    let listResp: GogListResponse;
    try {
      const output = d.execGog(['gmail', 'list', `label:${label.toLowerCase()}`, '--json']);
      listResp = JSON.parse(output) as GogListResponse;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`Failed to list threads for label "${label}": ${msg}`);
      console.error(`Error listing threads for label "${label}": ${msg}`);
      continue;
    }

    // Support both { threads: [...] } and { messages: [...] } shapes
    const threads = listResp.threads || listResp.messages || [];
    result.threadsFetched += threads.length;

    if (!dryRun) {
      d.mkdir(archiveBase);
      d.writeFile(
        join(archiveBase, `threads-${label.toLowerCase()}.json`),
        JSON.stringify(listResp, null, 2),
      );
      console.log(`  Archived ${threads.length} threads [${label}] → ${archiveBase}/threads-${label.toLowerCase()}.json`);
    } else {
      console.log(`  [dry-run] would archive ${threads.length} threads for label "${label}"`);
    }

    // ── Step 2: Normalize threads to markdown ─────────────────

    for (const thread of threads) {
      const threadId = thread.id || '';
      if (!threadId) {
        result.errors.push(`Thread missing id in label "${label}"`);
        continue;
      }

      if (!dryRun) {
        d.mkdir(eventsBase);
        const mdPath = join(eventsBase, `${slugifyThreadId(threadId)}.md`);
        d.writeFile(mdPath, renderThreadMarkdown(thread, label, targetDate));
        result.messagesNormalized++;
      }

      // ── Step 3: Write email as GBrain page ───────────────────

      if (d.writePage) {
        const pageSlug = buildGmailPageSlug(thread);
        const pageInput = buildGmailPageInput(thread, label, targetDate);
        try {
          // Deduplication: skip if page already exists with same thread id frontmatter
          const existing = await d.engine?.getPage(pageSlug);
          if (existing && existing.frontmatter?.thread_id === threadId) {
            result.pagesSkipped++;
          } else {
            await d.writePage(pageSlug, pageInput);
            result.pagesWritten++;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result.errors.push(`Failed to write page for thread "${threadId}": ${msg}`);
          console.error(`  [page-write error] thread ${threadId}: ${msg}`);
        }
      }
    }
  }

  console.log(
    `\nSync complete: ${result.labelsFetched} labels, ` +
    `${result.threadsFetched} threads, ${result.messagesNormalized} normalized, ` +
    `${result.pagesWritten} pages written, ${result.pagesSkipped} skipped${dryRun ? ' (dry-run)' : ''}`,
  );

  if (result.errors.length > 0) {
    console.error(`Errors (${result.errors.length}):`);
    for (const err of result.errors) console.error(`  - ${err}`);
  }

  return result;
}

// ── CLI entry ───────────────────────────────────────────────────

const USAGE = `
Usage: gbrain gog-gmail-sync [options]

Sync high-signal Gmail threads via the \`gog\` CLI. Fetches sent, starred,
and important mail, archives raw JSON, and normalizes emails to markdown
under raw/sources/.

Options:
  --date YYYY-MM-DD   Date partition for archive paths (default: today)
  --label <label>     Only sync this label (default: SENT, STARRED, IMPORTANT)
  --dry-run           Print what would happen without writing any files
  --help              Show this help message

Output layout:
  raw/sources/archive/gmail-gog/<date>/
    threads-<label>.json
    messages/<thread-id>.json
  raw/sources/events/gmail-gog/<date>/
    <slug>.md

Requires: gog CLI in PATH (or set GOG_BIN env var to the binary path).
`.trimStart();

export async function runGogGmailSyncCommand(args: string[], engine?: BrainEngine): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
    return; // guard for test environments where process.exit is mocked
  }

  // Build page-writer closure from engine
  const writePage = engine
    ? async (slug: string, page: PageInput) => {
        await engine.putPage(slug, page);
      }
    : undefined;

  try {
    await runGogGmailSync(args, { engine, writePage });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`gog-gmail-sync failed: ${msg}`);
    process.exit(1);
  }
}
