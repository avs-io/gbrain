import type { RecallResult } from '../evidence/recall.ts';
import { normalizeRecallEvidence, isExactEvidenceWindow } from './evidence-normalize.ts';
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
  maxQuoteChars?: number;
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
  const evidence = exactEvidence.slice(0, maxEvidence);
  const warnings = [...(recall.warnings ?? [])];

  if (exactEvidence.length !== normalized.length) warnings.push('non-gbs1 or empty evidence was excluded from deterministic-v2 answer synthesis');
  if (exactEvidence.length > evidence.length) warnings.push('exact evidence was truncated by max_evidence');

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
      evidence: normalized,
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
