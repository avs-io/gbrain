import type { CitationRef, ClaimAtom, EvidenceWindow } from './types.ts';
import type { QueryFrame } from './synthesis-dsl.ts';
import type { EvidenceSignal } from './evidence-classify.ts';
import { highOrMediumSignals, signalFingerprint, type SlotSignalCluster } from './signal-cluster.ts';

export interface CompiledClaims {
  claims: ClaimAtom[];
  missingSlots: string[];
  conflicts: string[];
}

function citationFor(signal: EvidenceSignal, evidenceById: Map<string, EvidenceWindow>, labelByEvidenceId: Map<string, string>): CitationRef {
  const ev = evidenceById.get(signal.evidenceId);
  return { id: signal.evidenceId, label: labelByEvidenceId.get(signal.evidenceId) ?? `S${signal.sourceOrder + 1}`, quoteHash: ev?.quoteHash };
}

function sentence(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return trimmed;
  const cleaned = trimmed.replace(/^#+\s*/g, '').replace(/^Claim:\s*/i, '').replace(/^Agree:\s*/i, '');
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function isQuestionFragment(text: string): boolean {
  return /\b(?:what|why|how|when|who|where|which)\b.*\?$|\?$/.test(text.trim());
}

function sentenceLike(text: string): string {
  const cleaned = sentence(text).replace(/\s+/g, ' ').trim();
  if (!cleaned) return cleaned;
  return isQuestionFragment(cleaned) ? cleaned.replace(/\?+$/, '.').replace(/\.$/, '.') : cleaned;
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
      .replace(/\?$|\.+$/g, '')
      .trim();
    if (!piece) continue;
    if (chunks.some(existing => existing === piece)) continue;
    chunks.push(piece);
  }
  const text = chunks.join(', ').trim();
  if (text.length <= maxQuoteChars) return sentenceLike(text);
  const cut = text.slice(0, Math.max(0, maxQuoteChars - 1));
  const boundary = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return `${(boundary > maxQuoteChars * 0.5 ? cut.slice(0, boundary) : cut).trim()}…`;
}

function listItemText(signal: EvidenceSignal): string {
  return sentenceLike(signal.text
    .replace(/\bciteturn\w+\b/gi, '')
    .replace(/\bturn\d+search\d+\b/gi, '')
    .replace(/\?$|\.+$/g, '')
    .trim());
}

function requestedRequiredSlotIds(frame: QueryFrame, clusters: SlotSignalCluster[]): Set<string> {
  return new Set(clusters
    .filter(cluster => cluster.required || cluster.aspects.some(aspect => aspectRequiredByQuery(frame, aspect)))
    .map(cluster => cluster.slotId));
}

function aspectRequiredByQuery(frame: QueryFrame, aspect: string): boolean {
  if (aspect === 'summary') return false;
  if (aspect === 'timeline' && !/\b(?:when|timeline|chronolog|date|year|month|day)\b/i.test(frame.normalizedQuery)) return false;
  return frame.requestedAspects.includes(aspect as any);
}

function isRequiredForFrame(frame: QueryFrame, cluster: SlotSignalCluster): boolean {
  return cluster.required || cluster.aspects.some(aspect => aspectRequiredByQuery(frame, aspect));
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

function compactStackSignals(signals: EvidenceSignal[], maxListItems?: number): EvidenceSignal[] {
  const protocolSignals = signals.filter(signal => signal.role === 'protocol_item');
  const listLike = protocolSignals.filter(signal => /[,;]|\b(?: and | with | plus )\b/i.test(signal.text));
  const preferred = (listLike.length > 0 ? listLike : protocolSignals).filter(signal => !/\b(?:why|because|due to|rationale|reason|fetal|maternal|clinical|operational|biomarker|measurement|marker|level|lab|window|score|count|growth)\b/i.test(signal.text));
  const out = preferred.length > 0 ? preferred : protocolSignals;
  return typeof maxListItems === 'number' ? out.slice(0, maxListItems) : out;
}

function conflictPair(signals: EvidenceSignal[]): [EvidenceSignal, EvidenceSignal] | null {
  const usable = signals.filter(signal => signal.confidence !== 'low');
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const a = usable[i].text.toLowerCase();
      const b = usable[j].text.toLowerCase();
      const activeVsDormant = (/\b(?:active|current|currently|still|ongoing)\b/.test(a) && /\b(?:dormant|not active|inactive|dead|no longer|not current)\b/.test(b))
        || (/\b(?:active|current|currently|still|ongoing)\b/.test(b) && /\b(?:dormant|not active|inactive|dead|no longer|not current)\b/.test(a));
      const pursuedVsRejected = (/\b(?:pursued|continued|kept)\b/.test(a) && /\b(?:not pursued|rejected|dropped|parked)\b/.test(b))
        || (/\b(?:pursued|continued|kept)\b/.test(b) && /\b(?:not pursued|rejected|dropped|parked)\b/.test(a));
      if (activeVsDormant || pursuedVsRejected) return [usable[i], usable[j]];
    }
  }
  return null;
}

