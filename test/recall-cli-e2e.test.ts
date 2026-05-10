/**
 * PR11 — Recall CLI End-to-End Test (No-DB Path)
 *
 * Exercises `gbrain recall` through the CLI binary. The CLI reads from
 * the actual GBrain data store (not temp fixtures), so this test verifies
 * real CLI behavior: --classify/--json flags, span_id format,
 * quote_hash presence, integration metadata, backward compat, and help.
 *
 * Does NOT require DATABASE_URL. Uses real GBrain data + CLI binary.
 */

import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

// ── Helpers ────────────────────────────────────────────────────────

const GBrain = join(import.meta.dir, '..', 'src', 'cli.ts');

function runGbrain(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn('bun', ['run', GBrain, ...args], {
      cwd: import.meta.dir.replace(/\/test$/, ''),
      env: {
        ...process.env,
        BUN_RUNTIME_RESPECT_WORKSPACES: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    p.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    p.on('error', (e) => reject(e));
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('PR11 — Recall CLI End-to-End (No-DB)', () => {
  // The CLI reads from the actual GBrain data store, not temp fixtures.
  // This test verifies real CLI behavior: flag parsing, output structure,
  // span_id/quote_hash format, and help documentation.

  it('classifies Citadel query and returns evidence with span_ids and quotes', async () => {
    const { exitCode, stdout } = await runGbrain(
      ['recall', 'Citadel initial idea why moved away', '--classify', '--json'],
    );
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output).toHaveProperty('classification');
    expect(output.classification).toHaveProperty('matched_route_ids');
    expect(output.classification).toHaveProperty('routing_hint');
    expect(output).toHaveProperty('result');
    expect(Array.isArray(output.result.evidence)).toBe(true);
    expect(output.result.evidence.length).toBeGreaterThan(0);
    const first = output.result.evidence[0];
    expect(first).toHaveProperty('span_id');
    expect(first.span_id).toMatch(/^gbs1:/);
    expect(first).toHaveProperty('quote');
    expect(first.quote).toBeTruthy();
    expect(first).toHaveProperty('source_id');
    expect(first).toHaveProperty('slug');
  });

  it('classifies World8/Verdict query and returns evidence', async () => {
    const { exitCode, stdout } = await runGbrain(
      ['recall', 'World 8 North Star Verdict correction', '--classify', '--json'],
    );
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.result.evidence.length).toBeGreaterThan(0);
    expect(output.result.evidence[0].span_id).toMatch(/^gbs1:/);
  });

  it('classifies Sovereign AI strategy query', async () => {
    const { exitCode, stdout } = await runGbrain(
      ['recall', 'Sovereign AI primary focus why', '--classify', '--json'],
    );
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.result.evidence.length).toBeGreaterThan(0);
  });

  it('classifies local models query', async () => {
    const { exitCode, stdout } = await runGbrain(
      ['recall', 'local models doctrine MWAL', '--classify', '--json'],
    );
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.result.evidence.length).toBeGreaterThan(0);
  });

  it('abstains on truly unrelated query', async () => {
    const { exitCode, stdout } = await runGbrain(
      ['recall', 'xyz non-existent concept that does not exist in any gbrain page', '--classify', '--json'],
    );
    const output = JSON.parse(stdout);
    // Should abstain (exitCode 2) or return empty evidence
    if (output.result?.status === 'abstain') {
      expect(output.result.status).toBe('abstain');
    } else {
      expect(output.result.evidence?.length).toBe(0);
    }
  });

  it('works without --classify (backward compat)', async () => {
    const { exitCode, stdout } = await runGbrain(
      ['recall', 'Citadel initial idea', '--json'],
    );
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.result.evidence?.length).toBeGreaterThan(0);
  });

  it('strict recall flags are documented in help', async () => {
    const { stdout } = await runGbrain(['recall', '--help']);
    expect(stdout).toContain('--conversation-only');
    expect(stdout).toContain('--show-genesis');
    expect(stdout).toContain('--timeline');
  });

  it('CLI output contains deterministic span_id format', async () => {
    const { stdout } = await runGbrain(
      ['recall', 'Citadel initial idea', '--classify', '--json'],
    );
    const output = JSON.parse(stdout);
    for (const ev of output.result.evidence || []) {
      expect(ev.span_id).toMatch(/^gbs1:/);
      const parts = ev.span_id.split(':');
      expect(parts.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('CLI output contains quote_hash for evidence', async () => {
    const { stdout } = await runGbrain(
      ['recall', 'Citadel initial idea', '--classify', '--json'],
    );
    const output = JSON.parse(stdout);
    for (const ev of output.result.evidence || []) {
      expect(ev).toHaveProperty('quote_hash');
      expect(typeof ev.quote_hash).toBe('string');
      expect(ev.quote_hash.length).toBeGreaterThan(0);
    }
  });

  it('CLI output includes integration metadata', async () => {
    const { stdout } = await runGbrain(
      ['recall', 'Citadel initial idea', '--classify', '--json'],
    );
    const output = JSON.parse(stdout);
    expect(output).toHaveProperty('result');
    expect(output.result).toHaveProperty('integration');
    expect(output).toHaveProperty('classification');
  });

  it('CLI help documents strict-recall flags', async () => {
    const { stdout } = await runGbrain(['recall', '--help']);
    expect(typeof stdout).toBe('string');
    expect(stdout).toContain('--classify');
    expect(stdout).toContain('--conversation-only');
    expect(stdout).toContain('--show-genesis');
    expect(stdout).toContain('--timeline');
    expect(stdout).toContain('--source-id');
  });
});
