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

  test('prunes irrelevant autobiographical source windows instead of emitting noisy additional evidence', () => {
    const noisyRecall: RecallResult = {
      query: 'What was my relationship with Archana like and what high friction incidents existed?',
      status: 'hit',
      evidence: [
        {
          span_id: 'gbs1:default:sources/test/rukam-friction#compiled_truth:L1-L2',
          source_id: 'default',
          slug: 'sources/test/rukam-friction',
          title: 'Rukam Friction',
          section: 'compiled_truth',
          start_line: 1,
          end_line: 2,
          quote: "I get called in every 2 days to say, you came in at 10:05 instead of 10, we might need to cut a half day. I haven't even told them I had a kid, because they're toxic that way.",
          quote_hash: 'b'.repeat(64),
          line_basis: 'stored_section',
          matched_by: 'exact',
          score: 0.9,
        },
        {
          span_id: 'gbs1:default:sources/test/irrelevant-window#compiled_truth:L1-L2',
          source_id: 'default',
          slug: 'sources/test/irrelevant-window',
          title: 'Irrelevant Window',
          section: 'compiled_truth',
          start_line: 1,
          end_line: 2,
          quote: 'A random source window about green tea, weather, and unrelated logistics should not be surfaced in this answer.',
          quote_hash: 'c'.repeat(64),
          line_basis: 'stored_section',
          matched_by: 'chunk',
          score: 0.4,
        },
      ],
      warnings: [],
      integration: { search_source: 'direct' },
    };

    const out = synthesizeAnswerFromRecall(noisyRecall, { maxEvidence: 4, maxQuoteChars: 240 });

    expect(out.status).toBe('hit');
    expect(out.answer).toContain('10:05 instead of 10');
    expect(out.answer).not.toContain('green tea');
    expect(out.answer).not.toContain('Additional exact source window');
    expect(out.citations.map(c => c.slug)).toEqual(['sources/test/rukam-friction']);
    expect(out.warnings.join(' ')).toContain('low-relevance or duplicate source windows were excluded');
  });

  test('polishes sentence-cluster punctuation without changing cited facts', () => {
    const clusteredRecall: RecallResult = {
      query: 'What was the idea before MWAL and why was MWAL not pursued?',
      status: 'hit',
      evidence: [
        {
          span_id: 'gbs1:default:sources/test/acc-lineage#compiled_truth:L1-L3',
          source_id: 'default',
          slug: 'sources/test/acc-lineage',
          title: 'ACC Lineage',
          section: 'compiled_truth',
          start_line: 1,
          end_line: 3,
          quote: 'Build the Agent Commerce Clearinghouse (ACC). a neutral settlement layer for agent commerce. Why not ACC as the top rail? PSPs already bundle escrow/chargeback tooling and Visa VROL sits over disputes.',
          quote_hash: 'e'.repeat(64),
          line_basis: 'stored_section',
          matched_by: 'exact',
          score: 0.92,
        },
      ],
      warnings: [],
      integration: { search_source: 'direct' },
    };

    const out = synthesizeAnswerFromRecall(clusteredRecall, { maxEvidence: 1, maxQuoteChars: 260 });

    expect(out.status).toBe('hit');
    expect(out.answer).toContain('Build the Agent Commerce Clearinghouse (ACC).');
    expect(out.answer).toContain('A neutral settlement layer for agent commerce.');
    expect(out.answer).toContain('Why not ACC as the top rail?');
    expect(out.answer).toContain('[S1]');
    expect(out.citations).toEqual([
      expect.objectContaining({ label: 'S1', span_id: clusteredRecall.evidence[0].span_id, quote_hash: 'e'.repeat(64) }),
    ]);
    expect(out.answer).not.toContain('?.');
    expect(out.answer).not.toContain('..');
    expect(out.answer).not.toMatch(/\.\s+a neutral\b/);
  });

  test('renders dense evidence clusters without semicolon-chain prose', () => {
    const clusteredRecall: RecallResult = {
      query: 'What supplements was Anu using during pregnancy?',
      status: 'hit',
      evidence: [
        {
          span_id: 'gbs1:default:sources/test/pregnancy-stack#compiled_truth:L1-L1',
          source_id: 'default',
          slug: 'sources/test/pregnancy-stack',
          title: 'Pregnancy Stack',
          section: 'compiled_truth',
          start_line: 1,
          end_line: 1,
          quote: 'Maternal Supplementation Stack (Already Taken Daily): Vitamin C + Quercetin 500mg, Folic acid 5mg, Methylfolate + Methylcobalamin, NMN 500mg, NAC 600mg, Phosphatidylcholine 2g, Vitamin D3 5000 IU + K2, Prenatal Multivitamin, Creatine 5g, Magnesium Glycinate, Metformin.',
          quote_hash: 'd'.repeat(64),
          line_basis: 'stored_section',
          matched_by: 'exact',
          score: 0.91,
        },
      ],
      warnings: [],
      integration: { search_source: 'direct' },
    };

    const out = synthesizeAnswerFromRecall(clusteredRecall, { maxEvidence: 1, maxQuoteChars: 260 });
    const stackLine = out.answer.split('\n').find(line => line.includes('Supplement stack captured in source')) ?? '';

    expect(out.status).toBe('hit');
    expect(stackLine).toContain('NMN 500mg');
    expect(stackLine).toContain('NAC 600mg');
    expect(stackLine).toContain('Phosphatidylcholine 2g');
    expect(stackLine).toContain('Metformin');
    expect(stackLine).toContain('[S1]');
    expect(stackLine.split(';').length - 1).toBeLessThanOrEqual(1);
  });

  test('strips markdown headings and citation artifacts from source windows before synthesis', () => {
    const artifactRecall: RecallResult = {
      query: 'What changed in the protocol stack?',
      status: 'hit',
      evidence: [
        {
          span_id: 'gbs1:default:sources/test/artifact-window#compiled_truth:L1-L3',
          source_id: 'default',
          slug: 'sources/test/artifact-window',
          title: 'Artifact Window',
          section: 'compiled_truth',
          start_line: 1,
          end_line: 3,
          quote: '### Therefore\n> Claim: Build a neutral network.\n- Agree: turn123search45 and citeturn1search5 are not acceptable.',
          quote_hash: 'f'.repeat(64),
          line_basis: 'stored_section',
          matched_by: 'exact',
          score: 0.88,
        },
      ],
      warnings: [],
      integration: { search_source: 'direct' },
    };

    const out = synthesizeAnswerFromRecall(artifactRecall, { maxEvidence: 1, maxQuoteChars: 220 });

    expect(out.status).toBe('hit');
    expect(out.answer).not.toContain('###');
    expect(out.answer).not.toContain('citeturn1search5');
    expect(out.answer).not.toContain('turn123search45');
    expect(out.answer).not.toContain('Claim:');
    expect(out.answer).not.toContain('Agree:');
    expect(out.answer).toContain('Build a neutral network.');
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
