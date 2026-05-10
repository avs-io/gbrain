import { validateClaimCitations } from './citation-validate.ts';
import type { CitationRef, ClaimAtom, EvidenceWindow } from './types.ts';

export const LLM_SYNTHESIS_BOUNDARY_SCHEMA = 'gbrain.llm_assisted_synthesis_boundary.v1' as const;
export const LLM_SYNTHESIS_BOUNDARY_ENABLED_BY_DEFAULT = false as const;

export interface LlmSynthesisDraft {
  /** Free-form LLM prose. The LLM is treated as an untrusted style proposer only. */
  text: string;
  /** Optional role/support proposals from the model. These are recorded as ignored and never decide support. */
  proposedRoles?: Array<{ sentence?: string; claimId?: string; role: string; confidence?: number }>;
  /** Optional follow-up searches. They are surfaced as suggestions only, never as answer facts. */
  proposedFollowUpSearches?: string[];
  /** Any requested trusted-memory/page mutation is rejected by construction. */
  requestedTrustedMutations?: string[];
}

export interface LlmBoundaryAcceptedSentence {
  text: string;
  claimId: string;
  citations: CitationRef[];
}

export interface LlmBoundaryRejectedSentence {
  text: string;
  reason: string;
}

export interface LlmSynthesisBoundaryResult {
  schema: typeof LLM_SYNTHESIS_BOUNDARY_SCHEMA;
  enabled: boolean;
  status: 'disabled' | 'accepted' | 'partial' | 'rejected' | 'failed';
  text: string;
  acceptedSentences: LlmBoundaryAcceptedSentence[];
  rejectedSentences: LlmBoundaryRejectedSentence[];
  rejectedLlmCitations: string[];
  ignoredRoleProposals: NonNullable<LlmSynthesisDraft['proposedRoles']>;
  followUpSearchSuggestions: string[];
  rejectedTrustedMutationRequests: string[];
  validation: {
    ok: boolean;
    errors: string[];
  };
  bounds: {
    llm_outside_trust_boundary: true;
    deterministic_claim_atoms_authority: true;
    citation_verifier_authority: true;
    trusted_mutations_allowed: false;
    llm_citations_allowed: false;
  };
}

export interface LlmSynthesisBoundaryOptions {
  /** Disabled by default. Tests/harnesses must opt in explicitly; no provider calls are made here. */
  enabled?: boolean;
  /** If true, any unsupported sentence fails the whole draft instead of stripping it. */
  failOnUnsupported?: boolean;
}

const CITATION_MARKUP = /\[(?:S\d+(?:\s*,\s*S\d+)*)\]|gbs1:[^\s)\]]+/gi;
const MUTATION_WORDS = /\b(?:propose-memory|ingest-source|trusted\s+memory\s+write|write\s+(?:to\s+)?(?:trusted|brain|memory)|mutate\s+(?:trusted|brain|memory)|edit\s+(?:trusted|brain|memory)|delete\s+(?:trusted|brain|memory))\b/i;
const ABSENCE_INFERENCE = /\b(?:no\s+(?:evidence|source|record)|absence\s+of\s+evidence|not\s+found)\b.*\b(?:therefore|means|proves|shows|implies|so)\b/i;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'been', 'but', 'by', 'for', 'from', 'had', 'has', 'have', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'only', 'that', 'the', 'this', 'to', 'was', 'were', 'with', 'without', 'source', 'backed', 'evidence', 'found', 'says', 'said', 'shows', 'states', 'reflects', 'indicates', 'not', 'no', 'did', 'does', 'do', 'later', 'current', 'historical', 'recall', 'live', 'check',
]);

