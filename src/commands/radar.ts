import { readFileSync, writeFileSync } from 'node:fs';
import { candidateFromScoutSignal, opportunityReportJson } from '../core/radar/opportunity.ts';
import type { ScoutSignal } from '../core/scout/pipeline.ts';

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

export async function runRadarCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`gbrain radar opportunity --signal-json <signal.json> [--active-bet ...] [--memory-ref ...] [--out <report.jsonl>] [--yes] [--json]`);
    return;
  }
  if (sub !== 'opportunity') throw new Error(`Unknown radar subcommand: ${sub}`);
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
