import type { MemoryAtomSupportLevel } from './memory-atom-proposal.ts';

export type ClaimSupportLevel = MemoryAtomSupportLevel | 'contradicted';

export interface ClaimSupportEvidenceSpan {
  span_id: string;
  quote: string;
  source_item_id?: string;
  entity_mentions?: string[];
  dates?: string[];
  numbers?: string[];
}

export interface ClaimSupportResult {
  ok: boolean;
  support_level: ClaimSupportLevel;
  confidence: number;
  claim: string;
  evidence_span_ids: string[];
  reasons: string[];
  explanation?: string;
  matched_entities: string[];
  matched_dates: string[];
  matched_numbers: string[];
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value: string): string[] {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

function overlap(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return [...new Set(a.filter(v => set.has(v)))];
}

function parseEntities(text: string): string[] {
  return [...text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g)].map(m => m[1]);
}

function parseDates(text: string): string[] {
  return [...text.matchAll(/\b(?:\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?)\b/gi)].map(m => m[0]);
}

function parseNumbers(text: string): string[] {
  return [...text.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(m => m[0]);
}

function isRealGbs1Span(spanId: string): boolean {
  return /^gbs1:[^:]+:[^#]+#[^#]+:L[1-9]\d*-L[1-9]\d*$/.test(spanId);
}

function directQuoteScore(claim: string, quote: string): number {
  const c = normalizeText(claim);
  const q = normalizeText(quote);
  if (!c || !q) return 0;
  if (q.includes(c)) return 1;
  const ct = tokens(claim);
  const qt = tokens(quote);
  const o = overlap(ct, qt);
  return ct.length ? o.length / ct.length : 0;
}

function evidenceMatchesClaim(claim: string, span: ClaimSupportEvidenceSpan): { overlapScore: number; entityMatches: string[]; dateMatches: string[]; numberMatches: string[] } {
  const claimTokens = tokens(claim);
  const quoteTokens = tokens(span.quote);
  const overlapScore = claimTokens.length ? overlap(claimTokens, quoteTokens).length / claimTokens.length : 0;
  const claimEntities = parseEntities(claim);
  const claimDates = parseDates(claim);
  const claimNumbers = parseNumbers(claim);
  return {
    overlapScore,
    entityMatches: overlap(claimEntities, span.entity_mentions || parseEntities(span.quote)),
    dateMatches: overlap(claimDates, span.dates || parseDates(span.quote)),
    numberMatches: overlap(claimNumbers, span.numbers || parseNumbers(span.quote)),
  };
}

export function verifyClaimSupport(input: { claim: string; evidence_spans: ClaimSupportEvidenceSpan[]; explanation?: string }): ClaimSupportResult {
  const reasons: string[] = [];
  const claim = input.claim?.trim() || '';
  if (!claim) return { ok: false, support_level: 'unsupported', confidence: 0, claim, evidence_span_ids: [], reasons: ['claim is required'], matched_entities: [], matched_dates: [], matched_numbers: [] };
  if (!Array.isArray(input.evidence_spans) || input.evidence_spans.length === 0) return { ok: false, support_level: 'unsupported', confidence: 0, claim, evidence_span_ids: [], reasons: ['evidence_spans are required'], matched_entities: [], matched_dates: [], matched_numbers: [] };

  const parsedSpans = input.evidence_spans.map(span => {
    if (!span?.span_id?.startsWith('gbs1:') || !isRealGbs1Span(span.span_id)) throw new Error('evidence_spans must contain real gbs1 spans');
    if (!span.quote?.trim()) throw new Error('evidence span quote is required');
    return span;
  });

  const allEntityMatches: string[] = [];
  const allDateMatches: string[] = [];
  const allNumberMatches: string[] = [];
  let bestDirect = 0;
  let bestOverlap = 0;
  for (const span of parsedSpans) {
    const match = evidenceMatchesClaim(claim, span);
    bestDirect = Math.max(bestDirect, directQuoteScore(claim, span.quote));
    bestOverlap = Math.max(bestOverlap, match.overlapScore);
    allEntityMatches.push(...match.entityMatches);
    allDateMatches.push(...match.dateMatches);
    allNumberMatches.push(...match.numberMatches);
  }

  const evidence_span_ids = parsedSpans.map(s => s.span_id);
  const matched_entities = [...new Set(allEntityMatches)];
  const matched_dates = [...new Set(allDateMatches)];
  const matched_numbers = [...new Set(allNumberMatches)];

  const hardNegative = matched_dates.length === 0 && parseDates(claim).length > 0 || matched_numbers.length === 0 && parseNumbers(claim).length > 0 || matched_entities.length === 0 && parseEntities(claim).length > 0;
  if (hardNegative && parsedSpans.length === 1) reasons.push('claim contains date/entity/number mismatch against single evidence span');

  if (bestDirect >= 0.95) return { ok: true, support_level: 'direct_quote', confidence: 0.99, claim, evidence_span_ids, reasons: reasons.length ? reasons : ['claim is contained in evidence quote'], explanation: input.explanation, matched_entities, matched_dates, matched_numbers };
  if (parsedSpans.length >= 2 && input.explanation?.trim() && bestOverlap >= 0.35) return { ok: true, support_level: 'strong_inference', confidence: 0.8, claim, evidence_span_ids, reasons: reasons.length ? reasons : ['multiple spans plus explicit explanation support inference'], explanation: input.explanation, matched_entities, matched_dates, matched_numbers };
  if (parsedSpans.length >= 2 && input.explanation?.trim() && bestOverlap >= 0.18) return { ok: true, support_level: 'weak_inference', confidence: 0.55, claim, evidence_span_ids, reasons: reasons.length ? reasons : ['weak overlap with explicit explanation'], explanation: input.explanation, matched_entities, matched_dates, matched_numbers };
  if (bestOverlap < 0.18) return { ok: false, support_level: 'unsupported', confidence: 0.05, claim, evidence_span_ids, reasons: [...reasons, 'low normalized token overlap'], explanation: input.explanation, matched_entities, matched_dates, matched_numbers };
  if (hardNegative) return { ok: false, support_level: 'contradicted', confidence: 0.1, claim, evidence_span_ids, reasons: [...reasons, 'hard negative entity/date/number mismatch'], explanation: input.explanation, matched_entities, matched_dates, matched_numbers };
  if (input.explanation?.trim()) return { ok: true, support_level: parsedSpans.length >= 2 ? 'strong_inference' : 'weak_inference', confidence: parsedSpans.length >= 2 ? 0.72 : 0.45, claim, evidence_span_ids, reasons: reasons.length ? reasons : ['explicit explanation bridges the evidence'], explanation: input.explanation, matched_entities, matched_dates, matched_numbers };
  return { ok: false, support_level: 'unsupported', confidence: 0.1, claim, evidence_span_ids, reasons: ['inference requires explicit explanation'], matched_entities, matched_dates, matched_numbers };
}
