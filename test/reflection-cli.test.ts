/**
 * gbrain reflect CLI integration tests
 *
 * Tests the CLI wiring of the reflection module:
 * - `gbrain reflect --help`
 * - `gbrain reflect run --fixtures <path> --context <text> --json`
 * - `gbrain reflect notes --fixtures <path> --json`
 * - `gbrain reflect surfacing --fixtures <path> --json`
 * - `gbrain reflect summary --fixtures <path> --json`
 * - Missing --fixtures error
 * - --out with --yes writes file
 * - Guardrails: review-only, no trusted-page writes
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GBrain = join(import.meta.dir, '..', 'src', 'cli.ts');
// From gbrain directory (set as cwd in spawnCli), fixtures are at ../projects/...
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

describe('gbrain reflect CLI integration', () => {
  it('exits with error when --fixtures is missing', async () => {
    const { exitCode, stderr } = await spawnCli(['reflection', 'run']);
    expect(exitCode).toBeGreaterThan(0);
    expect(stderr.toLowerCase()).toContain('missing required --fixtures');
  });

  it('shows help for --help flag', async () => {
    const { stdout, exitCode } = await spawnCli(['reflection', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('reflect');
    expect(stdout).toContain('--fixtures');
    expect(stdout).toContain('--context');
    expect(stdout).toContain('--json');
  });

  it('shows help for reflect run subcommand', async () => {
    const { stdout, exitCode } = await spawnCli(['reflection', 'run', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--fixtures');
  });

  it('reflect run --json produces valid schema with fixtures', async () => {
    const { stdout, exitCode } = await spawnCli([
      'reflection',
      'run',
      '--fixtures',
      FIXTURES,
      '--context',
      'Sovereign AI India policy update local models MLX',
      '--json',
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.schema).toBe('gbrain.reflection.v1');
    expect(parsed).toHaveProperty('reflection_notes');
    expect(parsed).toHaveProperty('surfacing_candidates');
    expect(parsed).toHaveProperty('suppression_count');
    expect(parsed).toHaveProperty('guardrails');
    expect(parsed.guardrails.review_only).toBe(true);
  });

  it('reflect notes --json produces notes array', async () => {
    const { stdout, exitCode } = await spawnCli([
      'reflection',
      'notes',
      '--fixtures',
      FIXTURES,
      '--context',
      'Citadel post-human cognitive fortress',
      '--json',
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.schema).toBe('gbrain.reflection.notes.v1');
    expect(Array.isArray(parsed.notes)).toBe(true);
  });

  it('reflect surfacing --json produces candidates array', async () => {
    const { stdout, exitCode } = await spawnCli([
      'reflection',
      'surfacing',
      '--fixtures',
      FIXTURES,
      '--context',
      'local compute MLX models on-device',
      '--json',
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.schema).toBe('gbrain.reflection.surfacing.v1');
    expect(Array.isArray(parsed.candidates)).toBe(true);
  });

  it('reflect summary --json produces compact summary', async () => {
    const { stdout, exitCode } = await spawnCli([
      'reflection',
      'summary',
      '--fixtures',
      FIXTURES,
      '--context',
      'test context',
      '--json',
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.schema).toBe('gbrain.reflection.summary.v1');
    expect(typeof parsed.item_count).toBe('number');
    expect(typeof parsed.note_count).toBe('number');
    expect(typeof parsed.candidate_count).toBe('number');
  });

  it('--out with --yes writes file', async () => {
    const tmpFile = join(tmpdir(), `gbrain-reflect-test-${Date.now()}.json`);
    try {
      const { stdout, exitCode } = await spawnCli([
        'reflection',
        'run',
        '--fixtures',
        FIXTURES,
        '--context',
        'test context for file write',
        '--json',
        '--out',
        tmpFile,
        '--yes',
      ]);
      expect(exitCode).toBe(0);
      expect(existsSync(tmpFile)).toBe(true);
      const parsed = JSON.parse(stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.written).toBe(true);
      // Also verify the file was written with valid content
      const fileContent = JSON.parse(readFileSync(tmpFile, 'utf8'));
      expect(fileContent).toHaveProperty('generated_at');
      expect(fileContent).toHaveProperty('reflection_notes');
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  });

  it('--out without --yes does not write file', async () => {
    const tmpFile = join(tmpdir(), `gbrain-reflect-no-write-${Date.now()}.json`);
    try {
      const { stdout, exitCode } = await spawnCli([
        'reflection',
        'run',
        '--fixtures',
        FIXTURES,
        '--context',
        'test',
        '--json',
        '--out',
        tmpFile,
      ]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.written).toBe(false);
      expect(existsSync(tmpFile)).toBe(false);
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  });

  it('unknown subcommand throws error', async () => {
    const { exitCode, stderr } = await spawnCli(['reflection', 'bogus', '--fixtures', FIXTURES]);
    expect(exitCode).toBeGreaterThan(0);
    expect(stderr.toLowerCase()).toContain('unknown reflect subcommand');
  });
});
