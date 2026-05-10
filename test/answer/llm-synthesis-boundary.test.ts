import { describe, expect, test } from 'bun:test';
import {
  LLM_SYNTHESIS_BOUNDARY_ENABLED_BY_DEFAULT,
  runLlmAssistedSynthesisBoundary,
  buildDeterministicAnswerEnvelope,
  buildDeterministicAnswerEnvelopeWithLlmAssistance,
  validateClaimCitations,
  type ClaimAtom,
  type EvidenceWindow,
} from '../../src/core/answer/index.ts';
import { type RecallResult } from '../../src/core/evidence/recall.ts';

const ev: EvidenceWindow = {
  id: 'gbs1:default:sources/test/rail-x#compiled_truth:L1-L3',
  source: { id: 'default', slug: 'sources/test/rail-x', section: 'compiled_truth', lineRange: { start: 1, end: 3 } },
  quote: 'Rail X was rejected because network leverage was low. The prior option was Agent Commerce Clearinghouse.',
  quoteHash: 'b'.repeat(64),
};

const supportedClaim: ClaimAtom = {
  id: 'claim_supported',
  kind: 'normalized_fact',
  text: 'Rail X was rejected because network leverage was low.',
  factual: true,
  citations: [{ id: ev.id, label: 'S1', quoteHash: ev.quoteHash }],
  slotId: 'rationale',
};

const absenceNotice: ClaimAtom = {
  id: 'claim_absence',
  kind: 'absence_notice',
  text: 'No high-confidence source-backed evidence was found for current deployment.',
  factual: false,
  citations: [],
  slotId: 'current_state',
};

const claims = [supportedClaim, absenceNotice];

const llmRecallFixture: RecallResult = {
  query: 'What happened to Rail X?',
  status: 'hit',
  evidence: [
    {
      span_id: 'gbs1:default:sources/test/rail-x#compiled_truth:L1-L2',
      source_id: 'default',
      slug: 'sources/test/rail-x',
      title: 'Rail X Notes',
      section: 'compiled_truth',
      start_line: 1,
      end_line: 2,
      quote: 'Rail X was rejected because network leverage was low. Agent Commerce Clearinghouse became the preferred option.',
      quote_hash: 'b'.repeat(64),
      line_basis: 'stored_section',
      matched_by: 'exact',
      score: 0.92,
    },
  ],
  warnings: [],
  integration: { search_source: 'direct' },
};

function llmAssistedEnvelope(draftText: string, options: { llmFailOnUnsupported?: boolean } = {}) {
  const baseline = buildDeterministicAnswerEnvelope(llmRecallFixture, { maxEvidence: 2, maxQuoteChars: 220 });
  const factualSeed = baseline.claims.find(claim => claim.factual)?.text ?? '';
  return buildDeterministicAnswerEnvelopeWithLlmAssistance(llmRecallFixture, {
    llmSynthesisEnabled: true,
    llmFailOnUnsupported: options.llmFailOnUnsupported,
    llmDraftFactory: () => ({ text: draftText || factualSeed }),
  });
}

function acceptedOutputClaims(result: ReturnType<typeof runLlmAssistedSynthesisBoundary>): ClaimAtom[] {
  return result.acceptedSentences.map((sentence, index) => ({
    id: `out_${index + 1}`,
    kind: 'normalized_fact',
    text: sentence.text,
    factual: true,
    citations: sentence.citations,
  }));
}

