import type { AnswerShapeDef } from './synthesis-dsl.ts';
import type { RequestedAspect } from './synthesis-dsl.ts';
import type { EvidenceSignal, EvidenceSignalRole } from './evidence-classify.ts';

export interface SlotSignalCluster {
  slotId: string;
  title: string;
  required: boolean;
  aspects: RequestedAspect[];
  groups: SlotSignalGroup[];
  signals: EvidenceSignal[];
}

export interface SlotSignalGroupKey {
  slotId: string;
  normalizedEntityOrConcept: string;
  sourceEpisode: string;
  sourceDate: string;
  role: EvidenceSignalRole;
}

export interface SlotSignalGroup {
  key: SlotSignalGroupKey;
  signals: EvidenceSignal[];
}

const ROLE_SLOT_MAP: Record<string, EvidenceSignalRole[]> = {
  relationship_frame: ['relationship_positive_signal', 'relationship_friction_signal'],
  incidents: ['relationship_friction_signal'],
  rationale_or_context: ['decision_rationale', 'clinical_or_operational_reasoning'],
  state_over_time: ['later_path_signal', 'deprioritization_signal'],
  prior_option: ['decision_option'],
  decision_or_shift: ['protocol_change', 'later_path_signal', 'deprioritization_signal', 'decision_rationale'],
  rationale: ['decision_rationale', 'clinical_or_operational_reasoning', 'uncertainty', 'deprioritization_signal'],
  later_state: ['later_path_signal'],
  timeline: ['later_path_signal', 'protocol_change', 'measurement'],
  stack: ['protocol_item'],
  change: ['protocol_change', 'later_path_signal'],
  measurement: ['measurement'],
  definition: ['decision_option'],
  evolution: ['later_path_signal', 'protocol_change', 'deprioritization_signal'],
  current_state: ['later_path_signal'],
  summary: ['relationship_positive_signal', 'relationship_friction_signal', 'decision_option', 'decision_rationale', 'protocol_item', 'protocol_change', 'measurement', 'clinical_or_operational_reasoning'],
  requested_details: ['relationship_positive_signal', 'relationship_friction_signal', 'decision_option', 'decision_rationale', 'deprioritization_signal', 'later_path_signal', 'protocol_item', 'protocol_change', 'measurement', 'clinical_or_operational_reasoning', 'uncertainty'],
};

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function dedupe(signals: EvidenceSignal[]): EvidenceSignal[] {
  const seen = new Set<string>();
  const out: EvidenceSignal[] = [];
  for (const signal of signals) {
    const key = normalizeText(signal.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(signal);
  }
  return out;
}

function normalizedEntityOrConcept(signal: EvidenceSignal): string {
  const stop = new Set(['and', 'the', 'what', 'why', 'when', 'who', 'how', 'did', 'was', 'were', 'direction', 'changed', 'change']);
  const terms = signal.queryOverlapTerms
    .map(normalizeText)
    .filter(term => term.length > 1 && !stop.has(term))
    .sort();
  if (terms.length > 0) return [...new Set(terms)].join('+');
  return 'unknown';
}

function sourceDate(signal: EvidenceSignal): string {
  if (signal.sourceDate) return signal.sourceDate.slice(0, 10);
  const fromEvidence = signal.evidenceId.match(/(?:^|[^0-9])((?:20|19)\d{2}-\d{2}-\d{2}|(?:20|19)\d{6})(?:[^0-9]|$)/);
  if (!fromEvidence) return 'unknown';
  const raw = fromEvidence[1];
  return raw.includes('-') ? raw : `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export function signalSlotGroupKey(signal: EvidenceSignal, slotId: string): SlotSignalGroupKey {
  return {
    slotId,
    normalizedEntityOrConcept: normalizedEntityOrConcept(signal),
    sourceEpisode: signal.sourceEpisode || signal.evidenceId.split('#')[0] || 'unknown',
    sourceDate: sourceDate(signal),
    role: signal.role,
  };
}

function groupSignals(slotId: string, signals: EvidenceSignal[]): SlotSignalGroup[] {
  const groups = new Map<string, SlotSignalGroup>();
  for (const signal of signals) {
    const key = signalSlotGroupKey(signal, slotId);
    const encoded = JSON.stringify(key);
    const existing = groups.get(encoded);
    if (existing) existing.signals.push(signal);
    else groups.set(encoded, { key, signals: [signal] });
  }
  return [...groups.values()].sort((a, b) =>
    a.key.slotId.localeCompare(b.key.slotId)
    || a.key.normalizedEntityOrConcept.localeCompare(b.key.normalizedEntityOrConcept)
    || a.key.sourceEpisode.localeCompare(b.key.sourceEpisode)
    || a.key.sourceDate.localeCompare(b.key.sourceDate)
    || a.key.role.localeCompare(b.key.role)
  );
}

export function signalFingerprint(signal: EvidenceSignal): string {
  return normalizeText(signal.text);
}

function confidenceRank(signal: EvidenceSignal): number {
  return signal.confidence === 'high' ? 0 : signal.confidence === 'medium' ? 1 : 2;
}

function stableSignalSort(a: EvidenceSignal, b: EvidenceSignal): number {
  return confidenceRank(a) - confidenceRank(b)
    || a.evidenceId.localeCompare(b.evidenceId)
    || a.localOrder - b.localOrder
    || a.text.localeCompare(b.text);
}

function slotSignalScore(signal: EvidenceSignal, slotId: string): number {
  let score = signal.score;
  if (slotId === 'incidents') {
    if (/\b(?:friction|toxic|incident|incidents|time[- ]policing|work[- ]expectation|work expectations|dread|fear|kid|kids|children|not told|didn't tell|did not tell)\b/i.test(signal.text)) score += 10;
    if (/\b(?:trust|thank|formative|meaningful|shaped|clarity|rigor|conviction|support|mentor|helped|valued)\b/i.test(signal.text)) score -= 15;
  }
  if (slotId === 'stack') {
    if (signal.role === 'protocol_item') score += 8;
    if (signal.kind === 'list_item' || signal.kind === 'bullet') score += 4;
    if (/\b(?:,|;| and | with | plus )\b/i.test(signal.text)) score += 3;
    if (/\b(?:why|because|due to|rationale|reason|fetal|maternal|clinical|operational|biomarker|measurement|marker|level|lab|window|score|count|growth)\b/i.test(signal.text)) score -= 8;
  }
  if (slotId === 'relationship_frame') {
    if (/\b(?:formative|trust|trusted|shaped|meaningful|support|helped|valued)\b/i.test(signal.text)) score += 5;
    if (/\b(?:why|because|rationale|reason|not clear|unclear|incumbent|zero lock-in)\b/i.test(signal.text)) score += 2;
  }
  if (slotId === 'rationale' || slotId === 'rationale_or_context') {
    if (/\b(?:why|because|not clear|unclear|incumbent|zero lock-in|zero network lock-in|reason|rationale|due to)\b/i.test(signal.text)) score += 6;
    if (/\b(?:formative|trust|trusted|shaped|meaningful)\b/i.test(signal.text)) score += 1;
  }
  if (slotId === 'later_state') {
    if (/\b(?:later|became|becomes|rides on|on top of|base rail|current target|current|module)\b/i.test(signal.text)) score += 12;
    if (/\b(?:not pursued|dropped|rejected|parked|move(?:d)? away|shift(?:ed)? away)\b/i.test(signal.text)) score -= 4;
  }
  return score;
}

export function clusterSignalsBySlot(signals: EvidenceSignal[], shape: AnswerShapeDef): SlotSignalCluster[] {
  const usable = signals.filter(signal => signal.role !== 'distractor');
  return shape.slots.map(slot => {
    const roles = ROLE_SLOT_MAP[slot.id] ?? [];
    const matched = usable.filter(signal => roles.includes(signal.role)).sort((a, b) => {
      const slotScoreDiff = slotSignalScore(b, slot.id) - slotSignalScore(a, slot.id);
      return slotScoreDiff || stableSignalSort(a, b);
    });
    const slotSignals = dedupe(matched);
    return { slotId: slot.id, title: slot.title, required: slot.required, aspects: slot.aspects, groups: groupSignals(slot.id, matched), signals: slotSignals };
  });
}

export function highOrMediumSignals(cluster: SlotSignalCluster): EvidenceSignal[] {
  return cluster.signals.filter(signal => signal.confidence === 'high' || signal.confidence === 'medium');
}
