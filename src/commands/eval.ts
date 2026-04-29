/**
 * gbrain eval — Retrieval Evaluation Command
 *
 * Runs search quality benchmarks against user-defined ground truth (qrels).
 * Supports single-config runs and A/B comparison mode for tuning parameters.
 *
 * Usage:
 *   gbrain eval --qrels <path|json>
 *   gbrain eval --qrels <path> --config-a <path|json> --config-b <path|json>
 *   gbrain eval --qrels <path> --strategy hybrid --rrf-k 30 --k 5
 */

import { readFileSync, existsSync } from 'fs';
import type { BrainEngine } from '../core/engine.ts';
import {
  runEval,
  parseQrels,
  type EvalConfig,
  type EvalReport,
  type QueryResult,
} from '../core/search/eval.ts';
import { buildDeterministicAnswerEnvelope } from '../core/answer/index.ts';
import { evaluateAnswerPromotionCases, type AnswerPromotionCase } from '../core/answer/promotion-eval.ts';
import type { RecallResult } from '../core/evidence/recall.ts';

export async function runEvalCommand(engine: BrainEngine | null, args: string[]): Promise<void> {
  if (args[0] === 'answer-v2' || args[0] === 'answer') {
    await runAnswerV2EvalCommand(args.slice(1));
    return;
  }

  if (!engine) throw new Error('gbrain eval --qrels requires a brain engine; use `gbrain eval answer-v2` for fixture-only answer promotion evals');

  const opts = parseArgs(args);

  if (opts.help) {
    printHelp();
    return;
  }

  if (!opts.qrels) {
    console.error('Error: --qrels <path|json> is required\n');
    printHelp();
    process.exit(1);
  }

  let qrels;
  try {
    qrels = parseQrels(opts.qrels);
  } catch (err: any) {
    console.error(`Error loading qrels: ${err.message}`);
    process.exit(1);
  }

  if (qrels.length === 0) {
    console.error('Error: qrels file contains no queries');
    process.exit(1);
  }

  const k = opts.k ?? 5;
  const configA = buildConfig(opts, 'a');

  const { createProgress } = await import('../core/progress.ts');
  const { getCliOptions, cliOptsToProgressOptions } = await import('../core/cli-options.ts');
  const progress = createProgress(cliOptsToProgressOptions(getCliOptions()));

  if (opts.configB || opts.configBPath) {
    // A/B comparison mode
    const configB = buildConfig(opts, 'b');
    progress.start('eval.ab', qrels.length * 2);
    const onProgress = (_done: number, _total: number, q: string) => progress.tick(1, q);
    const [reportA, reportB] = await Promise.all([
      runEval(engine, qrels, configA, k, { onProgress }),
      runEval(engine, qrels, configB, k, { onProgress }),
    ]);
    progress.finish();
    printABTable(reportA, reportB, k);
  } else {
    // Single-run mode
    progress.start('eval.single', qrels.length);
    const report = await runEval(engine, qrels, configA, k, {
      onProgress: (_done, _total, q) => progress.tick(1, q),
    });
    progress.finish();
    printSingleTable(report);
  }
}

// ─────────────────────────────────────────────────────────────────
// Answer v2 promotion eval subcommand
// ─────────────────────────────────────────────────────────────────

interface AnswerV2EvalFlags {
  casesPath?: string;
  synthesis?: string;
  json: boolean;
}

