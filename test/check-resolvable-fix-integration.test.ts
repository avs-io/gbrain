/**
 * check-resolvable-fix-integration.test.ts — Integration test for the
 * real-write `--fix` path of `gbrain check-resolvable`.
 *
 * Exercises the actual CLI subprocess (no --dry-run), proves that:
 *   1. A synthetic DRY-violation fixture is modified on disk
 *   2. The JSON envelope's autoFix.fixed[] reflects the applied fix
 *   3. A re-run on the fixed fixture produces zero DRY errors
 *
 * The fixture is created inside a git repo (git init + commit) so that
 * `getWorkingTreeStatus()` returns 'clean' and the auto-fix is allowed to
 * write.  Cleanup happens in afterEach.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';

// Path to the CLI entry point (same pattern as check-resolvable-cli.test.ts).
const CLI = resolve(import.meta.dir, '..', 'src', 'cli.ts');
const REPO_ROOT = resolve(import.meta.dir, '..');

// ---------------------------------------------------------------------------
// Fixture builder — creates a minimal skills/ tree with a known DRY
// violation (Iron Law heading) inside a git repo so auto-fix can write.
// ---------------------------------------------------------------------------

interface FixtureHandle {
  skillsDir: string;
  skillFile: string;
  originalContent: string;
}

function createDryViolationFixture(): FixtureHandle {
  const root = mkdtempSync(join(tmpdir(), 'check-resolvable-fix-integration-'));
  const skillsDir = join(root, 'skills');
  mkdirSync(skillsDir, { recursive: true });

  // Create manifest.json
  writeFileSync(
    join(skillsDir, 'manifest.json'),
    JSON.stringify({ skills: [{ name: 'test-skill', path: 'test-skill/SKILL.md' }] }, null, 2),
  );

  // Create a minimal RESOLVER.md so checkResolvable doesn't error on
  // missing_file. The trigger row points at our test skill.
  const resolver = [
    '# RESOLVER',
    '',
    '## Brain operations',
    '| Trigger | Skill |',
    '|---------|-------|',
    '| "test-skill trigger" | `skills/test-skill/SKILL.md` |',
    '',
  ].join('\n');
  writeFileSync(join(skillsDir, 'RESOLVER.md'), resolver);

  // Create a skill with a DRY violation: an inlined "Iron Law" heading
  // that should be replaced by a `> **Convention:**` delegation line.
  // Include a triggers: field so the MECE gap check doesn't emit a
  // warning (which --strict would promote to exit 1).  The frontmatter
  // must start at position 0 (no heading before `---`) because
  // `extractTriggers()` uses `^---` to anchor the frontmatter block.
  const skillDir = join(skillsDir, 'test-skill');
  mkdirSync(skillDir, { recursive: true });
  const content = [
    '---',
    'triggers:',
    '  - "test-skill trigger"',
    '---',
    '',
    '# test-skill',
    '',
    '## Iron Law: Back-Linking (MANDATORY)',
    '',
    'Every entity must link back to its source.',
    '',
    'This is a test skill for integration testing.',
    '',
  ].join('\n');
  const skillFile = join(skillDir, 'SKILL.md');
  writeFileSync(skillFile, content);

  // Initialize a git repo and commit so getWorkingTreeStatus returns 'clean'.
  execSync('git init --quiet', { cwd: root });
  execSync('git config user.email test@test', { cwd: root });
  execSync('git config user.name test', { cwd: root });
  execSync('git add -A && git commit --quiet -m init', { cwd: root });

  return {
    skillsDir,
    skillFile,
    originalContent: content,
  };
}

// ---------------------------------------------------------------------------
// CLI runner — spawns `bun src/cli.ts check-resolvable ...` and parses JSON.
// ---------------------------------------------------------------------------

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  json: any;
}

function run(args: string[]): RunResult {
  const res = spawnSync('bun', [CLI, 'check-resolvable', ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
  let json: any = null;
  if (args.includes('--json')) {
    try { json = JSON.parse(res.stdout); } catch { /* leave null */ }
  }
  return {
    status: res.status ?? -1,
    stdout: res.stdout,
    stderr: res.stderr,
    json,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gbrain check-resolvable --fix integration (real-write)', () => {
  let handle: FixtureHandle | null = null;

  afterEach(() => {
    if (handle) {
      try { rmSync(handle.skillsDir, { recursive: true, force: true }); } catch { /* ignore */ }
      handle = null;
    }
  });

  it('applies a DRY fix to a synthetic fixture and writes to disk', () => {
    handle = createDryViolationFixture();

    // Run check-resolvable with --fix --json (no --dry-run).
    const r = run(['--json', '--fix', '--skills-dir', handle.skillsDir]);

    // 1. Exit code 0 (warnings-only DRY violations don't fail default mode).
    expect(r.status).toBe(0);

    // 2. JSON envelope is present and well-formed.
    expect(r.json).not.toBeNull();
    expect(r.json.ok).toBe(true);

    // 3. autoFix is present and contains the applied fix.
    expect(r.json.autoFix).not.toBeNull();
    expect(Array.isArray(r.json.autoFix.fixed)).toBe(true);
    expect(r.json.autoFix.fixed.length).toBeGreaterThan(0);

    // 4. The fixed entry references our skill file.
    const fixedEntry = r.json.autoFix.fixed.find(
      (f: any) => f.skillPath === handle!.skillFile,
    );
    expect(fixedEntry).toBeDefined();
    expect(fixedEntry.status).toBe('applied');

    // 5. The fixture file on disk was actually modified.
    const updatedContent = readFileSync(handle.skillFile, 'utf-8');
    expect(updatedContent).not.toBe(handle.originalContent);
    expect(updatedContent).toContain('> **Convention:** See `skills/conventions/quality.md`');
    expect(updatedContent).not.toContain('## Iron Law: Back-Linking');
  });

  it('a re-run on the fixed fixture produces zero DRY errors', () => {
    handle = createDryViolationFixture();

    // First: apply the fix.
    const r1 = run(['--json', '--fix', '--skills-dir', handle.skillsDir]);
    expect(r1.status).toBe(0);
    expect(r1.json.autoFix.fixed.length).toBeGreaterThan(0);

    // Second: re-run check-resolvable (no --fix) on the now-fixed fixture.
    const r2 = run(['--json', '--skills-dir', handle.skillsDir]);
    expect(r2.status).toBe(0);
    expect(r2.json.ok).toBe(true);

    // No DRY violations should remain after the fix.
    const dryIssues = (r2.json.report.issues ?? []).filter(
      (i: any) => i.type === 'dry_violation',
    );
    expect(dryIssues.length).toBe(0);

    // The autoFix field should be null when --fix was not passed.
    expect(r2.json.autoFix).toBeNull();
  });

  it('autoFix.fixed[].patternLabel identifies the violation type', () => {
    handle = createDryViolationFixture();

    const r = run(['--json', '--fix', '--skills-dir', handle.skillsDir]);
    expect(r.status).toBe(0);

    const fixedEntry = r.json.autoFix.fixed[0];
    expect(fixedEntry.patternLabel).toContain('Iron Law');
    expect(fixedEntry.skill).toBe('test-skill');
  });

  it('exits 1 when --strict and DRY violations exist (before fix)', () => {
    handle = createDryViolationFixture();

    // Without --fix, the DRY violation is a warning. --strict promotes
    // warnings to exit 1.
    const r = run(['--json', '--strict', '--skills-dir', handle.skillsDir]);
    expect(r.status).toBe(1);
    expect(r.json.ok).toBe(false);

    // autoFix should be null when --fix was not passed.
    expect(r.json.autoFix).toBeNull();
  });

  it('exits 0 when --fix --strict and the DRY violation is auto-fixed', () => {
    handle = createDryViolationFixture();

    // With --fix, the DRY violation is auto-repaired, so --strict should
    // also pass (no remaining warnings).
    const r = run(['--json', '--fix', '--strict', '--skills-dir', handle.skillsDir]);
    expect(r.status).toBe(0);
    expect(r.json.ok).toBe(true);
    expect(r.json.autoFix.fixed.length).toBeGreaterThan(0);
  });
});
