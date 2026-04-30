import { readFileSync, writeFileSync } from 'node:fs';

import {
  WORK_ITEM_STATES,
  auditOps,
  buildOpsDashboard,
  buildWorkPack,
  claimWorkItem,
  completeWorkItem,
  dispatchWorkItem,
  enqueueWorkPacket,
  initOpsStore,
  listPrograms,
  listWorkItems,
  opsStatus,
  reconcileOpenClawTasks,
  opsStorePath,
  renderWorkPackMarkdown,
  renderOpsDashboardMarkdown,
  superviseOps,
  syncProgramsFromYamlFile,
  type WorkItemState,
} from '../core/ops/kernel.ts';
import {
  buildLaunchAgentPlan,
  heartbeatCheck,
  heartbeatTemplateMarkdown,
} from '../core/ops/liveness.ts';

function flagValue(args: string[], flag: string): string | undefined {
  const ix = args.indexOf(flag);
  if (ix >= 0 && args[ix + 1] && !args[ix + 1].startsWith('--')) return args[ix + 1];
  const hit = args.find(a => a.startsWith(flag + '='));
  return hit ? hit.slice(flag.length + 1) : undefined;
}
function hasFlag(args: string[], flag: string): boolean { return args.includes(flag); }
function printJson(v: unknown): void { console.log(JSON.stringify(v, null, 2)); }
function storePath(args: string[]): string { return flagValue(args, '--store') || opsStorePath(); }
function requireJson(args: string[]): void { if (!hasFlag(args, '--json')) return; }