function needAnswerV2Value(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseAnswerV2EvalArgs(args: string[]): AnswerV2EvalFlags {
  const flags: AnswerV2EvalFlags = { json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--cases') flags.casesPath = needAnswerV2Value(args, ++i, arg);
    else if (arg.startsWith('--cases=')) flags.casesPath = arg.slice('--cases='.length);
    else if (arg === '--synthesis') flags.synthesis = needAnswerV2Value(args, ++i, arg);
    else if (arg.startsWith('--synthesis=')) flags.synthesis = arg.slice('--synthesis='.length);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
  }
  return flags;
}

function parseAnswerV2JsonLines(raw: string): unknown[] {
  return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
}

function loadAnswerV2Cases(path: string): unknown[] {
  const raw = readFileSync(path, 'utf8');
  if (path.endsWith('.jsonl')) return parseAnswerV2JsonLines(raw);
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function toAnswerPromotionCase(item: any): AnswerPromotionCase {
  if (item?.envelope?.schema === 'gbrain.answer_envelope.v2') {
    return {
      id: String(item.id ?? item.case_id ?? item.envelope.query ?? 'case-1'),
      expected_abstain: item.expected_abstain,
      max_length: item.max_length,
      required_terms: item.required_terms,
      envelope: item.envelope,
    };
  }
  if (item?.schema === 'gbrain.answer_envelope.v2') return { id: String(item.id ?? item.query ?? 'case-1'), envelope: item };
  if (item?.query && Array.isArray(item.evidence)) {
    const recall = item as RecallResult;
    return {
      id: String(item.id ?? item.query ?? 'case-1'),
      expected_abstain: item.expected_abstain,
      max_length: item.max_length,
      required_terms: item.required_terms,
      envelope: buildDeterministicAnswerEnvelope(recall, { maxEvidence: item.maxEvidence, maxQuoteChars: item.maxQuoteChars }),
    };
  }
  throw new Error('Invalid answer-v2 case: expected envelope, recall payload, or case wrapper');
}

async function runAnswerV2EvalCommand(args: string[]): Promise<void> {
  const flags = parseAnswerV2EvalArgs(args);
  if (flags.synthesis && flags.synthesis !== 'deterministic-v2') throw new Error(`Unsupported synthesis: ${flags.synthesis}`);
  if (!flags.casesPath) throw new Error('Usage: gbrain eval answer-v2 --cases <jsonl|json> --synthesis deterministic-v2 [--json]');
  const report = evaluateAnswerPromotionCases(loadAnswerV2Cases(flags.casesPath).map(toAnswerPromotionCase));
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`schema: ${report.schema}`);
    console.log(`ok: ${report.ok}`);
    console.log(`pass_count: ${report.pass_count}`);
    console.log(`fail_count: ${report.fail_count}`);
    console.log(`recommendation: ${report.recommendation}`);
    for (const failure of report.failures) console.log(`- ${failure.case_id}: ${failure.reasons.join('; ')}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────

interface ParsedArgs {
  help: boolean;
  qrels?: string;
  configAPath?: string;
  configBPath?: string;
  configB?: EvalConfig;
  strategy?: EvalConfig['strategy'];
  rrfK?: number;
  expand?: boolean;
  dedupCosine?: number;
  dedupTypeRatio?: number;
  dedupMaxPerPage?: number;
  limit?: number;
  k?: number;
}

function parseArgs(args: string[]): ParsedArgs {
  const opts: ParsedArgs = { help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--help': case '-h': opts.help = true; break;
      case '--qrels': opts.qrels = next; i++; break;
      case '--config-a': opts.configAPath = next; i++; break;
      case '--config-b': opts.configBPath = next; i++; break;
      case '--strategy': opts.strategy = next as EvalConfig['strategy']; i++; break;
      case '--rrf-k': opts.rrfK = parseInt(next, 10); i++; break;
      case '--expand': opts.expand = true; break;
      case '--no-expand': opts.expand = false; break;
      case '--dedup-cosine': opts.dedupCosine = parseFloat(next); i++; break;
      case '--dedup-type-ratio': opts.dedupTypeRatio = parseFloat(next); i++; break;
      case '--dedup-max-per-page': opts.dedupMaxPerPage = parseInt(next, 10); i++; break;
      case '--limit': opts.limit = parseInt(next, 10); i++; break;
      case '--k': opts.k = parseInt(next, 10); i++; break;
    }
  }

  return opts;
}

function buildConfig(opts: ParsedArgs, side: 'a' | 'b'): EvalConfig {
  const pathOpt = side === 'a' ? opts.configAPath : opts.configBPath;

  // Start from file or inline JSON if provided
  let base: EvalConfig = {};
  if (pathOpt) {
    base = loadConfigFile(pathOpt);
  }

  // CLI flags override config file (only for side A — side B comes entirely from its config file)
  if (side === 'a') {
    if (opts.strategy !== undefined) base.strategy = opts.strategy;
    if (opts.rrfK !== undefined) base.rrf_k = opts.rrfK;
    if (opts.expand !== undefined) base.expand = opts.expand;
    if (opts.dedupCosine !== undefined) base.dedup_cosine_threshold = opts.dedupCosine;
    if (opts.dedupTypeRatio !== undefined) base.dedup_type_ratio = opts.dedupTypeRatio;
    if (opts.dedupMaxPerPage !== undefined) base.dedup_max_per_page = opts.dedupMaxPerPage;
    if (opts.limit !== undefined) base.limit = opts.limit;

    // Defaults for side A
    if (!base.name) base.name = 'Config A';
    if (!base.strategy) base.strategy = 'hybrid';
  } else {
    if (!base.name) base.name = 'Config B';
    if (!base.strategy) base.strategy = 'hybrid';
  }

  return base;
}

function loadConfigFile(pathOrJson: string): EvalConfig {
  const trimmed = pathOrJson.trimStart();
  if (trimmed.startsWith('{')) {
    return JSON.parse(pathOrJson) as EvalConfig;
  }
  if (!existsSync(pathOrJson)) {
    console.error(`Config file not found: ${pathOrJson}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(pathOrJson, 'utf-8')) as EvalConfig;
}

// ─────────────────────────────────────────────────────────────────
// Output formatting
// ─────────────────────────────────────────────────────────────────

function printSingleTable(report: EvalReport): void {
  const { config, k, queries } = report;
  const label = config.name ?? config.strategy ?? 'hybrid';

  console.log(`\ngbrain eval — ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'} · strategy: ${label} · k=${k}\n`);

  const COL_QUERY = 36;
  const COL_NUM = 7;
  const header = padR('Query', COL_QUERY) + padL(`P@${k}`, COL_NUM) + padL(`R@${k}`, COL_NUM) + padL('MRR', COL_NUM) + padL(`nDCG@${k}`, COL_NUM);
  const divider = '─'.repeat(header.length);

  console.log(header);
  console.log(divider);

  for (const q of queries) {
    console.log(
      padR(truncate(q.query, COL_QUERY - 1), COL_QUERY) +
      padL(fmt(q.precision_at_k), COL_NUM) +
      padL(fmt(q.recall_at_k), COL_NUM) +
      padL(fmt(q.mrr), COL_NUM) +
      padL(fmt(q.ndcg_at_k), COL_NUM),
    );
  }

  console.log(divider);
  console.log(
    padR('Mean', COL_QUERY) +
    padL(fmt(report.mean_precision), COL_NUM) +
    padL(fmt(report.mean_recall), COL_NUM) +
    padL(fmt(report.mean_mrr), COL_NUM) +
    padL(fmt(report.mean_ndcg), COL_NUM),
  );
  console.log('');
}

function printABTable(reportA: EvalReport, reportB: EvalReport, k: number): void {
  const labelA = reportA.config.name ?? 'Config A';
  const labelB = reportB.config.name ?? 'Config B';
  const n = reportA.queries.length;

  console.log(`\ngbrain eval — ${n} quer${n === 1 ? 'y' : 'ies'} · A/B comparison · k=${k}\n`);

  const COL_QUERY = 34;
  const COL_METRIC = 8;
  const COLS_PER_SIDE = 3; // P@k, MRR, nDCG@k

  // Header line 1: section labels
  const aLabel = ` ${labelA} `.slice(0, COL_METRIC * COLS_PER_SIDE - 2);
  const bLabel = ` ${labelB} `.slice(0, COL_METRIC * COLS_PER_SIDE - 2);
  const line1 =
    ' '.repeat(COL_QUERY) +
    padR(`── ${aLabel} `, COL_METRIC * COLS_PER_SIDE) +
    padR(`── ${bLabel} `, COL_METRIC * COLS_PER_SIDE) +
    `  Δ nDCG`;
  console.log(line1);

  // Header line 2: metric names
  const metricHeader = (suffix: string) =>
    padL(`P@${k}`, COL_METRIC) + padL('MRR', COL_METRIC) + padL(`nDCG@${k}`, COL_METRIC);

  const line2 =
    padR('Query', COL_QUERY) +
    metricHeader('A') +
    '  ' + metricHeader('B') +
    '  ' + padL('Δ nDCG', 10);
  console.log(line2);
  console.log('─'.repeat(line2.length));

  for (let i = 0; i < reportA.queries.length; i++) {
    const qa = reportA.queries[i];
    const qb = reportB.queries[i];
    const delta = qb.ndcg_at_k - qa.ndcg_at_k;
    const deltaStr = delta > 0 ? `+${fmt(delta)}` : fmt(delta);

    console.log(
      padR(truncate(qa.query, COL_QUERY - 1), COL_QUERY) +
      padL(fmt(qa.precision_at_k), COL_METRIC) +
      padL(fmt(qa.mrr), COL_METRIC) +
      padL(fmt(qa.ndcg_at_k), COL_METRIC) +
      '  ' +
      padL(fmt(qb.precision_at_k), COL_METRIC) +
      padL(fmt(qb.mrr), COL_METRIC) +
      padL(fmt(qb.ndcg_at_k), COL_METRIC) +
      '  ' + padL(deltaStr, 10),
    );
  }

  const divider = '─'.repeat(line2.length);
  console.log(divider);

  const meanDelta = reportB.mean_ndcg - reportA.mean_ndcg;
  const meanDeltaStr = (meanDelta > 0 ? '+' : '') + fmt(meanDelta);
  const winner = meanDelta > 0 ? ' ✓ B wins' : meanDelta < 0 ? ' ✓ A wins' : ' tie';

  console.log(
    padR('Mean', COL_QUERY) +
    padL(fmt(reportA.mean_precision), COL_METRIC) +
    padL(fmt(reportA.mean_mrr), COL_METRIC) +
    padL(fmt(reportA.mean_ndcg), COL_METRIC) +
    '  ' +
    padL(fmt(reportB.mean_precision), COL_METRIC) +
    padL(fmt(reportB.mean_mrr), COL_METRIC) +
    padL(fmt(reportB.mean_ndcg), COL_METRIC) +
    '  ' + padL(meanDeltaStr + winner, 10),
  );
  console.log('');
}

// ─────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toFixed(2);
}

