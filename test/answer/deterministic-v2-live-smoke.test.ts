import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const REPORT = join(ROOT, '../ops/reports/memory-systems/gbrain-deterministic-v2-live-smoke-20260429.md');
const ENABLED = process.env.GBRAIN_LIVE_DETERMINISTIC_V2 === '1';

describe('deterministic-v2 live smoke gate', () => {
  test('runs live DB-backed smoke gate when explicitly enabled', () => {
    if (!ENABLED) return;
    const stdout = execFileSync('bun', ['run', 'scripts/chief-deterministic-v2-live-smoke.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024,
    });
    const payload = JSON.parse(stdout);
    expect(payload.ok).toBe(true);
    expect(existsSync(REPORT)).toBe(true);
    const report = readFileSync(REPORT, 'utf8');
    expect(report).toContain('Live source CLI chain');
    expect(report).toContain('PASS');
  });
});