export async function runOpsCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`gbrain ops init [--store <path>] [--json]
gbrain ops status --json [--store <path>]
gbrain ops programs list --json [--store <path>]
gbrain ops programs sync --file <programs.yaml> --json [--store <path>]
gbrain ops dashboard [--json|--markdown] [--output <DASHBOARD.md>] [--store <path>]
gbrain ops work list [--state proposed|approved|ready|leased|running|succeeded|failed|blocked|waiting_human|cancelled|quarantined] --json [--store <path>]
gbrain ops work enqueue --packet <file.json> [--store <path>] [--json]
gbrain ops work claim --id <id> --worker <worker_id> --json [--store <path>]
gbrain ops work pack --id <id> [--out <path>] [--json] [--store <path>]
gbrain ops work complete --id <id> --completion <completion.json> [--store <path>] [--json]
gbrain ops dispatch --id <work_item_id> --dry-run --json [--store <path>] [--provider <p>] [--model <m>] [--openclaw-task-id <id>] [--session-key <key>]
gbrain ops reconcile --fixture <openclaw-tasks.json> --json [--store <path>]
gbrain ops supervise --once --json [--store <path>] [--max-claims 1] [--max-running 1]
gbrain ops install-launchagent (--dry-run|--yes) [--json] [--home <dir>] [--gbrain-dir <dir>] [--log-dir <dir>] [--interval-seconds 180]
gbrain ops heartbeat-check --json [--store <path>] [--max-tick-age-minutes 10]
gbrain ops heartbeat-template --markdown [--output <HEARTBEAT.md>]
gbrain ops audit --json [--store <path>]

Internal-only durable ops kernel for Programs, WorkItems, Runs, Leases, Artifacts, SupervisorTicks, Interrupts, and BudgetLedger. This command never sends external messages, pushes, mutates trusted memory, or crawls the web.`);
    return;
  }

  if (sub === 'init') {
    const result = initOpsStore(storePath(rest));
    if (hasFlag(rest, '--json')) printJson(result);
    else console.log(`Ops kernel initialized: ${result.path}`);
    return;
  }

  if (sub === 'status') {
    requireJson(rest);
    const result = opsStatus({ path: storePath(rest) });
    if (hasFlag(rest, '--json')) printJson(result);
    else console.log(`${result.initialized ? 'initialized' : 'not initialized'}\t${result.path}`);
    return;
  }

  if (sub === 'programs') {
    const action = rest[0];
    const actionArgs = rest.slice(1);
    if (action === 'list') {
      const programs = listPrograms({ path: storePath(actionArgs) });
      if (hasFlag(actionArgs, '--json')) printJson({ ok: true, schema: 'gbrain.ops.programs.list.v1', programs });
      else for (const p of programs) console.log(`${p.id}\t${p.status}\t${p.priority}\t${p.title}`);
      return;
    }
    if (action === 'sync') {
      const file = flagValue(actionArgs, '--file');
      if (!file) throw new Error('gbrain ops programs sync requires --file <programs.yaml>');
      const result = syncProgramsFromYamlFile(file, { path: storePath(actionArgs) });
      if (hasFlag(actionArgs, '--json')) printJson({ ...result, schema: 'gbrain.ops.programs.sync.v1' });
      else console.log(`synced ${result.upserted_count} programs from ${result.source_file}`);
      return;
    }
    throw new Error('gbrain ops programs supports: list, sync');
  }

  if (sub === 'dashboard') {
    const dashboard = buildOpsDashboard({ path: storePath(rest) });
    if (hasFlag(rest, '--json')) {
      printJson({ ok: true, schema: 'gbrain.ops.dashboard.v1', dashboard });
      return;
    }
    if (!hasFlag(rest, '--markdown') && rest.some(a => a.startsWith('--') && !['--store', '--output'].includes(a) && !a.startsWith('--store=') && !a.startsWith('--output='))) {
      throw new Error('gbrain ops dashboard supports --json, --markdown, --output, --store');
    }
    const markdown = renderOpsDashboardMarkdown(dashboard);
    const output = flagValue(rest, '--output');
    if (output) writeFileSync(output, markdown + '\n');
    console.log(markdown);
    return;
  }

  if (sub === 'work') {
    await runWork(rest);
    return;
  }

  if (sub === 'dispatch') {
    const id = flagValue(rest, '--id');
    if (!id) throw new Error('gbrain ops dispatch requires --id <work_item_id>');
    if (hasFlag(rest, '--live')) throw new Error('live OpenClaw dispatch is not enabled in this build; use --dry-run');
    if (!hasFlag(rest, '--dry-run')) throw new Error('gbrain ops dispatch requires explicit --dry-run');
    const result = dispatchWorkItem(id, {
      path: storePath(rest),
      dryRun: true,
      allowLive: false,
      workerId: flagValue(rest, '--worker'),
      provider: flagValue(rest, '--provider'),
      model: flagValue(rest, '--model'),
      openclawTaskId: flagValue(rest, '--openclaw-task-id'),
      sessionKey: flagValue(rest, '--session-key'),
      sessionId: flagValue(rest, '--session-id'),
      simulateFailure: hasFlag(rest, '--simulate-failure'),
      failureMessage: flagValue(rest, '--failure-message'),
    });
    if (hasFlag(rest, '--json')) printJson({ ...result, schema: 'gbrain.ops.dispatch.v1' });
    else console.log(`${result.work_item.id}\t${result.run.runtime}\t${result.packet_path}`);
    return;
  }

  if (sub === 'reconcile') {
    const fixture = flagValue(rest, '--fixture');
    if (!fixture) throw new Error('gbrain ops reconcile requires --fixture <openclaw-tasks.json>');
    const input = JSON.parse(readFileSync(fixture, 'utf8'));
    const result = reconcileOpenClawTasks(input, { path: storePath(rest) });
    if (hasFlag(rest, '--json')) printJson({ ...result, schema: 'gbrain.ops.reconcile.v1' });
    else console.log(`reconciled ${result.updates.length}/${result.observed_count} observed OpenClaw tasks`);
    return;
  }

  if (sub === 'supervise') {
    if (!hasFlag(rest, '--once')) throw new Error('gbrain ops supervise currently requires --once');
    const result = superviseOps({
      path: storePath(rest),
      maxClaims: numberFlag(rest, '--max-claims'),
      maxRunning: numberFlag(rest, '--max-running'),
      leaseMinutes: numberFlag(rest, '--lease-minutes'),
      workerId: flagValue(rest, '--worker'),
    });
    if (hasFlag(rest, '--json')) printJson({ ...result, schema: 'gbrain.ops.supervise.v1' });
    else console.log(`${result.status}\tclaimed=${result.claimed.length}\talerts=${result.alerts.length}`);
    return;
  }

  if (sub === 'install-launchagent') {
    if (!hasFlag(rest, '--dry-run') && !hasFlag(rest, '--yes')) throw new Error('gbrain ops install-launchagent requires --dry-run or --yes');
    if (hasFlag(rest, '--dry-run') && hasFlag(rest, '--yes')) throw new Error('choose only one of --dry-run or --yes');
    const result = buildLaunchAgentPlan({
      dryRun: hasFlag(rest, '--dry-run'),
      yes: hasFlag(rest, '--yes'),
      load: hasFlag(rest, '--load'),
      homeDir: flagValue(rest, '--home'),
      launchAgentsDir: flagValue(rest, '--launchagents-dir'),
      gbrainDir: flagValue(rest, '--gbrain-dir'),
      logDir: flagValue(rest, '--log-dir'),
      label: flagValue(rest, '--label'),
      startIntervalSeconds: numberFlag(rest, '--interval-seconds'),
    });
    if (hasFlag(rest, '--json')) printJson(result);
    else console.log(result.dry_run ? result.plist : `Installed LaunchAgent plist: ${result.plist_path}`);
    return;
  }

  if (sub === 'heartbeat-check') {
    const result = heartbeatCheck({
      path: storePath(rest),
      maxTickAgeMinutes: numberFlag(rest, '--max-tick-age-minutes'),
    });
    if (hasFlag(rest, '--json')) printJson(result);
    else if (result.status === 'green') console.log('green');
    else for (const alert of result.alerts) console.log(`${alert.severity}\t${alert.kind}\t${alert.message}`);
    return;
  }

  if (sub === 'heartbeat-template') {
    if (!hasFlag(rest, '--markdown')) throw new Error('gbrain ops heartbeat-template currently requires --markdown');
    const markdown = heartbeatTemplateMarkdown();
    const output = flagValue(rest, '--output');
    if (output) writeFileSync(output, markdown);
    console.log(markdown);
    return;
  }

  if (sub === 'audit') {
    const result = auditOps({ path: storePath(rest) });
    if (hasFlag(rest, '--json')) printJson({ ...result, schema: 'gbrain.ops.audit.v1' });
    else if (result.alerts.length) for (const alert of result.alerts) console.log(`${alert.severity}\t${alert.kind}\t${alert.message}`);
    else console.log('green');
    return;
  }

  throw new Error(`Unknown ops subcommand: ${sub}`);
}

