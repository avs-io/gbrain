/**
 * gbrain reflect — Reflection / Consolidation CLI
 *
 * Subcommands:
 *   gbrain reflect run [--fixtures <path>] [--context <text>] [--json] [--out <path>] [--yes]
 *   gbrain reflect notes [--fixtures <path>] [--context <text>] [--json]
 *   gbrain reflect surfacing [--fixtures <path>] [--context <text>] [--json] [--out <path>] [--yes]
 *   gbrain reflect summary [--fixtures <path>] [--context <text>] [--json]
 *
 * Reads typed-memory fixtures (JSONL), runs the reflection pipeline,
 * and outputs reflection notes + surfacing candidates.
 *
 * Guardrails:
 * - Read-only: never writes to fixtures or trusted pages.
 * - --yes required for --out file writes.
 * - Deterministic: same input → same output.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { runReflection } from '../core/memory/reflection.js';
import type { TypedMemoryItem } from '../core/memory/types.js';

function flagValue(args: string[], flag: string): string | undefined {
  const ix = args.indexOf(flag);
  if (ix >= 0 && args[ix + 1] && !args[ix + 1].startsWith('--')) return args[ix + 1];
  const hit = args.find((a) => a.startsWith(flag + '='));
  return hit ? hit.slice(flag.length + 1) : undefined;
}
function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}
function printJson(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}

function loadFixtures(path: string): TypedMemoryItem[] {
  const raw = readFileSync(path, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => JSON.parse(line) as TypedMemoryItem);
}

export async function runReflectionCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  if (!sub || sub === '--help' || sub === '-h') {
    console.log(
      `gbrain reflect run [--fixtures <path>] [--context <text>] [--json] [--out <path>] [--yes]
gbrain reflect notes [--fixtures <path>] [--context <text>] [--json]
gbrain reflect surfacing [--fixtures <path>] [--context <text>] [--json] [--out <path>] [--yes]
gbrain reflect summary [--fixtures <path>] [--context <text>] [--json]

Runs the reflection/consolidation pipeline over typed-memory fixtures.
Outputs reflection notes (staleness, contradictions, consolidation, opportunity)
and surfacing candidates with interruption-cost gating.

Guardrails: review-only, no trusted-page writes, no external messages.
--yes required for --out file writes.`
    );
    return;
  }

  const fixturesPath = flagValue(rest, '--fixtures') || flagValue(rest, '--fixture');
  const contextText = flagValue(rest, '--context') || '';
  const jsonFlag = hasFlag(rest, '--json');
  const outPath = flagValue(rest, '--out');

  // Handle --help for run subcommand before requiring --fixtures
  if (sub === 'run' && (hasFlag(rest, '--help') || hasFlag(rest, '-h'))) {
    console.log(
      `gbrain reflect run [--fixtures <path>] [--context <text>] [--json] [--out <path>] [--yes]

Runs the full reflection/consolidation pipeline over typed-memory fixtures.
Outputs reflection notes (staleness, contradictions, consolidation, opportunity)
and surfacing candidates with interruption-cost gating.

Guardrails: review-only, no trusted-page writes, no external messages.
--yes required for --out file writes.`
    );
    return;
  }

  if (!fixturesPath) {
    throw new Error('Missing required --fixtures <path> (JSONL file of typed-memory items)');
  }

  const items = loadFixtures(fixturesPath);

  if (sub === 'run') {
    const result = runReflection(items, contextText);

    if (outPath && hasFlag(rest, '--yes')) {
      writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
    }

    if (jsonFlag) {
      printJson({
        ok: true,
        schema: 'gbrain.reflection.v1',
        ...result,
        guardrails: {
          review_only: true,
          external_messages_sent: false,
          trusted_pages_edited: false,
          destructive_operations: false,
        },
        written: Boolean(outPath && hasFlag(rest, '--yes')),
      });
    } else {
      console.log(`Reflection result: ${result.reflection_notes.length} notes, ${result.surfacing_candidates.length} candidates, ${result.suppression_count} suppressed`);
      if (result.reflection_notes.length > 0) {
        console.log('\nReflection notes:');
        for (const note of result.reflection_notes) {
          console.log(`  [${note.kind}] ${note.title} (confidence: ${note.confidence.toFixed(2)})`);
          console.log(`    ${note.reason}`);
        }
      }
      if (result.surfacing_candidates.length > 0) {
        console.log('\nSurfacing candidates:');
        for (const c of result.surfacing_candidates) {
          console.log(`  ${c.id}\t${c.interruption_cost}\t${c.relevance_score.toFixed(2)}\t${c.title}`);
        }
      }
      if (result.warnings.length > 0) {
        console.log('\nWarnings:');
        for (const w of result.warnings) console.log(`  ${w}`);
      }
    }
    return;
  }

  if (sub === 'notes') {
    const notes = runReflection(items, contextText).reflection_notes;
    if (jsonFlag) {
      printJson({ ok: true, schema: 'gbrain.reflection.notes.v1', count: notes.length, notes });
    } else {
      console.log(`Reflection notes: ${notes.length}`);
      for (const note of notes) {
        console.log(`  [${note.kind}] ${note.title} (confidence: ${note.confidence.toFixed(2)})`);
        console.log(`    ${note.reason}`);
      }
    }
    return;
  }

  if (sub === 'surfacing') {
    const candidates = runReflection(items, contextText).surfacing_candidates;
    if (outPath && hasFlag(rest, '--yes')) {
      writeFileSync(outPath, JSON.stringify(candidates, null, 2) + '\n');
    }
    if (jsonFlag) {
      printJson({
        ok: true,
        schema: 'gbrain.reflection.surfacing.v1',
        candidate_count: candidates.length,
        candidates,
        guardrails: {
          review_only: true,
          external_messages_sent: false,
          trusted_pages_edited: false,
        },
        written: Boolean(outPath && hasFlag(rest, '--yes')),
      });
    } else {
      console.log(`Surfacing candidates: ${candidates.length}`);
      for (const c of candidates) {
        console.log(`  ${c.id}\t${c.interruption_cost}\t${c.relevance_score.toFixed(2)}\t${c.title}`);
      }
    }
    return;
  }

  if (sub === 'summary') {
    const result = runReflection(items, contextText);
    if (jsonFlag) {
      printJson({
        ok: true,
        schema: 'gbrain.reflection.summary.v1',
        item_count: items.length,
        context_summary: result.context_summary,
        note_count: result.reflection_notes.length,
        candidate_count: result.surfacing_candidates.length,
        suppression_count: result.suppression_count,
        warnings: result.warnings,
      });
    } else {
      console.log(
        `Summary: ${items.length} items, ${result.reflection_notes.length} notes, ${result.surfacing_candidates.length} candidates, ${result.suppression_count} suppressed`
      );
    }
    return;
  }

  throw new Error(`Unknown reflect subcommand: ${sub}. Use --help for usage.`);
}
