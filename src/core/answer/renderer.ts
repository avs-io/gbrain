import type { AnswerSection, CitationRef, ClaimAtom, EvidenceWindow } from './types.ts';
import type { AnswerShapeDef } from './synthesis-dsl.ts';
import type { SlotSignalCluster } from './signal-cluster.ts';

export interface RenderedAnswer {
  answer: string;
  sections: AnswerSection[];
  citations: Array<CitationRef & { evidenceId: string; source: EvidenceWindow['source'] }>;
}

function citationLabelForRefs(citations: CitationRef[]): string {
  if (citations.length === 0) return '';
  const labels = [...new Set(citations.map(c => c.label))];
  return ` [${labels.join(', ')}]`;
}

function citationLabel(claim: ClaimAtom): string {
  return citationLabelForRefs(claim.citations);
}

function citedClaimText(claim: ClaimAtom): string {
  const label = citationLabel(claim);
  if (!claim.factual || !label) return claim.text;
  const parts = claim.text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“])/).map(part => part.trim()).filter(Boolean);
  if (parts.length <= 1) return `${claim.text}${label}`;
  return parts.map(part => `${part}${label}`).join(' ');
}

function buildCitationIndex(claims: ClaimAtom[], evidence: EvidenceWindow[]): Array<CitationRef & { evidenceId: string; source: EvidenceWindow['source'] }> {
  const evidenceById = new Map(evidence.map(ev => [ev.id, ev]));
  const seen = new Set<string>();
  const citations: Array<CitationRef & { evidenceId: string; source: EvidenceWindow['source'] }> = [];
  for (const claim of claims) {
    for (const citation of claim.citations) {
      const ev = evidenceById.get(citation.id);
      if (!ev) continue;
      const key = `${claim.id}:${citation.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({ ...citation, evidenceId: citation.id, source: ev.source });
    }
  }
  return citations;
}

function dedupeRenderedLines(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#+\s*/.test(trimmed)) continue;
    if (/\bciteturn\w+\b/i.test(trimmed) || /\bturn\d+search\d+\b/i.test(trimmed)) continue;
    if (trimmed.startsWith('- ') && seen.has(trimmed.toLowerCase())) continue;
    if (trimmed.startsWith('- ')) seen.add(trimmed.toLowerCase());
    out.push(line);
  }
  return out;
}

export function renderDeterministicAnswer(claims: ClaimAtom[], clusters: SlotSignalCluster[], shape: AnswerShapeDef, evidence: EvidenceWindow[], missingSlots: string[]): RenderedAnswer {
  const sections: AnswerSection[] = [];
  const lines: string[] = [`${shape.title}:`];
  const claimIdsWithRenderableText = new Set<string>();
  const renderedClaimText = new Set<string>();

  function pushSection(id: string, title: string, claimIds: string[]): void {
    if (claimIds.length === 0) return;
    sections.push({ id, title, claimIds });
  }

  function hasRenderableText(claim: ClaimAtom): boolean {
    return claim.text.trim().length > 0;
  }

  function takeRenderableClaims(candidateClaims: ClaimAtom[]): ClaimAtom[] {
    const out: ClaimAtom[] = [];
    for (const claim of candidateClaims) {
      if (!hasRenderableText(claim)) continue;
      const fingerprint = claim.text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\bciteturn\w+\b/g, '').replace(/\bturn\d+search\d+\b/g, '');
      if (renderedClaimText.has(fingerprint)) continue;
      renderedClaimText.add(fingerprint);
      out.push(claim);
    }
    return out;
  }

  for (const cluster of clusters) {
    const clusterClaims = takeRenderableClaims(claims.filter(claim => claim.slotId === cluster.slotId));
    if (clusterClaims.length === 0) continue;
    pushSection(cluster.slotId, cluster.title, clusterClaims.map(claim => claim.id));
    lines.push('', `${cluster.title}:`);
    for (const claim of clusterClaims) {
      claimIdsWithRenderableText.add(claim.id);
      if (claim.listItems && claim.listItems.length > 0) {
        for (const item of claim.listItems) lines.push(`- ${item.text}${citationLabelForRefs(item.citations)}`);
      } else {
        lines.push(`- ${citedClaimText(claim)}`);
      }
    }
  }

  const sectionedClaimIds = new Set(sections.flatMap(section => section.claimIds));
  for (const claim of claims) {
    if (sectionedClaimIds.has(claim.id)) continue;
    const [renderableClaim] = takeRenderableClaims([claim]);
    if (!renderableClaim) continue;
    let section = sections.find(s => s.id === 'other');
    if (!section) {
      section = { id: 'other', title: 'Other supported evidence', claimIds: [] };
      sections.push(section);
      lines.push('', 'Other supported evidence:');
    }
    section.claimIds.push(renderableClaim.id);
    if (renderableClaim.listItems && renderableClaim.listItems.length > 0) {
      for (const item of renderableClaim.listItems) lines.push(`- ${item.text}${citationLabelForRefs(item.citations)}`);
    } else {
      lines.push(`- ${citedClaimText(renderableClaim)}`);
    }
  }

  if (missingSlots.length > 0) {
    lines.push('', `Missing slots: ${missingSlots.join(', ')}`);
  }

  return { answer: dedupeRenderedLines(lines).join('\n'), sections: sections.filter(section => section.claimIds.length > 0), citations: buildCitationIndex(claimIdsWithRenderableText.size > 0 ? claims.filter(claim => claimIdsWithRenderableText.has(claim.id)) : [], evidence) };
}
