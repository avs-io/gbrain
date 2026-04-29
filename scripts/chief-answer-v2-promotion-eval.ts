import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { evaluateAnswerPromotionCases, type AnswerPromotionCase, type AnswerPromotionReport } from '../src/core/answer/promotion-eval.ts';

const ROOT = resolve(import.meta.dirname, '..');

const QUESTIONS = [
  {
    id: 'archana_rukam',
    question: 'What was my relationship with Archana like and what high friction incidents existed?',
  },
  {
    id: 'acc_mwal',
    question: 'What was the idea before MWAL and why was MWAL not pursued?',
  },
  {
    id: 'anu_pregnancy',
    question: 'What supplements was Anu using during pregnancy? When did we shift to ferrous ascorbate and what was ferritin?',
  },
] as const;

type CliJson = Record<string, any>;

interface ScriptFlags {
  out?: string;
  live: boolean;
}

function parseArgs(args: string[]): ScriptFlags {
  const flags: ScriptFlags = { live: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out') flags.out = needValue(args, ++i, arg);
    else if (arg.startsWith('--out=')) flags.out = arg.slice('--out='.length);
    else if (arg === '--no-live') flags.live = false;
    else if (arg === '--live') flags.live = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
  }
  return flags;
}

function needValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function runCli(args: string[]): string {
  return execFileSync('bun', ['run', 'src/cli.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  });
}

function parseJson(stdout: string): CliJson {
  return JSON.parse(stdout.trim());
}

function isLiveRecallUnavailable(error: unknown): boolean {
  const text = String((error as any)?.stderr ?? (error as any)?.message ?? error);
  return /brain connection|recall data unavailable|no brain connection|connection/i.test(text);
}

function buildCaseFromRecall(item: { id: string; question: string }, recall: CliJson, answer: CliJson): AnswerPromotionCase {
  return {
    id: item.id,
    query: item.question,
    expected_abstain: false,
    max_length: 6000,
    required_terms: [],
    envelope: answer,
  };
}

function formatReport(report: AnswerPromotionReport, cases: AnswerPromotionCase[]): string {
  const rows = report.failures.length
    ? report.failures.map(f => `- ${f.case_id}: ${f.reasons.join('; ')}`).join('\n')
    : '- none';
  return JSON.stringify({ report, cases: cases.map(c => ({ id: c.id, query: c.query })) }, null, 2) + `\n\n${rows}\n`;
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  const cases: AnswerPromotionCase[] = [];

  if (!flags.live) {
    const report = evaluateAnswerPromotionCases([]);
    console.log(JSON.stringify({ ok: false, skipped: true, reason: 'live eval disabled by --no-live', report }, null, 2));
    return;
  }

  for (const item of QUESTIONS) {
    try {
      const recall = parseJson(runCli(['recall', item.question, '--quotes', '--json']));
      // The answer CLI consumes recall JSON from a file, so persist the local recall payload to a temp fixture.
      const tmpDir = resolve(ROOT, '.tmp');
      mkdirSync(tmpDir, { recursive: true });
      const recallPath = resolve(tmpDir, `${item.id}.recall.json`);
      writeFileSync(recallPath, JSON.stringify(recall, null, 2));
      const v2 = parseJson(runCli(['answer', '--from-recall-json', recallPath, '--synthesis', 'deterministic-v2', '--json']));
      cases.push(buildCaseFromRecall(item, recall, v2));
    } catch (error) {
      if (flags.live && isLiveRecallUnavailable(error)) {
        const report = evaluateAnswerPromotionCases([]);
        const payload = { ok: false, skipped: true, reason: 'live recall unavailable', report };
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      throw error;
    }
  }

  const report = evaluateAnswerPromotionCases(cases);
  const payload = {
    schema: 'gbrain.answer_v2_promotion_fixture.v1',
    ok: report.ok,
    report,
    cases: cases.map(c => ({
      id: c.id,
      query: c.query,
      envelope: c.envelope,
      expected_abstain: c.expected_abstain,
      max_length: c.max_length,
      required_terms: c.required_terms,
    })),
  };

  const text = JSON.stringify(payload, null, 2);
  if (flags.out) {
    mkdirSync(dirname(flags.out), { recursive: true });
    writeFileSync(flags.out, text + '\n');
  }
  console.log(text);
}

main();
