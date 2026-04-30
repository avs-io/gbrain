import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runOpsCommand } from '../src/commands/ops.ts';
import { claimWorkItem, dispatchWorkItem, enqueueWorkPacket, initOpsStore, readOpsState, superviseOps } from '../src/core/ops/kernel.ts';
import { buildLaunchAgentPlan, heartbeatCheck } from '../src/core/ops/liveness.ts';

function tempDir(prefix = 'gbrain-ops-liveness-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function tempStore(): string {
  return join(tempDir(), 'ops.jsonl');
}

function packet(...workItems: any[]) {
  return {
    programs: [{ id: 'always-on', title: 'Always-On OS', objective: 'Keep approved work moving.', priority: 90 }],
    work_items: workItems,
  };
}

function work(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    program_id: 'always-on',
    title: `Work ${id}`,
    description: `Do ${id}`,
    lane: 'code',
    worker_kind: 'subagent',
    privacy_tier: 'P1_PRIVATE',
    priority: 50,
    acceptance_criteria: ['deterministic test passes'],
    ...extra,
  };
}

async function capture(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  try { await fn(); } finally { console.log = original; }
  return logs.join('\n');
}

describe('ops liveness launchagent and heartbeat', () => {
  test('LaunchAgent dry-run generates plist/path without installing', async () => {
    const home = tempDir('gbrain-launchagent-home-');
    const gbrainDir = tempDir('gbrain-dir-');
    const cli = JSON.parse(await capture(() => runOpsCommand(null, ['install-launchagent', '--dry-run', '--json', '--home', home, '--gbrain-dir', gbrainDir, '--interval-seconds', '180'])));

    expect(cli.schema).toBe('gbrain.ops.launchagent.v1');
    expect(cli.dry_run).toBe(true);
    expect(cli.installed).toBe(false);
    expect(cli.launchctl_loaded).toBe(false);
    expect(cli.plist_path).toBe(join(home, 'Library', 'LaunchAgents', 'com.aditya.gbrain-supervisor.plist'));
    expect(existsSync(cli.plist_path)).toBe(false);
    expect(cli.plist).toContain('<string>com.aditya.gbrain-supervisor</string>');
    expect(cli.plist).toContain('<integer>180</integer>');
    expect(cli.plist).toContain('ops supervise --once --json');
    expect(cli.program_arguments).toEqual(['/bin/zsh', '-lc', expect.stringContaining('ops supervise --once --json')]);
  });

  test('LaunchAgent --yes safely writes only the temp HOME plist and never loads launchctl', () => {
    const home = tempDir('gbrain-launchagent-install-home-');
    const gbrainDir = tempDir('gbrain-dir-');
    const logDir = join(tempDir('gbrain-logs-'), 'logs');
    const result = buildLaunchAgentPlan({ yes: true, homeDir: home, gbrainDir, logDir });

    expect(result.installed).toBe(true);
    expect(result.dry_run).toBe(false);
    expect(result.launchctl_loaded).toBe(false);
    expect(result.plist_path).toBe(join(home, 'Library', 'LaunchAgents', 'com.aditya.gbrain-supervisor.plist'));
    expect(readFileSync(result.plist_path, 'utf8')).toBe(result.plist);
    expect(result.plist).toContain(logDir);
  });

  test('heartbeat-check is green for an initialized quiet store with fresh supervisor tick', () => {
    const store = tempStore();
    initOpsStore(store, new Date('2026-04-30T06:00:00.000Z'));
    superviseOps({ path: store, now: new Date('2026-04-30T06:01:00.000Z') });

    const check = heartbeatCheck({ path: store, now: new Date('2026-04-30T06:02:00.000Z') });
    expect(check.status).toBe('green');
    expect(check.action).toBe('none');
    expect(check.alerts).toEqual([]);
    expect(check.summary).toContain('no ready backlog');
  });

  test('heartbeat-check is red for no-idle ready backlog and recommends supervisor kick', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(work('ready-a6', { priority: 90 })), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });

    const check = heartbeatCheck({ path: store, now: new Date('2026-04-30T06:02:00.000Z') });
    expect(check.status).toBe('red');
    expect(check.action).toBe('kick_supervisor');
    expect(check.recommended_command).toBe('bun run src/cli.ts ops supervise --once --json');
    expect(check.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'no_idle', severity: 'red', work_item_ids: ['ready-a6'] })]));
  });

  test('heartbeat-check is amber for stale active leases', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(work('stale-lease-a6')), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });
    const claim = claimWorkItem('stale-lease-a6', 'worker-old', { path: store, now: new Date('2026-04-30T06:01:00.000Z'), leaseMinutes: 1 });
    superviseOps({ path: store, now: new Date('2026-04-30T06:01:30.000Z'), maxClaims: 0 });

    const check = heartbeatCheck({ path: store, now: new Date('2026-04-30T06:03:00.000Z') });
    expect(check.status).toBe('amber');
    expect(check.action).toBe('kick_supervisor');
    expect(check.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'stale_active_lease', severity: 'amber', lease_ids: [claim.lease.id] })]));
  });

  test('heartbeat-check detects stale supervisor tick and recommends backup kick', () => {
    const store = tempStore();
    initOpsStore(store, new Date('2026-04-30T06:00:00.000Z'));
    superviseOps({ path: store, now: new Date('2026-04-30T06:00:00.000Z') });

    const check = heartbeatCheck({ path: store, now: new Date('2026-04-30T06:20:00.000Z'), maxTickAgeMinutes: 10 });
    expect(check.status).toBe('amber');
    expect(check.action).toBe('kick_supervisor');
    expect(check.recommended_command).toBe('bun run src/cli.ts ops supervise --once --json');
    expect(check.alerts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'stale_supervisor_tick', severity: 'amber', age_minutes: 20 })]));
  });

  test('heartbeat-check surfaces failed dispatch and critical blocked work', () => {
    const store = tempStore();
    enqueueWorkPacket(packet(
      work('dispatch-fail-a6', { priority: 70 }),
      work('blocked-critical-a6', { state: 'blocked', priority: 95, last_state_reason: 'critical dependency missing' }),
    ), { path: store, now: new Date('2026-04-30T06:00:00.000Z') });
    dispatchWorkItem('dispatch-fail-a6', { path: store, now: new Date('2026-04-30T06:01:00.000Z'), dryRun: true, simulateFailure: true, failureMessage: 'simulated failed dispatch' });
    superviseOps({ path: store, now: new Date('2026-04-30T06:02:00.000Z') });

    const check = heartbeatCheck({ path: store, now: new Date('2026-04-30T06:03:00.000Z') });
    expect(check.status).toBe('red');
    expect(check.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'dispatch_failed', severity: 'red', work_item_ids: ['dispatch-fail-a6'] }),
      expect.objectContaining({ kind: 'blocked_critical_work', severity: 'red', work_item_ids: ['blocked-critical-a6'] }),
    ]));
    expect(readOpsState(store).interrupts.length).toBe(1);
  });

  test('heartbeat-template command renders the heartbeat-only behavior', async () => {
    const markdown = await capture(() => runOpsCommand(null, ['heartbeat-template', '--markdown']));
    expect(markdown).toContain('Run only the heartbeat check');
    expect(markdown).toContain('ops heartbeat-check --json');
    expect(markdown).toContain('Do not start long-running project work');
    expect(markdown).toContain('action: kick_supervisor');
  });
});
