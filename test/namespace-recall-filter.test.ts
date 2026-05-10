import { test, expect } from 'bun:test';
import {
  namespaceFilterPasses,
  filterByNamespace,
  defaultFilterForQueryType,
  type NamespaceFilter,
} from '../src/core/evidence/namespace-recall-filter.ts';
import type { GBrainNamespace, GBrainPrivacy, GBrainSensitivity } from '../src/core/memory/namespace-policy.ts';

// --- namespaceFilterPasses unit tests ---

test('PR4 namespace recall filter > default filter excludes personal', () => {
  const filter = defaultFilterForQueryType('world');
  const passes = namespaceFilterPasses(
    { namespace: 'personal', privacy: 'private', sensitivity: 'high' },
    filter,
  );
  expect(passes).toBe(false);
});

test('PR4 namespace recall filter > default filter includes world', () => {
  const filter = defaultFilterForQueryType('world');
  const passes = namespaceFilterPasses(
    { namespace: 'world', privacy: 'public', sensitivity: 'low' },
    filter,
  );
  expect(passes).toBe(true);
});

test('PR4 namespace recall filter > default filter includes ventures', () => {
  const filter = defaultFilterForQueryType('world');
  const passes = namespaceFilterPasses(
    { namespace: 'ventures', privacy: 'internal', sensitivity: 'medium' },
    filter,
  );
  expect(passes).toBe(true);
});

test('PR4 namespace recall filter > default filter excludes network', () => {
  const filter = defaultFilterForQueryType('world');
  const passes = namespaceFilterPasses(
    { namespace: 'network', privacy: 'private', sensitivity: 'high' },
    filter,
  );
  expect(passes).toBe(false);
});

test('PR4 namespace recall filter > default filter excludes actions', () => {
  const filter = defaultFilterForQueryType('world');
  const passes = namespaceFilterPasses(
    { namespace: 'actions', privacy: 'private', sensitivity: 'high' },
    filter,
  );
  expect(passes).toBe(false);
});

test('PR4 namespace recall filter > default filter includes scouts', () => {
  const filter = defaultFilterForQueryType('world');
  const passes = namespaceFilterPasses(
    { namespace: 'scouts', privacy: 'public', sensitivity: 'low' },
    filter,
  );
  expect(passes).toBe(true);
});

test('PR4 namespace recall filter > default filter includes evals', () => {
  const filter = defaultFilterForQueryType('world');
  const passes = namespaceFilterPasses(
    { namespace: 'evals', privacy: 'public', sensitivity: 'low' },
    filter,
  );
  expect(passes).toBe(true);
});

test('PR4 namespace recall filter > high sensitivity blocked by default filter', () => {
  const filter = defaultFilterForQueryType('world');
  // world+internal+high is valid (high sensitivity but not public)
  const passes = namespaceFilterPasses(
    { namespace: 'world', privacy: 'internal', sensitivity: 'high' },
    filter,
  );
  expect(passes).toBe(false);
});

test('PR4 namespace recall filter > confidential privacy blocked by default filter', () => {
  const filter = defaultFilterForQueryType('world');
  const passes = namespaceFilterPasses(
    { namespace: 'ventures', privacy: 'confidential', sensitivity: 'high' },
    filter,
  );
  expect(passes).toBe(false);
});

test('PR4 namespace recall filter > personal filter includes personal', () => {
  const filter = defaultFilterForQueryType('personal');
  const passes = namespaceFilterPasses(
    { namespace: 'personal', privacy: 'private', sensitivity: 'high' },
    filter,
  );
  expect(passes).toBe(true);
});

test('PR4 namespace recall filter > personal filter includes network', () => {
  const filter = defaultFilterForQueryType('personal');
  const passes = namespaceFilterPasses(
    { namespace: 'network', privacy: 'private', sensitivity: 'high' },
    filter,
  );
  expect(passes).toBe(true);
});

test('PR4 namespace recall filter > personal filter excludes actions', () => {
  const filter = defaultFilterForQueryType('personal');
  const passes = namespaceFilterPasses(
    { namespace: 'actions', privacy: 'private', sensitivity: 'high' },
    filter,
  );
  expect(passes).toBe(false);
});

