export const PREFERENCE_DECISION_EVALUATOR_SCHEMA = 'gbrain.preference_decision_evaluator.v1' as const;

export type PreferenceSignalClass =
  | 'mission_leverage'
  | 'family_values'
  | 'relationship_context'
  | 'venture_strategy'
  | 'world_intelligence'
  | 'operational_noise'
  | 'unclear';

export type PreferenceNextActionClass = 'interrupt' | 'review_today' | 'queue' | 'archive' | 'ask_for_human_judgment';

export interface PreferenceDecisionInput {
  text: string;
  evidence_span_ids?: string[];
  source?: 'memory' | 'public_signal' | 'operator_note' | 'synthetic_eval';
  generatedAt?: string | Date;
  feedback_examples?: Array<{ text: string; cared: boolean; next_action?: PreferenceNextActionClass }>;
}

export interface PreferenceDecisionEvaluation {
  schema: typeof PREFERENCE_DECISION_EVALUATOR_SCHEMA;
  generated_at: string;
  signal_class: PreferenceSignalClass;
  next_action_class: PreferenceNextActionClass;
  scores: {
    would_care: number;
    sovereignty_alignment: number;
    leverage_alignment: number;
    family_alignment: number;
    mission_alignment: number;
    actionability: number;
    evidence_confidence: number;
    total: number;
  };
  reasons: string[];
  guardrails: {
    deterministic: true;
    model_api_calls: false;
    external_action: false;
    trusted_memory_write: false;
    facts_require_evidence_for_high_confidence: true;
  };
}

function toIso(value: string | Date | undefined): string {
  if (!value) return new Date().toISOString();
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, Number(n.toFixed(3))));
}

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function scoreMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
}

const sovereignty = [/\bsovereign(?:ty)?\b/i, /\bindependent\b/i, /\bowned rails?\b/i, /\bprivate\b/i, /\blocal\b/i, /\bcontrol\b/i];
const leverage = [/\bleverage\b/i, /\bcompound(?:ing)?\b/i, /\bautomation\b/i, /\bagent\b/i, /\bworker\b/i, /\bscale\b/i, /\b10x\b/i];
const family = [/\bfamily\b/i, /\bparent(?:s)?\b/i, /\bhealth\b/i, /\bboundar(?:y|ies)\b/i, /\bvalues?\b/i];
const mission = [/\bmission\b/i, /\bpotential\b/i, /\bfrontier\b/i, /\bnew paradigm\b/i, /\bworld intelligence\b/i, /\bmemory kernel\b/i];
const action = [/\bdeadline\b/i, /\btoday\b/i, /\bnow\b/i, /\bnext action\b/i, /\bship\b/i, /\bblock(?:er|ed)?\b/i, /\bdecision\b/i];

function classify(text: string, scores: Pick<PreferenceDecisionEvaluation['scores'], 'sovereignty_alignment' | 'leverage_alignment' | 'family_alignment' | 'mission_alignment'>): PreferenceSignalClass {
  if (has(text, /\b(?:noise|low value|spam|routine|FYI only)\b/i)) return 'operational_noise';
  if (scores.family_alignment >= 0.4) return 'family_values';
  if (has(text, /\b(?:venture|startup|eonic|sovereign ai|product|customer|market|pilot)\b/i)) return 'venture_strategy';
  if (has(text, /\b(?:relationship|person|network|meeting|intro|trust)\b/i)) return 'relationship_context';
  if (has(text, /\b(?:competitor|paper|policy|regulation|market|research|public|scout)\b/i)) return 'world_intelligence';
  if (scores.sovereignty_alignment + scores.leverage_alignment + scores.mission_alignment >= 0.9) return 'mission_leverage';
  return 'unclear';
}

function nextAction(total: number, actionability: number, evidenceConfidence: number, signalClass: PreferenceSignalClass): PreferenceNextActionClass {
  if (signalClass === 'operational_noise' || total < 0.18) return 'archive';
  if (evidenceConfidence < 0.5 && (total >= 0.32 || actionability >= 0.3)) return 'ask_for_human_judgment';
  if (total >= 0.72 && actionability >= 0.5 && evidenceConfidence >= 0.5) return 'interrupt';
  if (total >= 0.45 || actionability >= 0.5) return 'review_today';
  return 'queue';
}

