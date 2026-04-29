import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { routeTypedMemory } from '../src/core/memory/typed-memory-router.ts';

function record(overrides: Record<string, any>): any {
  return {
    id: 'base',
    memory_type: 'semantic_fact',
    title: 'Base memory',
    claim: 'Base claim',
    source: { kind: 'test', path: 'fixture.jsonl', quote: 'source quote' },
    sensitivity: 'medium',
    permission_scope: 'private',
    surfacing_policy: 'on_query',
    entities: [],
    tags: [],
    status: 'candidate',
    ...overrides,
  };
}

function fixturePath(lines: any[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-route-'));
  const path = join(dir, 'typed-memory.jsonl');
  writeFileSync(path, lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n', 'utf-8');
  return path;
}

describe('typed-memory route', () => {
  test('Citadel/post-human context returns Citadel typed memories with provenance', () => {
    const path = fixturePath([
      record({ id: 'fact:citadel:origin', title: 'Citadel origin', claim: 'Citadel resists programmable drift.', entities: ['Citadel', 'programmable drift'], tags: ['citadel'] }),
      record({ id: 'fact:other', title: 'Other', claim: 'Unrelated note', entities: ['Banana'], tags: ['other'] }),
    ]);

    const result = routeTypedMemory({ query: 'post-human sovereign cognition and Citadel lineage', fixturePath: path });

    expect(result.pass).toBe(true);
    expect(result.matched_routes.map(r => r.id)).toContain('citadel-lineage');
    expect(result.results.map(r => r.id)).toContain('fact:citadel:origin');
    expect(result.results[0].source.quote).toBeTruthy();
  });

  test('Sovereign AI current-vs-stale query returns current and stale facts', () => {
    const path = fixturePath([
      record({ id: 'fact:sovereign-ai:current', title: 'Current Sovereign AI path', claim: 'Current posture favors productized pilot.', entities: ['Sovereign AI', 'GeM', 'procurement'], tags: ['current', 'sovereign-ai'] }),
      record({ id: 'fact:sovereign-ai:stale', title: 'Stale Sovereign AI path', claim: 'Stale posture assumed consulting-led entry.', entities: ['Sovereign AI', 'GeM', 'procurement'], tags: ['stale', 'sovereign-ai'] }),
    ]);

    const result = routeTypedMemory({ query: 'Sovereign AI current truth vs stale procurement posture for GeM', fixturePath: path });

    expect(result.pass).toBe(true);
    expect(result.matched_routes.map(r => r.id)).toContain('sovereign-ai-strategy-pivot');
    expect(result.results.map(r => r.id)).toEqual(expect.arrayContaining(['fact:sovereign-ai:current', 'fact:sovereign-ai:stale']));
  });

  test('Eonic-only current strategy does not leak high-sensitivity government relationship rows', () => {
    const path = fixturePath([
      record({ id: 'core:eonic:strategy', memory_type: 'core_memory', title: 'Eonic strategy', claim: 'Eonic is active parallel.', entities: ['Eonic', 'Sovereign AI'], tags: ['current-truth'] }),
      record({ id: 'rel:gov:hidden', memory_type: 'relationship_memory', title: 'Government route', claim: 'Sensitive government route.', entities: ['Somnath', 'e-Committee'], tags: ['government'], sensitivity: 'high', surfacing_policy: 'never' }),
    ]);

    const result = routeTypedMemory({ query: 'Eonic current strategy and Sovereign AI primary focus', fixturePath: path });

    expect(result.pass).toBe(true);
    expect(result.results.map(r => r.id)).toContain('core:eonic:strategy');
    expect(result.results.map(r => r.id)).not.toContain('rel:gov:hidden');
  });

  test('missing and malformed JSONL returns structured warnings and no crash', () => {
    const missing = routeTypedMemory({ query: 'Citadel', fixturePath: join(tmpdir(), 'missing-typed-memory.jsonl') });
    expect(missing.pass).toBe(false);
    expect(missing.warnings[0]).toContain('not found');

    const path = fixturePath(['{bad json']);
    const malformed = routeTypedMemory({ query: 'Citadel', fixturePath: path });
    expect(malformed.pass).toBe(false);
    expect(malformed.warnings[0]).toContain('line 1:');
  });

  test('CLI route is read-only and emits sanitized JSON without raw local paths', () => {
    const path = fixturePath([
      record({
        id: 'fact:typed-memory:native',
        title: 'Native GBrain typed memory',
        claim: 'Native GBrain can route typed memory products read-only.',
        source: { kind: 'test', path: join(tmpdir(), 'raw-fixtures', 'typed-memory.jsonl'), quote: 'source quote' },
        entities: ['GBrain', 'typed memory'],
        tags: ['typed-memory'],
      }),
    ]);

    const result = spawnSync(
      process.execPath,
      ['run', 'src/cli.ts', 'memory', 'route', '--query', 'native gbrain typed-memory route', '--json'],
      { cwd: join(import.meta.dir, '..'), env: { ...process.env, GBRAIN_TYPED_MEMORY_FIXTURES: path }, encoding: 'utf-8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(path);
    expect(result.stdout).not.toContain(join(tmpdir(), 'raw-fixtures'));
    const output = JSON.parse(result.stdout || '{}');
    expect(output.ok).toBe(true);
    expect(output.action).toBe('route');
    expect(output.fixture).toBeUndefined();
    expect(output.results[0].id).toBe('fact:typed-memory:native');
    expect(output.results[0].source).toMatchObject({ kind: 'test', label: 'typed-memory.jsonl', quote: 'source quote' });
    expect(output.results[0].source.path).toBeUndefined();
  });

  test('CLI route human output redacts raw source paths', () => {
    const rawSourcePath = join(tmpdir(), 'human-route-raw-source', 'typed-memory.jsonl');
    const path = fixturePath([
      record({
        id: 'fact:typed-memory:human',
        title: 'Native GBrain typed memory human output',
        claim: 'Native GBrain can route typed memory products read-only.',
        source: { kind: 'test', path: rawSourcePath, quote: 'source quote' },
        entities: ['GBrain', 'typed memory'],
        tags: ['typed-memory'],
      }),
    ]);

    const result = spawnSync(
      process.execPath,
      ['run', 'src/cli.ts', 'memory', 'route', '--query', 'native gbrain typed-memory route'],
      { cwd: join(import.meta.dir, '..'), env: { ...process.env, GBRAIN_TYPED_MEMORY_FIXTURES: path }, encoding: 'utf-8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('source: typed-memory.jsonl');
    expect(result.stdout).not.toContain(rawSourcePath);
  });

  test('CLI surface emits governed review-only proposal packet without writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-memory-surface-'));
    const contextPath = join(dir, 'context.md');
    writeFileSync(contextPath, 'Citadel programmable drift review should remain governed and review-only.', 'utf-8');

    const result = spawnSync(
      process.execPath,
      ['run', 'src/cli.ts', 'memory', 'surface', '--query', 'Citadel programmable drift', '--context-file', contextPath, '--json'],
      { cwd: join(import.meta.dir, '..'), encoding: 'utf-8' },
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout || '{}');
    expect(output.ok).toBe(true);
    expect(output.action).toBe('surface');
    expect(output.packet.packet_type).toBe('governed_surfacing_proposal_packet');
    expect(output.packet.review_required).toBe(true);
    expect(output.packet.guardrails).toMatchObject({
      trusted_pages_edited: false,
      external_messages_sent: false,
      global_config_changed: false,
      packet_is_review_only: true,
    });
    expect(output.packet.out).toBeUndefined();
  });

});
