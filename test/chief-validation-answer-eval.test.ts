import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAnswerCommand } from '../src/commands/answer.ts';
import { synthesizeAnswerFromRecall } from '../src/core/evidence/answer-synthesis.ts';
import type { RecallEvidence, RecallResult } from '../src/core/evidence/recall.ts';

const QUOTE_HASH = 'f'.repeat(64);

type AnswerQualityEvalCase = {
  name: string;
  recall: RecallResult;
  maxEvidence: number;
  maxQuoteChars: number;
  required: string[];
  forbidden: Array<string | RegExp>;
  minStatus: 'partial' | 'hit';
};

function evidence(overrides: Partial<RecallEvidence> & Pick<RecallEvidence, 'slug' | 'title' | 'quote' | 'start_line' | 'end_line'>): RecallEvidence {
  const section = overrides.section ?? 'compiled_truth';
  return {
    span_id: overrides.span_id ?? `gbs1:default:${overrides.slug}#${section}:L${overrides.start_line}-L${overrides.end_line}`,
    source_id: overrides.source_id ?? 'default',
    slug: overrides.slug,
    title: overrides.title,
    section,
    start_line: overrides.start_line,
    end_line: overrides.end_line,
    quote: overrides.quote,
    quote_hash: overrides.quote_hash ?? QUOTE_HASH,
    line_basis: overrides.line_basis ?? 'stored_section',
    matched_by: overrides.matched_by ?? 'exact',
    score: overrides.score ?? 0.9,
  };
}

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

async function synthesizeViaCli(recall: RecallResult, opts: { maxEvidence: number; maxQuoteChars: number }): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'gbrain-chief-answer-eval-'));
  const recallPath = join(dir, 'recall.json');
  writeFileSync(recallPath, JSON.stringify(recall), 'utf8');
  const stdout = await captureStdout(() => runAnswerCommand(null, [
    '--from-recall-json', recallPath,
    '--json',
    '--max-evidence', String(opts.maxEvidence),
    '--max-quote-chars', String(opts.maxQuoteChars),
  ]));
  process.exitCode = undefined;
  return JSON.parse(stdout);
}

