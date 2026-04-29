import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildRegressionPackArtifact, type RegressionPackCaseInput } from '../src/core/answer/regression-pack.ts';

declare const Bun: any;

const ROOT = resolve(import.meta.dirname, '..');

interface Flags {
  out?: string;
  includeEnvelopes: boolean;
  noLive: boolean;
}

function parseArgs(args: string[]): Flags {
  const flags: Flags = { includeEnvelopes: false, noLive: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out') flags.out = requireValue(args, ++i, arg);
    else if (arg.startsWith('--out=')) flags.out = arg.slice(6);
    else if (arg === '--include-envelopes') flags.includeEnvelopes = true;
    else if (arg === '--no-live') flags.noLive = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
  }
  return flags;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function runCli(args: string[]): string {
  return execFileSync('bun', ['run', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 30 * 1024 * 1024,
  });
}

function currentCommit(): string | null {
  if (Bun.env.GIT_COMMIT) return Bun.env.GIT_COMMIT;
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return null; }
}

function loadPromotionPayload(flags: Flags): { report: any; cases: RegressionPackCaseInput[] } {
  const fixture = (globalThis as any).__GRAIN_REGRESSION_PACK_FIXTURE__ as { report: any; cases: RegressionPackCaseInput[] } | undefined;
  if (fixture) return fixture;
  const args = ['scripts/chief-answer-v2-promotion-eval.ts', ...(flags.noLive ? ['--no-live'] : [])];
  const payload = JSON.parse(runCli(args));
  if (payload.skipped) return { report: payload.report, cases: [] };
  if (!payload.report || !Array.isArray(payload.cases)) throw new Error('Promotion smoke did not return report/cases payload');
  return { report: payload.report, cases: payload.cases };
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  const { report, cases } = loadPromotionPayload(flags);
  const artifact = buildRegressionPackArtifact(report, cases, {
    generatedAt: new Date().toISOString(),
    commit: currentCommit(),
    includeEnvelopes: flags.includeEnvelopes,
  });
  const text = JSON.stringify(artifact, null, 2);
  if (flags.out) { mkdirSync(dirname(flags.out), { recursive: true }); writeFileSync(flags.out, text + '\n'); }
  console.log(text);
}

main();
