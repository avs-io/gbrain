import type { AnswerSection, CitationRef, ClaimAtom, EvidenceWindow } from './types.ts';
import type { AnswerShapeDef } from './synthesis-dsl.ts';
import type { SlotSignalCluster } from './signal-cluster.ts';

export interface RenderedAnswer {
  answer: string;
  sections: AnswerSection[];
  citations: Array<CitationRef & { evidenceId: string; source: EvidenceWindow['source'] }>;
}

function citationLabel(claim: ClaimAtom): string {
  if (claim.citations.length === 0) return '';
  const labels = [...new Set(claim.citations.map(c => c.label))];
  return ` [${labels.join(', ')}]`;
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
    if (trimmed.startsWith('- ') && seen.has(trimmed.toLowerCase())) continue;
    if (trimmed.startsWith('- ')) seen.add(trimmed.toLowerCase());
    out.push(line);
  }
  return out;
}

export function renderDeterministicAnswer(claims: ClaimAtom[], clusters: SlotSignalCluster[], shape: AnswerShapeDef, evidence: EvidenceWindow[], missingSlots: string[]): RenderedAnswer {
  const sections: AnswerSection[] = [];
  const lines: string[] = [`${shape.title}:`];

  for (const cluster of clusters) {
    const clusterClaims = claims.filter(claim => claim.slotId === cluster.slotId);
    if (clusterClaims.length === 0) continue;
    sections.push({ id: cluster.slotId, title: cluster.title, claimIds: clusterClaims.map(claim => claim.id) });
    lines.push('', `${cluster.title}:`);
    for (const claim of clusterClaims) {
      lines.push(`- ${claim.text}${citationLabel(claim)}`);
    }
  }

  const sectionedClaimIds = new Set(sections.flatMap(section => section.claimIds));
  for (const claim of claims) {
    if (sectionedClaimIds.has(claim.id)) continue;
    let section = sections.find(s => s.id === 'other');
    if (!section) {
      section = { id: 'other', title: 'Other supported evidence', claimIds: [] };
      sections.push(section);
      lines.push('', 'Other supported evidence:');
    }
    section.claimIds.push(claim.id);
    lines.push(`- ${claim.text}${citationLabel(claim)}`);
  }

  if (missingSlots.length > 0) {
    lines.push('', `Missing slots: ${missingSlots.join(', ')}`);
  }

  return { answer: dedupeRenderedLines(lines).join('\n'), sections, citations: buildCitationIndex(claims, evidence) };
}