const cases: AnswerQualityEvalCase[] = [
  {
    name: 'Archana/Rukam relationship and high-friction incidents',
    maxEvidence: 8,
    maxQuoteChars: 220,
    minStatus: 'hit',
    recall: {
      query: 'What was my relationship with Archana like and what high friction incidents existed?',
      status: 'hit',
      evidence: [
        evidence({
          slug: 'sources/chatgpt/full-export-all/2026-01-25-what-i-know-about-you-694d3dc5',
          title: 'What I Know About You',
          start_line: 1,
          end_line: 6,
          quote: `The alternative of staying at Rukam is high friction as well. Rukam feels like it's going down.
I get called in every 2 days to say, you came in at 10:05 instead of 10, we might need to cut a half day.
Actual processes are shit. Every morning, my drive to work is looking at the clock, wondering what they're going to say today.
I haven't even told them I had a kid, because they're toxic that way.
And if I stay, they’d want to make me principal, and leaving post that would be seen as a grab and go.
Rukam is dead EV and actively toxic.`,
        }),
        evidence({
          slug: 'sources/chatgpt/full-export-all/2026-02-26-resignation-letter-feedback-697b4cf8',
          title: 'Resignation Letter Feedback',
          start_line: 1,
          end_line: 5,
          quote: `I want to say this clearly: my decision is not born out of dissatisfaction.
Rukam has been a meaningful and formative chapter of my life.
Much of how I think and operate today has been shaped by my time working with you.
Archana — thank you for the trust you placed in me over the years. You pushed for clarity, for rigor, and for conviction, even when it was uncomfortable.`,
        }),
        evidence({
          slug: 'raw/dream/ledger/2023-10-23-invoice-for-new-delhi-slush-d-0abdd630',
          title: 'Invoice for New Delhi Slush D',
          start_line: 1,
          end_line: 2,
          quote: `Claim: Archana: Informed the user about weekend work expectations and assigned specific tasks.
Claim: Workload Tracking: User maintains a detailed log of extra weekend work including specific tasks and budget figures.`,
        }),
      ],
      warnings: [],
      integration: { search_source: 'direct' },
    },
    required: ['Relationship frame', 'High-friction Rukam incidents', 'Weekend/workload pressure', '10:05 instead of 10', 'Archana — thank you', 'weekend work expectations'],
    forbidden: ['Additional exact source window', 'green tea', 'cite', '> **Build'],
  },
  {
    name: 'ACC before MWAL and why adjacent rails were not the base rail',
    maxEvidence: 9,
    maxQuoteChars: 240,
    minStatus: 'partial',
    recall: {
      query: 'What was the idea before MWAL and why was MWAL not pursued?',
      status: 'hit',
      evidence: [
        evidence({
          slug: 'sources/chatgpt/full-export-all/2025-09-11-navigating-legacy-and-power-6888ddac',
          title: 'Navigating Legacy and Power',
          start_line: 1,
          end_line: 4,
          quote: `> **Build the Agent Commerce Clearinghouse (ACC):** portable receipts, settlement and arbitration for agent commerce. citeturn0search0
- Why not ACC as the top rail? PSPs already bundle escrow/chargeback tooling and Visa VROL sits over disputes. Great wedge, but easier for incumbents to absorb; stronger as a module that rides on MWAL/C³ than as the base rail.
This is for ACC. I thought you’d pivoted to mwal. Think deeply.
With MWAL, the customer wasn't clear. The face of the customer was amorphous.`,
        }),
        evidence({
          slug: 'sources/chatgpt/full-export-all/2025-10-25-green-tea-safety-research-68fc8072',
          title: 'Green Tea Safety Research',
          start_line: 1,
          end_line: 2,
          quote: `Reality check: MWAL v0.3 spec has hardened technically, but ecosystem gravity is still low.
If missed: MWAL risks becoming another elegant spec with zero network lock-in.`,
        }),
        evidence({
          slug: 'sources/chatgpt/full-export-all/2025-12-18-ai-summit-shortcomings-6943a26a',
          title: 'AI Summit Shortcomings',
          start_line: 1,
          end_line: 2,
          quote: `Praeon was your attempt to build a sovereign AI rail — an infrastructure-grade layer concerned with correctness, provenance, control, and trust in AI systems.
Praeon tried to influence intelligence after it was created, not where intelligence meets physics, capital, power, or throughput.`,
        }),
        evidence({
          slug: 'sources/chatgpt/full-export-all/2025-12-18-reason-for-disappointment-6943af56',
          title: 'Reason for Disappointment',
          start_line: 1,
          end_line: 2,
          quote: `Praeon (AI rails / compliance / provenance): explored → rejected due to policy theatre and lack of real leverage.
I value sovereignty, compounding leverage, correctness over comfort, and family durability as a hard constraint.`,
        }),
      ],
      warnings: [],
      integration: { search_source: 'direct' },
    },
    required: ['Lineage before MWAL', 'Why ACC/MWAL were not enough as the base rail', 'Praeon-style rail lesson', 'Agent Commerce Clearinghouse (ACC)', 'zero network lock-in', 'policy theatre and lack of real leverage'],
    forbidden: ['?.', '..', /\.\s+a neutral\b/, '> **Build', 'cite', 'family durability'],
  },
  {
    name: 'Anu pregnancy supplement stack and ferritin/ferrous ascorbate context',
    maxEvidence: 6,
    maxQuoteChars: 260,
    minStatus: 'hit',
    recall: {
      query: 'What supplements was Anu using during pregnancy and when did we shift to ferrous ascorbate? What was ferritin?',
      status: 'hit',
      evidence: [
        evidence({
          slug: 'sources/chatgpt/full-export-all/2025-08-08-pregnancy-optimization-protocol-68026a94',
          title: 'Pregnancy Optimization Protocol',
          start_line: 1,
          end_line: 3,
          quote: `Maternal Supplementation Stack (Already Taken Daily): Vitamin C + Quercetin 500mg, Folic acid 5mg, Methylfolate + Methylcobalamin, NMN 500mg, NAC 600mg, Brahmi + Shankhpushpi, Biotin, Moringa, Lion's Mane, Citrulline malate, Beta alanine, Taurine, L-carnitine, Plant protein shake.
Phosphatidylcholine 2g, Flaxseed oil 2g, Vitamin D3 5000 IU + K2, Prenatal Multivitamin, Creatine 5g, Probiotics, ZMA, Magnesium Glycinate, Metformin.
Iron push: Ferrous bisglycinate 45 mg fasted daily, lactoferrin 200 mg BID; re-test ferritin at 31 w aiming ≥ 45 ng/mL.`,
        }),
        evidence({
          slug: 'sources/chatgpt/full-export-all/2025-09-15-pregnancy-protocol-review-68907095',
          title: 'Pregnancy Protocol Review',
          start_line: 1,
          end_line: 3,
          quote: `She suggested shifting Anu to 100mg ferrous ascorbate instead of the bisglycinate.
At **31–32 w** with **ferritin 19.9 ng/mL** and **FGR**, the job isn’t just mom’s Hb—it’s fetal iron endowment.
Switching to 100 mg ferrous ascorbate daily is a **slow, GI-hard path** that risks missing the fetal iron window.`,
        }),
      ],
      warnings: [],
      integration: { search_source: 'direct' },
    },
    required: ['Supplement stack captured in source', 'Initial iron plan', 'Ferrous ascorbate / ferritin context', 'Maternal Supplementation Stack', 'NMN 500mg', 'NAC 600mg', 'Phosphatidylcholine 2g', 'Metformin', 'Magnesium Glycinate', 'Ferrous bisglycinate 45 mg', 'ferritin 19.9 ng/mL'],
    forbidden: ['Additional exact source window', 'green tea', 'policy theatre', 'cite'],
  },
];