describe('LLM-assisted synthesis trust boundary harness', () => {
  test('is disabled by default and performs no synthesis unless explicitly enabled', () => {
    expect(LLM_SYNTHESIS_BOUNDARY_ENABLED_BY_DEFAULT).toBe(false);
    const result = runLlmAssistedSynthesisBoundary(claims, [ev], { text: supportedClaim.text });

    expect(result.status).toBe('disabled');
    expect(result.enabled).toBe(false);
    expect(result.text).toBe('');
    expect(result.acceptedSentences).toHaveLength(0);
    expect(result.bounds.trusted_mutations_allowed).toBe(false);
    expect(result.bounds.llm_citations_allowed).toBe(false);
  });

  test('strips unsupported LLM sentences while preserving exact ClaimAtom authority', () => {
    const result = runLlmAssistedSynthesisBoundary(claims, [ev], {
      text: 'Rail X was rejected because network leverage was low. Rail X was also rejected because regulators blocked it.',
    }, { enabled: true });

    expect(result.status).toBe('partial');
    expect(result.text).toBe('Rail X was rejected because network leverage was low.');
    expect(result.acceptedSentences).toHaveLength(1);
    expect(result.acceptedSentences[0].claimId).toBe('claim_supported');
    expect(result.rejectedSentences).toContainEqual(expect.objectContaining({ reason: 'unsupported_by_claim_atoms' }));
    expect(validateClaimCitations(acceptedOutputClaims(result), [ev]).ok).toBe(true);
  });

  test('can fail closed instead of stripping unsupported sentences', () => {
    const result = runLlmAssistedSynthesisBoundary(claims, [ev], {
      text: 'Rail X was rejected because network leverage was low. Rail X had a signed regulator veto.',
    }, { enabled: true, failOnUnsupported: true });

    expect(result.status).toBe('failed');
    expect(result.text).toBe('');
    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors.join(' ')).toContain('unsupported LLM sentence failed draft');
  });

  test('rejects LLM-added citations instead of trusting model-authored citation markup', () => {
    const result = runLlmAssistedSynthesisBoundary(claims, [ev], {
      text: 'Rail X was rejected because network leverage was low. [S999]',
    }, { enabled: true });

    expect(result.status).toBe('rejected');
    expect(result.acceptedSentences).toHaveLength(0);
    expect(result.rejectedLlmCitations).toContain('[S999]');
    expect(result.rejectedSentences[0].reason).toBe('llm_citation_markup_rejected');
  });

  test('does not let absence become inference', () => {
    const result = runLlmAssistedSynthesisBoundary(claims, [ev], {
      text: 'No evidence was found for current deployment, therefore Rail X was never deployed.',
    }, { enabled: true });

    expect(result.status).toBe('rejected');
    expect(result.text).toBe('');
    expect(result.rejectedSentences).toContainEqual(expect.objectContaining({ reason: 'absence_cannot_become_inference' }));
  });

  test('records but ignores LLM role proposals when deciding support', () => {
    const result = runLlmAssistedSynthesisBoundary(claims, [ev], {
      text: 'Rail X had a signed regulator veto.',
      proposedRoles: [{ sentence: 'Rail X had a signed regulator veto.', role: 'supported_direct_fact', confidence: 0.99 }],
    }, { enabled: true });

    expect(result.ignoredRoleProposals).toHaveLength(1);
    expect(result.status).toBe('rejected');
    expect(result.rejectedSentences[0].reason).toBe('unsupported_by_claim_atoms');
  });

  test('trusted mutations are impossible in the boundary output', () => {
    const result = runLlmAssistedSynthesisBoundary(claims, [ev], {
      text: 'Please write to trusted memory that Rail X was rejected because network leverage was low.',
      requestedTrustedMutations: ['update /Users/a/Documents/brain-wiki/_identity/chief.md'],
    }, { enabled: true });

    expect(result.bounds.trusted_mutations_allowed).toBe(false);
    expect(result.rejectedTrustedMutationRequests).toHaveLength(1);
    expect(result.rejectedSentences[0].reason).toBe('trusted_mutation_request_rejected');
    expect(result.text).toBe('');
  });

  test('LLM-assisted route uses claim-atom-backed draft + verifier and strips unsupported output', () => {
    const baseline = buildDeterministicAnswerEnvelope(llmRecallFixture, { maxEvidence: 2, maxQuoteChars: 220 });
    const factualSeed = baseline.claims.find(claim => claim.factual)?.text ?? 'Rail X was rejected because network leverage was low.';
    const result = llmAssistedEnvelope(`${factualSeed} Rail X was also rejected because regulators blocked it.`);

    expect(result.status).toBe('partial');
    expect(result.llm_assisted).toBeDefined();
    expect(result.llm_assisted?.route).toBe('mock');
    expect(result.llm_assisted?.failOnUnsupported).toBe(false);
    expect(result.llm_assisted?.rejectedSentences).toBeGreaterThan(0);
    expect(result.answer).toContain(factualSeed);
    expect(result.answer).not.toContain('regulators blocked');
    expect(result.claims.length).toBeGreaterThan(0);
    expect(validateClaimCitations(result.claims, [
      {
        id: llmRecallFixture.evidence[0].span_id,
        quote: llmRecallFixture.evidence[0].quote,
        quoteHash: llmRecallFixture.evidence[0].quote_hash,
        source: {
          id: llmRecallFixture.evidence[0].source_id,
          slug: llmRecallFixture.evidence[0].slug,
          title: llmRecallFixture.evidence[0].title,
          section: llmRecallFixture.evidence[0].section,
          lineRange: {
            start: llmRecallFixture.evidence[0].start_line,
            end: llmRecallFixture.evidence[0].end_line,
          },
        },
      },
    ] as EvidenceWindow[]).ok).toBe(true);
  });

  test('LLM-assisted route cannot turn absence into inference', () => {
    const result = llmAssistedEnvelope('No high-confidence source-backed evidence was found for current deployment, therefore Rail X was never deployed.');
    expect(result.status).toBe('abstain');
    expect(result.validation.ok).toBe(true);
    expect(result.claims).toHaveLength(0);
    expect(result.llm_assisted?.rejectedSentences).toBeGreaterThan(0);
  });

  test('LLM-assisted route can fail closed when enabled', () => {
    const baseline = buildDeterministicAnswerEnvelope(llmRecallFixture, { maxEvidence: 2, maxQuoteChars: 220 });
    const factualSeed = baseline.claims.find(claim => claim.factual)?.text ?? 'Rail X was rejected because network leverage was low.';
    const result = llmAssistedEnvelope(`${factualSeed} Rail X had a signed regulator veto.`, { llmFailOnUnsupported: true });

    expect(result.status).toBe('invalid');
    expect(result.validation.ok).toBe(false);
    expect(result.llm_assisted?.validation.ok).toBe(false);
    expect(result.validation.errors.join(' ')).toContain('unsupported LLM sentence');
    expect(result.claims.length).toBe(0);
    expect(result.llm_assisted?.status).toBe('failed');
  });

  test('LLM-added citations and role proposals are rejected by the assisted route', () => {
    const baseline = buildDeterministicAnswerEnvelope(llmRecallFixture, { maxEvidence: 2, maxQuoteChars: 220 });
    const factualSeed = baseline.claims.find(claim => claim.factual)?.text ?? 'Rail X was rejected because network leverage was low.';
    const result = llmAssistedEnvelope(`${factualSeed} [S999]`, { });

    expect(result.status).toBe('abstain');
    expect(result.validation.ok).toBe(true);
    expect(result.llm_assisted?.rejectedLlmCitations).toBeGreaterThan(0);
    expect(result.claims).toHaveLength(0);
    expect(result.llm_assisted?.status).toBe('rejected');
  });
});
