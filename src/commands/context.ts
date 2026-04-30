import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { configDir } from '../core/config.ts';
import { listClaimLedgerRecords, type ClaimLedgerRecord } from '../core/claims/claim-ledger.ts';
import { compileContextPackV2, validateContextPackV2 } from '../core/context/context-pack-v2.ts';
import type { TopicStateSurface } from '../core/world/topic-state.ts';

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

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path: string): any[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
}

function readRecords(flags: Record<string, string | boolean | undefined>): ClaimLedgerRecord[] {
  if (typeof flags.from_claims === 'string') return readJsonl(flags.from_claims) as ClaimLedgerRecord[];
  return listClaimLedgerRecords({}).records || [];
}

function readTopicStates(flags: Record<string, string | boolean | undefined>): TopicStateSurface[] {
  const path = typeof flags.from_topic_state === 'string' ? flags.from_topic_state : typeof flags.from_surfaces === 'string' ? flags.from_surfaces : join(configDir(), 'synthesis-surfaces.jsonl');
  if (!existsSync(path)) return [];
  if (path.endsWith('.jsonl')) return readJsonl(path).map((row: any) => row.surface || row).filter((row: any) => row?.schema === 'gbrain.synthesis_surface.topic_state.v1') as TopicStateSurface[];
  const parsed = readJson(path);
  if (Array.isArray(parsed)) return parsed as TopicStateSurface[];
  return [parsed.surface || parsed].filter((row: any) => row?.schema === 'gbrain.synthesis_surface.topic_state.v1') as TopicStateSurface[];
}

function readTask(flags: Record<string, string | boolean | undefined>, fallbackId: string) {
  if (typeof flags.from_task === 'string') return readJson(flags.from_task);
  const ac = typeof flags.acceptance === 'string' ? flags.acceptance.split(/\s*;\s*/).filter(Boolean) : undefined;
  const evidence = typeof flags.evidence_refs === 'string' ? flags.evidence_refs.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  return { id: fallbackId, title: typeof flags.title === 'string' ? flags.title : undefined, summary: typeof flags.summary === 'string' ? flags.summary : fallbackId, acceptance_criteria: ac, evidence_refs: evidence };
}

function printPack(pack: unknown, json: boolean): void {
  if (json) console.log(JSON.stringify(pack, null, 2));
  else {
    const p = pack as any;
    console.log(`${p.status.toUpperCase()} ${p.pack_type} token_estimate=${p.token_estimate} privacy_tier=${p.privacy_tier}`);
    for (const [section, items] of Object.entries(p.sections || {})) console.log(`${section}: ${(items as any[]).length}`);
    if (p.unknowns?.length) console.log(`unknowns: ${p.unknowns.join('; ')}`);
  }
}

export async function runContextCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const flags = parseArgs(rest);
  if (!sub || sub === '--help' || sub === '-h') {
    console.log('gbrain context project --slug <slug> [--include-world] --json\ngbrain context meeting --person "Name" [--date today] --json\ngbrain context opportunity --opportunity <name> --json\ngbrain context agent-handoff --task <task-id> [--from-task task.json] --json');
    return;
  }

  let pack;
  if (sub === 'project') {
    const slug = typeof flags.slug === 'string' ? flags.slug : typeof flags._pos1 === 'string' ? flags._pos1 : undefined;
    if (!slug) throw new Error('context project requires --slug <slug>');
    pack = compileContextPackV2({ packType: 'project_pack', slug, includeWorld: flags.include_world === true, records: readRecords(flags), topicStates: readTopicStates(flags) });
  } else if (sub === 'meeting') {
    const person = typeof flags.person === 'string' ? flags.person : typeof flags._pos1 === 'string' ? flags._pos1 : undefined;
    if (!person) throw new Error('context meeting requires --person <name>');
    pack = compileContextPackV2({ packType: 'meeting_brief', person, date: typeof flags.date === 'string' ? flags.date : undefined, records: readRecords(flags) });
  } else if (sub === 'opportunity' || sub === 'opportunity-eval') {
    const opportunity = typeof flags.opportunity === 'string' ? flags.opportunity : typeof flags._pos1 === 'string' ? flags._pos1 : undefined;
    if (!opportunity) throw new Error('context opportunity requires --opportunity <name>');
    pack = compileContextPackV2({ packType: 'opportunity_eval', opportunity, records: readRecords(flags), topicStates: readTopicStates(flags) });
  } else if (sub === 'agent-handoff' || sub === 'handoff') {
    const taskId = typeof flags.task === 'string' ? flags.task : typeof flags._pos1 === 'string' ? flags._pos1 : undefined;
    if (!taskId) throw new Error('context agent-handoff requires --task <task-id>');
    const operationalNotes = typeof flags.from_ops === 'string' ? readJsonl(flags.from_ops) : [];
    pack = compileContextPackV2({ packType: 'agent_handoff', taskId, task: readTask(flags, taskId), operationalNotes });
  } else {
    throw new Error(`Unknown context subcommand: ${sub}`);
  }

  const errors = validateContextPackV2(pack);
  const payload = { ok: errors.length === 0, errors, ...pack };
  printPack(payload, flags.json === true);
  if (errors.length || pack.status === 'abstain') process.exitCode = 1;
}
