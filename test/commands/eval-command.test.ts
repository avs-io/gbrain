import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEvalCommand } from '../../src/commands/eval.ts';

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('eval answer-v2 cli', () => {
  test('returns deterministic promotion report json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-eval-v2-'));
    const path = join(dir, 'cases.json');
    writeFileSync(path, JSON.stringify([{ id: 'case-1', query: 'why did Citadel change?', evidence: [{ span_id: 'gbs1:default:sources/test/citadel#compiled_truth:L10-L11', source_id: 'default', slug: 'sources/test/citadel', title: 'Citadel Note', section: 'compiled_truth', start_line: 10, end_line: 11, quote: 'Citadel was too static. The better direction was living memory.', quote_hash: 'd'.repeat(64), line_basis: 'stored_section', matched_by: 'exact', score: 0.95 }], integration: { search_source: 'direct' } }]), 'utf8');

    const stdout = await captureStdout(() => runEvalCommand(null, ['answer-v2', '--cases', path, '--synthesis', 'deterministic-v2', '--json']));
    const payload = JSON.parse(stdout);

    expect(payload.schema).toBe('gbrain.answer_promotion_eval.v1');
    expect(payload.gate_version).toContain('answer-v2-promotion-gate');
    expect(payload.ok).toBe(true);
    expect(payload.recommendation).toBe('eligible_for_limited_exposure');
  });

  test('is deterministic for same input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-eval-v2-'));
    const path = join(dir, 'cases.json');
    const caseJson = [{ id: 'case-1', query: 'why did Citadel change?', evidence: [{ span_id: 'gbs1:default:sources/test/citadel#compiled_truth:L10-L11', source_id: 'default', slug: 'sources/test/citadel', title: 'Citadel Note', section: 'compiled_truth', start_line: 10, end_line: 11, quote: 'Citadel was too static. The better direction was living memory.', quote_hash: 'd'.repeat(64), line_basis: 'stored_section', matched_by: 'exact', score: 0.95 }], integration: { search_source: 'direct' } }];
    writeFileSync(path, JSON.stringify(caseJson), 'utf8');

    const one = await captureStdout(() => runEvalCommand(null, ['answer-v2', '--cases', path, '--synthesis', 'deterministic-v2', '--json']));
    const two = await captureStdout(() => runEvalCommand(null, ['answer-v2', '--cases', path, '--synthesis', 'deterministic-v2', '--json']));

    expect(one).toBe(two);
  });
});
