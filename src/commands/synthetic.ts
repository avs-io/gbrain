import { readFileSync } from 'node:fs';
import { readSyntheticCasesJsonl, readSyntheticRecordsJsonl, validateSyntheticQueryCase, validateSyntheticRecord } from '../core/synthetic/index.ts';
import type { BrainEngine } from '../core/engine.ts';

function help(): void {
  console.log(`gbrain synthetic — review/eval synthetic artifact helpers

USAGE
  gbrain synthetic validate <file>
  gbrain synthetic eval generate --from-span <gbs1-id> [--dry-run] [--json]
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
    const fromSpan = rest.includes('--from-span') ? rest[rest.indexOf('--from-span') + 1] : rest.find(a => a.startsWith('--from-span='))?.split('=')[1];
    if (!fromSpan) throw new Error('Usage: gbrain synthetic eval generate --from-span <gbs1-id>');
    const payload = { seed_evidence_span_ids: [fromSpan], query: `Synthetic query for ${fromSpan}`, query_shape: 'single_span_recall', expected_claim_ids: [fromSpan], expected_abstain: false, hard_negative: false };
    if (rest.includes('--json')) console.log(JSON.stringify({ ok: true, dry_run: true, cases: [payload] }, null, 2));
    else console.log(`dry-run: ${payload.query}`);
    return;
  }
  help();
}

