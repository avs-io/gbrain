#!/usr/bin/env bun
/**
 * write-enriched-bookmarks.ts
 *
 * Ops script: reads enriched X bookmark JSONs and writes remember/act decisions
 * as GBrain pages at wiki/sources/bookmarks/{platform}/{author}/{slug}.
 *
 * Usage:
 *   bun run src/ops/write-enriched-bookmarks.ts [--limit N] [--dry-run] [--json] [--out <result.json>]
 *
 * This is a thin wrapper around runEnrichmentPipeline() from
 * src/core/ops/bookmark-enrichment-writer.ts — the actual page-writing logic lives
 * in writeBookmarkPagesAsBrainPages() inside bookmark-deep-radar.ts.
 *
 * The pipeline:
 *   1. Read enrichment-queue.jsonl (350 items, all platform x)
 *   2. Cross-reference with enrichment-status.jsonl for "enriched" (not "snippet_only") outcomes
 *   3. Read each enriched JSON file (~3KB each, full_post + media + outbound links)
 *   4. Normalize into BookmarkDeepInput format
 *   5. Run bookmark-deep-radar classification + scoring
 *   6. For "remember" and "act" decisions → write GBrain pages via engine.putPage
 *   7. "investigate"/"act" decisions also create work items (existing behavior preserved)
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { runEnrichmentPipeline, type EnrichmentPipelineOptions } from '../core/ops/bookmark-enrichment-writer.ts';

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------

const home = process.env.HOME || '';
const DEFAULT_ENRICHMENT_QUEUE = join(home, '.gbrain/integrations/enrichment-queue.jsonl');
const DEFAULT_ENRICHMENT_STATUS = join(home, '.gbrain/integrations/enrichment-status.jsonl');
const DEFAULT_ENRICHED_DIR = join(home, '.gbrain/integrations/enriched');

// --------------------------------------------------------------------------
// Argument parsing
// --------------------------------------------------------------------------

interface CliArgs {
  limit?: number;
  surfaceMinScore?: number;
  interruptMinScore?: number;
  dryRun: boolean;
  json: boolean;
  out?: string;
  queuePath?: string;
  statusPath?: string;
  enrichedDir?: string;
  pagesOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, json: false, pagesOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--surface-min-score') args.surfaceMinScore = Number(argv[++i]);
    else if (a === '--interrupt-min-score') args.interruptMinScore = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--json') args.json = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--queue') args.queuePath = argv[++i];
    else if (a === '--status') args.statusPath = argv[++i];
    else if (a === '--enriched-dir') args.enrichedDir = argv[++i];
    else if (a === '--pages-only') args.pagesOnly = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`write-enriched-bookmarks.ts

Read enriched X bookmark JSONs and write remember/act decisions as GBrain pages.

Usage:
  bun run src/ops/write-enriched-bookmarks.ts [flags]

Flags:
  --limit N                Limit to N queue items (default: all)
  --surface-min-score N     Surface-min score threshold (default: 70)
  --interrupt-min-score N  Interrupt score threshold (default: 90)
  --dry-run                Run without BrainEngine (pages won't be written)
  --json                   Output full JSON result
  --out <path>             Write result JSON to path
  --queue <path>           Path to enrichment-queue.jsonl
  --status <path>          Path to enrichment-status.jsonl
  --enriched-dir <path>    Directory containing enriched JSONs
  --pages-only             Skip work item enqueuement
  --help, -h               Show this help

Output format (tab-separated summary):
  queue_items=N  processed=N  enriched=N  pages_written=N  work_items=N
    decision_type: N
`);
}

// --------------------------------------------------------------------------
// Engine setup (same pattern as cli.ts)
// --------------------------------------------------------------------------

async function connectEngine() {
  const { loadConfig, toEngineConfig } = await import('../core/config.ts');
  const config = loadConfig();
  if (!config) {
    throw new Error('No brain configured. Run: gbrain init');
  }
  const { createEngine } = await import('../core/engine-factory.ts');
  const engine = await createEngine(toEngineConfig(config));
  const { connectWithRetry } = await import('../core/db.ts');
  await connectWithRetry(engine, toEngineConfig(config), { noRetry: true });
  return engine;
}

async function getEngine(): Promise<import('../core/engine.js').BrainEngine | null> {
  try {
    return await connectEngine();
  } catch (err) {
    console.error('Failed to load BrainEngine:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main(argv: string[]) {
  const args = parseArgs(argv.slice(2));

  // Verify inputs exist
  const queuePath = args.queuePath || DEFAULT_ENRICHMENT_QUEUE;
  const statusPath = args.statusPath || DEFAULT_ENRICHMENT_STATUS;

  if (!existsSync(queuePath)) {
    console.error(`ERROR: enrichment-queue.jsonl not found at ${queuePath}`);
    process.exit(1);
  }
  if (!existsSync(statusPath)) {
    console.error(`ERROR: enrichment-status.jsonl not found at ${statusPath}`);
    process.exit(1);
  }

  // Get engine (null in dry-run)
  const engine = args.dryRun ? null : await getEngine();
  if (!engine && !args.dryRun) {
    console.error('ERROR: Could not initialize BrainEngine. Use --dry-run to run without engine.');
    process.exit(1);
  }

  const options: EnrichmentPipelineOptions = {
    queuePath,
    statusPath,
    enrichedDir: args.enrichedDir || DEFAULT_ENRICHED_DIR,
    engine: engine!,
    surfaceMinScore: args.surfaceMinScore,
    interruptMinScore: args.interruptMinScore,
    limit: args.limit,
    pagesOnly: args.pagesOnly,
    now: new Date(),
  };

  const result = await runEnrichmentPipeline(options);

  if (args.json || args.out) {
    const output = JSON.stringify(result, null, 2);
    if (args.out) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(args.out, output + '\n');
      console.error(`Wrote result to ${args.out}`);
    } else {
      console.log(output);
    }
  } else {
    // Tab-separated summary for humans
    console.log(
      `queue_items=${result.total_queue_items}\t` +
      `processed=${result.processed}\t` +
      `enriched=${result.enriched_found}\t` +
      `pages_written=${result.pages_written}\t` +
      `work_items=${result.work_items_created}\t` +
      `skipped=${result.skipped_non_actionable}\t` +
      `duration_ms=${result.duration_ms}`
    );
    for (const [k, v] of Object.entries(result.decisions_by_type)) {
      console.log(`  ${k}: ${v}`);
    }
    if (result.errors.length) {
      console.error(`ERRORS: ${result.errors.join('; ')}`);
    }
  }

  process.exit(result.errors.length > 0 ? 1 : 0);
}

main(process.argv).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});