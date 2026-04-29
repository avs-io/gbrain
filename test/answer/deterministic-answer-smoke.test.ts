import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAnswerCommand } from '../../src/commands/answer.ts';
import { buildDeterministicAnswerEnvelope } from '../../src/core/answer/index.ts';
import type { RecallResult } from '../../src/core/evidence/recall.ts';

const recall: RecallResult = {
  query: 'why did Citadel change?',
  status: 'hit',
  evidence: [
    {
      span_id: 'gbs1:default:sources/test/citadel#compiled_truth:L10-L11',
      source_id: 'default',
      slug: 'sources/test/citadel',
      title: 'Citadel Note',
      section: 'compiled_truth',
      start_line: 10,
      end_line: 11,
      quote: 'Citadel was too static. The better direction was living memory.',
      quote_hash: 'd'.repeat(64),
      line_basis: 'stored_section',
      matched_by: 'exact',
      score: 0.95,
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

describe('deterministic-v2 answer envelope', () => {
  test('emits source-backed compiled claims from exact normalized evidence windows', () => {
    const envelope = buildDeterministicAnswerEnvelope(recall, { maxEvidence: 2, maxQuoteChars: 200 });

    expect(envelope.schema).toBe('gbrain.answer_envelope.v2');
    expect(envelope.status).toBe('hit');
    expect(envelope.synthesis).toBe('deterministic-v2');
    expect(envelope.claims.length).toBeGreaterThan(0);
    expect(envelope.claims.every(claim => !claim.factual || claim.citations.length > 0)).toBe(true);
    expect(envelope.claims[0].citations[0].id).toBe(recall.evidence[0].span_id);
    expect(envelope.validation.ok).toBe(true);
  });

  test('abstains when no exact gbs1 evidence exists', () => {
    const envelope = buildDeterministicAnswerEnvelope({
      ...recall,
      evidence: [{ ...recall.evidence[0], span_id: 'chunk:default:sources/test/citadel:1' }],
    });

    expect(envelope.status).toBe('abstain');
    expect(envelope.claims).toEqual([]);
    expect(envelope.missingSlots).toContain('exact_gbs1_evidence');
    expect(envelope.warnings.join(' ')).toContain('no exact gbs1 evidence');
  });

  test('CLI --synthesis deterministic-v2 --json returns an AnswerEnvelope from recall JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-answer-v2-'));
    const path = join(dir, 'recall.json');
    writeFileSync(path, JSON.stringify(recall), 'utf8');

    const stdout = await captureStdout(() => runAnswerCommand(null, ['--from-recall-json', path, '--synthesis', 'deterministic-v2', '--json']));
    const payload = JSON.parse(stdout);

    expect(payload.schema).toBe('gbrain.answer_envelope.v2');
    expect(payload.status).toBe('hit');
    expect(payload.claims[0].citations[0].id).toBe(recall.evidence[0].span_id);
    expect(process.exitCode).toBeUndefined();
  });
});
