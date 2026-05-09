import { createHash } from 'node:crypto';
import type { ClaimLedgerRecord } from '../claims/claim-ledger.ts';
import { classifyNamespacePolicy, validateNamespacePolicy, type GBrainPrivacy, type GBrainSensitivity } from './namespace-policy.ts';
import type { ScoutNextActionType, ScoutObservation } from './scoutnet.ts';

export const GBRAIN_RADAR_SCHEMA = 'gbrain.radar.candidate.v1';
export const GBRAIN_RADAR_REPORT_SCHEMA = 'gbrain.radar.report.v1';

export type RadarThresholdBand = 'immediate-review' | 'daily-brief' | 'weekly-digest' | 'archive';
export type RadarFeedbackDisposition = 'accepted' | 'dismissed' | 'snoozed' | 'wrong' | 'creepy' | 'stale';
export type RadarSourceKind = 'scout_observation' | 'claim_ledger_record' | 'context_pack_record';

export interface RadarFeedback {
  disposition: RadarFeedbackDisposition;
  at?: string;
  note?: string;
  snooze_until?: string;
}

export interface RadarSourceRef {
  kind: RadarSourceKind;
  id: string;
  source_ids: string[];
  evidence_ids: string[];
  title?: string;
  citation?: string;
  citation_url?: string;
}

export interface RadarScores {
  relevance: number;
  utility: number;
  timing: number;
  novelty: number;
  confidence: number;
  annoyance_risk: number;
  sensitivity_risk: number;
  action_cost: number;
  final: number;
}

export interface RadarCandidate {
  schema: typeof GBRAIN_RADAR_SCHEMA;
  id: string;
  generated_at: string;
  title: string;
  summary: string;
  recommended_action: string;
  review_queue_only: true;
  band: RadarThresholdBand;
  scores: RadarScores;
  namespace: string;
  privacy: GBrainPrivacy;
  sensitivity: GBrainSensitivity;
  source: RadarSourceRef;
  policy: {
    agent_read: string;
    context_visibility: string;
    immediate_review_allowed: boolean;
    warnings: string[];
  };
  feedback?: RadarFeedback;
  guardrails: {
    review_only: true;
    user_facing_interrupt_sent: false;
    trusted_pages_edited: false;
    external_messages_sent: false;
    global_config_changed: false;
  };
}

export interface RadarReport {
  schema: typeof GBRAIN_RADAR_REPORT_SCHEMA;
  generated_at: string;
  source: string;
  candidate_count: number;
  band_counts: Record<RadarThresholdBand, number>;
  candidates: RadarCandidate[];
  guardrails: RadarCandidate['guardrails'] & { automatic_notifications_enabled: false };
}

const PRIVACY_RISK: Record<GBrainPrivacy, number> = { public: 0.02, internal: 0.12, private: 0.46, confidential: 0.85 };
const SENSITIVITY_RISK: Record<GBrainSensitivity, number> = { low: 0.04, medium: 0.16, high: 0.62, restricted: 0.9 };
const ACTION_UTILITY: Record<ScoutNextActionType, number> = { proposal: 0.88, research: 0.76, brief: 0.7, monitor: 0.48, ignore: 0.08 };
const ACTION_COST: Record<ScoutNextActionType, number> = { ignore: 0.03, monitor: 0.14, brief: 0.28, research: 0.44, proposal: 0.6 };

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number { return Math.round(clamp01(value) * 1000) / 1000; }

function stableId(prefix: string, basis: unknown): string {
  return `${prefix}_${createHash('sha256').update(JSON.stringify(basis)).digest('hex').slice(0, 12)}`;
}

function daysSince(iso: string | undefined, now: Date): number {
  if (!iso) return 999;
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 999;
  return Math.max(0, ms / 86_400_000);
}

function timingFromObservedAt(observedAt: string | undefined, now: Date, freshnessDays = 14): number {
  const age = daysSince(observedAt, now);
  if (age > freshnessDays * 2) return 0.08;
  return clamp01(1 - age / Math.max(1, freshnessDays * 1.5));
}

