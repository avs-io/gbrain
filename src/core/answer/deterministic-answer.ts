import type { RecallResult } from '../evidence/recall.ts';
import { normalizeRecallEvidence, isExactEvidenceWindow } from './evidence-normalize.ts';
import { pruneEvidenceForSynthesis } from './evidence-prune.ts';
import { validateClaimCitations } from './citation-validate.ts';
import { ANSWER_ENVELOPE_SCHEMA, type AnswerEnvelope, type ClaimAtom, type EvidenceWindow, type LlmAssistedAnswerMetadata } from './types.ts';
import { buildQueryFrame } from './query-frame.ts';
import { selectAnswerShape } from './shape-selector.ts';
import { classifyEvidenceSignals } from './evidence-classify.ts';
import { clusterSignalsBySlot } from './signal-cluster.ts';
import { compileClaims } from './claim-compiler.ts';
import { renderDeterministicAnswer } from './renderer.ts';
import { runLlmAssistedSynthesisBoundary, type LlmSynthesisDraft } from './llm-synthesis-boundary.ts';

export interface DeterministicAnswerOptions {
  maxEvidence?: number;
  maxPerSourceEvidence?: number;
  maxQuoteChars?: number;
  pruneEvidence?: boolean;
}

export interface LlmAssistedDraftInput {
  query: string;
  recall: RecallResult;
  claims: ClaimAtom[];
  evidence: EvidenceWindow[];
}

export type LlmDraftFactory = (input: LlmAssistedDraftInput) => LlmSynthesisDraft;

export interface LlmAssistedDeterministicAnswerOptions extends DeterministicAnswerOptions {
  llmSynthesisEnabled?: boolean;
  llmFailOnUnsupported?: boolean;
  llmDraftFactory?: LlmDraftFactory;
}

const DEFAULT_MAX_EVIDENCE = 4;
const DEFAULT_MAX_QUOTE_CHARS = 420;

