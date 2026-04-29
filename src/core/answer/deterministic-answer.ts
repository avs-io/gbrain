import type { RecallResult } from '../evidence/recall.ts';
import { normalizeRecallEvidence, isExactEvidenceWindow } from './evidence-normalize.ts';
import { validateClaimCitations } from './citation-validate.ts';
import { ANSWER_ENVELOPE_SCHEMA, type AnswerEnvelope, type ClaimAtom, type CitationRef, type EvidenceWindow } from './types.ts';

export interface DeterministicAnswerOptions {
  maxEvidence?: number;
  maxQuoteChars?: number;
}

const DEFAULT_MAX_EVIDENCE = 4;
const DEFAULT_MAX_QUOTE_CHARS = 420;

function compact(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const hard = text.slice(0, Math.max(0, maxChars - 1));
  const boundary = Math.max(hard.lastIndexOf('. '), hard.lastIndexOf('; '), hard.lastIndexOf(', '), hard.lastIndexOf(' '));
  const cut = boundary > Math.floor(maxChars * 0.55) ? hard.slice(0, boundary) : hard;
  return `${cut.trim()}…`;
}

function citationFor(window: EvidenceWindow, index: number): CitationRef {
  return { id: window.id, label: `S${index + 1}`, quoteHash: window.quoteHash };
}

function buildClaim(window: EvidenceWindow, index: number, maxQuoteChars: number): ClaimAtom {
  const citation = citationFor(window, index);
  return {
    id: `claim_${index + 1}`,
    kind: 'direct_quote',
    text: truncate(compact(window.quote), maxQuoteChars),
    factual: true,
    citations: [citation],
  };
}

export function buildDeterministicAnswerEnvelope(recall: RecallResult, options: DeterministicAnswerOptions = {}): AnswerEnvelope {
  const maxEvidence = options.maxEvidence ?? DEFAULT_MAX_EVIDENCE;
  const maxQuoteChars = options.maxQuoteChars ?? DEFAULT_MAX_QUOTE_CHARS;
  const normalized = normalizeRecallEvidence(recall);
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

  const claims = evidence.map((window, index) => buildClaim(window, index, maxQuoteChars));
  const validation = validateClaimCitations(claims, evidence);
  const status = validation.ok ? 'hit' : 'invalid';
  const citations = claims.flatMap((claim, index) => claim.citations.map(citation => ({ ...citation, evidenceId: citation.id, source: evidence[index].source })));
  const answer = validation.ok
    ? [
        'Deterministic v2 evidence envelope:',
        ...claims.map(claim => `- ${claim.text} [${claim.citations.map(c => c.label).join(', ')}]`),
      ].join('\n')
    : '';

  return {
    schema: ANSWER_ENVELOPE_SCHEMA,
    query: recall.query,
    status,
    synthesis: 'deterministic-v2',
    answer,
    sections: [{ id: 'direct_quotes', title: 'Direct quote evidence', claimIds: claims.map(claim => claim.id) }],
    claims,
    citations,
    evidence,
    missingSlots: [],
    conflicts: [],
    warnings,
    bounds: { deterministic: true, abstain_if_no_exact_span: true, max_evidence: maxEvidence, max_quote_chars: maxQuoteChars },
    validation,
    integration: recall.integration,
  };
}
