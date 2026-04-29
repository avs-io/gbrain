import type { RecallEvidence } from '../evidence/recall.ts';
import type { EvidenceWindow } from './types.ts';

export interface EvidencePruneOptions {
  maxEvidence?: number;
  maxPerSource?: number;
  preferExactGbs1?: boolean;
}

export interface EvidencePruneStats {
  input: number;
  kept: number;
  removed: number;
  removedNonExact: number;
  removedDuplicateSpan: number;
  removedDuplicateQuoteHash: number;
  removedDuplicateQuoteText: number;
  removedPerSource: number;
}

export interface EvidencePruneResult {
  evidence: EvidenceWindow[];
  pruned: boolean;
  warnings: string[];
  stats: EvidencePruneStats;
}

function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function coerceEvidenceWindow(input: EvidenceWindow | RecallEvidence | any): EvidenceWindow {
  if (input?.id && input?.source) return input as EvidenceWindow;
  return {
    id: String(input?.span_id ?? input?.id ?? ''),
    source: {
      id: String(input?.source_id ?? input?.source?.id ?? ''),
      slug: String(input?.slug ?? input?.source?.slug ?? ''),
      title: input?.title ?? input?.source?.title,
      section: String(input?.section ?? input?.source?.section ?? ''),
      lineRange: typeof input?.start_line === 'number' && typeof input?.end_line === 'number'
        ? { start: input.start_line, end: input.end_line }
        : input?.source?.lineRange,
    },
    quote: String(input?.quote ?? ''),
    quoteHash: input?.quote_hash ?? input?.quoteHash,
    score: typeof input?.score === 'number' ? input.score : undefined,
    reason: input?.reason,
    matchedBy: input?.matched_by ?? input?.matchedBy,
    searchSource: input?.searchSource,
  };
}

function isExactGbs1(window: EvidenceWindow): boolean {
  return typeof window.id === 'string' && window.id.startsWith('gbs1:');
}

function sourceKey(window: EvidenceWindow): string {
  return `${window.source.id ?? ''}\u0000${window.source.slug ?? ''}\u0000${window.source.section ?? ''}`;
}

export function pruneEvidenceForSynthesis(windows: Array<EvidenceWindow | RecallEvidence | any>, options: EvidencePruneOptions = {}): EvidencePruneResult {
  const maxEvidence = options.maxEvidence ?? 4;
  const maxPerSource = options.maxPerSource ?? Math.max(1, maxEvidence);
  const stats: EvidencePruneStats = {
    input: windows.length,
    kept: 0,
    removed: 0,
    removedNonExact: 0,
    removedDuplicateSpan: 0,
    removedDuplicateQuoteHash: 0,
    removedDuplicateQuoteText: 0,
    removedPerSource: 0,
  };

  const ordered = windows
    .map((raw, index) => ({ window: coerceEvidenceWindow(raw), index }))
    .sort((a, b) => {
      const scoreA = a.window.score ?? 0;
      const scoreB = b.window.score ?? 0;
      return scoreB - scoreA || a.window.id.localeCompare(b.window.id) || a.index - b.index;
    });

  const seenSpan = new Set<string>();
  const seenQuoteHashToQuote = new Map<string, string>();
  const seenQuoteText = new Set<string>();
  const perSource = new Map<string, number>();
  const kept: EvidenceWindow[] = [];

  for (const { window } of ordered) {
    if (!isExactGbs1(window)) {
      stats.removedNonExact += 1;
      continue;
    }
    if (seenSpan.has(window.id)) {
      stats.removedDuplicateSpan += 1;
      continue;
    }
    const quoteText = normalizeQuote(window.quote);
    if (window.quoteHash && seenQuoteHashToQuote.get(window.quoteHash) === quoteText) {
      stats.removedDuplicateQuoteHash += 1;
      continue;
    }
    if (quoteText && seenQuoteText.has(quoteText)) {
      stats.removedDuplicateQuoteText += 1;
      continue;
    }
    const key = sourceKey(window);
    const sourceCount = perSource.get(key) ?? 0;
    if (sourceCount >= maxPerSource) {
      stats.removedPerSource += 1;
      continue;
    }
    kept.push(window);
    seenSpan.add(window.id);
    if (window.quoteHash) seenQuoteHashToQuote.set(window.quoteHash, quoteText);
    if (quoteText) seenQuoteText.add(quoteText);
    perSource.set(key, sourceCount + 1);
    if (kept.length >= maxEvidence) break;
  }

  stats.kept = kept.length;
  stats.removed = stats.input - stats.kept;
  const pruned = stats.removed > 0;
  const warnings: string[] = [];
  if (pruned) warnings.push(`evidence pruned for synthesis: kept ${stats.kept}/${stats.input} windows`);
  if (stats.removedNonExact > 0) warnings.push('syn/non-gbs1 evidence excluded from synthesis');
  if (stats.removedDuplicateSpan > 0 || stats.removedDuplicateQuoteHash > 0 || stats.removedDuplicateQuoteText > 0) warnings.push('duplicate evidence windows were removed before synthesis');
  if (stats.removedPerSource > 0) warnings.push('per-source evidence cap applied before synthesis');
  return { evidence: kept, pruned, warnings, stats };
}

export function exactGbs1Evidence(windows: RecallEvidence[]): EvidenceWindow[] {
  return windows.filter((window): window is RecallEvidence => typeof window.span_id === 'string' && window.span_id.startsWith('gbs1:')).map(coerceEvidenceWindow);
}
