import type { CitationRef, ClaimAtom, EvidenceWindow } from './types.ts';
import type { QueryFrame } from './synthesis-dsl.ts';
import type { EvidenceSignal } from './evidence-classify.ts';
import { highOrMediumSignals, signalFingerprint, type SlotSignalCluster } from './signal-cluster.ts';

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
  const cleaned = trimmed.replace(/^#+\s*/g, '').replace(/^Claim:\s*/i, '').replace(/^Agree:\s*/i, '');
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function claimKind(slotId: string, signals: EvidenceSignal[]): ClaimAtom['kind'] {
  if (signals.some(signal => signal.role === 'measurement')) return 'normalized_fact';
  if (slotId === 'stack') return 'list_aggregate';
  if (slotId === 'timeline' || signals.some(signal => signal.role === 'later_path_signal' || signal.role === 'protocol_change')) return 'timeline_event';
  if (signals.some(signal => signal.role === 'deprioritization_signal')) return 'contrast_synthesis';
  return 'normalized_fact';
}

function compactListText(signals: EvidenceSignal[], maxQuoteChars: number): string {
  const chunks: string[] = [];
  for (const signal of signals) {
    const piece = signal.text
      .replace(/\bciteturn\w+\b/gi, '')
      .replace(/\bturn\d+search\d+\b/gi, '')
      .trim();
    if (!piece) continue;
    if (chunks.some(existing => existing === piece)) continue;
    chunks.push(piece);
  }
  const text = chunks.join('; ').trim();
  if (text.length <= maxQuoteChars) return sentence(text);
  const cut = text.slice(0, Math.max(0, maxQuoteChars - 1));
  const boundary = Math.max(cut.lastIndexOf('; '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return `${(boundary > maxQuoteChars * 0.5 ? cut.slice(0, boundary) : cut).trim()}…`;
}

function requestedRequiredSlotIds(frame: QueryFrame, clusters: SlotSignalCluster[]): Set<string> {
  return new Set(clusters
    .filter(cluster => cluster.required || cluster.signals.some(signal => signal.confidence !== 'low'))
    .filter(cluster => cluster.required || frame.requestedAspects.length > 0)
    .map(cluster => cluster.slotId));
}

function materiallyDifferent(a: string, b: string): boolean {
  if (a === b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length < 18) return true;
  if (!longer.includes(shorter)) return true;
  return Math.abs(longer.length - shorter.length) > Math.max(18, Math.floor(shorter.length * 0.35));
}

function filterSlotDuplicates(slotSignals: EvidenceSignal[], seen: Map<string, string>): EvidenceSignal[] {
  const out: EvidenceSignal[] = [];
  for (const signal of slotSignals) {
    const fingerprint = signalFingerprint(signal);
    let keep = true;
    for (const [seenFingerprint, seenSlot] of seen.entries()) {
      if (seenSlot === signal.evidenceId) continue;
      if (fingerprint === seenFingerprint || !materiallyDifferent(fingerprint, seenFingerprint)) {
        keep = false;
        break;
      }
    }
    if (!keep) continue;
    seen.set(fingerprint, signal.evidenceId);
    out.push(signal);
  }
  return out;
}

function compactStackSignals(signals: EvidenceSignal[]): EvidenceSignal[] {
  const protocolSignals = signals.filter(signal => signal.role === 'protocol_item');
  const listLike = protocolSignals.filter(signal => /[,;]|\b(?: and | with | plus )\b/i.test(signal.text));
  const preferred = (listLike.length > 0 ? listLike : protocolSignals).filter(signal => !/\b(?:why|because|due to|rationale|reason|fetal|maternal|clinical|operational|hb|fgr|ferritin|measurement|level|lab|window|score|count)\b/i.test(signal.text));
  return preferred.length > 0 ? preferred : protocolSignals;
}

export function compileClaims(clusters: SlotSignalCluster[], evidence: EvidenceWindow[], frame: QueryFrame, options: { maxQuoteChars?: number } = {}): CompiledClaims {
  const maxQuoteChars = options.maxQuoteChars ?? 420;
  const evidenceById = new Map(evidence.map(ev => [ev.id, ev]));
  const claims: ClaimAtom[] = [];
  const missingSlots: string[] = [];
  const wanted = requestedRequiredSlotIds(frame, clusters);
  const seenFingerprints = new Map<string, string>();

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

    const sourceSignals = cluster.slotId === 'stack' ? compactStackSignals(strong) : strong;
    const selected = filterSlotDuplicates(
      cluster.slotId === 'stack' ? sourceSignals.slice(0, Math.min(8, sourceSignals.length)) : sourceSignals.slice(0, 2),
      seenFingerprints,
    );
    if (wanted.has(cluster.slotId) && selected.length === 0) {
      missingSlots.push(cluster.slotId);
      claims.push({
        id: `claim_${claims.length + 1}`,
        kind: 'absence_notice',
        text: `No non-duplicate source-backed evidence was found for ${cluster.title}.`,
        factual: false,
        citations: [],
        slotId: cluster.slotId,
        supportSignalIds: [],
      });
      continue;
    }
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