test('PR4 namespace recall filter > all filter includes everything', () => {
  const filter = defaultFilterForQueryType('all');
  const passes = namespaceFilterPasses(
    { namespace: 'personal', privacy: 'confidential', sensitivity: 'restricted' },
    filter,
  );
  expect(passes).toBe(true);
});

test('PR4 namespace recall filter > empty allowedNamespaces includes all namespaces', () => {
  const filter: NamespaceFilter = {
    allowedNamespaces: [],
    maxPrivacy: 'confidential',
    maxSensitivity: 'restricted',
  };
  const passes = namespaceFilterPasses(
    { namespace: 'personal', privacy: 'confidential', sensitivity: 'restricted' },
    filter,
  );
  expect(passes).toBe(true);
});

test('PR4 namespace recall filter > undefined namespace defaults to personal (conservative)', () => {
  const filter = defaultFilterForQueryType('world');
  // undefined namespace defaults to 'personal' via conservativeNamespacePolicyDefaults
  // personal+private+high is valid but personal is excluded by default filter
  const passes = namespaceFilterPasses(
    { privacy: 'private', sensitivity: 'high' },
    filter,
  );
  expect(passes).toBe(false);
});

// --- filterByNamespace integration test ---

test('PR4 namespace recall filter > filterByNamespace removes excluded pages', () => {
  const filter = defaultFilterForQueryType('world');
  const rows = [
    { slug: 'world/page1', _namespace: 'world' as GBrainNamespace, _privacy: 'public' as GBrainPrivacy, _sensitivity: 'low' as GBrainSensitivity },
    { slug: 'personal/page1', _namespace: 'personal' as GBrainNamespace, _privacy: 'private' as GBrainPrivacy, _sensitivity: 'high' as GBrainSensitivity },
    { slug: 'ventures/page1', _namespace: 'ventures' as GBrainNamespace, _privacy: 'internal' as GBrainPrivacy, _sensitivity: 'medium' as GBrainSensitivity },
    { slug: 'network/page1', _namespace: 'network' as GBrainNamespace, _privacy: 'private' as GBrainPrivacy, _sensitivity: 'high' as GBrainSensitivity },
  ];
  const filtered = filterByNamespace(rows, filter);
  expect(filtered).toHaveLength(2);
  expect(filtered.map(r => r.slug)).toEqual(['world/page1', 'ventures/page1']);
});

test('PR4 namespace recall filter > filterByNamespace with personal filter includes personal+network but excludes world+actions', () => {
  const filter = defaultFilterForQueryType('personal');
  const rows = [
    { slug: 'world/page1', _namespace: 'world' as GBrainNamespace, _privacy: 'public' as GBrainPrivacy, _sensitivity: 'low' as GBrainSensitivity },
    { slug: 'personal/page1', _namespace: 'personal' as GBrainNamespace, _privacy: 'private' as GBrainPrivacy, _sensitivity: 'high' as GBrainSensitivity },
    { slug: 'network/page1', _namespace: 'network' as GBrainNamespace, _privacy: 'private' as GBrainPrivacy, _sensitivity: 'high' as GBrainSensitivity },
    { slug: 'actions/page1', _namespace: 'actions' as GBrainNamespace, _privacy: 'private' as GBrainPrivacy, _sensitivity: 'high' as GBrainSensitivity },
  ];
  const filtered = filterByNamespace(rows, filter);
  // personal filter allows: personal, ventures, network, scouts, evals
  // world and actions are excluded
  expect(filtered).toHaveLength(2);
  expect(filtered.map(r => r.slug)).toEqual(['personal/page1', 'network/page1']);
});

test('PR4 namespace recall filter > filterByNamespace with all filter keeps everything', () => {
  const filter = defaultFilterForQueryType('all');
  const rows = [
    { slug: 'world/page1', _namespace: 'world' as GBrainNamespace, _privacy: 'public' as GBrainPrivacy, _sensitivity: 'low' as GBrainSensitivity },
    { slug: 'personal/page1', _namespace: 'personal' as GBrainNamespace, _privacy: 'confidential' as GBrainPrivacy, _sensitivity: 'restricted' as GBrainSensitivity },
    { slug: 'actions/page1', _namespace: 'actions' as GBrainNamespace, _privacy: 'private' as GBrainPrivacy, _sensitivity: 'high' as GBrainSensitivity },
  ];
  const filtered = filterByNamespace(rows, filter);
  expect(filtered).toHaveLength(3);
});