function sensitivityRisk(privacy: GBrainPrivacy, sensitivity: GBrainSensitivity): number {
  return round3(Math.max(PRIVACY_RISK[privacy] ?? 0.5, SENSITIVITY_RISK[sensitivity] ?? 0.5));
}

function annoyanceRisk(input: { novelty: number; relevance: number; actionCost: number; actionType?: string }): number {
  const lowSignal = (1 - input.novelty) * 0.28 + (1 - input.relevance) * 0.28;
  const cost = input.actionCost * 0.28;
  const passivePenalty = input.actionType === 'monitor' || input.actionType === 'ignore' ? 0.12 : 0;
  return round3(lowSignal + cost + passivePenalty);
}

function finalScore(scores: Omit<RadarScores, 'final'>): number {
  return round3(
    scores.relevance * 0.24 +
    scores.utility * 0.18 +
    scores.timing * 0.14 +
    scores.novelty * 0.16 +
    scores.confidence * 0.18 -
    scores.annoyance_risk * 0.12 -
    scores.sensitivity_risk * 0.08 -
    scores.action_cost * 0.06,
  );
}

export function bandForRadarScore(final: number, immediateAllowed = true): RadarThresholdBand {
  if (final >= 0.72 && immediateAllowed) return 'immediate-review';
  if (final >= 0.52) return 'daily-brief';
  if (final >= 0.32) return 'weekly-digest';
  return 'archive';
}

function policyFor(input: { namespace: string; privacy: GBrainPrivacy; sensitivity: GBrainSensitivity }, allowSensitiveImmediate: boolean): RadarCandidate['policy'] {
  const warnings = validateNamespacePolicy(input);
  let classified: ReturnType<typeof classifyNamespacePolicy> | undefined;
  if (warnings.length === 0) classified = classifyNamespacePolicy(input);
  const highOrPrivate = input.privacy === 'private' || input.privacy === 'confidential' || input.sensitivity === 'high' || input.sensitivity === 'restricted';
  return {
    agent_read: classified?.agent_read || 'review_required',
    context_visibility: classified?.context_visibility || 'metadata_only',
    immediate_review_allowed: !highOrPrivate || allowSensitiveImmediate === true,
    warnings: [...warnings, ...(classified?.warnings || []), ...(highOrPrivate && !allowSensitiveImmediate ? ['high/private radar candidates are capped below immediate-review unless explicitly allowed'] : [])],
  };
}

export function radarCandidateFromScoutObservation(observation: ScoutObservation, opts: { now?: Date; allowSensitiveImmediate?: boolean } = {}): RadarCandidate {
  const now = opts.now || new Date();
  const actionType = observation.recommended_next_action.type;
  const relevance = round3(observation.signal.relevance);
  const novelty = round3(observation.signal.novelty);
  const confidence = round3(observation.signal.confidence);
  const utility = round3(ACTION_UTILITY[actionType] ?? 0.35);
  const timing = round3(timingFromObservedAt(observation.observed_at, now, observation.coverage.freshness_window_days));
  const action_cost = round3(ACTION_COST[actionType] ?? 0.35);
  const sensitivity_risk = sensitivityRisk(observation.privacy, observation.sensitivity);
  const annoyance_risk = annoyanceRisk({ novelty, relevance, actionCost: action_cost, actionType });
  const scores = { relevance, utility, timing, novelty, confidence, annoyance_risk, sensitivity_risk, action_cost, final: 0 };
  scores.final = finalScore(scores);
  const policy = policyFor(observation, opts.allowSensitiveImmediate === true);
  return {
    schema: GBRAIN_RADAR_SCHEMA,
    id: stableId('radar', { kind: 'scout', id: observation.id }),
    generated_at: now.toISOString(),
    title: observation.source.title || observation.source.name || observation.id,
    summary: observation.signal.summary,
    recommended_action: `${actionType}: ${observation.recommended_next_action.rationale}`,
    review_queue_only: true,
    band: bandForRadarScore(scores.final, policy.immediate_review_allowed),
    scores,
    namespace: observation.namespace,
    privacy: observation.privacy,
    sensitivity: observation.sensitivity,
    source: {
      kind: 'scout_observation',
      id: observation.id,
      source_ids: [observation.source.source_id].filter(Boolean),
      evidence_ids: [observation.id, observation.source.source_id, observation.source.citation_url || observation.source.citation].filter(Boolean),
      title: observation.source.title || observation.source.name,
      citation: observation.source.citation,
      citation_url: observation.source.citation_url,
    },
    policy,
    guardrails: radarGuardrails(),
  };
}