function padR(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

function padL(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : ' '.repeat(width - s.length) + s;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function printHelp(): void {
  console.log(`
gbrain eval — measure and compare retrieval quality

USAGE
  gbrain eval --qrels <path>
  gbrain eval --qrels <path> --config-a <path> --config-b <path>

OPTIONS
  --qrels <path|json>         Path to qrels JSON file (required)
                              Or inline JSON: '[{"query":"...","relevant":["slug"]}]'
  --config-a <path|json>      Config for strategy A (default: hybrid with defaults)
  --config-b <path|json>      Config for strategy B (triggers A/B mode)
  --strategy <s>              Search strategy: hybrid | keyword | vector
  --rrf-k <n>                 Override RRF K constant (default: 60)
  --expand / --no-expand      Enable/disable multi-query expansion
  --dedup-cosine <f>          Override cosine dedup threshold (default: 0.85)
  --dedup-type-ratio <f>      Override type ratio cap (default: 0.6)
  --dedup-max-per-page <n>    Override max chunks per page (default: 2)
  --limit <n>                 Max results to fetch per query (default: 10)
  --k <n>                     Metric cutoff depth (default: 5)

QRELS FORMAT
  {
    "version": 1,
    "queries": [
      {
        "query": "who founded NovaMind",
        "relevant": ["people/sarah-chen", "companies/novamind"],
        "grades": { "people/sarah-chen": 3, "companies/novamind": 2 }
      }
    ]
  }
  "grades" is optional — enables graded nDCG. Without it, binary relevance is used.

CONFIG FORMAT
  { "name": "rrf-k-30", "strategy": "hybrid", "rrf_k": 30, "expand": false }

EXAMPLES
  gbrain eval --qrels ./my-queries.json
  gbrain eval --qrels ./qrels.json --strategy keyword
  gbrain eval --qrels ./qrels.json --rrf-k 30
  gbrain eval --qrels ./qrels.json --config-a baseline.json --config-b experiment.json
`.trim());
}
