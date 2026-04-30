import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateEvalPolicy, type EvalCaseMeta, type EvalWorkflowType } from '../intelligence/eval-policy.ts';

export type WorkflowEvalSplit = 'visible' | 'holdout' | 'mutation';

export type WorkflowEvalMeta = EvalCaseMeta & {
  split: WorkflowEvalSplit;
  mutationOf?: string;
};

export type WorkflowEvalCase = {
  id: string;
  meta: WorkflowEvalMeta;
  prompt: string;
  fixture: {
    summary: string;
    evidenceRefs: string[];
    observedAt: string;
    route?: { providerKind?: 'local' | 'cloud' | string; rawPrivateContext?: boolean };
    mutation?: string;
  };
  expected: {
    abstain: boolean;
    requiredEvidenceRefs: string[];
    requiredTerms: string[];
    forbiddenTerms: string[];
    cloudAllowed: boolean;
    privacyFailClosed: boolean;
  };
};

export type WorkflowEvalSuite = {
  schema: 'gbrain.workflow_eval_suite.v1';
  description: string;
  cases: WorkflowEvalCase[];
};

export type WorkflowEvalFailure = { case_id: string; reasons: string[] };

export type WorkflowEvalReport = {
  schema: 'gbrain.workflow_eval_report.v1';
  ok: boolean;
  suite_total: number;
  evaluated: number;
  pass_count: number;
  fail_count: number;
  class_counts: Record<string, number>;
  workflow_counts: Record<string, number>;
  split_counts: Record<string, number>;
  abstention_count: number;
  world_intelligence_count: number;
  context_pack_count: number;
  radar_count: number;
  policy_violations: string[];
  failures: WorkflowEvalFailure[];
};

export type WorkflowEvalFilter = {
  classes?: string[];
  workflowTypes?: EvalWorkflowType[];
  privacyOnly?: boolean;
};

const DEFAULT_SUITE_PATH = join(process.cwd(), 'data/evals/workflow-suite.json');

