import type { ClaimAtom, EvidenceWindow } from './types.ts';

export interface CitationValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateClaimCitations(claims: ClaimAtom[], evidence: EvidenceWindow[]): CitationValidationResult {
  const errors: string[] = [];
  const evidenceById = new Map(evidence.map(ev => [ev.id, ev]));

  for (const claim of claims) {
    if (claim.factual && claim.citations.length === 0) {
      errors.push(`claim ${claim.id} is factual but has no support citations`);
      continue;
    }

    for (const citation of claim.citations) {
      if (!citation.id.startsWith('gbs1:')) {
        errors.push(`claim ${claim.id} cites non-gbs1 evidence ${citation.id}`);
        continue;
      }
      const ev = evidenceById.get(citation.id);
      if (!ev) {
        errors.push(`claim ${claim.id} cites evidence not present in normalized evidence: ${citation.id}`);
        continue;
      }
      if (citation.quoteHash && ev.quoteHash && citation.quoteHash !== ev.quoteHash) {
        errors.push(`claim ${claim.id} citation quote-hash mismatch for ${citation.id}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
