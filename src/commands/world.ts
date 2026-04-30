import { readFileSync, writeFileSync } from 'node:fs';

import { extractWorldCandidatesFromScout, validateWorldExtractionReport } from '../core/world/extractor.ts';
import { backfillTimelineEntriesFromExtractions, readWorldExtractionReports } from '../core/intelligence/data-hygiene.ts';
import {
  appendSynthesisSurface,
  compileTopicState,
  readClaimLedgerFile,
  readWorldExtractionFile,
  validateTopicStateSurface,
} from '../core/world/topic-state.ts';
import type { ScoutRunReport } from '../core/scout/runner.ts';

function parseArgs(args: string[]): Record<string, string | boolean | undefined> {
  const out: Record<string, string | boolean | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    if (a.startsWith('--') && a.includes('=')) {
      const [k, v] = a.slice(2).split(/=(.*)/s, 2);
      out[k.replace(/-/g, '_')] = v;
    } else if (a.startsWith('--')) {
      const k = a.slice(2).replace(/-/g, '_');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) out[k] = next, i++;
      else out[k] = true;
    } else if (!out._pos1) out._pos1 = a;
    else if (!out._pos2) out._pos2 = a;
  }
  return out;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireScoutReport(value: unknown): ScoutRunReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('world extract requires a scout run report object');
  const report = value as Partial<ScoutRunReport>;
  if (report.schema !== 'gbrain.scout.run_report.v1') throw new Error('world extract --from-run/--from-scout-report must point to gbrain.scout.run_report.v1 JSON');
  if (!Array.isArray(report.source_spans)) throw new Error('scout report source_spans must be an array');
  return report as ScoutRunReport;
}

export async function runWorldCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const flags = parseArgs(rest);
  if (!sub || sub === '--help' || sub === '-h') {
    console.log('gbrain world extract <topic> --from-run <scout-report.json> --json [--out <world-extraction.json>]\ngbrain world topic state <slug> --from-extraction <world-extraction.json> [--from-claims <claim-ledger.jsonl>] [--since <iso>] [--json] [--out <topic-state.json>] [--no-store]\ngbrain world timeline backfill --from-extraction <world-extraction.json> [--json] [--out <timeline-entries.jsonl>] [--dry-run]');
    return;
  }

  if (sub === 'timeline') {
    const action = typeof flags._pos1 === 'string' ? flags._pos1 : undefined;
    if (action !== 'backfill') throw new Error('world timeline requires backfill');
    const fromExtraction = typeof flags.from_extraction === 'string' ? flags.from_extraction : typeof flags.from_world_extraction === 'string' ? flags.from_world_extraction : undefined;
    if (!fromExtraction) throw new Error('world timeline backfill requires --from-extraction <world-extraction.json>');
    const result = backfillTimelineEntriesFromExtractions(readWorldExtractionReports(fromExtraction), {
      path: typeof flags.out === 'string' ? flags.out : undefined,
      dryRun: Boolean(flags.dry_run),
    });
    const payload = { ok: true, ...result, dry_run: Boolean(flags.dry_run) };
    console.log(flags.json ? JSON.stringify(payload, null, 2) : `timeline_entries\tbefore=${result.before}\tadded=${result.added}\tafter=${result.after}\tpath=${result.path}`);
    return;
  }

  if (sub === 'topic') {
    const action = typeof flags._pos1 === 'string' ? flags._pos1 : undefined;
    const topic = typeof flags._pos2 === 'string' ? flags._pos2 : undefined;
    if (action !== 'state' && action !== 'compile') throw new Error('world topic requires state (or compile)');
    if (!topic) throw new Error('world topic state requires <slug>');
    const fromExtraction = typeof flags.from_extraction === 'string' ? flags.from_extraction : typeof flags.from_world_extraction === 'string' ? flags.from_world_extraction : undefined;
    if (!fromExtraction) throw new Error('world topic state requires --from-extraction <world-extraction.json>');
    const fromClaims = typeof flags.from_claims === 'string' ? flags.from_claims : undefined;
    const activeProjects = typeof flags.active_projects === 'string' ? flags.active_projects.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    const surface = compileTopicState({
      topic,
      extractions: readWorldExtractionFile(fromExtraction),
      claims: fromClaims ? readClaimLedgerFile(fromClaims) : [],
      since: typeof flags.since === 'string' ? flags.since : undefined,
      staleAfterDays: typeof flags.stale_days === 'string' ? Number(flags.stale_days) : undefined,
      activeProjects,
    });
    const errors = validateTopicStateSurface(surface);
    const out = typeof flags.out === 'string' ? flags.out : undefined;
    if (out) writeFileSync(out, JSON.stringify(surface, null, 2) + '\n');
    let stored_at: string | undefined;
    if (!flags.no_store && !flags.dry_run) stored_at = appendSynthesisSurface(surface);
    const payload = { ok: errors.length === 0, errors, stored_at, surface };
    console.log(flags.json || out ? JSON.stringify(payload, null, 2) : `${surface.topic}\tstate\tclaims=${surface.current_state.length}\tdeltas=${surface.recent_deltas.new.length + surface.recent_deltas.changed.length + surface.recent_deltas.repeated.length}\tstale=${surface.diagnostics.stale_claims}`);
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (sub === 'extract') {
    const topic = typeof flags._pos1 === 'string' ? flags._pos1 : undefined;
    const fromRun = typeof flags.from_run === 'string' ? flags.from_run : typeof flags.from_scout_report === 'string' ? flags.from_scout_report : undefined;
    if (!fromRun) throw new Error('world extract requires --from-run <scout-report.json> (or --from-scout-report)');
    const scoutReport = requireScoutReport(readJson(fromRun));
    const extraction = extractWorldCandidatesFromScout(scoutReport, { topic });
    const errors = validateWorldExtractionReport(extraction);
    const payload = { ok: errors.length === 0, errors, extraction };
    const json = JSON.stringify(payload, null, 2);
    const out = typeof flags.out === 'string' ? flags.out : undefined;
    if (out) writeFileSync(out, json + '\n');
    console.log(flags.json || out ? json : `${extraction.topic}\tclaims=${extraction.claims.length}\tevents=${extraction.events.length}\tentities=${extraction.entity_updates.length}\tunsupported=${extraction.diagnostics.unsupported_candidates}`);
    if (errors.length) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown world subcommand: ${sub}`);
}
