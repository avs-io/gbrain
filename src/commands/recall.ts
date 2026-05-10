import type { BrainEngine } from '../core/engine.ts';
import { recallEvidence, type RecallResult } from '../core/evidence/recall.ts';
import { classifyQuery, type QueryClassification } from '../core/memory/query-classifier.ts';

interface ParsedFlags {
  queryParts: string[];
  json: boolean;
  classify: boolean;
  limit: number;
  before: number;
  after: number;
  sourceId?: string;
  conversationOnly: boolean;
  showGenesis: boolean;
  timeline: boolean;
}

function printHelp(): void {
  console.log(`gbrain recall — source-backed quote recall (local CLI only)

USAGE
  gbrain recall <query> [--json] [--conversation-only] [--show-genesis] [--timeline] [--classify] [--limit N] [--before N] [--after N] [--source-id id]

NOTES
  Recall returns exact stored source windows only. If no exact window can be located, it abstains.
  --conversation-only restricts output to conversation-derived recall windows.
  --show-genesis prioritizes genesis-style source windows.
  --timeline restricts output to timeline section windows.
  --classify runs the query classifier and passes routing hints to recallEvidence() for source-page targeting.
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
  const flags: ParsedFlags = {
    queryParts: [],
    json: false,
    classify: false,
    limit: 5,
    before: 2,
    after: 2,
    conversationOnly: false,
    showGenesis: false,
    timeline: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--classify') flags.classify = true;
    else if (arg === '--conversation-only') flags.conversationOnly = true;
    else if (arg === '--show-genesis') flags.showGenesis = true;
    else if (arg === '--timeline') flags.timeline = true;
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

function jsonOut(payload: RecallResult, classification?: QueryClassification): void {
  const output: Record<string, unknown> = { result: payload };
  if (classification) {
    output.classification = {
      intent: classification.intent,
      confidence: classification.confidence,
      memory_types: classification.memory_types,
      entities: classification.entities,
      tags: classification.tags,
      matched_route_ids: classification.matched_route_ids,
      is_proactive: classification.is_proactive,
      needs_context: classification.needs_context,
      routing_hint: classification.routing_hint,
    };
  }
  console.log(JSON.stringify(output, null, 2));
}

interface StrictFilter {
  title: string;
  matches: (ev: { source_id: string; slug: string; section: string }) => boolean;
}

function strictFilters(flags: ParsedFlags): StrictFilter[] {
  const filters: StrictFilter[] = [];
  if (flags.conversationOnly) {
    filters.push({
      title: 'conversation-only',
      matches: ev => ev.source_id === 'default' && ev.slug.includes('sources/chatgpt/'),
    });
  }
  if (flags.showGenesis) {
    filters.push({
      title: 'show-genesis',
      matches: ev => ev.slug.includes('full-export-all'),
    });
  }
  if (flags.timeline) {
    filters.push({
      title: 'timeline',
      matches: ev => ev.section === 'timeline',
    });
  }
  return filters;
}

function applyStrictMode(result: RecallResult, flags: ParsedFlags): RecallResult {
  const filters = strictFilters(flags);
  if (!filters.length) return result;
  const filteredEvidence = result.evidence.filter((ev) => filters.every((filter) => filter.matches(ev)));
  const keptAll = filteredEvidence.length === result.evidence.length;
  if (keptAll) return result;
  const filteredWarnings = filters.length
    ? result.warnings.concat(`strict recall flags removed all non-conforming windows: ${filters.map((f) => f.title).join(', ')}`)
    : result.warnings.slice();
  if (filteredEvidence.length === 0 && result.status === 'hit') {
    return {
      ...result,
      status: 'abstain',
      evidence: [],
      warnings: filteredWarnings,
      integration: {
        ...result.integration,
        search_source: 'none',
      },
    };
  }
  return {
    ...result,
    evidence: filteredEvidence,
    warnings: filteredWarnings,
  };
}

function shouldSetProcessExitCode(): boolean {
  return !(process.env.NODE_ENV === 'test' && process.argv[1]?.endsWith('.test.ts'));
}

function formatHuman(result: RecallResult, includeQuotes: boolean, classification?: QueryClassification): string {
  if (result.status === 'abstain') {
    const warnings = result.warnings.length ? `\nwarnings: ${result.warnings.join('; ')}` : '';
    let extra = '';
    if (classification) {
      extra = `\nclassification: ${classification.intent} (confidence: ${classification.confidence.toFixed(2)})`;
      if (classification.matched_route_ids.length) extra += `\n  routes: ${classification.matched_route_ids.join(', ')}`;
    }
    return `ABSTAIN: no exact source window located for "${result.query}".${warnings}${extra}`;
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
  if (classification) {
    lines.push('', `classification: ${classification.intent} (confidence: ${classification.confidence.toFixed(2)})`);
    if (classification.matched_route_ids.length) lines.push(`  routes: ${classification.matched_route_ids.join(', ')}`);
    if (classification.entities.length) lines.push(`  entities: ${classification.entities.join(', ')}`);
    if (classification.routing_hint) lines.push(`  routing_hint: ${classification.routing_hint}`);
  }
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
  if (!query) throw new Error('Usage: gbrain recall <query> [--json] [--conversation-only] [--show-genesis] [--timeline] [--source-id id]');

  let classification: QueryClassification | undefined;
  if (flags.classify) {
    classification = classifyQuery(query);
  }

  const strictResult = applyStrictMode(await recallEvidence(engine, query, {
    limit: flags.limit,
    before: flags.before,
    after: flags.after,
    sourceId: flags.sourceId,
    classification,
  }), flags);

  if (flags.json) jsonOut(strictResult, classification);
  else console.log(formatHuman(strictResult, true, classification));
  if (strictResult.status === 'abstain' && shouldSetProcessExitCode()) process.exitCode = 2;
}