function countBy<T extends string>(values: T[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

export function loadWorkflowEvalSuite(path = DEFAULT_SUITE_PATH): WorkflowEvalSuite {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as WorkflowEvalSuite;
  if (parsed.schema !== 'gbrain.workflow_eval_suite.v1') throw new Error(`Invalid workflow eval suite schema: ${parsed.schema}`);
  return parsed;
}

export function validateWorkflowEvalSuite(suite: WorkflowEvalSuite): string[] {
  const violations = validateEvalPolicy(suite.cases.map(c => c.meta)).violations.map(v => `${v.code}: ${v.message}`);
  if (suite.cases.length !== 50) violations.push(`suite_size: expected 50 cases, got ${suite.cases.length}`);
  const splits = countBy(suite.cases.map(c => c.meta.split));
  if (splits.visible !== 35) violations.push(`split_visible: expected 35 visible cases, got ${splits.visible ?? 0}`);
  if (splits.holdout !== 10) violations.push(`split_holdout: expected 10 holdout cases, got ${splits.holdout ?? 0}`);
  if (splits.mutation !== 5) violations.push(`split_mutation: expected 5 mutation cases, got ${splits.mutation ?? 0}`);
  const negative = suite.cases.filter(c => c.meta.requiresAbstention || c.meta.class === 'negative_abstention').length;
  if (negative < 10) violations.push(`negative_abstention: expected at least 10, got ${negative}`);
  const world = suite.cases.filter(c => c.meta.class === 'world_intelligence' || c.meta.class === 'topic_state' || c.meta.namespace === 'world').length;
  if (world < 10) violations.push(`world_intelligence: expected at least 10, got ${world}`);
  const context = suite.cases.filter(c => ['project_pack', 'meeting_brief', 'opportunity_eval', 'agent_handoff'].includes(c.meta.workflowType)).length;
  if (context < 8) violations.push(`context_pack: expected at least 8, got ${context}`);
  const radar = suite.cases.filter(c => c.meta.workflowType === 'radar' || c.meta.class === 'opportunity_radar').length;
  if (radar < 5) violations.push(`radar: expected at least 5, got ${radar}`);
  return violations;
}

function caseMatches(c: WorkflowEvalCase, filter: WorkflowEvalFilter): boolean {
  if (filter.privacyOnly) return c.meta.privacyTier === 'P0_LOCAL_ONLY' || c.meta.privacyTier === 'P1_PRIVATE' || c.expected.privacyFailClosed;
  if (filter.classes?.length && !filter.classes.includes(c.meta.class)) return false;
  if (filter.workflowTypes?.length && !filter.workflowTypes.includes(c.meta.workflowType)) return false;
  return true;
}

export function evaluateWorkflowCase(c: WorkflowEvalCase): WorkflowEvalFailure | null {
  const reasons: string[] = [];
  const evidence = c.fixture.evidenceRefs ?? [];
  if (c.expected.abstain) {
    if (!c.meta.requiresAbstention && c.meta.class !== 'negative_abstention') reasons.push('expected abstention case lacks abstention metadata');
    if (c.expected.requiredEvidenceRefs.length > 0) reasons.push('abstention case must not require evidence refs');
  } else {
    for (const ref of c.expected.requiredEvidenceRefs) if (!evidence.includes(ref)) reasons.push(`missing required evidence ref ${ref}`);
    if (evidence.length === 0) reasons.push('non-abstention case has no fixture evidence');
  }
  if (c.meta.split === 'mutation' && !c.meta.mutationOf) reasons.push('mutation case missing mutationOf metadata');
  if (c.meta.privacyTier === 'P0_LOCAL_ONLY' && c.fixture.route?.providerKind === 'cloud') reasons.push('P0 case routed to cloud');
  if (c.meta.privacyTier === 'P1_PRIVATE' && c.fixture.route?.providerKind === 'cloud' && c.fixture.route?.rawPrivateContext) reasons.push('P1 raw private context routed to cloud');
  if (!c.expected.cloudAllowed && c.fixture.route?.providerKind === 'cloud') reasons.push('case expected cloud denial but fixture route uses cloud');
  if (c.expected.privacyFailClosed && c.meta.privacyTier === 'P0_LOCAL_ONLY' && c.expected.cloudAllowed) reasons.push('privacy fail-closed case allowed cloud');
  return reasons.length ? { case_id: c.id, reasons } : null;
}

export function runWorkflowEval(filter: WorkflowEvalFilter = {}, suite = loadWorkflowEvalSuite()): WorkflowEvalReport {
  const suiteViolations = validateWorkflowEvalSuite(suite);
  const selected = suite.cases.filter(c => caseMatches(c, filter));
  const failures = selected.map(evaluateWorkflowCase).filter((x): x is WorkflowEvalFailure => Boolean(x));
  const negative = suite.cases.filter(c => c.meta.requiresAbstention || c.meta.class === 'negative_abstention').length;
  const world = suite.cases.filter(c => c.meta.class === 'world_intelligence' || c.meta.class === 'topic_state' || c.meta.namespace === 'world').length;
  const context = suite.cases.filter(c => ['project_pack', 'meeting_brief', 'opportunity_eval', 'agent_handoff'].includes(c.meta.workflowType)).length;
  const radar = suite.cases.filter(c => c.meta.workflowType === 'radar' || c.meta.class === 'opportunity_radar').length;
  return {
    schema: 'gbrain.workflow_eval_report.v1',
    ok: suiteViolations.length === 0 && failures.length === 0 && selected.length > 0,
    suite_total: suite.cases.length,
    evaluated: selected.length,
    pass_count: selected.length - failures.length,
    fail_count: failures.length,
    class_counts: countBy(suite.cases.map(c => c.meta.class)),
    workflow_counts: countBy(suite.cases.map(c => c.meta.workflowType)),
    split_counts: countBy(suite.cases.map(c => c.meta.split)),
    abstention_count: negative,
    world_intelligence_count: world,
    context_pack_count: context,
    radar_count: radar,
    policy_violations: suiteViolations,
    failures,
  };
}