export function buildDeterministicAnswerEnvelope(recall: RecallResult, options: DeterministicAnswerOptions = {}): AnswerEnvelope {
  const maxEvidence = options.maxEvidence ?? DEFAULT_MAX_EVIDENCE;
  const maxQuoteChars = options.maxQuoteChars ?? DEFAULT_MAX_QUOTE_CHARS;
  const normalized = normalizeRecallEvidence(recall);
  const queryFrame = buildQueryFrame(recall.query);
  const shape = selectAnswerShape(queryFrame);
  const exactEvidence = normalized.filter(isExactEvidenceWindow);
  const pruneResult = options.pruneEvidence === false
    ? { evidence: exactEvidence.slice(0, maxEvidence), warnings: [], pruned: false, stats: { input: exactEvidence.length, kept: Math.min(exactEvidence.length, maxEvidence), removed: Math.max(0, exactEvidence.length - maxEvidence), removedNonExact: 0, removedDuplicateSpan: 0, removedDuplicateQuoteHash: 0, removedDuplicateQuoteText: 0, removedPerSource: 0 } }
    : pruneEvidenceForSynthesis(exactEvidence, { maxEvidence, maxPerSource: options.maxPerSourceEvidence });
  const evidence = pruneResult.evidence;
  const warnings = [...(recall.warnings ?? []), ...pruneResult.warnings];

  if (exactEvidence.length !== normalized.length) warnings.push('non-gbs1 or empty evidence was excluded from deterministic-v2 answer synthesis');
  if (pruneResult.pruned) warnings.push('evidence pruning changed the deterministic-v2 synthesis input');
  if (queryFrame.requestedAspects.includes('current_state')) {
    warnings.push('current-status query answered with historical recall only; no live-state check was performed');
  }

  if (evidence.length === 0) {
    if (!warnings.some(w => /abstain/i.test(w))) warnings.push('no exact gbs1 evidence supplied to deterministic-v2 answer synthesis; abstaining');
    return {
      schema: ANSWER_ENVELOPE_SCHEMA,
      query: recall.query,
      status: 'abstain',
      synthesis: 'deterministic-v2',
      shape: shape.id,
      queryFrame,
      answer: '',
      sections: [],
      claims: [],
      citations: [],
      evidence,
      missingSlots: ['exact_gbs1_evidence'],
      conflicts: [],
      warnings,
      bounds: { deterministic: true, abstain_if_no_exact_span: true, max_evidence: maxEvidence, max_quote_chars: maxQuoteChars },
      validation: { ok: true, errors: [] },
      integration: recall.integration,
    };
  }

  const signals = classifyEvidenceSignals(evidence, queryFrame);
  const clusters = clusterSignalsBySlot(signals, shape);
  const compiled = compileClaims(clusters, evidence, queryFrame, { maxQuoteChars });
  const validation = validateClaimCitations(compiled.claims, evidence);
  const rendered = validation.ok ? renderDeterministicAnswer(compiled.claims, clusters, shape, evidence, compiled.missingSlots) : { answer: '', sections: [], citations: [] };
  const status = validation.ok
    ? (compiled.missingSlots.length > 0 ? 'partial' : 'hit')
    : 'invalid';
  const topUnclassified = evidence
    .map(ev => ({ evidenceId: ev.id, reason: signals.some(signal => signal.evidenceId === ev.id && signal.role !== 'distractor') ? '' : 'no non-distractor signal after role classification' }))
    .filter(item => item.reason)
    .slice(0, 3);

  return {
    schema: ANSWER_ENVELOPE_SCHEMA,
    query: recall.query,
    status,
    synthesis: 'deterministic-v2',
    shape: shape.id,
    queryFrame,
    answer: rendered.answer,
    sections: rendered.sections,
    claims: compiled.claims,
    citations: rendered.citations,
    evidence,
    missingSlots: compiled.missingSlots,
    conflicts: compiled.conflicts,
    warnings,
    bounds: { deterministic: true, abstain_if_no_exact_span: true, max_evidence: maxEvidence, max_quote_chars: maxQuoteChars },
    validation,
    diagnostics: { evidence_window_count: evidence.length, classified_signal_count: signals.length, top_unclassified_windows: topUnclassified },
    integration: recall.integration,
  };
}

export function buildDeterministicAnswerEnvelopeWithLlmAssistance(recall: RecallResult, options: LlmAssistedDeterministicAnswerOptions = {}): AnswerEnvelope {
  const baseline = buildDeterministicAnswerEnvelope(recall, options);
  if (!options.llmSynthesisEnabled) return baseline;
  if (!baseline.validation.ok || baseline.status === 'abstain' || baseline.claims.length === 0) {
    return baseline;
  }

  const draft = (options.llmDraftFactory ?? buildMockLlmDraft)({
    query: baseline.query,
    recall,
    claims: baseline.claims,
    evidence: baseline.evidence,
  });
  const boundaryResult = runLlmAssistedSynthesisBoundary(baseline.claims, baseline.evidence, draft, {
    enabled: true,
    failOnUnsupported: options.llmFailOnUnsupported ?? false,
  });

  if (boundaryResult.status === 'failed' && options.llmFailOnUnsupported) {
    return {
      ...baseline,
      status: 'invalid',
      answer: '',
      sections: [],
      claims: [],
      citations: [],
      validation: {
        ok: false,
        errors: boundaryResult.validation.errors.length
          ? boundaryResult.validation.errors
          : ['llm-assisted synthesis failed'],
      },
      warnings: [...baseline.warnings, 'llm-assisted synthesis failed; no output emitted'],
      llm_assisted: buildLlmAssistedMetadata({
        boundaryResult,
        options,
      }),
    };
  }

  const acceptedClaims = buildLlmAcceptedClaims(baseline.claims, boundaryResult);
  const status = inferLlmAssistedStatus({ baselineStatus: baseline.status, boundaryResult, acceptedCount: acceptedClaims.length });
  const warnings = [...baseline.warnings];
  if (boundaryResult.rejectedSentences.length > 0) warnings.push('llm-assisted synthesis removed unsupported or unauthorized sentences after verifier pass');

  return {
    ...baseline,
    status,
    answer: boundaryResult.text,
    sections: [],
    claims: acceptedClaims,
    citations: buildLlmBoundaryCitations(acceptedClaims, baseline.evidence),
    validation: {
      ok: boundaryResult.validation.ok,
      errors: boundaryResult.validation.errors,
    },
    warnings,
    llm_assisted: buildLlmAssistedMetadata({
      boundaryResult,
      options,
    }),
  };
}

