/**
 * PR4: Namespace-aware recall filter.
 *
 * Applies namespace/privacy/sensitivity constraints to recall results.
 * Used by the recall path to exclude pages that don't match the
 * caller's access policy (e.g. a world-facing query should not
 * surface personal/private/high-sensitivity pages).
 *
 * This module is intentionally minimal: it only filters, never
 * writes. The filter is opt-in — recall without a filter behaves
 * exactly as before.
 */

import { classifyNamespacePolicy, type GBrainNamespace, type GBrainPrivacy, type GBrainSensitivity } from '../memory/namespace-policy.ts';

export interface NamespaceFilter {
  /** Namespaces whose pages are included. Empty = include all. */
  allowedNamespaces: GBrainNamespace[];
  /** Maximum privacy level to include. 'confidential' = include all. */
  maxPrivacy: GBrainPrivacy;
  /** Maximum sensitivity level to include. 'restricted' = include all. */
  maxSensitivity: GBrainSensitivity;
}

const defaultFilter: NamespaceFilter = {
  allowedNamespaces: ['world', 'ventures'],
  maxPrivacy: 'internal',
  maxSensitivity: 'medium',
};

/**
 * Check whether a page row (identified by namespace/privacy/sensitivity)
 * passes the filter. Returns true if the page should be included in
 * recall results, false if it should be filtered out.
 */
export function namespaceFilterPasses(
  row: { namespace?: GBrainNamespace; privacy?: GBrainPrivacy; sensitivity?: GBrainSensitivity },
  filter: NamespaceFilter = defaultFilter,
): boolean {
  const policy = classifyNamespacePolicy({
    namespace: row.namespace,
    privacy: row.privacy,
    sensitivity: row.sensitivity,
  });

  // Check namespace inclusion
  if (filter.allowedNamespaces.length > 0 && !filter.allowedNamespaces.includes(policy.namespace)) {
    return false;
  }

  // Check privacy: deny if page privacy exceeds filter max
  const privacyOrder: GBrainPrivacy[] = ['public', 'internal', 'private', 'confidential'];
  const maxIdx = privacyOrder.indexOf(filter.maxPrivacy);
  const pageIdx = privacyOrder.indexOf(policy.privacy);
  if (pageIdx > maxIdx) {
    return false;
  }

  // Check sensitivity: deny if page sensitivity exceeds filter max
  const sensitivityOrder: GBrainSensitivity[] = ['low', 'medium', 'high', 'restricted'];
  const maxSensIdx = sensitivityOrder.indexOf(filter.maxSensitivity);
  const pageSensIdx = sensitivityOrder.indexOf(policy.sensitivity);
  if (pageSensIdx > maxSensIdx) {
    return false;
  }

  return true;
}

/**
 * Filter a list of page rows by namespace policy.
 * Returns only rows that pass the filter.
 */
export function filterByNamespace(
  rows: Array<Record<string, unknown>>,
  filter: NamespaceFilter = defaultFilter,
): Array<Record<string, unknown>> {
  return rows.filter(row => {
    const ns = (row._namespace as GBrainNamespace | undefined)
      || (row.namespace as GBrainNamespace | undefined);
    const pr = (row._privacy as GBrainPrivacy | undefined)
      || (row.privacy as GBrainPrivacy | undefined);
    const se = (row._sensitivity as GBrainSensitivity | undefined)
      || (row.sensitivity as GBrainSensitivity | undefined);
    return namespaceFilterPasses(
      { namespace: ns, privacy: pr, sensitivity: se },
      filter,
    );
  });
}

/**
 * Get the default filter for a query type.
 * - 'world' queries: world, ventures, evals, scouts (no personal/network/actions)
 * - 'personal' queries: personal, network, ventures (includes private content)
 * - 'all' queries: all namespaces (admin/reviewer only)
 */
export function defaultFilterForQueryType(queryType: 'world' | 'personal' | 'all'): NamespaceFilter {
  switch (queryType) {
    case 'world':
      return {
        allowedNamespaces: ['world', 'ventures', 'scouts', 'evals'],
        maxPrivacy: 'internal',
        maxSensitivity: 'medium',
      };
    case 'personal':
      return {
        allowedNamespaces: ['personal', 'ventures', 'network', 'scouts', 'evals'],
        maxPrivacy: 'private',
        maxSensitivity: 'high',
      };
    case 'all':
      return {
        allowedNamespaces: ['personal', 'ventures', 'world', 'network', 'scouts', 'actions', 'evals'],
        maxPrivacy: 'confidential',
        maxSensitivity: 'restricted',
      };
  }
}
