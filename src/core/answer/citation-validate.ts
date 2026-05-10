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

    if (claim.factual && claim.citations.length > 0) {
      const support = claim.citations.map(citation => evidenceById.get(citation.id)?.quote ?? '').join(' ');
      const supportLower = support.toLowerCase();
      for (const literal of literalTokens(claim.text)) {
        if (!supportLower.includes(literal.toLowerCase())) {
          errors.push(`claim ${claim.id} contains unsupported literal value "${literal}"`);
        }
      }
    }

    for (const [index, item] of (claim.listItems ?? []).entries()) {
      if (claim.factual && item.citations.length === 0) errors.push(`claim ${claim.id} list item ${index + 1} is factual but has no support citations`);
      const itemSupport = item.citations.map(citation => evidenceById.get(citation.id)?.quote ?? '').join(' ').toLowerCase();
      for (const literal of literalTokens(item.text)) {
        if (!itemSupport.includes(literal.toLowerCase())) errors.push(`claim ${claim.id} list item ${index + 1} contains unsupported literal value "${literal}"`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function literalTokens(text: string): string[] {
  const numeric = text.match(/\b\d+(?:\.\d+)?\s*(?:mg|g|iu|ng\/ml|w|weeks?|%|x|bid|daily)?\b/gi) ?? [];
  const quoted = [...text.matchAll(/[“"]([^”"]{2,80})[”"]/g)].flatMap(match => match[1].match(/\b[A-Za-z0-9][A-Za-z0-9'/-]{2,}\b/g) ?? []);
  return [...new Set([...numeric, ...quoted].map(token => token.trim()).filter(Boolean))];
}

function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“])/).map(part => part.trim()).filter(Boolean).length || (text.trim() ? 1 : 0);
}

export function validateRenderedAnswerCitations(answer: string, claims: ClaimAtom[]): CitationValidationResult {
  const errors: string[] = [];
  const factualClaims = new Map(claims.filter(claim => claim.factual).map(claim => [claim.id, claim]));
  const rendered = answer.split(/\r?\n/).filter(line => line.trim().startsWith('- '));

  for (const claim of factualClaims.values()) {
    if (claim.listItems && claim.listItems.length > 0) {
      for (const [index, item] of claim.listItems.entries()) {
        const normalizedItem = item.text.replace(/\s+/g, ' ').trim();
        const line = rendered.find(candidate => candidate.replace(/\[[^\]]+\]/g, '').includes(normalizedItem.slice(0, Math.min(normalizedItem.length, 80))));
        if (!line) {
          errors.push(`rendered factual claim ${claim.id} list item ${index + 1} is missing`);
          continue;
        }
        const expectedLabels = new Set(item.citations.map(citation => citation.label));
        const citationGroups = line.match(/\[(?:S\d+(?:,\s*)?)+\]/g) ?? [];
        if (citationGroups.length === 0) errors.push(`rendered factual claim ${claim.id} list item ${index + 1} has no citation label`);
        const renderedLabels = new Set(citationGroups.flatMap(group => group.match(/S\d+/g) ?? []));
        for (const label of expectedLabels) if (!renderedLabels.has(label)) errors.push(`rendered factual claim ${claim.id} list item ${index + 1} is missing citation label ${label}`);
      }
      continue;
    }
    const normalizedClaim = claim.text.replace(/\s+/g, ' ').trim();
    const line = rendered.find(candidate => candidate.replace(/\[[^\]]+\]/g, '').includes(normalizedClaim.slice(0, Math.min(normalizedClaim.length, 80))));
    if (!line) continue;
    const citationGroups = line.match(/\[(?:S\d+(?:,\s*)?)+\]/g) ?? [];
    if (citationGroups.length === 0) errors.push(`rendered factual claim ${claim.id} has no citation label`);
    if (citationGroups.length < sentenceCount(claim.text)) errors.push(`rendered factual claim ${claim.id} does not cite every factual sentence`);
  }

  return { ok: errors.length === 0, errors };
}
