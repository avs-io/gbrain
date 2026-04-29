import { readFileSync } from 'node:fs';
import type { BrainEngine } from '../core/engine.ts';
import { recallEvidence, type RecallResult } from '../core/evidence/recall.ts';
import { synthesizeAnswerFromRecall, type AnswerSynthesisResult } from '../core/evidence/answer-synthesis.ts';

interface ParsedFlags {
  queryParts: string[];
  json: boolean;
  limit: number;
  before: number;
  after: number;
  sourceId?: string;
  fromRecallJson?: string;
  maxEvidence: number;
  maxQuoteChars: number;
}

function printHelp(): void {
  console.log(`gbrain answer — deterministic answer draft from exact recall evidence

USAGE
  gbrain answer <query> [--json] [--limit N] [--before N] [--after N] [--source-id id]
  gbrain answer --from-recall-json <path|-> [--json] [--max-evidence N] [--max-quote-chars N]

NOTES
  Answer synthesis is deterministic and bounded. It only restates exact gbs1 source windows.
  If recall abstains or no exact spans are supplied, answer synthesis abstains too.
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

function parsePositiveInt(value: string, flag: string): number {
  const parsed = parseNonNegativeInt(value, flag);
  if (parsed < 1) throw new Error(`Invalid ${flag}: ${value}`);
  return parsed;
}

function parseArgs(args: string[]): ParsedFlags {
  const flags: ParsedFlags = { queryParts: [], json: false, limit: 5, before: 2, after: 2, maxEvidence: 4, maxQuoteChars: 420 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--limit') flags.limit = parsePositiveInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--limit=')) flags.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    else if (arg === '--before') flags.before = parseNonNegativeInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--before=')) flags.before = parseNonNegativeInt(arg.slice('--before='.length), '--before');
    else if (arg === '--after') flags.after = parseNonNegativeInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--after=')) flags.after = parseNonNegativeInt(arg.slice('--after='.length), '--after');
    else if (arg === '--source-id' || arg === '--source') flags.sourceId = needValue(args, ++i, arg);
    else if (arg.startsWith('--source-id=')) flags.sourceId = arg.slice('--source-id='.length);
    else if (arg.startsWith('--source=')) flags.sourceId = arg.slice('--source='.length);
    else if (arg === '--from-recall-json') flags.fromRecallJson = needValue(args, ++i, arg);
    else if (arg.startsWith('--from-recall-json=')) flags.fromRecallJson = arg.slice('--from-recall-json='.length);
    else if (arg === '--max-evidence') flags.maxEvidence = parsePositiveInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--max-evidence=')) flags.maxEvidence = parsePositiveInt(arg.slice('--max-evidence='.length), '--max-evidence');
    else if (arg === '--max-quote-chars') flags.maxQuoteChars = parsePositiveInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--max-quote-chars=')) flags.maxQuoteChars = parsePositiveInt(arg.slice('--max-quote-chars='.length), '--max-quote-chars');
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else flags.queryParts.push(arg);
  }
  return flags;
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function loadRecallJson(path: string): Promise<RecallResult> {
  const raw = path === '-' ? await readStdin() : readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.query !== 'string' || !Array.isArray(parsed.evidence)) {
    throw new Error('Invalid recall JSON: expected a gbrain recall --json payload');
  }
  return parsed as RecallResult;
}

function formatHuman(result: AnswerSynthesisResult): string {
  if (result.status === 'abstain') {
    const warnings = result.warnings.length ? `\nwarnings: ${result.warnings.join('; ')}` : '';
    return `ABSTAIN: no exact source-backed answer draft for "${result.query}".${warnings}`;
  }
  const lines = [result.answer, '', 'Citations:'];
  for (const c of result.citations) {
    lines.push(`- [${c.label}] ${c.span_id} quote_hash=${c.quote_hash}`);
  }
  if (result.warnings.length) lines.push('', `warnings: ${result.warnings.join('; ')}`);
  return lines.join('\n');
}

export async function runAnswerCommand(engine: BrainEngine | null, args: string[]): Promise<void> {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const flags = parseArgs(args);
  let recall: RecallResult;
  if (flags.fromRecallJson) {
    recall = await loadRecallJson(flags.fromRecallJson);
  } else {
    if (!engine) throw new Error('Answer command requires a brain connection unless --from-recall-json is supplied');
    const query = flags.queryParts.join(' ').trim();
    if (!query) throw new Error('Usage: gbrain answer <query> [--json]');
    recall = await recallEvidence(engine, query, {
      limit: flags.limit,
      before: flags.before,
      after: flags.after,
      sourceId: flags.sourceId,
    });
  }

  const result = synthesizeAnswerFromRecall(recall, { maxEvidence: flags.maxEvidence, maxQuoteChars: flags.maxQuoteChars });
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatHuman(result));
  if (result.status === 'abstain') process.exitCode = 2;
}
