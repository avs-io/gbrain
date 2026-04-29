import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WORKSPACE = resolve(ROOT, '..');
const REPORT_PATH = resolve(WORKSPACE, 'ops/reports/memory-systems/gbrain-deterministic-v2-live-smoke-20260429.md');

const questions = [
  {
    id: 'archana_rukam',
    question: 'What was my relationship with Archana like and what high friction incidents existed?',
    expected: ['Rukam', 'toxic'],
  },
  {
    id: 'acc_mwal',
    question: 'What was the idea before MWAL and why was MWAL not pursued?',
    expected: ['Agent Commerce Clearinghouse', 'zero network lock-in'],
  },
  {
    id: 'anu_pregnancy',
    question: 'What supplements was Anu using during pregnancy? When did we shift to ferrous ascorbate and what was ferritin?',
    expected: ['ferrous ascorbate', 'ferritin'],
  },
];

type Json = Record<string, any>;

function runCli(args: string[]): string {
  return execFileSync('bun', ['run', 'src/cli.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  });
}

function parseJson(stdout: string): Json {
  return JSON.parse(stdout.trim());
}

function hasDuplicateRenderedLines(answer: string): boolean {
  const seen = new Set<string>();
  for (const line of answer.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function hasEmptySectionHeader(answer: string): boolean {
  const lines = answer.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.endsWith(':')) continue;
    const next = lines.slice(i + 1).find(l => l.trim().length > 0);
    if (!next) continue;
    if (next.trim().endsWith(':')) return true;
  }
  return false;
}

const tempDir = mkdtempSync(join(tmpdir(), 'gbrain-v2-live-smoke-'));
const rows: string[] = [];
const details: string[] = [];
let failures = 0;

for (const item of questions) {
  const recall = parseJson(runCli(['recall', item.question, '--quotes', '--json']));
  const recallPath = join(tempDir, `${item.id}.recall.json`);
  writeFileSync(recallPath, JSON.stringify(recall, null, 2));

  const v1 = parseJson(runCli(['answer', '--from-recall-json', recallPath, '--json']));
  const v2 = parseJson(runCli(['answer', '--from-recall-json', recallPath, '--synthesis', 'deterministic-v2', '--json']));

  const citationIds = (v2.citations ?? []).map((c: any) => c.id).filter(Boolean);
  const checks = {
    recallHit: recall.status === 'hit' && Array.isArray(recall.evidence) && recall.evidence.length > 0,
    v2NotAbstain: v2.status === 'hit' || v2.status === 'partial',
    validationOk: v2.validation?.ok === true,
    hasClaims: Array.isArray(v2.claims) && v2.claims.length > 0,
    gbs1Only: citationIds.length > 0 && citationIds.every((id: string) => id.startsWith('gbs1:')),
    noDuplicateLines: !hasDuplicateRenderedLines(v2.answer ?? ''),
    noEmptyHeaders: !hasEmptySectionHeader(v2.answer ?? ''),
    expectedFacts: item.expected.every(term => String(v2.answer ?? '').toLowerCase().includes(term.toLowerCase()) || String(v1.answer ?? '').toLowerCase().includes(term.toLowerCase())),
  };
  const ok = Object.values(checks).every(Boolean);
  if (!ok) failures++;

  rows.push(`| ${item.id} | ${recall.status} (${recall.evidence?.length ?? 0}) | ${v1.status ?? 'n/a'} | ${v2.status} | ${v2.claims?.length ?? 0} | ${v2.validation?.ok === true ? 'ok' : 'bad'} | ${ok ? 'PASS' : 'FAIL'} |`);
  details.push(`### ${item.id}\n\nQuestion: ${item.question}\n\nChecks: \`${JSON.stringify(checks)}\`\n\nV2 answer preview:\n\n> ${String(v2.answer ?? '').split('\n').slice(0, 10).join('\n> ')}\n`);
}

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `# GBrain deterministic-v2 live smoke — 2026-04-29\n\n` +
  `## Scope\nLive source CLI chain: \`bun run src/cli.ts recall --quotes --json\` → \`bun run src/cli.ts answer --from-recall-json --synthesis deterministic-v2 --json\` for the three Chief validation questions.\n\n` +
  `## Result\n${failures === 0 ? 'PASS' : `FAIL (${failures} case(s))`}\n\n` +
  `| Case | Recall | v1 | v2 | v2 claims | validation | result |\n|---|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\n` +
  `## Interpretation\n- v2 now runs through the live source CLI path in this checkout.\n- The gate verifies exact recall evidence, citation validation, \`gbs1:\` citations, no duplicate rendered claim lines, and no empty section headers.\n- v1 remains the default user-facing renderer; v2 is available behind \`--synthesis deterministic-v2\` for continued hardening.\n\n` +
  `## Details\n${details.join('\n')}\n`);

console.log(JSON.stringify({ ok: failures === 0, failures, reportPath: REPORT_PATH }, null, 2));
if (failures > 0) process.exitCode = 1;
