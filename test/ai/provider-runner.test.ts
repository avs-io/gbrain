import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareProviderRun } from '../../src/core/ai/provider-runner.ts';

describe('provider runner skeleton', () => {
  test('P0 rejects and never leaks raw prompt', () => {
    const out = prepareProviderRun({ kind: 'source_normalize', privacy: 'P0', prompt: 'Chief private note: secret', allowCloudEscalation: true });
    expect(out.ok).toBe(false);
    expect(out.decision).toBe('reject');
    expect(JSON.stringify(out)).not.toContain('Chief private note: secret');
    expect(out.redacted_prompt).toBeUndefined();
  });

  test('P1 redacts and requires escalation for cloud', () => {
    const local = prepareProviderRun({ kind: 'world_scout', privacy: 'P1', prompt: 'private source text', allowCloudEscalation: false });
    expect(local.decision).toBe('local_only');
    expect(local.redacted_prompt).toBe('[redacted-private-context]');
    expect(local.provider_request).toBeUndefined();

    const escalated = prepareProviderRun({ kind: 'world_scout', privacy: 'P1', prompt: 'private source text', allowCloudEscalation: true });
    expect(escalated.ok).toBe(true);
    expect(escalated.decision).toBe('cloud_allowed');
    expect(escalated.provider_request?.prompt).toBe('[redacted-private-context]');
    expect(escalated.provider_request?.prompt_summary).toBe('[redacted-private-context]');
  });

  test('P2/P3 build dry-run cloud envelope only', () => {
    const out = prepareProviderRun({ kind: 'code_pr_review', privacy: 'P2', prompt: 'review this patch', allowCloudEscalation: false });
    expect(out.dry_run).toBe(true);
    expect(out.decision).toBe('cloud_allowed');
    expect(out.provider_request?.provider).toBe('codex');
    expect(out.provider_request?.prompt).toBe('review this patch');
  });

  test('P1 cloud escalation emits only sanitized provider requests', () => {
    const out = prepareProviderRun({ kind: 'bookmark_enrich', privacy: 'P1', prompt: 'private relationship detail', allowCloudEscalation: true });
    expect(out.ok).toBe(true);
    expect(out.provider_request?.provider).toBe('minimax-m27');
    expect(out.provider_request?.prompt).toBe('[redacted-private-context]');
    expect(JSON.stringify(out.provider_request)).not.toContain('private relationship detail');
  });

  test('CLI emits JSON and reads prompt files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-provider-runner-'));
    const promptFile = join(dir, 'prompt.txt');
    writeFileSync(promptFile, 'cli prompt file secret', 'utf8');
    const proc = spawnSync('bun', ['run', 'src/cli.ts', 'ai', 'provider', 'prepare', '--kind', 'world_scout', '--privacy', 'P1', '--prompt-file', promptFile, '--allow-cloud-escalation', '--json'], { cwd: '/Users/a/.openclaw/workspace/gbrain', encoding: 'utf8' });
    expect(proc.status).toBe(0);
    const out = JSON.parse(proc.stdout.trim());
    expect(out.schema).toBe('gbrain.ai.provider-runner.v1');
    expect(out.provider_request.prompt).toBe('[redacted-private-context]');
    expect(JSON.stringify(out)).not.toContain('cli prompt file secret');
    expect(out.provider_request.prompt_summary).toBe('[redacted-private-context]');
  });
});
