import type { BrainEngine } from '../core/engine.ts';
import { recallEvidence, type RecallResult } from '../core/evidence/recall.ts';

interface ParsedFlags {
  queryParts: string[];
  json: boolean;
  quotes: boolean;
  limit: number;
  before: number;
  after: number;
  sourceId?: string;
}

function printHelp(): void {
  console.log(`gbrain recall — source-backed quote recall (local CLI only)

USAGE
  gbrain recall <query> [--quotes] [--json] [--limit N] [--before N] [--after N] [--source-id id]

NOTES
  Recall returns exact stored source windows only. If no exact window can be located, it abstains.
`);
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

function parseArgs(args: string[]): ParsedFlags {
  const flags: ParsedFlags = { queryParts: [], json: false, quotes: false, limit: 5, before: 2, after: 2 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--quotes') flags.quotes = true;
    else if (arg === '--limit') flags.limit = Math.max(1, parseNonNegativeInt(needValue(args, ++i, arg), arg));
    else if (arg.startsWith('--limit=')) flags.limit = Math.max(1, parseNonNegativeInt(arg.slice('--limit='.length), '--limit'));
    else if (arg === '--before') flags.before = parseNonNegativeInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--before=')) flags.before = parseNonNegativeInt(arg.slice('--before='.length), '--before');
    else if (arg === '--after') flags.after = parseNonNegativeInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--after=')) flags.after = parseNonNegativeInt(arg.slice('--after='.length), '--after');
    else if (arg === '--source-id' || arg === '--source') flags.sourceId = needValue(args, ++i, arg);
    else if (arg.startsWith('--source-id=')) flags.sourceId = arg.slice('--source-id='.length);
    else if (arg.startsWith('--source=')) flags.sourceId = arg.slice('--source='.length);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else flags.queryParts.push(arg);
  }
  return flags;
}

function jsonOut(payload: RecallResult): void {
  console.log(JSON.stringify(payload, null, 2));
}

function formatHuman(result: RecallResult, includeQuotes: boolean): string {
  if (result.status === 'abstain') {
    const warnings = result.warnings.length ? `\nwarnings: ${result.warnings.join('; ')}` : '';
    return `ABSTAIN: no exact source window located for "${result.query}".${warnings}`;
  }

  const lines: string[] = [`HIT: ${result.evidence.length} evidence window${result.evidence.length === 1 ? '' : 's'}`];
  if (result.integration.search_source === 'alias') lines.push(`matched_by: alias (${result.integration.alias})`);
  result.evidence.forEach((ev, index) => {
    lines.push('', `[${index + 1}] ${ev.slug} ${ev.section}:L${ev.start_line}-L${ev.end_line}`);
    if (ev.title) lines.push(`title: ${ev.title}`);
    lines.push(`span: ${ev.span_id}`);
    lines.push(`quote_hash: ${ev.quote_hash}`);
    lines.push(`matched_by: ${ev.matched_by} score=${ev.score.toFixed(4)}`);
    if (includeQuotes) lines.push(`> ${ev.quote.replace(/\n/g, '\n> ')}`);
  });
  if (result.warnings.length) lines.push('', `warnings: ${result.warnings.join('; ')}`);
  return lines.join('\n');
}

export async function runRecallCommand(engine: BrainEngine | null, args: string[]): Promise<void> {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  if (!engine) throw new Error('Recall command requires a brain connection');
  const flags = parseArgs(args);
  const query = flags.queryParts.join(' ').trim();
  if (!query) throw new Error('Usage: gbrain recall <query> [--quotes] [--json]');

  const result = await recallEvidence(engine, query, {
    limit: flags.limit,
    before: flags.before,
    after: flags.after,
    sourceId: flags.sourceId,
  });

  if (flags.json) jsonOut(result);
  else console.log(formatHuman(result, flags.quotes || true));
  if (result.status === 'abstain') process.exitCode = 2;
}