afterEach(() => {
  process.exitCode = undefined;
});

describe('Chief validation answer-quality eval harness', () => {
  for (const evalCase of cases) {
    test(evalCase.name, async () => {
      const payload = await synthesizeViaCli(evalCase.recall, {
        maxEvidence: evalCase.maxEvidence,
        maxQuoteChars: evalCase.maxQuoteChars,
      }) as { status: string; answer: string; citations: Array<{ span_id: string }>; evidence: RecallEvidence[]; bounds: { deterministic: boolean; abstain_if_no_exact_span: boolean } };

      expect(['partial', 'hit']).toContain(payload.status);
      if (evalCase.minStatus === 'hit') expect(payload.status).toBe('hit');
      expect(payload.bounds).toMatchObject({ deterministic: true, abstain_if_no_exact_span: true });
      expect(payload.answer).toContain('Evidence spans:');
      expect(payload.citations.length).toBeGreaterThan(0);
      expect(payload.evidence.length).toBe(payload.citations.length);
      for (const citation of payload.citations) {
        expect(citation.span_id).toStartWith('gbs1:');
        expect(payload.answer).toContain(citation.span_id);
      }
      for (const required of evalCase.required) expect(payload.answer).toContain(required);
      for (const forbidden of evalCase.forbidden) {
        if (typeof forbidden === 'string') expect(payload.answer).not.toContain(forbidden);
        else expect(payload.answer).not.toMatch(forbidden);
      }
      const lines = payload.answer.split('\n').filter((line: string) => line.trim().startsWith('- '));
      expect(new Set(lines.map((line: string) => line.toLowerCase())).size).toBe(lines.length);
    });
  }

  test('abstains when recall evidence is missing exact gbs1 spans', () => {
    const payload = synthesizeAnswerFromRecall({
      query: 'What should not be answered without exact evidence?',
      status: 'hit',
      evidence: [evidence({
        span_id: 'chunk:default:sources/test/no-exact-span#compiled_truth:L1-L1',
        slug: 'sources/test/no-exact-span',
        title: 'No Exact Span',
        start_line: 1,
        end_line: 1,
        quote: 'This looks relevant but is not an exact gbs1 source window.',
      })],
      warnings: [],
      integration: { search_source: 'direct' },
    }, { maxEvidence: 4, maxQuoteChars: 200 });

    expect(payload.status).toBe('abstain');
    expect(payload.answer).toBe('');
    expect(payload.citations).toEqual([]);
    expect(payload.warnings.join(' ')).toContain('abstaining');
  });
});