async function runWork(args: string[]): Promise<void> {
  const action = args[0];
  const rest = args.slice(1);
  if (action === 'list') {
    const rawState = flagValue(rest, '--state');
    const state = rawState ? parseWorkState(rawState) : undefined;
    const work_items = listWorkItems({ state }, { path: storePath(rest) });
    if (hasFlag(rest, '--json')) printJson({ ok: true, schema: 'gbrain.ops.work.list.v1', work_items });
    else for (const w of work_items) console.log(`${w.id}\t${w.state}\t${w.priority}\t${w.program_id}\t${w.title}`);
    return;
  }

  if (action === 'enqueue') {
    const packetPath = flagValue(rest, '--packet');
    if (!packetPath) throw new Error('gbrain ops work enqueue requires --packet <file.json>');
    const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
    const result = enqueueWorkPacket(packet, { path: storePath(rest) });
    if (hasFlag(rest, '--json')) printJson({ ...result, schema: 'gbrain.ops.work.enqueue.v1' });
    else for (const w of result.work_items) console.log(`${w.id}\t${w.state}\t${w.title}`);
    return;
  }

  if (action === 'claim') {
    const id = flagValue(rest, '--id');
    const worker = flagValue(rest, '--worker');
    if (!id) throw new Error('gbrain ops work claim requires --id <id>');
    if (!worker) throw new Error('gbrain ops work claim requires --worker <worker_id>');
    const result = claimWorkItem(id, worker, { path: storePath(rest) });
    if (hasFlag(rest, '--json')) printJson({ ...result, schema: 'gbrain.ops.work.claim.v1' });
    else console.log(`${result.work_item.id}\t${result.work_item.state}\t${result.lease.id}`);
    return;
  }

  if (action === 'pack') {
    const id = flagValue(rest, '--id');
    if (!id) throw new Error('gbrain ops work pack requires --id <id>');
    const pack = buildWorkPack(id, { path: storePath(rest) });
    const output = flagValue(rest, '--out');
    if (output) writeFileSync(output, JSON.stringify(pack, null, 2) + '\n');
    if (hasFlag(rest, '--json')) printJson({ ok: true, schema: pack.schema, work_pack: pack });
    else console.log(renderWorkPackMarkdown(pack));
    return;
  }

  if (action === 'complete') {
    const id = flagValue(rest, '--id');
    const completionPath = flagValue(rest, '--completion');
    if (!id) throw new Error('gbrain ops work complete requires --id <id>');
    if (!completionPath) throw new Error('gbrain ops work complete requires --completion <completion.json>');
    const completion = JSON.parse(readFileSync(completionPath, 'utf8'));
    const result = completeWorkItem(id, completion, { path: storePath(rest) });
    if (hasFlag(rest, '--json')) printJson({ ...result, schema: 'gbrain.ops.work.complete.v1' });
    else console.log(`${result.work_item.id}\t${result.work_item.state}\tunblocked=${result.unblocked.length}`);
    return;
  }

  throw new Error(`Unknown ops work subcommand: ${action || '(missing)'}`);
}

function parseWorkState(raw: string): WorkItemState {
  if (!WORK_ITEM_STATES.includes(raw as WorkItemState)) throw new Error(`invalid work state: ${raw}`);
  return raw as WorkItemState;
}

function numberFlag(args: string[], flag: string): number | undefined {
  const raw = flagValue(args, flag);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${flag} must be a number`);
  return n;
}