function inferLlmAssistedStatus(params: {
  baselineStatus: AnswerEnvelope['status'];
  boundaryResult: ReturnType<typeof runLlmAssistedSynthesisBoundary>;
  acceptedCount: number;
}) {
  if (params.boundaryResult.status === 'failed') return 'invalid';
  if (params.acceptedCount === 0) return params.baselineStatus === 'partial' ? 'partial' : 'abstain';
  if (params.boundaryResult.rejectedSentences.length > 0 && params.baselineStatus === 'hit') return 'partial';
  return params.baselineStatus;
}

function buildLlmAcceptedClaims(authoritativeClaims: ClaimAtom[], boundaryResult: ReturnType<typeof runLlmAssistedSynthesisBoundary>): ClaimAtom[] {
  return boundaryResult.acceptedSentences.map((sentence, index) => {
    const sourceClaim = authoritativeClaims.find(claim => claim.id === sentence.claimId);
    return {
      id: `llm_sentence_${index + 1}`,
      kind: sourceClaim?.kind ?? 'normalized_fact',
      factual: sourceClaim?.factual ?? true,
      text: sentence.text,
      citations: sourceClaim?.factual === false ? [] : sentence.citations,
      slotId: sourceClaim?.slotId,
      supportSignalIds: sourceClaim?.supportSignalIds,
    };
  });
}

function buildLlmBoundaryCitations(claims: ClaimAtom[], evidence: EvidenceWindow[]): Array<{
  id: string;
  label: string;
  quoteHash?: string;
  evidenceId: string;
  source: EvidenceWindow['source'];
}> {
  const seen = new Set<string>();
  const evidenceById = new Map(evidence.map(window => [window.id, window]));
  const output: Array<{
    id: string;
    label: string;
    quoteHash?: string;
    evidenceId: string;
    source: EvidenceWindow['source'];
  }> = [];

  for (const claim of claims) {
    for (const citation of claim.citations) {
      if (seen.has(citation.id)) continue;
      const window = evidenceById.get(citation.id);
      if (!window) continue;
      seen.add(citation.id);
      output.push({ id: citation.id, label: citation.label, quoteHash: citation.quoteHash, evidenceId: citation.id, source: window.source });
    }
  }
  return output;
}

function buildLlmAssistedMetadata(params: {
  boundaryResult: ReturnType<typeof runLlmAssistedSynthesisBoundary>;
  options: LlmAssistedDeterministicAnswerOptions;
}): LlmAssistedAnswerMetadata {
  return {
    enabled: true,
    route: 'mock',
    status: params.boundaryResult.status,
    failOnUnsupported: params.options.llmFailOnUnsupported ?? false,
    bounds: params.boundaryResult.bounds,
    validation: params.boundaryResult.validation,
    rejectedSentences: params.boundaryResult.rejectedSentences.length,
    rejectedLlmCitations: params.boundaryResult.rejectedLlmCitations.length,
    trustedMutationsRejected: params.boundaryResult.rejectedTrustedMutationRequests.length,
  };
}

function buildMockLlmDraft(input: LlmAssistedDraftInput): LlmSynthesisDraft {
  const factualClaims = input.claims.filter(claim => claim.factual && claim.text.trim().length > 0);
  return {
    text: factualClaims.map(claim => claim.text.trim()).join(' '),
    proposedRoles: [],
    proposedFollowUpSearches: [],
    requestedTrustedMutations: [],
  };
}
