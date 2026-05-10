import { readFileSync } from 'node:fs';
import type { BrainEngine } from '../core/engine.ts';
import { analyzeRecallForAnswer } from '../core/evidence/recall-diagnostics.ts';
import { recallEvidence, type RecallResult } from '../core/evidence/recall.ts';
import { synthesizeAnswerFromRecall, type AnswerSynthesisResult } from '../core/evidence/answer-synthesis.ts';
import {
  buildDeterministicAnswerEnvelopeWithLlmAssistance,
  type AnswerEnvelope,
} from '../core/answer/index.ts';

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
  maxClaims: number;
  maxListItems: number;
  citationDensity: 'strict' | 'compact';
  synthesis: 'legacy' | 'deterministic-v2';
  diagnoseRecall: boolean;
  llmAssisted: boolean;
  llmFailOnUnsupported: boolean;
}

function printHelp(): void {
  console.log(`gbrain answer — deterministic answer draft from exact recall evidence

USAGE
  gbrain answer <query> [--json] [--limit N] [--before N] [--after N] [--source-id id]
  gbrain answer --from-recall-json <path|-> [--json] [--max-evidence N] [--max-quote-chars N]
  gbrain answer --from-recall-json <path|-> --synthesis deterministic-v2 --json
  gbrain answer --from-recall-json <path|-> --synthesis deterministic-v2 --compact
  gbrain answer diagnose-recall --from-recall-json <path|-> --json

NOTES
  Answer synthesis is deterministic and bounded. It only restates exact gbs1 source windows.
  The default renderer is unchanged; --synthesis deterministic-v2 emits the new AnswerEnvelope JSON shape.
  If recall abstains or no exact spans are supplied, answer synthesis abstains too.
  LLM-assisted deterministic-v2 synthesis is optional and disabled by default.
  Use --llm-assisted, GBRAIN_ANSWER_LLM_ASSISTED=1, or equivalent environment toggle
  to run the optional local draft+verifier boundary.
  --compact / --citation-density compact only changes human rendering; JSON remains full-detail.
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
  const flags: ParsedFlags = { queryParts: [], json: false, limit: 5, before: 2, after: 2, maxEvidence: 4, maxQuoteChars: 420, maxClaims: 4, maxListItems: 5, citationDensity: 'strict', synthesis: 'legacy', diagnoseRecall: false, llmAssisted: false, llmFailOnUnsupported: false };
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
    else if (arg === 'diagnose-recall') flags.diagnoseRecall = true;
    else if (arg.startsWith('--from-recall-json=')) flags.fromRecallJson = arg.slice('--from-recall-json='.length);
    else if (arg === '--max-evidence') flags.maxEvidence = parsePositiveInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--max-evidence=')) flags.maxEvidence = parsePositiveInt(arg.slice('--max-evidence='.length), '--max-evidence');
    else if (arg === '--max-quote-chars') flags.maxQuoteChars = parsePositiveInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--max-quote-chars=')) flags.maxQuoteChars = parsePositiveInt(arg.slice('--max-quote-chars='.length), '--max-quote-chars');
    else if (arg === '--max-claims') flags.maxClaims = parsePositiveInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--max-claims=')) flags.maxClaims = parsePositiveInt(arg.slice('--max-claims='.length), '--max-claims');
    else if (arg === '--max-list-items') flags.maxListItems = parsePositiveInt(needValue(args, ++i, arg), arg);
    else if (arg.startsWith('--max-list-items=')) flags.maxListItems = parsePositiveInt(arg.slice('--max-list-items='.length), '--max-list-items');
    else if (arg === '--compact') flags.citationDensity = 'compact';
    else if (arg === '--citation-density') {
      const value = needValue(args, ++i, arg);
      if (value !== 'strict' && value !== 'compact') throw new Error(`Unsupported --citation-density: ${value}`);
      flags.citationDensity = value;
    }
    else if (arg.startsWith('--citation-density=')) {
      const value = arg.slice('--citation-density='.length);
      if (value !== 'strict' && value !== 'compact') throw new Error(`Unsupported --citation-density: ${value}`);
      flags.citationDensity = value;
    }
    else if (arg === '--llm-assisted') flags.llmAssisted = true;
    else if (arg === '--llm-fail-on-unsupported') flags.llmFailOnUnsupported = true;
    else if (arg === '--synthesis') {
      const value = needValue(args, ++i, arg);
      if (value !== 'deterministic-v2') throw new Error(`Unsupported --synthesis: ${value}`);
      flags.synthesis = value;
    }
    else if (arg.startsWith('--synthesis=')) {
      const value = arg.slice('--synthesis='.length);
      if (value !== 'deterministic-v2') throw new Error(`Unsupported --synthesis: ${value}`);
      flags.synthesis = value;
    }
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else flags.queryParts.push(arg);
  }
  return flags;
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function shouldEnableLlmAssisted(flags: ParsedFlags): boolean {
  return flags.llmAssisted
    || parseBooleanEnv(process.env.GBRAIN_ANSWER_LLM_ASSISTED)
    || parseBooleanEnv(process.env.GBRAIN_LLM_ASSISTED_ANSWER);
}

function shouldFailOnUnsupported(flags: ParsedFlags): boolean {
  return flags.llmFailOnUnsupported || parseBooleanEnv(process.env.GBRAIN_ANSWER_LLM_FAIL_ON_UNSUPPORTED);
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function containsSyntheticEvidence(recall: RecallResult): boolean {
  return recall.evidence.some((e: any) => String(e.span_id || e.id || '').startsWith('syn:') || String(e.source_id || '').startsWith('syn:'));
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

function citationLabelForRefs(refs: AnswerEnvelope['claims'][number]['citations']): string {
  return refs.length ? ` [${refs.map(ref => ref.label).join(', ')}]` : '';
}

function formatCompactEnvelopeHuman(result: AnswerEnvelope, maxClaims: number, maxListItems: number): string {
  if (result.status === 'abstain') {
    const warnings = result.warnings.length ? `\nwarnings: ${result.warnings.join('; ')}` : '';
    return `ABSTAIN: no exact source-backed AnswerEnvelope for "${result.query}".${warnings}`;
  }
  if (result.status === 'invalid') return `INVALID: ${result.validation.errors.join('; ')}`;

  const lines = ['Compact answer:'];
  const citedIds = new Set<string>();
  const addCitations = (refs: AnswerEnvelope['claims'][number]['citations']) => {
    for (const ref of refs) citedIds.add(ref.id);
  };

  let emitted = 0;
  for (const claim of result.claims) {
    if (!claim.factual || !claim.text.trim()) continue;
    const listItems = claim.listItems?.filter(item => item.text.trim()) ?? [];
    if (listItems.length > 0) {
      if (emitted >= maxClaims) break;
      lines.push(`- ${claim.text.trim()}${citationLabelForRefs(claim.citations)}`);
      addCitations(claim.citations);
      emitted++;
      for (const item of listItems.slice(0, maxListItems)) {
        lines.push(`  - ${item.text.trim()}${citationLabelForRefs(item.citations)}`);
        addCitations(item.citations);
      }
      continue;
    }
    lines.push(`- ${claim.text.trim()}${citationLabelForRefs(claim.citations)}`);
    addCitations(claim.citations);
    emitted++;
    if (emitted >= maxClaims) break;
  }

  if (emitted === 0) lines.push('- No compact-supported factual claims were emitted under current bounds.');

  lines.push('', 'Provenance summary:');
  const citations = result.citations.filter(citation => citedIds.has(citation.id)).slice(0, Math.max(1, maxClaims));
  if (citations.length === 0) lines.push('- none');
  else {
    for (const citation of citations) lines.push(`- [${citation.label}] ${citation.id} source=${citation.source.slug}`);
  }
  if (result.status === 'partial') lines.push('', `partial: missing_slots=${result.missingSlots.join(', ')}`);
  if (result.warnings.length) lines.push('', `warnings: ${result.warnings.join('; ')}`);
  return lines.join('\n');
}

function formatEnvelopeHuman(result: AnswerEnvelope): string {
  if (result.status === 'abstain') {
    const warnings = result.warnings.length ? `\nwarnings: ${result.warnings.join('; ')}` : '';
    return `ABSTAIN: no exact source-backed AnswerEnvelope for "${result.query}".${warnings}`;
  }
  if (result.status === 'invalid') return `INVALID: ${result.validation.errors.join('; ')}`;
  const lines = [result.answer, '', 'Citations:'];
  for (const c of result.citations) {
    lines.push(`- [${c.label}] ${c.id} quote_hash=${c.quoteHash ?? ''}`);
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

  if (flags.diagnoseRecall) {
    const result = analyzeRecallForAnswer(recall);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log([`Recall diagnostics for "${result.query}"`, `ok: ${result.ok}`, `recommendation: ${result.recommendation}`, `evidence_count: ${result.evidence_count}`, `gbs1_count: ${result.gbs1_count}`, `non_gbs1_count: ${result.non_gbs1_count}`, `duplicate_span_count: ${result.duplicate_span_count}`, `source_count: ${result.source_count}`, `top_sources: ${result.top_sources.map(s => `${s.source}:${s.count}`).join(', ') || 'none'}`, result.warnings.length ? `warnings: ${result.warnings.join('; ')}` : 'warnings: none'].join('\n'));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (containsSyntheticEvidence(recall)) throw new Error('Synthetic evidence is not eligible for memory or citation-backed answers');

  if (flags.synthesis === 'deterministic-v2') {
    const result = buildDeterministicAnswerEnvelopeWithLlmAssistance(recall, {
      maxEvidence: flags.maxEvidence,
      maxQuoteChars: flags.maxQuoteChars,
      llmSynthesisEnabled: shouldEnableLlmAssisted(flags),
      llmFailOnUnsupported: shouldFailOnUnsupported(flags),
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (flags.citationDensity === 'compact') console.log(formatCompactEnvelopeHuman(result, flags.maxClaims, flags.maxListItems));
    else console.log(formatEnvelopeHuman(result));
    if (result.status === 'abstain' || result.status === 'invalid') process.exitCode = result.status === 'abstain' ? 2 : 1;
    return;
  }

  const result = synthesizeAnswerFromRecall(recall, { maxEvidence: flags.maxEvidence, maxQuoteChars: flags.maxQuoteChars });
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatHuman(result));
  if (result.status === 'abstain') process.exitCode = 2;
}
