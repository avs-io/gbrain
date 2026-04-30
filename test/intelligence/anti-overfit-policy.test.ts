import { describe, expect, test } from 'bun:test';
import { validateEvalPolicy, type EvalCaseMeta } from '../../src/core/intelligence/eval-policy.ts';

const balancedCases: EvalCaseMeta[] = [
  { id: 'recall-archana-visible', class: 'autobiographical_recall', namespace: 'personal', privacyTier: 'P1_PRIVATE', visibleToImplementation: true, requiresAbstention: false, workflowType: 'recall' },
  { id: 'project-sovereign-ai-visible', class: 'project_lineage', namespace: 'project', privacyTier: 'P1_PRIVATE', visibleToImplementation: true, requiresAbstention: false, workflowType: 'project_pack' },
  { id: 'world-policy-holdout', class: 'world_intelligence', namespace: 'world', privacyTier: 'P3_PUBLIC', visibleToImplementation: false, requiresAbstention: false, workflowType: 'scout' },
  { id: 'radar-old-idea-visible', class: 'opportunity_radar', namespace: 'project', privacyTier: 'P2_LIMITED_CLOUD', visibleToImplementation: true, requiresAbstention: false, workflowType: 'radar' },
  { id: 'meeting-network-visible', class: 'meeting_brief', namespace: 'network', privacyTier: 'P1_PRIVATE', visibleToImplementation: true, requiresAbstention: false, workflowType: 'meeting_brief' },
  { id: 'health-abstain-holdout', class: 'negative_abstention', namespace: 'personal', privacyTier: 'P0_LOCAL_ONLY', visibleToImplementation: false, requiresAbstention: true, workflowType: 'recall' },
];

describe('intelligence substrate anti-overfit eval policy', () => {
  test('accepts a suite distributed across workflows, namespaces, holdouts, and abstentions', () => {
    const report = validateEvalPolicy(balancedCases);
    expect(report.ok).toBe(true);
    expect(report.hiddenCount).toBe(2);
    expect(report.abstentionCount).toBe(1);
    expect(Object.keys(report.workflowCounts).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(report.namespaceCounts).length).toBeGreaterThanOrEqual(2);
  });

  test('rejects suites dominated by one recall class', () => {
    const dominated: EvalCaseMeta[] = [
      { id: 'r1', class: 'autobiographical_recall', namespace: 'personal', privacyTier: 'P1_PRIVATE', visibleToImplementation: true, requiresAbstention: false, workflowType: 'recall' },
      { id: 'r2', class: 'autobiographical_recall', namespace: 'personal', privacyTier: 'P1_PRIVATE', visibleToImplementation: true, requiresAbstention: false, workflowType: 'recall' },
      { id: 'r3', class: 'autobiographical_recall', namespace: 'personal', privacyTier: 'P1_PRIVATE', visibleToImplementation: true, requiresAbstention: false, workflowType: 'recall' },
      { id: 'n1', class: 'negative_abstention', namespace: 'personal', privacyTier: 'P0_LOCAL_ONLY', visibleToImplementation: false, requiresAbstention: true, workflowType: 'recall' },
    ];

    const report = validateEvalPolicy(dominated);
    expect(report.ok).toBe(false);
    expect(report.violations.some(v => v.code === 'class_dominance')).toBe(true);
    expect(report.violations.some(v => v.code === 'workflow_monoculture')).toBe(true);
    expect(report.violations.some(v => v.code === 'namespace_monoculture')).toBe(true);
  });

  test('rejects suites with no negative or abstention cases', () => {
    const report = validateEvalPolicy(balancedCases.map(item => ({ ...item, class: item.class === 'negative_abstention' ? 'health_family' : item.class, requiresAbstention: false })));
    expect(report.ok).toBe(false);
    expect(report.violations.some(v => v.code === 'missing_negative_or_abstention')).toBe(true);
  });

  test('rejects eval cases missing required metadata', () => {
    const report = validateEvalPolicy([{ id: 'incomplete', class: 'project_lineage' }]);
    expect(report.ok).toBe(false);
    expect(report.violations.some(v => v.code === 'missing_required_field')).toBe(true);
  });
});
