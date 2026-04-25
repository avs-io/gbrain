/**
 * gbrain gog-gmail-sync — thin Gmail high-signal connector.
 *
 * Shells out to the `gog` CLI (not Google API clients) to fetch high-signal
 * Gmail threads (sent, starred, important, direct), archives raw JSON, and
 * normalizes emails to markdown with frontmatter.
 *
 * Usage:
 *   gbrain gog-gmail-sync [--date YYYY-MM-DD] [--label <label>] [--dry-run]
 *
 * Output layout (relative to gbrain root):
 *   raw/sources/archive/gmail-gog/<date>/
 *     threads-<label>.json            — output of `gog gmail list --json`
 *     messages/
 *       <thread-id>.json              — output of `gog gmail get <id> --json`
 *   raw/sources/events/gmail-gog/<date>/
 *     <slug>.md                       — normalized email record per thread
 *
 * Does NOT access live Google data when tests run (inject mock deps).
 */

import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

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

interface GogMessage {
  id: string;
  threadId?: string;
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  subject?: string;
  date?: string;
  snippet?: string;
  body?: string;
  labels?: string[];
  [k: string]: unknown;
}

interface GogListResponse {
  threads?: Array<{ id: string; snippet?: string; [k: string]: unknown }>;
  messages?: GogMessage[];
  [k: string]: unknown;
}

interface GogGetResponse {
  message?: GogMessage;
  // Some gog versions return the message directly at top level
  id?: string;
  from?: string;
  subject?: string;
  [k: string]: unknown;
}

export interface GmailSyncResult {
  labelsFetched: number;
  threadsFetched: number;
  messagesNormalized: number;
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

function extractMessage(resp: GogGetResponse): GogMessage | null {
  // gog may return { message: {...} } or the message directly at top level
  if (resp.message && resp.message.id) return resp.message;
  if (resp.id) return resp as unknown as GogMessage;
  return null;
}

// ── Markdown normalization ──────────────────────────────────────

function renderEmailMarkdown(msg: GogMessage, label: string, targetDate: string): string {
  const subject = msg.subject || '(no subject)';
  const from = msg.from || '';
  const to = normalizeAddressList(msg.to);
  const cc = normalizeAddressList(msg.cc);
  const date = msg.date || '';
  const labels = (msg.labels || []).join(', ');

  const lines: string[] = [
    '---',
    `subject: "${subject.replace(/"/g, '\\"')}"`,
    `from: "${from.replace(/"/g, '\\"')}"`,
    `to: "${to.replace(/"/g, '\\"')}"`,
  ];
  if (cc) lines.push(`cc: "${cc.replace(/"/g, '\\"')}"`);
  lines.push(`date: "${date}"`);
  if (labels) lines.push(`labels: "${labels}"`);
  lines.push(`source_label: "${label}"`);
  lines.push(`imported: "${targetDate}"`);
  lines.push(`thread_id: "${msg.id || ''}"`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${subject}`);
  lines.push('');
  if (from) lines.push(`**From:** ${from}`);
  if (to) lines.push(`**To:** ${to}`);
  if (cc) lines.push(`**CC:** ${cc}`);
  if (date) lines.push(`**Date:** ${date}`);
  if (labels) lines.push(`**Labels:** ${labels}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (msg.body) {
    lines.push(msg.body.trim());
  } else if (msg.snippet) {
    lines.push(`*${msg.snippet.trim()}*`);
  }

  lines.push('');
  lines.push('---');
  lines.push(`*Source: gmail-gog | Label: ${label} | Imported: ${targetDate}*`);
  lines.push('');

  return lines.join('\n');
}

// ── Core logic ──────────────────────────────────────────────────

export function runGogGmailSync(args: string[], deps?: Partial<GogGmailSyncDeps>): GmailSyncResult {
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
    errors: [],
  };

  const labelsToSync = targetLabel ? [targetLabel] : HIGH_SIGNAL_LABELS;
  result.labelsFetched = labelsToSync.length;

  // ── Step 1: Fetch thread list per label ──────────────────────

  for (const label of labelsToSync) {
    let listResp: GogListResponse;
    try {
      const output = d.execGog(['gmail', 'list', '--label', label, '--json']);
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

    // ── Step 2: Fetch each thread's full message ──────────────

    for (const thread of threads) {
      const threadId = (thread as { id?: string }).id || '';
      if (!threadId) {
        result.errors.push(`Thread missing id in label "${label}"`);
        continue;
      }

      let msgResp: GogGetResponse;
      try {
        const output = d.execGog(['gmail', 'get', threadId, '--json']);
        msgResp = JSON.parse(output) as GogGetResponse;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push(`Failed to fetch thread "${threadId}": ${msg}`);
        console.error(`Error fetching thread "${threadId}": ${msg}`);
        continue;
      }

      const message = extractMessage(msgResp);
      if (!message) {
        result.errors.push(`Thread "${threadId}" returned no parseable message`);
        continue;
      }

      if (!dryRun) {
        const messagesDir = join(archiveBase, 'messages');
        d.mkdir(messagesDir);
        d.writeFile(
          join(messagesDir, `${slugifyThreadId(threadId)}.json`),
          JSON.stringify(msgResp, null, 2),
        );

        // ── Step 3: Normalize to markdown ─────────────────────

        d.mkdir(eventsBase);
        const mdPath = join(eventsBase, `${slugifyThreadId(threadId)}.md`);
        d.writeFile(mdPath, renderEmailMarkdown(message, label, targetDate));
        result.messagesNormalized++;
      }
    }
  }

  console.log(
    `\nSync complete: ${result.labelsFetched} labels, ` +
    `${result.threadsFetched} threads, ${result.messagesNormalized} normalized${dryRun ? ' (dry-run)' : ''}`,
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

export async function runGogGmailSyncCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
    return; // guard for test environments where process.exit is mocked
  }
  try {
    runGogGmailSync(args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`gog-gmail-sync failed: ${msg}`);
    process.exit(1);
  }
}
