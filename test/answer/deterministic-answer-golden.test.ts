import { describe, expect, test } from 'bun:test';
import { buildDeterministicAnswerEnvelope } from '../../src/core/answer/index.ts';
import type { RecallEvidence, RecallResult } from '../../src/core/evidence/recall.ts';

const HASH = 'a'.repeat(64);

function evidence(slug: string, quote: string, start = 1, end = 3): RecallEvidence {
  return {
    span_id: `gbs1:default:${slug}#compiled_truth:L${start}-L${end}`,
    source_id: 'default',
    slug,
    title: slug.split('/').pop(),
    section: 'compiled_truth',
    start_line: start,
    end_line: end,
    quote,
    quote_hash: HASH,
    line_basis: 'stored_section',
    matched_by: 'exact',
    score: 0.9,
  };
}

function recall(query: string, evidenceRows: RecallEvidence[]): RecallResult {
  return { query, status: 'hit', evidence: evidenceRows, warnings: [], integration: { search_source: 'direct' } };
}

describe('deterministic-v2 golden answer behavior', () => {
  test('synthetic decision fixture is stable under evidence shuffle', () => {
    const query = 'What was the idea before Rail X and why was Rail X not pursued?';
    const a = evidence('sources/test/rail-x', 'The prior option was Agent Commerce Clearinghouse. Rail X was rejected due to low network leverage. Later it became a module on the stronger base rail.');
    const b = evidence('sources/test/distractor', 'Green tea safety research was unrelated to the rail decision.');
    const one = buildDeterministicAnswerEnvelope(recall(query, [a, b]), { maxEvidence: 5 });
    const two = buildDeterministicAnswerEnvelope(recall(query, [b, a]), { maxEvidence: 5 });

    expect(one.status).toBe('hit');
    expect(one.answer).toContain('Agent Commerce Clearinghouse');
    expect(one.answer).toContain('low network leverage');
    expect(one.answer).not.toContain('Green tea');
    expect(two.claims.map(claim => claim.text)).toEqual(one.claims.map(claim => claim.text));
  });

  test('Chief-style protocol fixture compiles stack, change and measurement without production hardcoding', () => {
    const envelope = buildDeterministicAnswerEnvelope(recall(
      'What supplements was Anu using during pregnancy and when did we shift to ferrous ascorbate? What was ferritin?',
      [
        evidence('sources/test/pregnancy-stack', 'Maternal Supplementation Stack: Vitamin C + Quercetin 500mg, NMN 500mg, NAC 600mg, Magnesium Glycinate, Metformin. Iron push: Ferrous bisglycinate 45 mg fasted daily.'),
        evidence('sources/test/iron-review', 'She suggested shifting Anu to 100mg ferrous ascorbate instead of the bisglycinate. At 31-32 w with ferritin 19.9 ng/mL and FGR, the job is fetal iron endowment.'),
      ],
    ), { maxEvidence: 5 });

    expect(envelope.status).toBe('hit');
    expect(envelope.shape).toBe('protocol_or_stack_change');
    expect(envelope.answer).toContain('Maternal Supplementation Stack');
    expect(envelope.answer).toContain('100mg ferrous ascorbate');
    expect(envelope.answer).toContain('ferritin 19.9 ng/mL');
    expect(envelope.validation.ok).toBe(true);
  });

  test('evidence-removed fixture returns partial with missing required slot', () => {
    const envelope = buildDeterministicAnswerEnvelope(recall(
      'What supplements were in the protocol stack?',
      [evidence('sources/test/no-stack', 'The project had a later operational reason only; no itemized details are present.')],
    ));

    expect(envelope.status).toBe('partial');
    expect(envelope.missingSlots).toContain('stack');
    expect(envelope.answer).toContain('Missing slots: stack');
  });
});