export function compileClaims(clusters: SlotSignalCluster[], evidence: EvidenceWindow[], frame: QueryFrame, options: { maxQuoteChars?: number; maxClaims?: number; maxListItems?: number } = {}): CompiledClaims {
  const maxQuoteChars = options.maxQuoteChars ?? 420;
  const evidenceById = new Map(evidence.map(ev => [ev.id, ev]));
  const labelByEvidenceId = new Map(evidence.map(ev => ev.id).sort().map((id, index) => [id, `S${index + 1}`]));
  const claims: ClaimAtom[] = [];
  const missingSlots: string[] = [];
  const conflicts: string[] = [];
  const wanted = requestedRequiredSlotIds(frame, clusters);
  const seenFingerprints = new Map<string, string>();
  let factualClaims = 0;

  function canEmitFactual(): boolean {
    return typeof options.maxClaims !== 'number' || factualClaims < options.maxClaims;
  }

  function pushClaim(claim: Omit<ClaimAtom, 'id'>): void {
    if (claim.factual) factualClaims += 1;
    claims.push({ id: `claim_${claims.length + 1}`, ...claim });
  }

  for (const cluster of clusters) {
    const strong = highOrMediumSignals(cluster);
    if (wanted.has(cluster.slotId) && isRequiredForFrame(frame, cluster) && strong.length === 0) {
      missingSlots.push(cluster.slotId);
      pushClaim({
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

    const conflict = conflictPair(strong);
    if (conflict && canEmitFactual()) {
      const citations = conflict.map(signal => citationFor(signal, evidenceById, labelByEvidenceId));
      const conflictId = `${cluster.slotId}:${conflict.map(signal => signal.evidenceId).sort().join('|')}`;
      conflicts.push(conflictId);
      pushClaim({
        kind: 'conflict_notice',
        text: `Conflicting source-backed evidence was found for ${cluster.title}: “${conflict[0].text}” and “${conflict[1].text}”.`,
        factual: true,
        citations,
        slotId: cluster.slotId,
        supportSignalIds: conflict.map(signal => signal.id),
      });
      continue;
    }

    const sourceSignals = cluster.slotId === 'stack' ? compactStackSignals(strong, options.maxListItems) : strong;
    const selected = filterSlotDuplicates(
      cluster.slotId === 'stack' ? sourceSignals.slice(0, Math.min(8, sourceSignals.length)) : sourceSignals.slice(0, 2),
      seenFingerprints,
    );
    if (wanted.has(cluster.slotId) && selected.length === 0) {
      missingSlots.push(cluster.slotId);
      pushClaim({
        kind: 'absence_notice',
        text: `No non-duplicate source-backed evidence was found for ${cluster.title}.`,
        factual: false,
        citations: [],
        slotId: cluster.slotId,
        supportSignalIds: [],
      });
      continue;
    }
    if (!canEmitFactual()) continue;
    if (cluster.slotId === 'stack') {
      const citations = selected.map(signal => citationFor(signal, evidenceById, labelByEvidenceId));
      pushClaim({
        kind: 'list_aggregate',
        text: compactListText(selected, maxQuoteChars),
        factual: true,
        citations,
        slotId: cluster.slotId,
        supportSignalIds: selected.map(signal => signal.id),
        listItems: selected.map(signal => ({
          text: listItemText(signal),
          citations: [citationFor(signal, evidenceById, labelByEvidenceId)],
          supportSignalIds: [signal.id],
        })),
      });
      continue;
    }

    for (const signal of selected) {
      if (!canEmitFactual()) break;
      pushClaim({
        kind: claimKind(cluster.slotId, [signal]),
        text: sentenceLike(signal.text),
        factual: true,
        citations: [citationFor(signal, evidenceById, labelByEvidenceId)],
        slotId: cluster.slotId,
        supportSignalIds: [signal.id],
      });
    }
  }

  if (frame.requestedAspects.includes('current_state')) {
    pushClaim({
      kind: 'absence_notice',
      text: 'Freshness caveat: this deterministic answer reflects only cited historical recall evidence and is not a live current-state check.',
      factual: false,
      citations: [],
      slotId: 'freshness_caveat',
      supportSignalIds: [],
    });
  }

  return { claims, missingSlots, conflicts };
}
