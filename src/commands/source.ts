import type { BrainEngine } from '../core/engine.ts';
import {
  aroundSpan,
  buildSourceDocument,
  grepDocument,
  parseSpanId,
  showLines,
  type SourceDocument,
  type SourceWindow,
} from '../core/evidence/source-window.ts';

type SourceSectionName = 'compiled_truth' | 'timeline';

interface PageRow {
  id?: number;
  slug: string;
  source_id?: string | null;
  title?: string | null;
  compiled_truth?: string | null;
  timeline?: string | null;
  type?: string | null;
}

interface ParsedFlags {
  positionals: string[];
  json: boolean;
  sourceId?: string;
  section?: string;
  lines?: string;
  before?: number;
  after?: number;
  near?: string;
  limit: number;
}

function printHelp(): void {
  console.log(`gbrain source — inspect exact stored source windows (local CLI only)

USAGE
  gbrain source show <slug> [--source-id <id>] [--section compiled_truth|timeline] [--lines A:B] [--json]
  gbrain source around <span-id> [--before 5] [--after 5] [--json]
  gbrain source grep <slug> <phrase> [--near <phrase>] [--before 3] [--after 3] [--source-id <id>] [--json]

NOTES
  Line numbers are 1-indexed offsets in the stored GBrain section text (line_basis=stored_section).
  Span IDs are deterministic virtual IDs: gbs1:<source_id>:<slug>#<section>:L<start>-L<end>.
`);
}

function parseArgs(args: string[]): ParsedFlags {
  const flags: ParsedFlags = { positionals: [], json: false, limit: 20 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--source-id' || arg === '--source') flags.sourceId = needValue(args, ++i, arg);
    else if (arg.startsWith('--source-id=')) flags.sourceId = arg.slice('--source-id='.length);
    else if (arg.startsWith('--source=')) flags.sourceId = arg.slice('--source='.length);
    else if (arg === '--section') flags.section = needValue(args, ++i, arg);
    else if (arg.startsWith('--section=')) flags.section = arg.slice('--section='.length);
    else if (arg === '--lines') flags.lines = needValue(args, ++i, arg);
    else if (arg.startsWith('--lines=')) flags.lines = arg.slice('--lines='.length);
    else if (arg === '--before') flags.before = parseNonNegativeInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--before=')) flags.before = parseNonNegativeInt(arg.slice('--before='.length), '--before');
    else if (arg === '--after') flags.after = parseNonNegativeInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--after=')) flags.after = parseNonNegativeInt(arg.slice('--after='.length), '--after');
    else if (arg === '--near') flags.near = needValue(args, ++i, arg);
    else if (arg.startsWith('--near=')) flags.near = arg.slice('--near='.length);
    else if (arg === '--limit') flags.limit = Math.max(1, parseNonNegativeInt(needValue(args, ++i, arg), arg));
    else if (arg.startsWith('--limit=')) flags.limit = Math.max(1, parseNonNegativeInt(arg.slice('--limit='.length), '--limit'));
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else flags.positionals.push(arg);
  }
  return flags;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseNonNegativeInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid ${flag}: ${value}`);
  return parsed;
}

function parseSection(value: string | undefined, doc: SourceDocument): SourceSectionName {
  if (value) {
    if (value !== 'compiled_truth' && value !== 'timeline') throw new Error(`Invalid --section: ${value}`);
    if (!doc.sections[value]) throw new Error(`Source section not found: ${value}`);
    return value;
  }
  if (doc.sections.compiled_truth) return 'compiled_truth';
  if (doc.sections.timeline) return 'timeline';
  throw new Error('Source page has no inspectable compiled_truth or timeline section');
}

function parseLines(value: string | undefined, doc: SourceDocument, section: string): { start: number; end: number } {
  const max = doc.sections[section]?.lines.length ?? 0;
  if (!value) return { start: 1, end: Math.max(1, max) };
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid --lines: ${value} (expected A:B)`);
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new Error(`Invalid --lines range: ${value}`);
  }
  return { start, end };
}

