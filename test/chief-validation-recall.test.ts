import { describe, expect, test } from 'bun:test';
import type { BrainEngine } from '../src/core/engine.ts';
import { recallEvidence } from '../src/core/evidence/recall.ts';
import { synthesizeAnswerFromRecall } from '../src/core/evidence/answer-synthesis.ts';

const pages = new Map([
  ['sources/chatgpt/full-export-all/2026-01-25-what-i-know-about-you-694d3dc5', {
    slug: 'sources/chatgpt/full-export-all/2026-01-25-what-i-know-about-you-694d3dc5',
    source_id: 'default',
    title: 'What I Know About You',
    compiled_truth: `The alternative of staying at Rukam is high friction as well. Rukam feels like it's going down.
I get called in every 2 days to say, you came in at 10:05 instead of 10, we might need to cut a half day.
Actual processes are shit. Every morning, my drive to work is looking at the clock, wondering what they're going to say today.
I haven't even told them I had a kid, because they're toxic that way.
And if I stay, they’d want to make me principal, and leaving post that would be seen as a grab and go.
Rukam is dead EV and actively toxic.`,
    timeline: '',
    type: 'source',
  }],
  ['sources/chatgpt/full-export-all/2026-02-26-resignation-letter-feedback-697b4cf8', {
    slug: 'sources/chatgpt/full-export-all/2026-02-26-resignation-letter-feedback-697b4cf8',
    source_id: 'default',
    title: 'Resignation Letter Feedback',
    compiled_truth: `I want to say this clearly: my decision is not born out of dissatisfaction.
Rukam has been a meaningful and formative chapter of my life.
Much of how I think and operate today has been shaped by my time working with you.
Archana — thank you for the trust you placed in me over the years. You pushed for clarity, for rigor, and for conviction, even when it was uncomfortable.`,
    timeline: '',
    type: 'source',
  }],
  ['raw/dream/ledger/2023-10-23-invoice-for-new-delhi-slush-d-0abdd630', {
    slug: 'raw/dream/ledger/2023-10-23-invoice-for-new-delhi-slush-d-0abdd630',
    source_id: 'default',
    title: 'Invoice for New Delhi Slush D',
    compiled_truth: `Claim: Archana: Informed the user about weekend work expectations and assigned specific tasks.
Claim: Workload Tracking: User maintains a detailed log of extra weekend work including specific tasks and budget figures.`,
    timeline: '',
    type: 'source',
  }],
  ['sources/chatgpt/full-export-all/2025-09-11-navigating-legacy-and-power-6888ddac', {
    slug: 'sources/chatgpt/full-export-all/2025-09-11-navigating-legacy-and-power-6888ddac',
    source_id: 'default',
    title: 'Navigating Legacy and Power',
    compiled_truth: `Build the Agent Commerce Clearinghouse (ACC): portable receipts, settlement and arbitration for agent commerce.
Why not ACC as the top rail? PSPs already bundle escrow/chargeback tooling and Visa VROL sits over disputes. Great wedge, but easier for incumbents to absorb; stronger as a module that rides on MWAL/C³ than as the base rail.
This is for ACC. I thought you’d pivoted to mwal. Think deeply.
With MWAL, the customer wasn't clear. The face of the customer was amorphous.`,
    timeline: '',
    type: 'source',
  }],
  ['sources/chatgpt/full-export-all/2025-10-25-green-tea-safety-research-68fc8072', {
    slug: 'sources/chatgpt/full-export-all/2025-10-25-green-tea-safety-research-68fc8072',
    source_id: 'default',
    title: 'Green Tea Safety Research',
    compiled_truth: `Reality check: MWAL v0.3 spec has hardened technically, but ecosystem gravity is still low.
If missed: MWAL risks becoming another elegant spec with zero network lock-in.`,
    timeline: '',
    type: 'source',
  }],
  ['sources/chatgpt/full-export-all/2025-12-18-ai-summit-shortcomings-6943a26a', {
    slug: 'sources/chatgpt/full-export-all/2025-12-18-ai-summit-shortcomings-6943a26a',
    source_id: 'default',
    title: 'AI Summit Shortcomings',
    compiled_truth: `Praeon was your attempt to build a sovereign AI rail — an infrastructure-grade layer concerned with correctness, provenance, control, and trust in AI systems.
Praeon tried to influence intelligence after it was created, not where intelligence meets physics, capital, power, or throughput.`,
    timeline: '',
    type: 'source',
  }],
  ['sources/chatgpt/full-export-all/2025-12-18-reason-for-disappointment-6943af56', {
    slug: 'sources/chatgpt/full-export-all/2025-12-18-reason-for-disappointment-6943af56',
    source_id: 'default',
    title: 'Reason for Disappointment',
    compiled_truth: `Praeon (AI rails / compliance / provenance): explored → rejected due to policy theatre and lack of real leverage.
I value sovereignty, compounding leverage, correctness over comfort, and family durability as a hard constraint.`,
    timeline: '',
    type: 'source',
  }],
  ['sources/chatgpt/full-export-all/2025-08-08-pregnancy-optimization-protocol-68026a94', {
    slug: 'sources/chatgpt/full-export-all/2025-08-08-pregnancy-optimization-protocol-68026a94',
    source_id: 'default',
    title: 'Pregnancy Optimization Protocol',
    compiled_truth: `Maternal Supplementation Stack (Already Taken Daily): Vitamin C + Quercetin 500mg, Folic acid 5mg, Methylfolate + Methylcobalamin, NMN 500mg, NAC 600mg, Brahmi + Shankhpushpi, Biotin, Moringa, Lion's Mane, Citrulline malate, Beta alanine, Taurine, L-carnitine, Plant protein shake.
Phosphatidylcholine 2g, Flaxseed oil 2g, Vitamin D3 5000 IU + K2, Prenatal Multivitamin, Creatine 5g, Probiotics, ZMA, Magnesium Glycinate, Metformin.
Iron push: Ferrous bisglycinate 45 mg fasted daily, lactoferrin 200 mg BID; re-test ferritin at 31 w aiming ≥ 45 ng/mL.`,
    timeline: '',
    type: 'source',
  }],
  ['sources/chatgpt/full-export-all/2025-09-15-pregnancy-protocol-review-68907095', {
    slug: 'sources/chatgpt/full-export-all/2025-09-15-pregnancy-protocol-review-68907095',
    source_id: 'default',
    title: 'Pregnancy Protocol Review',
    compiled_truth: `She suggested shifting Anu to 100mg ferrous ascorbate instead of the bisglycinate.
At **31–32 w** with **ferritin 19.9 ng/mL** and **FGR**, the job isn’t just mom’s Hb—it’s fetal iron endowment.
Switching to 100 mg ferrous ascorbate daily is a **slow, GI-hard path** that risks missing the fetal iron window.`,
    timeline: '',
    type: 'source',
  }],
]);