export function evaluatePreferenceDecision(input: PreferenceDecisionInput): PreferenceDecisionEvaluation {
  const text = String(input.text || '').trim();
  if (!text) throw new Error('text is required');
  const evidenceSpanIds = input.evidence_span_ids || [];
  const evidenceConfidence = evidenceSpanIds.some(id => id.startsWith('gbs1:')) ? 1 : input.source === 'synthetic_eval' ? 0.25 : 0.45;

  const sovereigntyScore = clamp(scoreMatches(text, sovereignty) / 3);
  const leverageScore = clamp(scoreMatches(text, leverage) / 3);
  const familyScore = clamp(scoreMatches(text, family) / 2);
  const missionScore = clamp(scoreMatches(text, mission) / 3);
  const actionability = clamp(scoreMatches(text, action) / 3);
  const feedbackBoost = clamp((input.feedback_examples || []).filter(example => example.cared && text.toLowerCase().includes(example.text.toLowerCase().slice(0, 24))).length * 0.1);

  const wouldCare = clamp((sovereigntyScore * 0.22) + (leverageScore * 0.24) + (familyScore * 0.18) + (missionScore * 0.22) + (actionability * 0.14) + feedbackBoost);
  const signalClass = classify(text, {
    sovereignty_alignment: sovereigntyScore,
    leverage_alignment: leverageScore,
    family_alignment: familyScore,
    mission_alignment: missionScore,
  });
  const total = clamp((wouldCare * 0.65) + (evidenceConfidence * 0.2) + (actionability * 0.15));
  const next_action_class = nextAction(total, actionability, evidenceConfidence, signalClass);
  const reasons: string[] = [];
  if (sovereigntyScore > 0) reasons.push('sovereignty/control signal');
  if (leverageScore > 0) reasons.push('leverage/compounding signal');
  if (familyScore > 0) reasons.push('family/values signal');
  if (missionScore > 0) reasons.push('mission/frontier signal');
  if (actionability > 0) reasons.push('actionable/decision-timed signal');
  if (evidenceConfidence < 0.5) reasons.push('low evidence confidence prevents high-confidence action');
  if (signalClass === 'operational_noise') reasons.push('classified as low-value operational noise');

  return {
    schema: PREFERENCE_DECISION_EVALUATOR_SCHEMA,
    generated_at: toIso(input.generatedAt),
    signal_class: signalClass,
    next_action_class,
    scores: {
      would_care: wouldCare,
      sovereignty_alignment: sovereigntyScore,
      leverage_alignment: leverageScore,
      family_alignment: familyScore,
      mission_alignment: missionScore,
      actionability,
      evidence_confidence: evidenceConfidence,
      total,
    },
    reasons,
    guardrails: {
      deterministic: true,
      model_api_calls: false,
      external_action: false,
      trusted_memory_write: false,
      facts_require_evidence_for_high_confidence: true,
    },
  };
}

export function validatePreferenceDecisionEvaluation(value: unknown): string[] {
  const errors: string[] = [];
  const obj = value as PreferenceDecisionEvaluation;
  if (!obj || typeof obj !== 'object') return ['evaluation must be an object'];
  if (obj.schema !== PREFERENCE_DECISION_EVALUATOR_SCHEMA) errors.push(`schema must be ${PREFERENCE_DECISION_EVALUATOR_SCHEMA}`);
  if (typeof obj.generated_at !== 'string' || Number.isNaN(Date.parse(obj.generated_at))) errors.push('generated_at must be ISO-like');
  if (!['mission_leverage', 'family_values', 'relationship_context', 'venture_strategy', 'world_intelligence', 'operational_noise', 'unclear'].includes(obj.signal_class)) errors.push('signal_class is invalid');
  if (!['interrupt', 'review_today', 'queue', 'archive', 'ask_for_human_judgment'].includes(obj.next_action_class)) errors.push('next_action_class is invalid');
  for (const [key, score] of Object.entries(obj.scores || {})) {
    if (typeof score !== 'number' || score < 0 || score > 1) errors.push(`scores.${key} must be between 0 and 1`);
  }
  if (!Array.isArray(obj.reasons)) errors.push('reasons must be an array');
  if (obj.guardrails?.model_api_calls !== false) errors.push('guardrails.model_api_calls must be false');
  if (obj.guardrails?.external_action !== false) errors.push('guardrails.external_action must be false');
  if (obj.guardrails?.trusted_memory_write !== false) errors.push('guardrails.trusted_memory_write must be false');
  return errors;
}
