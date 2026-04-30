import { readFileSync, writeFileSync } from 'node:fs';
import { candidateFromScoutSignal, opportunityReportJson } from '../core/radar/opportunity.ts';
import type { ScoutSignal } from '../core/scout/pipeline.ts';
import {
  appendSurfacingCandidates,
  generateSurfacingCandidates,
  parseSurfacingFixture,
  readSurfacingStore,
  recordSurfacingDecision,
  surfacingCandidatesPath,
  type SurfacingCandidate,
} from '../core/radar/surfacing.ts';

function flagValue(args: string[], flag: string): string | undefined {
  const ix = args.indexOf(flag); if (ix >= 0 && args[ix+1] && !args[ix+1].startsWith('--')) return args[ix+1];
  const hit = args.find(a => a.startsWith(flag + '=')); return hit ? hit.slice(flag.length + 1) : undefined;
}
function hasFlag(args: string[], flag: string): boolean { return args.includes(flag); }
function printJson(v: unknown): void { console.log(JSON.stringify(v, null, 2)); }

function flagValues(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === flag && args[i + 1] && !args[i + 1].startsWith('--')) out.push(args[++i]);
    else if (a.startsWith(flag + '=')) out.push(a.slice(flag.length + 1));
  }
  return out;
}

function readFixture(path: string): any { return JSON.parse(readFileSync(path, 'utf8')); }

function visibleCandidates(candidates: SurfacingCandidate[]): SurfacingCandidate[] {
  return candidates.filter(c => c.status === 'review' || c.status === 'brief' || c.status === 'cooldown').sort((a, b) => b.scores.final - a.scores.final || a.id.localeCompare(b.id));
}

function printReview(candidates: SurfacingCandidate[], json: boolean): void {
  if (json) printJson({ ok: true, schema: 'gbrain.radar.review.v1', candidate_count: candidates.length, candidates, guardrails: { review_only: true, external_messages_sent: false, trusted_pages_edited: false } });
  else for (const c of candidates) console.log(`${c.id}\t${c.status}\t${c.scores.final}\t${c.title}\t${c.recommended_action.type}`);
}

async function runOpportunityCommand(rest: string[]): Promise<void> {
  const signalPath = flagValue(rest, '--signal-json') || flagValue(rest, '--signal');
  if (!signalPath) throw new Error('Missing required --signal-json <signal.json>');
  const raw = JSON.parse(readFileSync(signalPath, 'utf-8'));
  const signal = (raw.signal || raw) as ScoutSignal;
  const active_bets = flagValues(rest, '--active-bet');
  const memory_refs = flagValues(rest, '--memory-ref');
  const candidate = candidateFromScoutSignal(signal, { active_bets, memory_refs });
  const report = opportunityReportJson(candidate);
  const json = JSON.stringify(report, null, 2);
  const out = flagValue(rest, '--out');
  if (out && hasFlag(rest, '--yes')) writeFileSync(out, json + '\n');
  if (hasFlag(rest, '--json')) printJson({ ok: true, ...report, outputPath: out || undefined, written: Boolean(out && hasFlag(rest, '--yes')) });
  else console.log(`${candidate.id}\t${candidate.opportunity_score}`);
}

export async function runRadarCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`gbrain radar review [--limit 20] [--json] [--from fixture.json] [--store <path>] [--yes]\ngbrain radar accept <id> --action investigate --json [--store <path>]\ngbrain radar dismiss <id> --reason irrelevant --json [--store <path>]\ngbrain radar opportunity --signal-json <signal.json> [--active-bet ...] [--memory-ref ...] [--out <report.jsonl>] [--yes] [--json]`);
    return;
  }

  if (sub === 'opportunity') return runOpportunityCommand(rest);

  const storePath = flagValue(rest, '--store') || surfacingCandidatesPath();

  if (sub === 'review') {
    const from = flagValue(rest, '--from') || flagValue(rest, '--fixture');
    let generated: SurfacingCandidate[] = [];
    if (from) {
      const store = readSurfacingStore(storePath);
      const parsed = parseSurfacingFixture(readFixture(from));
      generated = generateSurfacingCandidates({ ...parsed, existingCandidates: store.candidates });
      if (hasFlag(rest, '--yes') || hasFlag(rest, '--write')) appendSurfacingCandidates(generated, storePath);
    }
    const all = from && !(hasFlag(rest, '--yes') || hasFlag(rest, '--write')) ? generated : readSurfacingStore(storePath).candidates;
    const limit = Number(flagValue(rest, '--limit') || 20);
    printReview(visibleCandidates(all).slice(0, Number.isFinite(limit) ? limit : 20), hasFlag(rest, '--json'));
    return;
  }

  if (sub === 'accept') {
    const id = rest.find(a => !a.startsWith('--'));
    if (!id) throw new Error('gbrain radar accept requires <id>');
    const action = flagValue(rest, '--action') || 'investigate';
    const decision = recordSurfacingDecision({ candidateId: id, status: 'accepted', action, path: storePath });
    if (hasFlag(rest, '--json')) printJson({ ok: true, decision });
    else console.log(`${id}\taccepted\t${action}`);
    return;
  }

  if (sub === 'dismiss') {
    const id = rest.find(a => !a.startsWith('--'));
    if (!id) throw new Error('gbrain radar dismiss requires <id>');
    const reason = flagValue(rest, '--reason') || 'dismissed';
    const decision = recordSurfacingDecision({ candidateId: id, status: 'dismissed', reason, path: storePath });
    if (hasFlag(rest, '--json')) printJson({ ok: true, decision });
    else console.log(`${id}\tdismissed\t${reason}`);
    return;
  }

  throw new Error(`Unknown radar subcommand: ${sub}`);
}