function engine(): BrainEngine {
  return {
    kind: 'postgres',
    searchKeyword: async () => [],
    executeRaw: async (_sql: string, params: unknown[]) => {
      const slug = String(params[0]);
      const page = pages.get(slug);
      return page ? [page] : [];
    },
  } as unknown as BrainEngine;
}

describe('Chief-confirmed autobiographical validation recall', () => {
  test('recalls and synthesizes Archana/Rukam relationship and high-friction incidents through source hints', async () => {
    const out = await recallEvidence(engine(), 'What was my relationship with Archana like and what high friction incidents existed?', { limit: 8, before: 0, after: 0 });

    expect(out.status).toBe('hit');
    const joined = out.evidence.map(e => e.quote).join('\n');
    expect(joined).toContain('10:05 instead of 10');
    expect(joined).toContain("I haven't even told them I had a kid");
    expect(joined).toContain('Archana — thank you');
    expect(joined).toContain('weekend work expectations');

    const answer = synthesizeAnswerFromRecall(out, { maxEvidence: 8, maxQuoteChars: 220 });
    expect(answer.status).toBe('hit');
    expect(answer.answer).toContain('Relationship frame');
    expect(answer.answer).toContain('High-friction Rukam incidents');
    expect(answer.answer).toContain('Weekend/workload pressure');
    expect(answer.answer).toContain('10:05 instead of 10');
    expect(answer.answer).toContain('Archana — thank you');
    expect(answer.answer).toContain('gbs1:');
  });

  test('recalls and synthesizes ACC before MWAL and why MWAL/adjacent rails were not pursued as standalone primary', async () => {
    const out = await recallEvidence(engine(), 'What was the idea before MWAL and why was MWAL not pursued?', { limit: 9, before: 0, after: 0 });

    expect(out.status).toBe('hit');
    const joined = out.evidence.map(e => e.quote).join('\n');
    expect(joined).toContain('Agent Commerce Clearinghouse (ACC)');
    expect(joined).toContain('Why not ACC as the top rail?');
    expect(joined).toContain('face of the customer was amorphous');
    expect(joined).toContain('zero network lock-in');
    expect(joined).toContain('policy theatre and lack of real leverage');

    const answer = synthesizeAnswerFromRecall(out, { maxEvidence: 9, maxQuoteChars: 240 });
    expect(answer.status).toBe('hit');
    expect(answer.answer).toContain('Lineage before MWAL');
    expect(answer.answer).toContain('Why ACC/MWAL were not enough as the base rail');
    expect(answer.answer).toContain('Praeon-style rail lesson');
    expect(answer.answer).toContain('Agent Commerce Clearinghouse (ACC)');
    expect(answer.answer).toContain('zero network lock-in');
    expect(answer.answer).toContain('policy theatre and lack of real leverage');
    expect(answer.answer).not.toContain('family durability');
  });

  test('recalls and synthesizes Anu pregnancy supplement stack and ferrous ascorbate/ferritin context', async () => {
    const out = await recallEvidence(engine(), 'What supplements was Anu using during pregnancy and when did we shift to ferrous ascorbate? What was ferritin?', { limit: 6, before: 0, after: 0 });

    expect(out.status).toBe('hit');
    const joined = out.evidence.map(e => e.quote).join('\n');
    expect(joined).toContain('Maternal Supplementation Stack');
    expect(joined).toContain('Phosphatidylcholine 2g');
    expect(joined).toContain('Ferrous bisglycinate 45 mg');
    expect(joined).toContain('100mg ferrous ascorbate');
    expect(joined).toContain('ferritin 19.9 ng/mL');

    const answer = synthesizeAnswerFromRecall(out, { maxEvidence: 6, maxQuoteChars: 260 });
    expect(answer.status).toBe('hit');
    expect(answer.answer).toContain('Supplement stack captured in source');
    expect(answer.answer).toContain('Initial iron plan');
    expect(answer.answer).toContain('Ferrous ascorbate / ferritin context');
    expect(answer.answer).toContain('Maternal Supplementation Stack');
    expect(answer.answer).toContain('Ferrous bisglycinate 45 mg');
    expect(answer.answer).toContain('ferritin 19.9 ng/mL');
  });
});
