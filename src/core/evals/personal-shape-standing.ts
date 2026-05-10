export const PERSONAL_SHAPE_CATEGORIES = [
  'opportunity_decision',
  'relationship_context',
  'venture_strategy',
  'family_values_boundary',
  'pushback',
  'style_rendering',
] as const;

export const PERSONAL_SHAPE_SCORE_DIMENSIONS = [
  'correctness',
  'candor',
  'non_sycophancy',
  'alignment',
  'actionability',
  'abstention',
  'style_fidelity',
] as const;

export type PersonalShapeCategory = (typeof PERSONAL_SHAPE_CATEGORIES)[number];
export type PersonalShapeScoreDimension = (typeof PERSONAL_SHAPE_SCORE_DIMENSIONS)[number];

export type PersonalShapeStandingCase = {
  id: string;
  category: PersonalShapeCategory;
  prompt: string;
  source_context_pack_id: string;
  source_evidence_span_ids: string[];
  expected_behavior_tags: string[];
  score_dimensions: Record<PersonalShapeScoreDimension, boolean>;
  expected_abstain: boolean;
  corpus_scope: 'behavior_style_not_fact_memory';
  reviewed: boolean;
  eligible_for_trusted_memory: false;
};

export type PersonalShapeStandingReport = {
  ok: boolean;
  total: number;
  category_counts: Record<PersonalShapeCategory, number>;
  missing_categories: string[];
  issues: string[];
};

export function validatePersonalShapeStandingSet(cases: PersonalShapeStandingCase[], minPerCategory = 50): PersonalShapeStandingReport {
  const counts = Object.fromEntries(PERSONAL_SHAPE_CATEGORIES.map(category => [category, 0])) as Record<PersonalShapeCategory, number>;
  const issues: string[] = [];
  const ids = new Set<string>();

  cases.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      issues.push(`cases[${index}]: must be object`);
      return;
    }
    if (!item.id || ids.has(item.id)) issues.push(`cases[${index}].id missing or duplicate`);
    ids.add(item.id);
    if (!PERSONAL_SHAPE_CATEGORIES.includes(item.category)) issues.push(`${item.id}: invalid category`);
    else counts[item.category] += 1;
    if (!item.source_context_pack_id) issues.push(`${item.id}: missing source_context_pack_id`);
    if (!Array.isArray(item.source_evidence_span_ids) || item.source_evidence_span_ids.length === 0 || item.source_evidence_span_ids.some(id => !id.startsWith('gbs1:'))) issues.push(`${item.id}: evidence spans must be real gbs1 ids`);
    if (!Array.isArray(item.expected_behavior_tags) || item.expected_behavior_tags.length === 0) issues.push(`${item.id}: missing behavior tags`);
    if (item.corpus_scope !== 'behavior_style_not_fact_memory') issues.push(`${item.id}: corpus_scope must remain behavior/style, not fact memory`);
    if (item.reviewed !== true) issues.push(`${item.id}: must be reviewed`);
    if (item.eligible_for_trusted_memory !== false) issues.push(`${item.id}: must not be trusted memory`);
    for (const dimension of PERSONAL_SHAPE_SCORE_DIMENSIONS) {
      if (item.score_dimensions?.[dimension] !== true) issues.push(`${item.id}: missing score dimension ${dimension}`);
    }
  });

  const missing = PERSONAL_SHAPE_CATEGORIES.filter(category => counts[category] < minPerCategory);
  for (const category of missing) issues.push(`${category}: only ${counts[category]} cases; expected >=${minPerCategory}`);
  return { ok: issues.length === 0, total: cases.length, category_counts: counts, missing_categories: missing, issues };
}

export type DecisionStyleCorpusCase = {
  id: string;
  source_context_pack_id: string;
  source_evidence_span_ids: string[];
  output_kind: 'decision_memo' | 'opportunity_score' | 'pushback' | 'style_rendering';
  prompt: string;
  expected_behavior_tags: string[];
  reviewed_by: string;
  corpus_scope: 'behavior_style_not_fact_memory';
  eligible_for_trusted_memory: false;
};

export function validateDecisionStyleCorpus(cases: DecisionStyleCorpusCase[]): string[] {
  const issues: string[] = [];
  const outputKinds = new Set<DecisionStyleCorpusCase['output_kind']>();
  for (const [index, item] of cases.entries()) {
    if (!item.id) issues.push(`cases[${index}].id missing`);
    if (!item.source_context_pack_id) issues.push(`${item.id}: missing source_context_pack_id`);
    if (!Array.isArray(item.source_evidence_span_ids) || item.source_evidence_span_ids.length === 0 || item.source_evidence_span_ids.some(id => !id.startsWith('gbs1:'))) issues.push(`${item.id}: evidence spans must be real gbs1 ids`);
    if (!['decision_memo', 'opportunity_score', 'pushback', 'style_rendering'].includes(item.output_kind)) issues.push(`${item.id}: invalid output_kind`);
    else outputKinds.add(item.output_kind);
    if (!item.reviewed_by) issues.push(`${item.id}: missing reviewer`);
    if (item.corpus_scope !== 'behavior_style_not_fact_memory') issues.push(`${item.id}: corpus scope must not be fact memory`);
    if (item.eligible_for_trusted_memory !== false) issues.push(`${item.id}: must not be trusted memory`);
  }
  for (const required of ['decision_memo', 'opportunity_score', 'pushback'] as const) {
    if (!outputKinds.has(required)) issues.push(`missing output kind ${required}`);
  }
  return issues;
}