export function runLlmAssistedSynthesisBoundary(
  claims: ClaimAtom[],
  evidence: EvidenceWindow[],
  draft: LlmSynthesisDraft,
  options: LlmSynthesisBoundaryOptions = {},
): LlmSynthesisBoundaryResult {
  const enabled = options.enabled === true;
  const base = baseResult(enabled, draft);

  if (!enabled) {
    return { ...base, status: 'disabled', validation: { ok: true, errors: [] } };
  }

  const authoritativeClaims = claims.filter(claim => claim.kind !== 'absence_notice' || !claim.factual || claim.text.trim().length > 0);
  const validationErrors: string[] = [];
  const validClaimIds = new Set<string>();

  for (const claim of authoritativeClaims) {
    if (!claim.factual) {
      validClaimIds.add(claim.id);
      continue;
    }
    const validation = validateClaimCitations([claim], evidence);
    if (validation.ok) validClaimIds.add(claim.id);
    else validationErrors.push(...validation.errors.map(error => `authoritative ${error}`));
  }

  for (const rawSentence of splitDraftSentences(draft.text)) {
    const citationMatches = rawSentence.match(CITATION_MARKUP) ?? [];
    if (citationMatches.length > 0) {
      base.rejectedLlmCitations.push(...citationMatches);
      base.rejectedSentences.push({ text: rawSentence, reason: 'llm_citation_markup_rejected' });
      continue;
    }
    if (MUTATION_WORDS.test(rawSentence)) {
      base.rejectedSentences.push({ text: rawSentence, reason: 'trusted_mutation_request_rejected' });
      continue;
    }
    if (ABSENCE_INFERENCE.test(rawSentence)) {
      base.rejectedSentences.push({ text: rawSentence, reason: 'absence_cannot_become_inference' });
      continue;
    }

    const match = findAuthoritativeClaim(rawSentence, authoritativeClaims, evidence, validClaimIds);
    if (!match) {
      base.rejectedSentences.push({ text: rawSentence, reason: 'unsupported_by_claim_atoms' });
      continue;
    }

    base.acceptedSentences.push({ text: normalizeSentence(rawSentence), claimId: match.id, citations: match.citations });
  }

  const outputClaims: ClaimAtom[] = base.acceptedSentences.map((sentence, index) => {
    const sourceClaim = claims.find(claim => claim.id === sentence.claimId);
    return {
      id: `llm_boundary_sentence_${index + 1}`,
      kind: sourceClaim?.kind ?? 'normalized_fact',
      factual: sourceClaim?.factual ?? true,
      text: sentence.text,
      citations: sourceClaim?.factual === false ? [] : sentence.citations,
      slotId: sourceClaim?.slotId,
      supportSignalIds: sourceClaim?.supportSignalIds,
    } satisfies ClaimAtom;
  });
  const outputValidation = validateClaimCitations(outputClaims, evidence);
  validationErrors.push(...outputValidation.errors.map(error => `output ${error}`));

  base.text = base.acceptedSentences.map(sentence => sentence.text).join(' ');
  base.validation = { ok: validationErrors.length === 0, errors: validationErrors };
  if (!base.validation.ok) base.status = 'failed';
  else if (base.acceptedSentences.length === 0) base.status = 'rejected';
  else if (base.rejectedSentences.length > 0) base.status = options.failOnUnsupported ? 'failed' : 'partial';
  else base.status = 'accepted';

  if (options.failOnUnsupported && base.rejectedSentences.length > 0) {
    base.text = '';
    base.validation = {
      ok: false,
      errors: [...base.validation.errors, ...base.rejectedSentences.map(sentence => `unsupported LLM sentence failed draft: ${sentence.reason}: ${sentence.text}`)],
    };
    base.status = 'failed';
  }

  return base;
}

function baseResult(enabled: boolean, draft: LlmSynthesisDraft): LlmSynthesisBoundaryResult {
  return {
    schema: LLM_SYNTHESIS_BOUNDARY_SCHEMA,
    enabled,
    status: 'disabled',
    text: '',
    acceptedSentences: [],
    rejectedSentences: [],
    rejectedLlmCitations: [],
    ignoredRoleProposals: draft.proposedRoles ?? [],
    followUpSearchSuggestions: [...(draft.proposedFollowUpSearches ?? [])],
    rejectedTrustedMutationRequests: [...(draft.requestedTrustedMutations ?? [])],
    validation: { ok: true, errors: [] },
    bounds: {
      llm_outside_trust_boundary: true,
      deterministic_claim_atoms_authority: true,
      citation_verifier_authority: true,
      trusted_mutations_allowed: false,
      llm_citations_allowed: false,
    },
  };
}

function splitDraftSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?:\n+|(?<=[.!?])\s+(?=[A-Z0-9“"']))/g)
    .map(part => part.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function normalizeSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return cleaned;
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function normalizeForExact(text: string): string {
  return normalizeSentence(text).toLowerCase().replace(/[“”"'.,!?;:()\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

function significantTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .match(/\b[a-z0-9][a-z0-9'/-]{2,}\b/g) ?? [];
  return new Set(tokens.filter(token => !STOPWORDS.has(token) && !/^s\d+$/.test(token)));
}

function supportTextForClaim(claim: ClaimAtom, evidenceById: Map<string, EvidenceWindow>): string {
  const citationSupport = claim.citations.map(citation => evidenceById.get(citation.id)?.quote ?? '').join(' ');
  return `${claim.text} ${citationSupport}`;
}

function findAuthoritativeClaim(sentence: string, claims: ClaimAtom[], evidence: EvidenceWindow[], validClaimIds: Set<string>): ClaimAtom | null {
  const sentenceNorm = normalizeForExact(sentence);
  const evidenceById = new Map(evidence.map(ev => [ev.id, ev]));
  const sentenceTokens = significantTokens(sentence);

  for (const claim of claims) {
    if (!validClaimIds.has(claim.id)) continue;
    if (sentenceNorm === normalizeForExact(claim.text)) return claim;
  }

  for (const claim of claims) {
    if (!validClaimIds.has(claim.id) || !claim.factual || claim.citations.length === 0) continue;
    const claimTokens = significantTokens(claim.text);
    if (claimTokens.size === 0 || sentenceTokens.size === 0) continue;
    const overlap = [...sentenceTokens].filter(token => claimTokens.has(token)).length;
    const supportTokens = significantTokens(supportTextForClaim(claim, evidenceById));
    const unsupported = [...sentenceTokens].filter(token => !supportTokens.has(token));
    const overlapRatio = overlap / Math.max(1, Math.min(sentenceTokens.size, claimTokens.size));
    if (unsupported.length === 0 && overlapRatio >= 0.75) return claim;
  }

  return null;
}
