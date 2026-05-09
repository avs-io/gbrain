import type { RecallResult } from './recall.ts';

export type RecallDiagnosticsRecommendation = 'good_for_synthesis' | 'needs_more_evidence' | 'unsafe_for_synthesis';

export type RecallDiagnosticsOptions = {
  topK?: number;
  distractorWarningThreshold?: number;
  duplicateSpanWarningThreshold?: number;
};

export type RecallDiagnosticsEnvelope = {
  schema: 'gbrain.recall_diagnostics.v1';
  ok: boolean;
  query: string;
  evidence_count: number;
  gbs1_count: number;
  non_gbs1_count: number;
  duplicate_span_count: number;
  source_count: number;
  top_sources: Array<{ source: string; count: number }>;
  warnings: string[];
  recommendation: RecallDiagnosticsRecommendation;
};

function getEvidenceList(recall: RecallResult): Array<any> {
  if (Array.isArray((recall as any).evidence)) return (recall as any).evidence;
  if (Array.isArray((recall as any).results)) return (recall as any).results;
  return [];
}

function evidenceId(entry: any, index: number): string {
  return String(entry?.span_id ?? entry?.id ?? entry?.source_span_id ?? entry?.source_id ?? `evidence_${index + 1}`);
}

function sourceKey(entry: any): string {
  return String(entry?.source_id ?? entry?.source ?? entry?.source_name ?? entry?.source_url ?? 'unknown');
}

export function analyzeRecallForAnswer(recall: RecallResult, options: RecallDiagnosticsOptions = {}): RecallDiagnosticsEnvelope {
  const evidence = getEvidenceList(recall);
  const topK = options.topK ?? 3;
  const duplicateThreshold = options.duplicateSpanWarningThreshold ?? 1;
  const distractorThreshold = options.distractorWarningThreshold ?? 0.5;

  const countsBySource = new Map<string, number>();
  const seenIds = new Map<string, number>();
  const seenText = new Map<string, number>();
  let gbs1_count = 0;
  let non_gbs1_count = 0;

  for (const [index, entry] of evidence.entries()) {
    const id = evidenceId(entry, index);
    const key = sourceKey(entry);
    countsBySource.set(key, (countsBySource.get(key) ?? 0) + 1);
    if (String(id).startsWith('gbs1:')) gbs1_count += 1;
    else non_gbs1_count += 1;
    seenIds.set(id, (seenIds.get(id) ?? 0) + 1);
    const text = String(entry?.quote ?? entry?.text ?? entry?.snippet ?? '').trim();
    if (text) seenText.set(text, (seenText.get(text) ?? 0) + 1);
  }

  const duplicateIdCount = Array.from(seenIds.values()).filter(count => count > duplicateThreshold).reduce((sum, count) => sum + (count - 1), 0);
  const duplicateTextCount = Array.from(seenText.values()).filter(count => count > duplicateThreshold).reduce((sum, count) => sum + (count - 1), 0);
  const duplicate_span_count = Math.max(duplicateIdCount, duplicateTextCount);
  const source_count = countsBySource.size;
  const top_sources = Array.from(countsBySource.entries()).sort((a, b) => b[1] - a[1]).slice(0, topK).map(([source, count]) => ({ source, count }));

  const warnings: string[] = [];
  const evidence_count = evidence.length;
  const distractor_ratio = evidence_count > 0 ? non_gbs1_count / evidence_count : 1;

  if (evidence_count === 0) warnings.push('no_recall_evidence');
  if (non_gbs1_count > 0) warnings.push('contains_non_gbs1_evidence');
  if (duplicate_span_count > 0) warnings.push('duplicate_span_overlap');
  if (source_count > 0 && top_sources.length > 0 && top_sources[0].count / evidence_count >= 0.7) warnings.push('low_source_diversity');
  if (distractor_ratio > distractorThreshold) warnings.push('high_distractor_ratio');

  let recommendation: RecallDiagnosticsRecommendation = 'good_for_synthesis';
  if (evidence_count === 0 || gbs1_count === 0) recommendation = 'needs_more_evidence';
  if (non_gbs1_count > 0 || duplicate_span_count > 0 || (evidence_count > 0 && distractor_ratio > distractorThreshold)) recommendation = 'unsafe_for_synthesis';

  return {
    schema: 'gbrain.recall_diagnostics.v1',
    ok: recommendation !== 'unsafe_for_synthesis' && evidence_count > 0,
    query: String((recall as any).query ?? ''),
    evidence_count,
    gbs1_count,
    non_gbs1_count,
    duplicate_span_count,
    source_count,
    top_sources,
    warnings,
    recommendation,
  };
}
