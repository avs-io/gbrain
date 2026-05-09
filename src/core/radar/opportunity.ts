import { createHash } from 'node:crypto';
import type { ScoutSignal } from '../scout/pipeline.ts';

export type OpportunityFeedback = 'useful' | 'noise' | 'already_knew' | 'wrong' | 'pursue';

export interface OpportunityRadarCandidate {
  schema: 'gbrain.radar.opportunity.v1';
  id: string;
  scout_signal_id: string;
  topic: string;
  source_url?: string;
  source_title?: string;
  published_at?: string;
  matched_memory_refs: string[];
  score_breakdown: Record<string, number>;
  opportunity_score: number;
  why_now: string;
  proposed_action: string;
  evidence_excerpt: string;
  feedback?: OpportunityFeedback;
}

export interface OpportunityRadarContext {
  active_bets?: string[];
  memory_refs?: string[];
  now?: Date;
}

function stableId(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}
function clamp(n: number): number { return Math.max(0, Math.min(1, Number(n.toFixed(3)))); }
function norm(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function overlap(text: string, items: string[]): number { if (!items.length) return 0; const hay = norm(text); return items.filter(i => i && hay.includes(norm(i))).length / items.length; }
function uniq(xs: string[]): string[] { return [...new Set(xs.map(x => x.trim()).filter(Boolean))]; }

export function candidateFromScoutSignal(signal: ScoutSignal, context: OpportunityRadarContext = {}): OpportunityRadarCandidate {
  const active = uniq(context.active_bets || []);
  const memoryRefs = uniq(context.memory_refs || []);
  const suggestedActionLabels = signal.suggested_actions.map(action => action.label);
  const sourceText = [signal.topic, signal.source_title || '', signal.claim, signal.evidence_excerpt, signal.entities.join(' '), suggestedActionLabels.join(' ')].join(' ');
  const betOverlap = overlap(sourceText, active);
  const novelty = clamp(signal.novelty_score);
  const actionability = clamp(Math.max(signal.relevance_score, signal.suggested_actions.length ? 0.4 : 0) * 0.9);
  const timingUrgency = clamp(Math.max(signal.urgency_score, signal.source_url ? 0.15 : 0));
  const networkLeverage = clamp(Math.min(1, (signal.entities.length * 0.08) + (memoryRefs.length ? 0.1 : 0) + (betOverlap * 0.25)));
  const asymmetricUpside = clamp(Math.min(1, 0.2 + novelty * 0.35 + signal.confidence * 0.25 + betOverlap * 0.2));
  const distractionPenalty = clamp(Math.max(0, 0.25 - betOverlap * 0.18 + (signal.confidence < 0.45 ? 0.1 : 0)));
  const score_breakdown = { relevance_to_active_bets: betOverlap, novelty, actionability, timing_urgency: timingUrgency, network_leverage: networkLeverage, asymmetric_upside: asymmetricUpside, distraction_penalty: distractionPenalty };
  const opportunity_score = clamp((betOverlap * 0.25) + (novelty * 0.2) + (actionability * 0.2) + (timingUrgency * 0.15) + (networkLeverage * 0.1) + (asymmetricUpside * 0.1) - (distractionPenalty * 0.2));
  const matched_memory_refs = uniq([...memoryRefs, ...signal.matched_memory_refs].slice(0, 8));
  const why_now = active.length ? `Matches active bets: ${active.slice(0, 2).join(', ')}${betOverlap > 0.35 ? '; high overlap' : ''}.` : `Public signal is timely${timingUrgency > 0.4 ? ' and urgent' : ''}; review before it decays.`;
  const proposed_action = signal.suggested_actions[0]?.label || (opportunity_score >= 0.55 ? 'draft a review note' : 'park for later review');
  return { schema: 'gbrain.radar.opportunity.v1', id: `opp_${stableId({ scout_signal_id: signal.id, active, memoryRefs })}`, scout_signal_id: signal.id, topic: signal.topic, source_url: signal.source_url, source_title: signal.source_title, published_at: signal.published_at, matched_memory_refs, score_breakdown, opportunity_score, why_now, proposed_action, evidence_excerpt: signal.evidence_excerpt };
}

export interface ScoutRadarEvaluationLabel {
  candidate_id?: string;
  scout_signal_id?: string;
  useful: boolean;
  false_urgency: boolean;
  duplicate_of?: string;
  stale_source: boolean;
  public_citation_present?: boolean;
  action_converted: boolean;
}

export interface ScoutRadarEvaluationReport {
  schema: 'gbrain.radar.scout_evaluation.v1';
  sample_size: number;
  useful_surfacing_rate: number;
  false_urgency_rate: number;
  duplicate_rate: number;
  stale_source_rate: number;
  public_citation_coverage: number;
  action_conversion_rate: number;
  thresholds: {
    min_useful_surfacing_rate: number;
    max_false_urgency_rate: number;
    max_duplicate_rate: number;
    max_stale_source_rate: number;
    min_public_citation_coverage: number;
  };
  passed: boolean;
  missing_labels: string[];
}

function mean(flags: boolean[]): number {
  if (!flags.length) return 0;
  return clamp(flags.filter(Boolean).length / flags.length);
}

export function evaluateScoutRadarCandidates(
  candidates: OpportunityRadarCandidate[],
  labels: ScoutRadarEvaluationLabel[],
  thresholds: Partial<ScoutRadarEvaluationReport['thresholds']> = {},
): ScoutRadarEvaluationReport {
  const resolvedThresholds = {
    min_useful_surfacing_rate: 0.6,
    max_false_urgency_rate: 0.1,
    max_duplicate_rate: 0.15,
    max_stale_source_rate: 0.1,
    min_public_citation_coverage: 1,
    ...thresholds,
  };
  const byKey = new Map<string, ScoutRadarEvaluationLabel>();
  for (const label of labels) {
    if (label.candidate_id) byKey.set(`candidate:${label.candidate_id}`, label);
    if (label.scout_signal_id) byKey.set(`signal:${label.scout_signal_id}`, label);
  }
  const matched = candidates.map(candidate => ({
    candidate,
    label: byKey.get(`candidate:${candidate.id}`) || byKey.get(`signal:${candidate.scout_signal_id}`),
  }));
  const missing_labels = matched.filter(item => !item.label).map(item => item.candidate.id);
  const labelled = matched.filter((item): item is { candidate: OpportunityRadarCandidate; label: ScoutRadarEvaluationLabel } => !!item.label);
  const publicCitationFlags = labelled.map(({ candidate, label }) => label.public_citation_present ?? !!candidate.source_url);
  const report: ScoutRadarEvaluationReport = {
    schema: 'gbrain.radar.scout_evaluation.v1',
    sample_size: labelled.length,
    useful_surfacing_rate: mean(labelled.map(item => item.label.useful)),
    false_urgency_rate: mean(labelled.map(item => item.label.false_urgency)),
    duplicate_rate: mean(labelled.map(item => !!item.label.duplicate_of)),
    stale_source_rate: mean(labelled.map(item => item.label.stale_source)),
    public_citation_coverage: mean(publicCitationFlags),
    action_conversion_rate: mean(labelled.map(item => item.label.action_converted)),
    thresholds: resolvedThresholds,
    passed: false,
    missing_labels,
  };
  report.passed = report.sample_size > 0
    && missing_labels.length === 0
    && report.useful_surfacing_rate >= resolvedThresholds.min_useful_surfacing_rate
    && report.false_urgency_rate <= resolvedThresholds.max_false_urgency_rate
    && report.duplicate_rate <= resolvedThresholds.max_duplicate_rate
    && report.stale_source_rate <= resolvedThresholds.max_stale_source_rate
    && report.public_citation_coverage >= resolvedThresholds.min_public_citation_coverage;
  return report;
}

export function opportunityReportJson(candidate: OpportunityRadarCandidate): Record<string, unknown> {
  return { schema: 'gbrain.radar.opportunity.report.v1', mode: 'review-only', trusted_world_truth: false, candidate };
}
