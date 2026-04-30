import type { Namespace as EvalNamespace, PrivacyTier as EvalPrivacyTier } from './policy.ts';

export const EVAL_CLASS_DOMINANCE_LIMIT = 0.25;

export type EvalWorkflowType =
  | 'recall'
  | 'meeting_brief'
  | 'person_dossier'
  | 'project_pack'
  | 'topic_brief'
  | 'opportunity_eval'
  | 'decision_memo'
  | 'agent_handoff'
  | 'weekly_review'
  | 'scout'
  | 'radar'
  | 'governance';

export type EvalCaseMeta = {
  id: string;
  class: string;
  namespace: EvalNamespace;
  privacyTier: EvalPrivacyTier;
  visibleToImplementation: boolean;
  requiresAbstention: boolean;
  workflowType: EvalWorkflowType;
};

export type EvalPolicyViolation = {
  code:
    | 'empty_suite'
    | 'missing_required_field'
    | 'class_dominance'
    | 'missing_negative_or_abstention'
    | 'missing_holdout'
    | 'workflow_monoculture'
    | 'namespace_monoculture';
  message: string;
  details?: Record<string, unknown>;
};

export type EvalPolicyReport = {
  ok: boolean;
  total: number;
  classCounts: Record<string, number>;
  workflowCounts: Record<string, number>;
  namespaceCounts: Record<string, number>;
  hiddenCount: number;
  abstentionCount: number;
  violations: EvalPolicyViolation[];
};

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function missingRequiredFields(item: Partial<EvalCaseMeta>): string[] {
  const required: Array<keyof EvalCaseMeta> = ['id', 'class', 'namespace', 'privacyTier', 'visibleToImplementation', 'requiresAbstention', 'workflowType'];
  return required.filter(key => item[key] === undefined || item[key] === null || item[key] === '');
}

export function validateEvalPolicy(cases: Array<Partial<EvalCaseMeta>>, options: { dominanceLimit?: number } = {}): EvalPolicyReport {
  const dominanceLimit = options.dominanceLimit ?? EVAL_CLASS_DOMINANCE_LIMIT;
  const violations: EvalPolicyViolation[] = [];
  const classCounts: Record<string, number> = {};
  const workflowCounts: Record<string, number> = {};
  const namespaceCounts: Record<string, number> = {};

  if (cases.length === 0) {
    violations.push({ code: 'empty_suite', message: 'Eval suite must contain at least one case.' });
  }

  for (const item of cases) {
    const missing = missingRequiredFields(item);
    if (missing.length > 0) {
      violations.push({ code: 'missing_required_field', message: `Eval case ${item.id ?? '<unknown>'} is missing required metadata.`, details: { id: item.id, missing } });
      continue;
    }
    increment(classCounts, item.class!);
    increment(workflowCounts, item.workflowType!);
    increment(namespaceCounts, item.namespace!);
  }

  const totalWithClass = Object.values(classCounts).reduce((sum, count) => sum + count, 0);
  if (totalWithClass > 0) {
    for (const [className, count] of Object.entries(classCounts)) {
      const share = count / totalWithClass;
      if (share > dominanceLimit) {
        violations.push({
          code: 'class_dominance',
          message: `Eval class "${className}" is ${(share * 100).toFixed(1)}% of suite; limit is ${(dominanceLimit * 100).toFixed(1)}%.`,
          details: { className, count, total: totalWithClass, share, dominanceLimit },
        });
      }
    }
  }

  const abstentionCount = cases.filter(item => item.requiresAbstention === true || item.class === 'negative_abstention').length;
  if (cases.length > 0 && abstentionCount === 0) {
    violations.push({ code: 'missing_negative_or_abstention', message: 'Eval suite must include at least one negative or abstention case.' });
  }

  const hiddenCount = cases.filter(item => item.visibleToImplementation === false).length;
  if (cases.length >= 4 && hiddenCount === 0) {
    violations.push({ code: 'missing_holdout', message: 'Eval suites with 4+ cases must include at least one hidden/holdout case.' });
  }

  if (cases.length >= 4 && Object.keys(workflowCounts).length < 2) {
    violations.push({ code: 'workflow_monoculture', message: 'Eval suites with 4+ cases must include at least two workflow types.' });
  }

  if (cases.length >= 4 && Object.keys(namespaceCounts).length < 2) {
    violations.push({ code: 'namespace_monoculture', message: 'Eval suites with 4+ cases must include at least two namespaces.' });
  }

  return {
    ok: violations.length === 0,
    total: cases.length,
    classCounts,
    workflowCounts,
    namespaceCounts,
    hiddenCount,
    abstentionCount,
    violations,
  };
}
