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
  const sourceText = [signal.topic, signal.source_title || '', signal.claim, signal.evidence_excerpt, signal.entities.join(' '), signal.suggested_actions.join(' ')].join(' ');
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
  const proposed_action = signal.suggested_actions[0] || (opportunity_score >= 0.55 ? 'draft a review note' : 'park for later review');
  return { schema: 'gbrain.radar.opportunity.v1', id: `opp_${stableId({ scout_signal_id: signal.id, active, memoryRefs })}`, scout_signal_id: signal.id, topic: signal.topic, source_url: signal.source_url, source_title: signal.source_title, matched_memory_refs, score_breakdown, opportunity_score, why_now, proposed_action, evidence_excerpt: signal.evidence_excerpt };
}

export function opportunityReportJson(candidate: OpportunityRadarCandidate): Record<string, unknown> {
  return { schema: 'gbrain.radar.opportunity.report.v1', mode: 'review-only', trusted_world_truth: false, candidate };
}
