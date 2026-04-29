import type { CitationRef, ClaimAtom, EvidenceWindow } from './types.ts';
import type { QueryFrame } from './synthesis-dsl.ts';
import type { EvidenceSignal } from './evidence-classify.ts';
import { highOrMediumSignals, type SlotSignalCluster } from './signal-cluster.ts';

export interface CompiledClaims {
  claims: ClaimAtom[];
  missingSlots: string[];
  conflicts: string[];
}

function citationFor(signal: EvidenceSignal, evidenceById: Map<string, EvidenceWindow>): CitationRef {
  const ev = evidenceById.get(signal.evidenceId);
  return { id: signal.evidenceId, label: `S${signal.sourceOrder + 1}`, quoteHash: ev?.quoteHash };
}

function sentence(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function claimKind(slotId: string, signals: EvidenceSignal[]): ClaimAtom['kind'] {
  if (signals.some(signal => signal.role === 'measurement')) return 'normalized_fact';
  if (slotId === 'stack') return 'list_aggregate';
  if (slotId === 'timeline' || signals.some(signal => signal.role === 'later_path_signal' || signal.role === 'protocol_change')) return 'timeline_event';
  if (signals.some(signal => signal.role === 'deprioritization_signal')) return 'contrast_synthesis';
  return 'normalized_fact';
}

function compactListText(signals: EvidenceSignal[], maxQuoteChars: number): string {
  const text = signals.map(signal => signal.text).join(' ');
  if (text.length <= maxQuoteChars) return sentence(text);
  const cut = text.slice(0, Math.max(0, maxQuoteChars - 1));
  const boundary = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '), cut.lastIndexOf(' '));
  return `${(boundary > maxQuoteChars * 0.5 ? cut.slice(0, boundary) : cut).trim()}…`;
}

function requestedRequiredSlotIds(frame: QueryFrame, clusters: SlotSignalCluster[]): Set<string> {
  return new Set(clusters
    .filter(cluster => cluster.required || cluster.signals.some(signal => signal.confidence !== 'low'))
    .filter(cluster => cluster.required || frame.requestedAspects.length > 0)
    .map(cluster => cluster.slotId));
}

export function compileClaims(clusters: SlotSignalCluster[], evidence: EvidenceWindow[], frame: QueryFrame, options: { maxQuoteChars?: number } = {}): CompiledClaims {
  const maxQuoteChars = options.maxQuoteChars ?? 420;
  const evidenceById = new Map(evidence.map(ev => [ev.id, ev]));
  const claims: ClaimAtom[] = [];
  const missingSlots: string[] = [];
  const wanted = requestedRequiredSlotIds(frame, clusters);

  for (const cluster of clusters) {
    const strong = highOrMediumSignals(cluster);
    if (wanted.has(cluster.slotId) && cluster.required && strong.length === 0) {
      missingSlots.push(cluster.slotId);
      claims.push({
        id: `claim_${claims.length + 1}`,
        kind: 'absence_notice',
        text: `No high-confidence source-backed evidence was found for ${cluster.title}.`,
        factual: false,
        citations: [],
        slotId: cluster.slotId,
        supportSignalIds: [],
      });
      continue;
    }
    if (strong.length === 0) continue;

    const selected = cluster.slotId === 'stack' ? strong.slice(0, 3) : strong.slice(0, 2);
    const citations = selected.map(signal => citationFor(signal, evidenceById));
    const text = cluster.slotId === 'stack'
      ? compactListText(selected, maxQuoteChars)
      : sentence(selected.map(signal => signal.text).join(' '));
    claims.push({
      id: `claim_${claims.length + 1}`,
      kind: claimKind(cluster.slotId, selected),
      text,
      factual: true,
      citations,
      slotId: cluster.slotId,
      supportSignalIds: selected.map(signal => signal.id),
    });
  }

  return { claims, missingSlots, conflicts: [] };
}
