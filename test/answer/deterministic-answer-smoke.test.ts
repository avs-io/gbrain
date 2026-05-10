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

  test('does not render empty sections after duplicate suppression', () => {
    const envelope = buildDeterministicAnswerEnvelope({
      ...recall,
      evidence: [
        {
          ...recall.evidence[0],
          span_id: 'gbs1:default:sources/test/citadel#compiled_truth:L12-L13',
          quote: 'Citadel was too static. The better direction was living memory.',
          quote_hash: 'e'.repeat(64),
        },
      ],
    }, { maxEvidence: 4, maxQuoteChars: 200 });

    expect(envelope.validation.ok).toBe(true);
    expect(envelope.sections.every(section => section.claimIds.length > 0)).toBe(true);
    expect(envelope.answer).not.toContain('Rationale:\n\n');
  });


  test('CLI deterministic-v2 compact human output is concise while JSON remains full detail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-answer-v2-compact-human-'));
    const path = join(dir, 'recall.json');
    writeFileSync(path, JSON.stringify(recall), 'utf8');

    const strictStdout = await captureStdout(() => runAnswerCommand(null, ['--from-recall-json', path, '--synthesis', 'deterministic-v2']));
    expect(strictStdout).toContain('Citations:');
    expect(strictStdout).toContain('quote_hash=');

    const compactStdout = await captureStdout(() => runAnswerCommand(null, [
      '--from-recall-json', path,
      '--synthesis', 'deterministic-v2',
      '--compact',
      '--max-claims', '1',
      '--max-list-items', '2',
    ]));
    expect(compactStdout).toContain('Compact answer:');
    expect(compactStdout).toContain('Provenance summary:');
    expect(compactStdout).not.toContain('quote_hash=');
    const compactClaimLines = compactStdout.split('\n').filter(line => line.startsWith('- ') && !line.startsWith('- ['));
    expect(compactClaimLines.length).toBeLessThanOrEqual(1);

    const compactJsonStdout = await captureStdout(() => runAnswerCommand(null, [
      '--from-recall-json', path,
      '--synthesis', 'deterministic-v2',
      '--json',
      '--compact',
      '--max-claims', '1',
    ]));
    const compactJson = JSON.parse(compactJsonStdout);
    expect(compactJson.claims.length).toBeGreaterThan(0);
    expect(compactJson.citations[0].quoteHash).toBe(recall.evidence[0].quote_hash);
  });

  test('LLM-assisted deterministic-v2 is opt-in and off by default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-answer-v2-llm-opt-in-'));
    const path = join(dir, 'recall.json');
    writeFileSync(path, JSON.stringify(recall), 'utf8');

    const baseline = buildDeterministicAnswerEnvelope(recall, { maxEvidence: 2, maxQuoteChars: 200 });
    const disabledStdout = await captureStdout(() => runAnswerCommand(null, [
      '--from-recall-json',
      path,
      '--synthesis',
      'deterministic-v2',
      '--json',
    ]));
    const disabledPayload = JSON.parse(disabledStdout);

    expect(disabledPayload.llm_assisted).toBeUndefined();
    expect(disabledPayload.answer).toBe(baseline.answer);
    expect(disabledPayload.status).toBe(baseline.status);

    const previous = process.env.GBRAIN_ANSWER_LLM_ASSISTED;
    process.env.GBRAIN_ANSWER_LLM_ASSISTED = '1';
    try {
      const enabledStdout = await captureStdout(() => runAnswerCommand(null, [
        '--from-recall-json',
        path,
        '--synthesis',
        'deterministic-v2',
        '--json',
      ]));
      const enabledPayload = JSON.parse(enabledStdout);

      expect(enabledPayload.llm_assisted).toBeDefined();
      expect(enabledPayload.llm_assisted.enabled).toBe(true);
      expect(enabledPayload.llm_assisted.route).toBe('mock');
      expect(enabledPayload.llm_assisted.bounds.llm_citations_allowed).toBe(false);
      expect(enabledPayload.llm_assisted.bounds.trusted_mutations_allowed).toBe(false);
      expect(typeof enabledPayload.llm_assisted.rejectedLlmCitations).toBe('number');
    } finally {
      if (previous === undefined) delete process.env.GBRAIN_ANSWER_LLM_ASSISTED;
      else process.env.GBRAIN_ANSWER_LLM_ASSISTED = previous;
    }
  });
});