async function loadSourceDocument(engine: BrainEngine, slug: string, sourceId?: string): Promise<SourceDocument> {
  const rows = await engine.executeRaw<PageRow>(
    `SELECT p.id, p.slug, p.source_id, p.title, p.compiled_truth, p.timeline, p.type
       FROM pages p
      WHERE p.slug = $1 AND ($2::text IS NULL OR p.source_id = $2)
      ORDER BY (p.source_id = 'default') DESC, p.source_id ASC
      LIMIT 2`,
    [slug, sourceId ?? null],
  );

  if (rows.length === 0) {
    throw new Error(sourceId ? `Source page not found: ${sourceId}:${slug}` : `Source page not found: ${slug}`);
  }
  if (!sourceId && rows.length > 1) {
    const candidates = rows.map((row) => `${row.source_id ?? 'default'}:${row.slug}`).join(', ');
    throw new Error(`Ambiguous source slug: ${slug}. Re-run with --source-id. Candidates: ${candidates}`);
  }
  return buildSourceDocument(rows[0]);
}

function pageEnvelope(doc: SourceDocument) {
  return { source_id: doc.sourceId, slug: doc.slug, title: doc.title, line_basis: 'stored_section' as const };
}

function windowEnvelope(window: SourceWindow) {
  return {
    source_id: window.sourceId,
    slug: window.slug,
    section: window.section,
    start_line: window.startLine,
    end_line: window.endLine,
    span_id: window.spanId,
    quote: window.quote,
    quote_hash: window.quoteHash,
    line_basis: window.lineBasis,
    score: window.score,
    matched_by: window.matchedBy,
  };
}

function jsonOut(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function formatWindow(window: SourceWindow, index?: number): string {
  const prefix = index == null ? '' : `[${index}] `;
  return `${prefix}${window.slug} ${window.section}:L${window.startLine}-L${window.endLine}\nspan: ${window.spanId}\nquote_hash: ${window.quoteHash}\n> ${window.quote.replace(/\n/g, '\n> ')}`;
}

async function showCommand(engine: BrainEngine, flags: ParsedFlags): Promise<void> {
  const [slug] = flags.positionals;
  if (!slug) throw new Error('Usage: gbrain source show <slug> [--source-id <id>] [--section compiled_truth|timeline] [--lines A:B] [--json]');
  const doc = await loadSourceDocument(engine, slug, flags.sourceId);
  const section = parseSection(flags.section, doc);
  const { start, end } = parseLines(flags.lines, doc, section);
  const window = showLines(doc, section, start, end);
  if (flags.json) jsonOut({ status: 'hit', page: pageEnvelope(doc), window: windowEnvelope(window) });
  else console.log(formatWindow(window));
}

async function aroundCommand(engine: BrainEngine, flags: ParsedFlags): Promise<void> {
  const [spanId] = flags.positionals;
  if (!spanId) throw new Error('Usage: gbrain source around <span-id> [--before 5] [--after 5] [--json]');
  const span = parseSpanId(spanId);
  const doc = await loadSourceDocument(engine, span.slug, span.sourceId);
  const window = aroundSpan(doc, span, flags.before ?? 5, flags.after ?? 5);
  if (flags.json) jsonOut({ status: 'hit', page: pageEnvelope(doc), window: windowEnvelope(window), requested_span_id: spanId });
  else console.log(formatWindow(window));
}

async function grepCommand(engine: BrainEngine, flags: ParsedFlags): Promise<void> {
  const [slug, phrase] = flags.positionals;
  if (!slug || !phrase) throw new Error('Usage: gbrain source grep <slug> <phrase> [--near <phrase>] [--before 3] [--after 3] [--source-id <id>] [--json]');
  const doc = await loadSourceDocument(engine, slug, flags.sourceId);
  const section = flags.section ? parseSection(flags.section, doc) : undefined;
  const windows = grepDocument(doc, phrase, {
    section,
    near: flags.near,
    before: flags.before ?? 3,
    after: flags.after ?? 3,
    limit: flags.limit,
  });
  if (flags.json) jsonOut({ status: windows.length ? 'hit' : 'miss', page: pageEnvelope(doc), query: { phrase, near: flags.near }, windows: windows.map(windowEnvelope) });
  else if (windows.length === 0) console.log(`No source windows matched "${phrase}".`);
  else console.log(windows.map((window, idx) => formatWindow(window, idx + 1)).join('\n\n'));
}

export async function runSourceCommand(engine: BrainEngine | null, args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === '--help' || sub === '-h') {
    printHelp();
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  if (!engine) throw new Error('Source command requires a brain connection');

  const flags = parseArgs(args.slice(1));
  if (sub === 'show') await showCommand(engine, flags);
  else if (sub === 'around') await aroundCommand(engine, flags);
  else if (sub === 'grep') await grepCommand(engine, flags);
  else throw new Error(`Unknown source subcommand: ${sub}`);
}
