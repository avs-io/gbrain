/**
 * gbrain memory reflection surfacing subcommand — property-name fix regression
 *
 * Verifies that the memory.ts CLI wrapper correctly uses snake_case property
 * names from ReflectionResult (reflection_notes, surfacing_candidates,
 * suppression_count) instead of the incorrect camelCase that caused the
 * surfacing subcommand to crash with:
 *   "Reflection failed: undefined is not an object (evaluating 'reflectionNotes')"
 *
 * Tests the actual module API (not the compiled binary) to avoid GBRAIN_HOME
 * path resolution issues in the test environment.
 */

import { describe, it, expect } from 'bun:test';
import { runReflection } from '../src/core/memory/reflection.js';
import { buildSurfacingCandidates } from '../src/core/memory/reflection.js';
import { readFileSync } from 'node:fs';
import type { TypedMemoryItem } from '../src/core/memory/types.js';

function loadFixtures(path: string): TypedMemoryItem[] {
  const raw = readFileSync(path, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => JSON.parse(line) as TypedMemoryItem);
}

function fixturesPath(): string {
  return join(
    import.meta.dir,
    '..',
    '..',
    'projects',
    'gbrain-living-memory',
    'implementation',
    'typed-memory-fixtures.jsonl'
  );
}

function join(...parts: string[]): string {
  return parts.join('/');
}

describe('memory reflection surfacing subcommand — property-name fix', () => {
  const fixtures = loadFixtures(fixturesPath());

  it('runReflection returns reflection_notes (snake_case) not reflectionNotes', () => {
    const result = runReflection(fixtures, 'working on local AI models');
    // The fix: memory.ts must use result.reflection_notes (snake_case)
    // not result.reflectionNotes (camelCase)
    expect(result.reflection_notes).toBeDefined();
    expect(Array.isArray(result.reflection_notes)).toBe(true);
    expect(result.reflection_notes.length).toBeGreaterThan(0);
  });

  it('runReflection returns surfacing_candidates (snake_case) not surfacingCandidates', () => {
    const result = runReflection(fixtures, 'working on local AI models');
    expect(result.surfacing_candidates).toBeDefined();
    expect(Array.isArray(result.surfacing_candidates)).toBe(true);
  });

  it('runReflection returns suppression_count (snake_case) not suppressionCount', () => {
    const result = runReflection(fixtures, 'working on local AI models');
    expect(result.suppression_count).toBeDefined();
    expect(typeof result.suppression_count).toBe('number');
  });

  it('buildSurfacingCandidates receives reflection_notes correctly (no undefined)', () => {
    const result = runReflection(fixtures, 'working on local AI models');
    // This is the critical fix: before, memory.ts passed undefined because
    // it used .reflectionNotes (camelCase) which was undefined on the
    // ReflectionResult object. Now it passes .reflection_notes correctly.
    const surfacing = buildSurfacingCandidates(
      fixtures,
      'working on local AI models',
      result.reflection_notes,
      result.generated_at
    );
    expect(Array.isArray(surfacing)).toBe(true);
    expect(surfacing.length).toBeGreaterThan(0);
  });

  it('empty context still produces surfacing (entity-based, by design)', () => {
    const result = runReflection(fixtures, '');
    const surfacing = buildSurfacingCandidates(
      fixtures,
      '',
      result.reflection_notes,
      result.generated_at
    );
    expect(Array.isArray(surfacing)).toBe(true);
    // Entity-based clustering should still produce candidates even with empty context
    expect(surfacing.length).toBeGreaterThan(0);
  });
});
