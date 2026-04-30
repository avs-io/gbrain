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
  importRoadmapFile,
  initOpsStore,
  listPrograms,
  listWorkItems,
  opsStatus,
  roadmapStatus,
  reconcileOpenClawTasks,
  opsStorePath,
  parseWorkerProfilesYaml,
  readOpsState,
  renderWorkPackMarkdown,
  renderOpsDashboardMarkdown,
  selectWorkerRoute,
  superviseOps,
  syncTopicTracksFromYamlFile,
  syncProgramsFromYamlFile,
  syncWorkerProfilesFromYamlFile,
  listWorkerProfiles,
  listOpsTopicTracks,
  type WorkItemState,
} from '../core/ops/kernel.ts';
import { runTopicTrackScoutCycle } from '../core/scout/topic-track-cycle.ts';
import {
  buildLaunchAgentPlan,
  heartbeatCheck,
  heartbeatTemplateMarkdown,
} from '../core/ops/liveness.ts';
import { readBookmarkBatchFile, runBookmarkActionRadar } from '../core/ops/bookmark-action-radar.ts';
import { readMeetingTranscriptFile, runMeetingTranscriptActions, writeMeetingTranscriptActionReport } from '../core/ops/meeting-transcript-actions.ts';
import { buildOpportunityBriefReadySurface, readOpportunityRadarInputFile, recordOpportunityFeedback, runOpportunityRadar, writeOpportunityReport } from '../core/ops/opportunity-radar.ts';
import {
  buildDailyBuildReportSurface,
  buildMorningBriefSurface,
  buildWeeklyStrategySynthesisSurface,
  renderDailyBuildReportMarkdown,
  renderMorningBriefMarkdown,
  renderWeeklyStrategyMarkdown,
  writeBriefingSurface,
} from '../core/ops/briefing-surfaces.ts';

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
gbrain ops workers list --json [--store <path>]
gbrain ops workers sync --file <worker_profiles.yaml> --json [--store <path>]
gbrain ops topic-tracks list --json [--store <path>]
gbrain ops topic-tracks sync --file <topic_tracks.yaml> --json [--store <path>]
gbrain ops scout cycle --topic-track <id> --input <public-sources.json> --json [--store <path>] [--out <report.json>]
gbrain ops bookmarks radar --input <bookmarks.json|bookmarks.md> --json [--store <path>] [--archive <decisions.jsonl>] [--out <report.json>]
gbrain ops meetings extract --input <transcript.md|txt> --json [--store <path>] [--archive <reports.jsonl>] [--actions-store <action-proposals.jsonl>] [--out <report.json>]
gbrain ops opportunities radar --input <signals.json> --json [--store <path>] [--out <report.json>]
gbrain ops opportunities brief-ready --json [--store <path>] [--limit 5] [--out <surface.json>]
gbrain ops opportunities feedback <candidate-id> --useful|--not-useful [--reason <text>] --json [--store <path>]
gbrain ops brief morning --json|--markdown [--store <path>] [--opportunities-store <path>] [--limit 5] [--out <surface.json>]
gbrain ops brief daily-build --json|--markdown [--store <path>] [--opportunities-store <path>] [--limit 12] [--out <surface.json>]
gbrain ops brief weekly-strategy --json|--markdown [--store <path>] [--opportunities-store <path>] [--limit 8] [--out <surface.json>]
gbrain ops dashboard [--json|--markdown] [--output <DASHBOARD.md>] [--store <path>]
gbrain ops work list [--state proposed|approved|ready|leased|running|succeeded|failed|blocked|waiting_human|cancelled|quarantined] --json [--store <path>]
gbrain ops work enqueue --packet <file.json> [--store <path>] [--json]
gbrain ops work claim --id <id> --worker <worker_id> --json [--store <path>]
gbrain ops work pack --id <id> [--out <path>] [--json] [--store <path>]
gbrain ops work complete --id <id> --completion <completion.json> [--store <path>] [--json]
gbrain ops roadmap import --file <roadmap.yaml|json> --json [--store <path>]
gbrain ops roadmap status --flow-id <id> --json [--store <path>]
gbrain ops workers list --json [--profiles <worker_profiles.yaml>]
gbrain ops workers route --id <work_item_id> --json [--store <path>] [--profiles <worker_profiles.yaml>]
gbrain ops dispatch --id <work_item_id> --dry-run --json [--store <path>] [--provider <p>] [--model <m>] [--openclaw-task-id <id>] [--session-key <key>]
gbrain ops reconcile --fixture <openclaw-tasks.json> --json [--store <path>]
gbrain ops supervise --once --json [--store <path>] [--max-claims 1] [--max-running 1] [--profiles <worker_profiles.yaml>]
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

  if (sub === 'workers') {
    const action = rest[0];
    const actionArgs = rest.slice(1);
    if (action === 'list') {
      const profilesFile = flagValue(actionArgs, '--profiles');
      const worker_profiles = profilesFile ? parseWorkerProfilesYaml(readFileSync(profilesFile, 'utf8')).workers : listWorkerProfiles({ path: storePath(actionArgs) });
      if (hasFlag(actionArgs, '--json')) printJson({ ok: true, schema: 'gbrain.ops.workers.list.v1', worker_profiles });
      else for (const p of worker_profiles) console.log(`${p.id}\t${p.provider}\t${p.model || ''}\t${p.worker_kind}`);
      return;
    }
    if (action === 'sync') {
      const file = flagValue(actionArgs, '--file');
      if (!file) throw new Error('gbrain ops workers sync requires --file <worker_profiles.yaml>');
      const result = syncWorkerProfilesFromYamlFile(file, { path: storePath(actionArgs) });
      if (hasFlag(actionArgs, '--json')) printJson({ ...result, schema: 'gbrain.ops.workers.sync.v1' });
      else console.log(`synced ${result.upserted_count} worker profiles from ${result.source_file}`);
      return;
    }
    if (action === 'route') {
      const id = flagValue(actionArgs, '--id');
      if (!id) throw new Error('gbrain ops workers route requires --id <work_item_id>');
      const profilesFile = flagValue(actionArgs, '--profiles');
      const state = readOpsState(storePath(actionArgs));
      const item = state.work_items.find(w => w.id === id);
      if (!item) throw new Error(`work item not found: ${id}`);
      const routeState = profilesFile ? { ...state, worker_profiles: parseWorkerProfilesYaml(readFileSync(profilesFile, 'utf8')).workers } : state;
      const route = selectWorkerRoute(item, routeState);
      if (hasFlag(actionArgs, '--json')) printJson({ ok: true, schema: 'gbrain.ops.workers.route.v1', route });
      else console.log(`${route.work_item_id}\t${route.status}\t${route.worker_profile_id || ''}\t${route.provider}\t${route.reason}`);
      return;
    }
    throw new Error('gbrain ops workers supports: list, sync, route');
  }

  if (sub === 'topic-tracks' || sub === 'topics') {
    const action = rest[0];
    const actionArgs = rest.slice(1);
    if (!action || action === 'list') {
      const topic_tracks = listOpsTopicTracks({ path: storePath(actionArgs) });
      if (hasFlag(actionArgs, '--json')) printJson({ ok: true, schema: 'gbrain.ops.topic_tracks.list.v1', topic_tracks });
      else for (const t of topic_tracks) console.log(`${t.id}\t${t.status}\t${t.priority}\t${t.title}`);
      return;
    }
    if (action === 'sync') {
      const file = flagValue(actionArgs, '--file');
      if (!file) throw new Error('gbrain ops topic-tracks sync requires --file <topic_tracks.yaml>');
      const result = syncTopicTracksFromYamlFile(file, { path: storePath(actionArgs) });
      if (hasFlag(actionArgs, '--json')) printJson({ ...result, schema: 'gbrain.ops.topic_tracks.sync.v1' });
      else console.log(`synced ${result.upserted_count} topic tracks from ${result.source_file}`);
      return;
    }
    throw new Error('gbrain ops topic-tracks supports: list, sync');
  }

  if (sub === 'scout') {
    const action = rest[0];
    const actionArgs = rest.slice(1);
    if (action !== 'cycle') throw new Error('gbrain ops scout supports: cycle');
    const topicTrackId = flagValue(actionArgs, '--topic-track') || flagValue(actionArgs, '--track') || flagValue(actionArgs, '--id');
    if (!topicTrackId) throw new Error('gbrain ops scout cycle requires --topic-track <id>');
    const input = flagValue(actionArgs, '--input');
    if (!input) throw new Error('gbrain ops scout cycle requires --input <public-sources.json>');
    const sources = JSON.parse(readFileSync(input, 'utf8'));
    if (!Array.isArray(sources)) throw new Error('gbrain ops scout cycle --input must be a JSON array');
    const report = runTopicTrackScoutCycle({ topicTrackId, sources, storePath: storePath(actionArgs), since: flagValue(actionArgs, '--since') });
    const out = flagValue(actionArgs, '--out');
    if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    if (hasFlag(actionArgs, '--json') || out) printJson(report);
    else console.log(`${report.topic_track_id}\tsources=${report.scout_report.source_items.length}\tclaims=${report.extraction.claims.length}\tdeltas=${report.recent_deltas.new.length + report.recent_deltas.changed.length + report.recent_deltas.repeated.length}\tsurfacing=${report.surfacing_candidates.length}`);
    return;
  }

  if (sub === 'bookmarks') {
    const action = rest[0];
    const actionArgs = rest.slice(1);
    if (action !== 'radar') throw new Error('gbrain ops bookmarks supports: radar');
    const input = flagValue(actionArgs, '--input');
    if (!input) throw new Error('gbrain ops bookmarks radar requires --input <bookmarks.json|bookmarks.md>');
    const bookmarks = readBookmarkBatchFile(input);
    const minScore = flagValue(actionArgs, '--surface-min-score');
    const interruptScore = flagValue(actionArgs, '--interrupt-min-score');
    const report = runBookmarkActionRadar({
      bookmarks,
      storePath: storePath(actionArgs),
      archivePath: flagValue(actionArgs, '--archive'),
      surfaceMinScore: minScore ? Number(minScore) : undefined,
      interruptMinScore: interruptScore ? Number(interruptScore) : undefined,
    });
    const out = flagValue(actionArgs, '--out');
    if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    if (hasFlag(actionArgs, '--json') || out) printJson(report);
    else console.log(`bookmarks=${report.deduped_count}\twork_items=${report.created_work_items.length}\tarchived=${report.archived_decisions.length}\tsurfaced=${report.surfaced_candidates.length}`);
    return;
  }

  if (sub === 'meetings' || sub === 'meeting-transcripts') {
    const action = rest[0];
    const actionArgs = rest.slice(1);
    if (action !== 'extract') throw new Error('gbrain ops meetings supports: extract');
    const input = flagValue(actionArgs, '--input');
    if (!input) throw new Error('gbrain ops meetings extract requires --input <transcript.md|txt>');
    const report = runMeetingTranscriptActions({
      transcript: readMeetingTranscriptFile(input),
      transcriptRef: flagValue(actionArgs, '--transcript-ref') || input,
      storePath: storePath(actionArgs),
      archivePath: flagValue(actionArgs, '--archive'),
      actionProposalPath: flagValue(actionArgs, '--actions-store'),
    });
    const out = flagValue(actionArgs, '--out');
    if (out) writeMeetingTranscriptActionReport(out, report);
    if (hasFlag(actionArgs, '--json') || out) printJson(report);
    else console.log(`commitments=${report.commitments.length}\tfollow_ups=${report.follow_ups.length}\treminders=${report.reminders.length}\tmemory_proposals=${report.memory_proposals.length}\twork_items=${report.created_work_items.length}`);
    return;
  }

  if (sub === 'opportunities' || sub === 'opportunity-radar') {
    const action = rest[0];
    const actionArgs = rest.slice(1);
    if (action === 'radar' || action === 'run') {
      const input = flagValue(actionArgs, '--input');
      if (!input) throw new Error('gbrain ops opportunities radar requires --input <signals.json>');
      const parsed = readOpportunityRadarInputFile(input);
      const report = runOpportunityRadar({ ...parsed, storePath: storePath(actionArgs), topN: flagValue(actionArgs, '--limit') ? Number(flagValue(actionArgs, '--limit')) : parsed.topN });
      const out = flagValue(actionArgs, '--out');
      if (out) writeOpportunityReport(out, report);
      if (hasFlag(actionArgs, '--json') || out) printJson(report);
      else console.log(`opportunities=${report.candidate_count}\tbrief_ready=${report.brief_ready.top_candidates.length}\tfalse_positives=${report.brief_ready.false_positive_count}`);
      return;
    }
    if (action === 'brief-ready' || action === 'brief') {
      const surface = buildOpportunityBriefReadySurface({ storePath: storePath(actionArgs), topN: flagValue(actionArgs, '--limit') ? Number(flagValue(actionArgs, '--limit')) : undefined });
      const out = flagValue(actionArgs, '--out');
      if (out) writeOpportunityReport(out, surface);
      if (hasFlag(actionArgs, '--json') || out) printJson(surface);
      else for (const c of surface.top_candidates) console.log(`${c.id}\t${c.scores.final}\t${c.title}`);
      return;
    }
    if (action === 'feedback') {
      const candidateId = actionArgs.find(a => !a.startsWith('--'));
      if (!candidateId) throw new Error('gbrain ops opportunities feedback requires <candidate-id>');
      const value = hasFlag(actionArgs, '--useful') ? 'useful' : hasFlag(actionArgs, '--not-useful') ? 'not_useful' : undefined;
      if (!value) throw new Error('gbrain ops opportunities feedback requires --useful or --not-useful');
      const feedback = recordOpportunityFeedback({ candidateId, value, reason: flagValue(actionArgs, '--reason'), storePath: storePath(actionArgs) });
      if (hasFlag(actionArgs, '--json')) printJson({ ok: true, schema: 'gbrain.ops.opportunity_feedback.result.v1', feedback });
      else console.log(`${feedback.candidate_id}\t${feedback.value}\tfalse_positive=${feedback.false_positive}`);
      return;
    }
    throw new Error('gbrain ops opportunities supports: radar, brief-ready, feedback');
  }

  if (sub === 'brief' || sub === 'briefs' || sub === 'surfaces') {
    const action = rest[0];
    const actionArgs = rest.slice(1);
    const common = { opsStorePath: storePath(actionArgs), opportunityStorePath: flagValue(actionArgs, '--opportunities-store') || flagValue(actionArgs, '--opportunity-store'), limit: numberFlag(actionArgs, '--limit') };
    let surface: ReturnType<typeof buildMorningBriefSurface> | ReturnType<typeof buildDailyBuildReportSurface> | ReturnType<typeof buildWeeklyStrategySynthesisSurface>;
    let markdown: string;
    if (action === 'morning' || action === 'morning-brief') {
      surface = buildMorningBriefSurface(common);
      markdown = renderMorningBriefMarkdown(surface);
    } else if (action === 'daily-build' || action === 'daily') {
      surface = buildDailyBuildReportSurface(common);
      markdown = renderDailyBuildReportMarkdown(surface);
    } else if (action === 'weekly-strategy' || action === 'weekly') {
      surface = buildWeeklyStrategySynthesisSurface(common);
      markdown = renderWeeklyStrategyMarkdown(surface);
    } else {
      throw new Error('gbrain ops brief supports: morning, daily-build, weekly-strategy');
    }
    const out = flagValue(actionArgs, '--out');
    if (out) writeBriefingSurface(out, surface);
    if (hasFlag(actionArgs, '--markdown')) console.log(markdown);
    else if (hasFlag(actionArgs, '--json') || out) printJson(surface);
    else console.log(markdown);
    return;
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

  if (sub === 'roadmap') {
    await runRoadmap(rest);
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
    const profilesFile = flagValue(rest, '--profiles');
    if (profilesFile) syncWorkerProfilesFromYamlFile(profilesFile, { path: storePath(rest) });
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

async function runRoadmap(args: string[]): Promise<void> {
  const action = args[0];
  const rest = args.slice(1);
  if (action === 'import') {
    const file = flagValue(rest, '--file');
    if (!file) throw new Error('gbrain ops roadmap import requires --file <roadmap.yaml|json>');
    const result = importRoadmapFile(file, { path: storePath(rest) });
    if (hasFlag(rest, '--json')) printJson(result);
    else console.log(`${result.flow.id}\titems=${result.work_items.length}\tauto_advance=${result.flow.auto_advance}`);
    return;
  }
  if (action === 'status') {
    const flowId = flagValue(rest, '--flow-id');
    if (!flowId) throw new Error('gbrain ops roadmap status requires --flow-id <id>');
    const result = roadmapStatus(flowId, { path: storePath(rest) });
    if (hasFlag(rest, '--json')) printJson(result);
    else console.log(`${result.flow.id}\tcurrent=${result.current_step?.id || 'complete'}\tready=${result.counts.ready}\trunning=${result.counts.running}\tblocked=${result.counts.blocked}`);
    return;
  }
  throw new Error(`Unknown ops roadmap subcommand: ${action || '(missing)'}`);
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
