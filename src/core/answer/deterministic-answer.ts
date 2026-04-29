import type { RecallResult } from '../evidence/recall.ts';
import { normalizeRecallEvidence, isExactEvidenceWindow } from './evidence-normalize.ts';
import { pruneEvidenceForSynthesis } from './evidence-prune.ts';
import { validateClaimCitations } from './citation-validate.ts';
import { ANSWER_ENVELOPE_SCHEMA, type AnswerEnvelope } from './types.ts';
import { buildQueryFrame } from './query-frame.ts';
import { selectAnswerShape } from './shape-selector.ts';
import { classifyEvidenceSignals } from './evidence-classify.ts';
import { clusterSignalsBySlot } from './signal-cluster.ts';
import { compileClaims } from './claim-compiler.ts';
import { renderDeterministicAnswer } from './renderer.ts';

export interface DeterministicAnswerOptions {
  maxEvidence?: number;
  maxPerSourceEvidence?: number;
  maxQuoteChars?: number;
  pruneEvidence?: boolean;
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
    integration: recall.integration,
  };
}
