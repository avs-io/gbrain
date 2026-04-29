import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { buildSyntheticQueryCases, seedFromSpan, runSyntheticEvalJsonl, runSyntheticEvalCases } from '../core/synthetic/index.ts';
import { readSyntheticCasesJsonl, readSyntheticRecordsJsonl, validateSyntheticQueryCase, validateSyntheticRecord } from '../core/synthetic/index.ts';
import type { BrainEngine } from '../core/engine.ts';
import type { SyntheticQueryShape } from '../core/synthetic/types.ts';

function parseFlags(rest: string[]): { fromSpan?: string; shape: SyntheticQueryShape[]; topic?: string; claim?: string; hardNegatives: boolean; count?: number; out?: string; yes: boolean; json: boolean; run?: string } {
  const shape: SyntheticQueryShape[] = [];
  let fromSpan: string | undefined;
  let topic: string | undefined;
  let claim: string | undefined;
  let hardNegatives = false;
  let count: number | undefined;
  let out: string | undefined;
  let yes = false;
  let json = false;
  let run: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--from-span') fromSpan = rest[++i];
    else if (a?.startsWith('--from-span=')) fromSpan = a.slice(12);
    else if (a === '--shape') shape.push(rest[++i] as SyntheticQueryShape);
    else if (a?.startsWith('--shape=')) shape.push(a.slice(8) as SyntheticQueryShape);
    else if (a === '--topic') topic = rest[++i];
    else if (a?.startsWith('--topic=')) topic = a.slice(8);
    else if (a === '--claim') claim = rest[++i];
    else if (a?.startsWith('--claim=')) claim = a.slice(8);
    else if (a === '--hard-negatives') hardNegatives = true;
    else if (a === '--count') count = Number(rest[++i]);
    else if (a?.startsWith('--count=')) count = Number(a.slice(8));
    else if (a === '--out') out = rest[++i];
    else if (a?.startsWith('--out=')) out = a.slice(6);
    else if (a === '--yes') yes = true;
    else if (a === '--json') json = true;
    else if (a === '--run') run = rest[++i];
    else if (a?.startsWith('--run=')) run = a.slice(6);
    else if (a === '--cases') run = rest[++i];
    else if (a?.startsWith('--cases=')) run = a.slice(8);
  }
  return { fromSpan, shape, topic, claim, hardNegatives, count, out, yes, json, run };
}

function help(): void {
  console.log(`gbrain synthetic — review/eval synthetic artifact helpers

USAGE
  gbrain synthetic validate <file>
  gbrain synthetic eval generate --from-span <gbs1-id> [--shape <shape>] [--topic <topic>] [--claim <claim>] [--hard-negatives] [--count <n>] [--out <jsonl>] [--yes] [--json]
  gbrain synthetic eval run --cases <jsonl> [--json]
`);
}

export async function runSyntheticCommand(_engine: BrainEngine | null, args: string[]): Promise<void> {
  if (!args.length || args.includes('--help') || args.includes('-h')) return help();
  const [sub, ...rest] = args;
  if (sub === 'validate') {
    const file = rest[0];
    if (!file) throw new Error('Usage: gbrain synthetic validate <file>');
    const raw = readFileSync(file, 'utf8');
    const first = raw.split('\n').find(l => l.trim());
    if (!first) throw new Error('Empty JSONL file');
    const sample = JSON.parse(first);
    const recordIssues = validateSyntheticRecord(sample);
    const caseIssues = validateSyntheticQueryCase(sample);
    const useRecords = recordIssues.length <= caseIssues.length;
    const issues = useRecords ? recordIssues : caseIssues;
    if (issues.length) { console.error(JSON.stringify({ ok: false, issues }, null, 2)); process.exitCode = 1; return; }
    const parsed = useRecords ? readSyntheticRecordsJsonl(file) : readSyntheticCasesJsonl(file);
    const ok = parsed.errors.length === 0;
    console.log(JSON.stringify({ ok, count: parsed.items.length, errors: parsed.errors }, null, 2));
    if (!ok) process.exitCode = 1;
    return;
  }
  if (sub === 'eval' && rest[0] === 'generate') {
    const flags = parseFlags(rest.slice(1));
    if (!flags.fromSpan) throw new Error('Usage: gbrain synthetic eval generate --from-span <gbs1-id>');
    if (flags.shape.length === 0) flags.shape.push('exact_fact');
    const seed = seedFromSpan(flags.fromSpan, { topic: flags.topic, claim: flags.claim });
    const cases = buildSyntheticQueryCases({ seeds: [seed], shapes: flags.shape, topic: flags.topic, claim: flags.claim, hardNegatives: flags.hardNegatives, count: flags.count });
    const summary = runSyntheticEvalCases(cases);
    if (flags.out && flags.yes) {
      writeFileSync(flags.out, cases.map(c => JSON.stringify(c)).join('\n') + '\n');
    }
    if (flags.json) console.log(JSON.stringify({ ok: summary.ok, dry_run: !flags.yes, out: flags.out, count: cases.length, summary, cases }, null, 2));
    else console.log(flags.yes && flags.out ? `wrote ${cases.length} cases to ${flags.out}` : `dry-run: ${cases.length} cases`);
    return;
  }
  if (sub === 'eval' && rest[0] === 'run') {
    const flags = parseFlags(rest.slice(1));
    if (!flags.run) throw new Error('Usage: gbrain synthetic eval run --cases <jsonl> [--json]');
    const summary = runSyntheticEvalJsonl(flags.run);
    if (flags.json) console.log(JSON.stringify(summary, null, 2));
    else console.log(`ok=${summary.ok} count=${summary.count} abstain=${summary.abstain_count} hard_negative=${summary.hard_negative_count}`);
    return;
  }
  help();
}
