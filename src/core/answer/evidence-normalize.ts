import type { RecallEvidence, RecallResult } from '../evidence/recall.ts';
import type { EvidenceWindow } from './types.ts';

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function inferIsoDate(...parts: Array<unknown>): string | undefined {
  const joined = parts.filter(part => typeof part === 'string').join(' ');
  const match = joined.match(/\b(20\d{2}|19\d{2})[-_/](0[1-9]|1[0-2])[-_/]([0-2]\d|3[01])\b/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

function inferTurnRange(spanId: string): { start: number; end: number } | undefined {
  const match = spanId.match(/(?:turn|T)(\d+)(?:[-_](?:turn|T)?(\d+))?/i);
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : undefined;
}

function inferSpeakerAndAuthority(quote: string): Pick<EvidenceWindow['source'], 'speaker' | 'authority'> {
  const first = quote.trim().split(/\r?\n/, 1)[0] ?? '';
  const speakerMatch = first.match(/^\s*(user|human|chief|aditya|assistant|ai|system)\s*:/i);
  if (!speakerMatch) return { speaker: 'unknown', authority: 'unknown' };
  const raw = speakerMatch[1].toLowerCase();
  if (raw === 'assistant' || raw === 'ai') return { speaker: 'assistant', authority: /\b(?:accepted|confirmed|correct|agree|agreed)\b/i.test(first) ? 'accepted_assistant_claim' : 'assistant_proposal' };
  if (raw === 'system') return { speaker: 'system', authority: 'system' };
  return { speaker: 'user', authority: 'user_statement' };
}

function normalizeEvidence(ev: RecallEvidence, searchSource: RecallResult['integration']['search_source']): EvidenceWindow | null {
  if (!ev || typeof ev.span_id !== 'string' || !ev.span_id.trim()) return null;
  if (typeof ev.quote !== 'string' || !ev.quote.trim()) return null;
  const speakerAuthority = inferSpeakerAndAuthority(ev.quote);
  const date = inferIsoDate((ev as any).source_date, ev.slug, ev.span_id, ev.title);
  const turnRange = inferTurnRange(ev.span_id);
  return {
    id: ev.span_id,
    source: {
      id: ev.source_id,
      slug: ev.slug,
      title: ev.title,
      section: ev.section,
      ...(date ? { date } : {}),
      ...(speakerAuthority.speaker !== 'unknown' ? speakerAuthority : {}),
      lineRange: Number.isFinite(ev.start_line) && Number.isFinite(ev.end_line)
        ? { start: ev.start_line, end: ev.end_line }
        : undefined,
      ...(turnRange ? { turnRange } : {}),
    },
    quote: ev.quote,
    quoteHash: ev.quote_hash || undefined,
    score: finiteNumber(ev.score),
    matchedBy: ev.matched_by,
    searchSource,
  };
}

export function normalizeRecallEvidence(recall: RecallResult): EvidenceWindow[] {
  const windows: EvidenceWindow[] = [];
  const seen = new Set<string>();
  for (const ev of recall.evidence ?? []) {
    const normalized = normalizeEvidence(ev, recall.integration.search_source);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    windows.push(normalized);
  }
  return windows;
}

export function isExactEvidenceWindow(window: EvidenceWindow): boolean {
  return window.id.startsWith('gbs1:');
}
