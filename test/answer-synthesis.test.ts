import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RecallResult } from '../src/core/evidence/recall.ts';
import { synthesizeAnswerFromRecall } from '../src/core/evidence/answer-synthesis.ts';
import { runAnswerCommand } from '../src/commands/answer.ts';

const hitRecall: RecallResult = {
  query: 'why did we move away from Citadel?',
  status: 'hit',
  evidence: [
    {
      span_id: 'gbs1:default:sources/chatgpt/full-export-all/2025-05-05-unshackled-mode-exit-6812c3bd#compiled_truth:L5-L6',
      source_id: 'default',
      slug: 'sources/chatgpt/full-export-all/2025-05-05-unshackled-mode-exit-6812c3bd',
      title: 'Unshackled Mode Exit',
      section: 'compiled_truth',
      start_line: 5,
      end_line: 6,
      quote: 'We moved away from Citadel because it was too static and bunker-like.\nThe better direction was a living memory system that can evolve with source-backed recall.',
      quote_hash: 'a'.repeat(64),
      line_basis: 'stored_section',
      matched_by: 'chunk',
      score: 0.87,
    },
  ],
  warnings: [],
  integration: { search_source: 'direct' },
};

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

describe('answer synthesis from recall evidence', () => {
  test('builds a bounded deterministic draft with exact span references', () => {
    const out = synthesizeAnswerFromRecall(hitRecall, { maxQuoteChars: 120 });

    expect(out.schema).toBe('gbrain.answer_synthesis.v1');
    expect(out.status).toBe('hit');
    expect(out.answer).toContain('Deterministic evidence-backed draft');
    expect(out.answer).toContain('[S1]');
    expect(out.answer).toContain(hitRecall.evidence[0].span_id);
    expect(out.answer).toContain('too static and bunker-like');
    expect(out.citations).toEqual([
      expect.objectContaining({ label: 'S1', span_id: hitRecall.evidence[0].span_id, quote_hash: 'a'.repeat(64) }),
    ]);
    expect(out.bounds).toMatchObject({ deterministic: true, abstain_if_no_exact_span: true, max_quote_chars: 120 });
  });

  test('preserves abstain behavior when no exact evidence exists', () => {
    const out = synthesizeAnswerFromRecall({
      query: 'missing',
      status: 'abstain',
      evidence: [],
      warnings: ['no direct or alias search candidates found; abstaining'],
      integration: { search_source: 'none' },
    });

    expect(out.status).toBe('abstain');
    expect(out.answer).toBe('');
    expect(out.citations).toEqual([]);
    expect(out.warnings.join(' ')).toContain('abstaining');
  });

  test('answer CLI accepts recall JSON without needing a brain connection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-answer-synthesis-'));
    const hitPath = join(dir, 'recall-hit.json');
    writeFileSync(hitPath, JSON.stringify(hitRecall), 'utf8');

    const stdout = await captureStdout(() => runAnswerCommand(null, ['--from-recall-json', hitPath, '--json', '--max-evidence', '1']));
    const payload = JSON.parse(stdout);

    expect(payload.status).toBe('hit');
    expect(payload.citations[0].span_id).toBe(hitRecall.evidence[0].span_id);
    expect(process.exitCode).toBeUndefined();
  });
});
