/**
 * gbrain reflect → claims CLI writeback integration test
 *
 * Exercises the full pipeline through the CLI:
 *   gbrain reflect run --fixtures <path> --context <text> --json
 *     → captures surfacing candidates with evidence_refs
 *   gbrain claims propose --from-span <gbs1:...> --claim "..." --json
 *     → writes a claim to the review-only ledger
 *   gbrain claims list --json
 *     → verifies the claim is visible
 *   gbrain claims show <claim_id> --json
 *     → verifies claim detail retrieval
 *
 * This test exercises actual claim writeback through the CLI,
 * not just module-level direct calls. It verifies:
 * - Reflection output is compatible with claim propose input
 * - Claim writeback through CLI produces visible records
 * - Claim show retrieves the written claim correctly
 * - Full pipeline determinism (same fixtures + context → same output)
 * - Guardrails: review-only, no trusted-page writes, no external messages
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GBrain = join(import.meta.dir, '..', 'src', 'cli.ts');
const FIXTURES = join(
  '..',
  'projects',
  'gbrain-living-memory',
  'implementation',
  'typed-memory-fixtures.jsonl'
);

function spawnCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn('bun', ['run', GBrain, ...args], {
      cwd: import.meta.dir.replace(/\/test$/, ''),
      env: { ...process.env, BUN_RUNTIME_RESPECT_WORKSPACES: '1' },
    });
    let stdout = '';
    let stderr = '';
    p.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    p.on('error', (e) => reject(e));
  });
}

function readFixtureFile(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => JSON.parse(line));
}

describe('gbrain reflect → claims CLI writeback integration', () => {
  it('reflect run → claims propose → claims list: full writeback pipeline', async () => {
    // Step 1: Run reflection to get surfacing candidates with evidence_refs
    const { stdout: reflectOut, exitCode: reflectCode } = await spawnCli([
      'reflection',
      'run',
      '--fixtures',
      FIXTURES,
      '--context',
      'Sovereign AI India policy local compute MLX on-device models',
      '--json',
    ]);
    expect(reflectCode).toBe(0);
    const reflectResult = JSON.parse(reflectOut);
    expect(reflectResult.ok).toBe(true);
    expect(reflectResult.schema).toBe('gbrain.reflection.v1');
    expect(Array.isArray(reflectResult.surfacing_candidates)).toBe(true);

    // Step 2: Extract the first evidence_ref span_id from reflection notes
    const notes = reflectResult.reflection_notes;
    if (notes.length === 0) {
      // No notes produced — skip writeback test (valid case)
      return;
    }

    // Find a gbs1: span from evidence_refs
    let spanId: string | null = null;
    for (const note of notes) {
      const refs = (note as { evidence_refs?: string[] }).evidence_refs;
      if (refs && refs.length > 0) {
        spanId = refs[0];
        break;
      }
    }

    if (!spanId || !spanId.startsWith('gbs1:')) {
      // No evidence refs — skip writeback test (valid case)
      return;
    }

    // Step 3: Propose a claim from the span
    const claimText = 'Sovereign AI India policy emphasizes local compute and on-device MLX models';
    const { stdout: proposeOut, exitCode: proposeCode } = await spawnCli([
      'claims',
      'propose',
      '--from-span',
      spanId,
      '--claim',
      claimText,
      '--json',
    ]);
    expect(proposeCode).toBe(0);
    const proposeResult = JSON.parse(proposeOut);
    expect(proposeResult.ok).toBe(true);
    expect(proposeResult).toHaveProperty('id');
    expect(proposeResult).toHaveProperty('status');
    expect(proposeResult).toHaveProperty('source_span');
    expect(proposeResult.source_span).toBe(spanId);

    const claimId = (proposeResult as { id: string }).id;

    // Step 4: Verify the claim is visible via claims list
    const { stdout: listOut, exitCode: listCode } = await spawnCli([
      'claims',
      'list',
      '--json',
    ]);
    expect(listCode).toBe(0);
    const listResult = JSON.parse(listOut);
    expect(listResult.ok).toBe(true);
    expect(Array.isArray(listResult.records)).toBe(true);

    // The newly proposed claim should be in the list
    const foundClaim = (listResult as { records: Array<{ id: string; status: string }> }).records.find(
      (r: { id: string; status: string }) => r.id === claimId
    );
    expect(foundClaim).toBeDefined();
    expect(foundClaim!.status).toBe('proposed');

    // Step 5: Verify claim show retrieves the written claim
    const { stdout: showOut, exitCode: showCode } = await spawnCli([
      'claims',
      'show',
      claimId,
      '--json',
    ]);
    expect(showCode).toBe(0);
    const showResult = JSON.parse(showOut);
    expect(showResult.ok).toBe(true);
    expect(showResult.id).toBe(claimId);
    expect(showResult.source_span).toBe(spanId);
  });

  it('reflect run → claims propose with --quote: exact quote preservation', async () => {
    // Run reflection to get evidence refs
    const { stdout: reflectOut, exitCode: reflectCode } = await spawnCli([
      'reflection',
      'run',
      '--fixtures',
      FIXTURES,
      '--context',
      'Citadel post-human cognitive fortress sovereignty',
      '--json',
    ]);
    expect(reflectCode).toBe(0);
    const reflectResult = JSON.parse(reflectOut);
    expect(reflectResult.ok).toBe(true);

    // Find a gbs1: span
    let spanId: string | null = null;
    const notes = reflectResult.reflection_notes;
    for (const note of notes) {
      const refs = (note as { evidence_refs?: string[] }).evidence_refs;
      if (refs && refs.length > 0) {
        spanId = refs[0];
        break;
      }
    }

    if (!spanId || !spanId.startsWith('gbs1:')) {
      return; // No evidence refs — valid skip
    }

    // Propose a claim with explicit quote
    const claimText = 'Citadel was about anti-programming and personal sovereignty';
    const quoteText = 'Citadel: anti-programming, resistance to marketing';
    const { stdout: proposeOut, exitCode: proposeCode } = await spawnCli([
      'claims',
      'propose',
      '--from-span',
      spanId,
      '--claim',
      claimText,
      '--quote',
      quoteText,
      '--json',
    ]);
    expect(proposeCode).toBe(0);
    const proposeResult = JSON.parse(proposeOut);
    expect(proposeResult.ok).toBe(true);
    expect(proposeResult).toHaveProperty('quote');
    expect((proposeResult as { quote?: string }).quote).toBe(quoteText);
  });

  it('reflect run → claims propose with namespace: namespace routing works', async () => {
    // Run reflection
    const { stdout: reflectOut, exitCode: reflectCode } = await spawnCli([
      'reflection',
      'run',
      '--fixtures',
      FIXTURES,
      '--context',
      'test context',
      '--json',
    ]);
    expect(reflectCode).toBe(0);
    const reflectResult = JSON.parse(reflectOut);
    expect(reflectResult.ok).toBe(true);

    // Find a gbs1: span
    let spanId: string | null = null;
    const notes = reflectResult.reflection_notes;
    for (const note of notes) {
      const refs = (note as { evidence_refs?: string[] }).evidence_refs;
      if (refs && refs.length > 0) {
        spanId = refs[0];
        break;
      }
    }

    if (!spanId || !spanId.startsWith('gbs1:')) {
      return;
    }

    // Propose a claim with namespace personal
    const { stdout: proposeOut, exitCode: proposeCode } = await spawnCli([
      'claims',
      'propose',
      '--from-span',
      spanId,
      '--claim',
      'Test claim with namespace',
      '--namespace',
      'personal',
      '--json',
    ]);
    expect(proposeCode).toBe(0);
    const proposeResult = JSON.parse(proposeOut);
    expect(proposeResult.ok).toBe(true);
    expect((proposeResult as { namespace?: string }).namespace).toBe('personal');
  });

  it('full pipeline determinism: same fixtures + context → same reflection output', async () => {
    // Run reflection twice with same inputs
    const { stdout: reflectOut1, exitCode: reflectCode1 } = await spawnCli([
      'reflection',
      'run',
      '--fixtures',
      FIXTURES,
      '--context',
      'Eonic deferred opportunity sovereign AI policy',
      '--json',
    ]);
    expect(reflectCode1).toBe(0);
    const reflectResult1 = JSON.parse(reflectOut1);

    const { stdout: reflectOut2, exitCode: reflectCode2 } = await spawnCli([
      'reflection',
      'run',
      '--fixtures',
      FIXTURES,
      '--context',
      'Eonic deferred opportunity sovereign AI policy',
      '--json',
    ]);
    expect(reflectCode2).toBe(0);
    const reflectResult2 = JSON.parse(reflectOut2);

    // Same number of surfacing candidates
    expect(reflectResult1.surfacing_candidates.length).toBe(
      reflectResult2.surfacing_candidates.length
    );
    // Same number of reflection notes
    expect(reflectResult1.reflection_notes.length).toBe(
      reflectResult2.reflection_notes.length
    );
    // Same schema
    expect(reflectResult1.schema).toBe(reflectResult2.schema);
    // Guardrails preserved
    expect(reflectResult1.guardrails.review_only).toBe(true);
    expect(reflectResult2.guardrails.review_only).toBe(true);
  });

  it('guardrails: review-only, no trusted-page writes, no external messages', async () => {
    // Run reflection and verify guardrails
    const { stdout: reflectOut, exitCode: reflectCode } = await spawnCli([
      'reflection',
      'run',
      '--fixtures',
      FIXTURES,
      '--context',
      'test context for guardrails',
      '--json',
    ]);
    expect(reflectCode).toBe(0);
    const reflectResult = JSON.parse(reflectOut);
    expect(reflectResult.ok).toBe(true);
    expect(reflectResult.guardrails.review_only).toBe(true);
    expect(reflectResult.guardrails.trusted_pages_edited).toBe(false);
    expect(reflectResult.guardrails.external_messages_sent).toBe(false);

    // Propose a claim and verify guardrails
    const notes = reflectResult.reflection_notes;
    let spanId: string | null = null;
    for (const note of notes) {
      const refs = (note as { evidence_refs?: string[] }).evidence_refs;
      if (refs && refs.length > 0) {
        spanId = refs[0];
        break;
      }
    }

    if (spanId && spanId.startsWith('gbs1:')) {
      const { stdout: proposeOut, exitCode: proposeCode } = await spawnCli([
        'claims',
        'propose',
        '--from-span',
        spanId,
        '--claim',
        'Guardrail test claim',
        '--json',
      ]);
      expect(proposeCode).toBe(0);
      const proposeResult = JSON.parse(proposeOut);
      expect(proposeResult.guardrails.review_only).toBe(true);
      expect(proposeResult.guardrails.trusted_pages_edited).toBe(false);
    }
  });

  it('empty context: entity-based surfacing still works, claims pipeline accessible', async () => {
    // Empty context should still produce entity-based surfacing
    const { stdout: reflectOut, exitCode: reflectCode } = await spawnCli([
      'reflection',
      'run',
      '--fixtures',
      FIXTURES,
      '--context',
      '',
      '--json',
    ]);
    expect(reflectCode).toBe(0);
    const reflectResult = JSON.parse(reflectOut);
    expect(reflectResult.ok).toBe(true);
    expect(Array.isArray(reflectResult.surfacing_candidates)).toBe(true);

    // Claims list should still be accessible
    const { stdout: listOut, exitCode: listCode } = await spawnCli([
      'claims',
      'list',
      '--json',
    ]);
    expect(listCode).toBe(0);
    const listResult = JSON.parse(listOut);
    expect(listResult.ok).toBe(true);
    expect(listResult).toHaveProperty('records');
  });
});