export function radarCandidateFromClaimLedgerRecord(record: ClaimLedgerRecord, opts: { now?: Date; allowSensitiveImmediate?: boolean } = {}): RadarCandidate {
  const now = opts.now || new Date();
  const relevance = round3(record.type === 'open_loop' || record.type === 'decision' || record.type === 'project_status' ? 0.72 : 0.48);
  const novelty = round3(record.status === 'proposed' ? 0.62 : record.status === 'trusted' ? 0.34 : 0.18);
  const confidence = round3(record.confidence);
  const utility = round3(record.type === 'open_loop' ? 0.78 : record.type === 'decision' ? 0.7 : 0.48);
  const timing = round3(timingFromObservedAt(record.observed_at, now, 30));
  const action_cost = round3(record.review_required ? 0.35 : 0.18);
  const sensitivity_risk = sensitivityRisk(record.privacy, record.sensitivity);
  const annoyance_risk = annoyanceRisk({ novelty, relevance, actionCost: action_cost, actionType: record.type });
  const scores = { relevance, utility, timing, novelty, confidence, annoyance_risk, sensitivity_risk, action_cost, final: 0 };
  scores.final = finalScore(scores);
  const policy = policyFor(record, opts.allowSensitiveImmediate === true);
  const evidenceIds = record.evidence.map(ev => ev.span_id);
  return {
    schema: GBRAIN_RADAR_SCHEMA,
    id: stableId('radar', { kind: 'claim', id: record.id }),
    generated_at: now.toISOString(),
    title: `${record.type}: ${record.id}`,
    summary: record.claim,
    recommended_action: 'review claim-ledger record for context surfacing or archive',
    review_queue_only: true,
    band: bandForRadarScore(scores.final, policy.immediate_review_allowed),
    scores,
    namespace: record.namespace,
    privacy: record.privacy,
    sensitivity: record.sensitivity,
    source: {
      kind: 'claim_ledger_record',
      id: record.id,
      source_ids: [...new Set(record.evidence.map(ev => ev.source_id).filter((v): v is string => Boolean(v)))],
      evidence_ids: evidenceIds,
      title: record.id,
      citation: evidenceIds.join(', '),
    },
    policy,
    guardrails: radarGuardrails(),
  };
}

export function scoreRadarCandidates(opts: { scoutObservations?: ScoutObservation[]; claimRecords?: ClaimLedgerRecord[]; now?: Date; allowSensitiveImmediate?: boolean } = {}): RadarCandidate[] {
  const scout = (opts.scoutObservations || []).map(o => radarCandidateFromScoutObservation(o, opts));
  const claims = (opts.claimRecords || []).map(r => radarCandidateFromClaimLedgerRecord(r, opts));
  return [...scout, ...claims].sort((a, b) => b.scores.final - a.scores.final || a.id.localeCompare(b.id));
}

export function radarGuardrails(): RadarCandidate['guardrails'] {
  return {
    review_only: true,
    user_facing_interrupt_sent: false,
    trusted_pages_edited: false,
    external_messages_sent: false,
    global_config_changed: false,
  };
}

export function buildRadarReport(opts: { candidates: RadarCandidate[]; source?: string; now?: Date }): RadarReport {
  const counts: Record<RadarThresholdBand, number> = { 'immediate-review': 0, 'daily-brief': 0, 'weekly-digest': 0, archive: 0 };
  for (const candidate of opts.candidates) counts[candidate.band] += 1;
  return {
    schema: GBRAIN_RADAR_REPORT_SCHEMA,
    generated_at: (opts.now || new Date()).toISOString(),
    source: opts.source || 'local-review-only',
    candidate_count: opts.candidates.length,
    band_counts: counts,
    candidates: opts.candidates,
    guardrails: { ...radarGuardrails(), automatic_notifications_enabled: false },
  };
}
