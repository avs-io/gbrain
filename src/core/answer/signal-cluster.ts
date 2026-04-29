import type { AnswerShapeDef } from './synthesis-dsl.ts';
import type { EvidenceSignal, EvidenceSignalRole } from './evidence-classify.ts';

export interface SlotSignalCluster {
  slotId: string;
  title: string;
  required: boolean;
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
  stack: ['protocol_item', 'measurement'],
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

function confidenceRank(signal: EvidenceSignal): number {
  return signal.confidence === 'high' ? 0 : signal.confidence === 'medium' ? 1 : 2;
}

function stableSignalSort(a: EvidenceSignal, b: EvidenceSignal): number {
  return confidenceRank(a) - confidenceRank(b)
    || a.sourceOrder - b.sourceOrder
    || a.localOrder - b.localOrder
    || a.text.localeCompare(b.text);
}

export function clusterSignalsBySlot(signals: EvidenceSignal[], shape: AnswerShapeDef): SlotSignalCluster[] {
  const usable = signals.filter(signal => signal.role !== 'distractor');
  return shape.slots.map(slot => {
    const roles = ROLE_SLOT_MAP[slot.id] ?? [];
    const matched = usable.filter(signal => roles.includes(signal.role)).sort(stableSignalSort);
    return { slotId: slot.id, title: slot.title, required: slot.required, signals: dedupe(matched) };
  });
}

export function highOrMediumSignals(cluster: SlotSignalCluster): EvidenceSignal[] {
  return cluster.signals.filter(signal => signal.confidence === 'high' || signal.confidence === 'medium');
}
