import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  createSourceTargetFetchWorkItemsFromYamlFile,
  getTopicTrackFromYamlFile,
  listSourceTargetsFromYamlFile,
  parseTopicTracksYaml,
  seedTopicTrackWorkItemsFromYamlFile,
  validateSourceTargetsFromYaml,
  validateTopicTracksYaml,
} from '../core/ops/kernel.ts';
import {
  appendTopicCandidateExtractionArtifact,
  extractTopicCandidatesFromScout,
  extractTopicCandidatesFromSourceSpans,
  readTopicExtractionInputFile,
  validateTopicCandidateExtractionReport,
} from '../core/topics/extractor.ts';
import {
  appendTopicClaimReductionArtifact,
  readTopicCandidateExtractionReportFile,
  reduceTopicClaimsFromExtraction,
  validateTopicClaimReductionReport,
} from '../core/topics/claim-reducer.ts';
import {
  appendTopicCurrentStateArtifact,
  appendTopicDailyDeltaArtifact,
  compileTopicCurrentState,
  compileTopicDailyDelta,
  readTopicReductionOrStateFile,
  validateTopicCurrentStateSurface,
  validateTopicDailyDeltaSurface,
} from '../core/topics/state-delta.ts';
import {
  appendTopicAnswerPackArtifact,
  compileTopicAnswerPack,
  readTopicAnswerPackInputs,
  validateTopicAnswerPack,
} from '../core/topics/answer-pack.ts';
import {
  appendTopicDashboardArtifact,
  compileTopicDashboard,
  readTopicDashboardInputs,
  validateTopicDashboard,
} from '../core/topics/dashboard.ts';

function flagValue(args: string[], flag: string): string | undefined {
  const ix = args.indexOf(flag);
  if (ix >= 0 && args[ix + 1] && !args[ix + 1].startsWith('--')) return args[ix + 1];
  const hit = args.find(a => a.startsWith(flag + '='));
  return hit ? hit.slice(flag.length + 1) : undefined;
}
function hasFlag(args: string[], flag: string): boolean { return args.includes(flag); }
function printJson(v: unknown): void { console.log(JSON.stringify(v, null, 2)); }
function defaultRegistryPath(): string { return resolve(join(import.meta.dir, '../../ops/always-on/topic_tracks.yaml')); }
function registryPath(args: string[]): string { return flagValue(args, '--file') || flagValue(args, '--registry') || defaultRegistryPath(); }

export async function runTopicsCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`gbrain topics list [--json] [--file <topic_tracks.yaml>]\ngbrain topics get <id> [--json] [--file <topic_tracks.yaml>]\ngbrain topics validate [--json] [--file <topic_tracks.yaml>]\ngbrain topics seed-work <id> --json [--store <ops.jsonl>] [--file <topic_tracks.yaml>] [--force]\ngbrain topics extract --topic <id> --from-source-spans <file>|--from-scout-report <file> [--json] [--out <json>] [--artifact-store <jsonl>] [--no-store]\ngbrain topics reduce-claims --topic <id> --from-extraction <file> [--json] [--out <json>] [--artifact-store <jsonl>] [--no-store]\ngbrain topics state --topic <id> --from-reduction <file> [--from-extraction <file>] [--json] [--out <json>] [--artifact-store <jsonl>] [--no-store]\ngbrain topics delta --topic <id> --from-current <file> [--from-previous <file>] [--json] [--out <json>] [--artifact-store <jsonl>] [--no-store]\ngbrain topics answer-pack --topic <id> [--domain <domain>] --from-state <file>|--from-reduction <file> [--from-source-spans <file>] [--json] [--out <json>] [--artifact-store <jsonl>] [--no-store]\ngbrain topics dashboard --topic <id> [--from-state <file>] [--from-delta <file>] [--from-opportunities <file>] [--from-answer-pack <file>] [--from-bookmark-radar <file>] [--from-report-audit <file>] [--from-report-reduction <file>] [--from-work-items <file>] [--json] [--out <json>] [--artifact-store <jsonl>] [--no-store]\ngbrain topics source-targets list <topic-id> [--json] [--file <topic_tracks.yaml>]\ngbrain topics source-targets validate [<topic-id>] [--json] [--file <topic_tracks.yaml>]\ngbrain topics source-targets seed-fetch-work <topic-id> --json [--store <ops.jsonl>] [--file <topic_tracks.yaml>] [--force]\n\nTopicTrack v2 registry, Research Plan DSL, public source target commands, review-only candidate extraction, claim reduction, current-state, daily-delta, domain-scoped answer-pack, and topic dashboard surfaces. Public P3/world only; WorkItem creation never performs live web fetching.`);
     return;
   }

  if (sub === 'extract') {
    const topic = flagValue(rest, '--topic') || rest.find(a => !a.startsWith('--'));
    if (!topic) throw new Error('gbrain topics extract requires --topic <id>');
    const from = flagValue(rest, '--from-source-spans') || flagValue(rest, '--from-spans') || flagValue(rest, '--from-scout-report') || flagValue(rest, '--from-run');
    if (!from) throw new Error('gbrain topics extract requires --from-source-spans <file> or --from-scout-report <file>');
    const input = readTopicExtractionInputFile(from);
    const report = input.scout_report
      ? extractTopicCandidatesFromScout(input.scout_report, { topic_id: topic })
      : extractTopicCandidatesFromSourceSpans({ topic_id: topic, source_items: input.source_items, source_spans: input.source_spans || [] });
    const errors = validateTopicCandidateExtractionReport(report);
    const out = flagValue(rest, '--out');
    if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    let stored_at: string | undefined;
    if (!hasFlag(rest, '--no-store') && !hasFlag(rest, '--dry-run')) stored_at = appendTopicCandidateExtractionArtifact(report, flagValue(rest, '--artifact-store'));
    const payload = { ok: errors.length === 0, schema: 'gbrain.topics.extract.v1', errors, stored_at, report };
    if (hasFlag(rest, '--json') || out) printJson(payload);
    else console.log(`${report.topic_id}\tclaims=${report.topic_claims.length}\tentities=${report.topic_entities.length}\tevents=${report.topic_events.length}\tproblem_signals=${report.topic_problem_signals.length}\tunsupported=${report.diagnostics.unsupported_candidates}\tstored_at=${stored_at || 'none'}`);
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (sub === 'reduce-claims') {
    const topic = flagValue(rest, '--topic') || rest.find(a => !a.startsWith('--'));
    if (!topic) throw new Error('gbrain topics reduce-claims requires --topic <id>');
    const from = flagValue(rest, '--from-extraction') || flagValue(rest, '--from-candidates') || flagValue(rest, '--from');
    if (!from) throw new Error('gbrain topics reduce-claims requires --from-extraction <file>');
    const extraction = readTopicCandidateExtractionReportFile(from);
    const report = reduceTopicClaimsFromExtraction(extraction, { topic_id: topic });
    const errors = validateTopicClaimReductionReport(report);
    const out = flagValue(rest, '--out');
    if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    let stored_at: string | undefined;
    if (!hasFlag(rest, '--no-store') && !hasFlag(rest, '--dry-run')) stored_at = appendTopicClaimReductionArtifact(report, flagValue(rest, '--artifact-store'));
    const payload = { ok: errors.length === 0, schema: 'gbrain.topics.reduce_claims.v1', errors, stored_at, report };
    if (hasFlag(rest, '--json') || out) printJson(payload);
    else console.log(`${report.topic_id}\tclaims=${report.diagnostics.claims_emitted}\tsupported=${report.diagnostics.supported_claims}\tdraft=${report.diagnostics.draft_claims}\tcontested=${report.diagnostics.contested_claims}\tstored_at=${stored_at || 'none'}`);
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (sub === 'state') {
    const topic = flagValue(rest, '--topic') || rest.find(a => !a.startsWith('--'));
    if (!topic) throw new Error('gbrain topics state requires --topic <id>');
    const fromReduction = flagValue(rest, '--from-reduction') || flagValue(rest, '--from-claims') || flagValue(rest, '--from');
    if (!fromReduction) throw new Error('gbrain topics state requires --from-reduction <file>');
    const reduction = readTopicReductionOrStateFile(fromReduction);
    if (reduction.schema !== 'gbrain.topics.claim_reduction_report.v1') throw new Error('gbrain topics state --from-reduction must contain gbrain.topics.claim_reduction_report.v1');
    const fromExtraction = flagValue(rest, '--from-extraction') || flagValue(rest, '--from-candidates');
    const extraction = fromExtraction ? readTopicCandidateExtractionReportFile(fromExtraction) : undefined;
    const surface = compileTopicCurrentState({ topic_id: topic, reduction, extraction });
    const errors = validateTopicCurrentStateSurface(surface);
    const out = flagValue(rest, '--out');
    if (out) writeFileSync(out, JSON.stringify(surface, null, 2) + '\n');
    let stored_at: string | undefined;
    if (!hasFlag(rest, '--no-store') && !hasFlag(rest, '--dry-run')) stored_at = appendTopicCurrentStateArtifact(surface, flagValue(rest, '--artifact-store'));
    const payload = { ok: errors.length === 0, schema: 'gbrain.topics.state.v1', errors, stored_at, surface };
    if (hasFlag(rest, '--json') || out) printJson(payload);
    else console.log(`${surface.topic_id}\tclaims=${surface.coverage.current_claims}\tunknowns=${surface.open_unknowns.length}\tnext_work=${surface.next_work.length}\tstored_at=${stored_at || 'none'}`);
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (sub === 'delta') {
    const topic = flagValue(rest, '--topic') || rest.find(a => !a.startsWith('--'));
    if (!topic) throw new Error('gbrain topics delta requires --topic <id>');
    const fromCurrent = flagValue(rest, '--from-current') || flagValue(rest, '--from-reduction') || flagValue(rest, '--from');
    if (!fromCurrent) throw new Error('gbrain topics delta requires --from-current <file>');
    const current = readTopicReductionOrStateFile(fromCurrent);
    const fromPrevious = flagValue(rest, '--from-previous') || flagValue(rest, '--previous');
    const previous = fromPrevious ? readTopicReductionOrStateFile(fromPrevious) : undefined;
    const surface = compileTopicDailyDelta({ topic_id: topic, current, previous });
    const errors = validateTopicDailyDeltaSurface(surface);
    const out = flagValue(rest, '--out');
    if (out) writeFileSync(out, JSON.stringify(surface, null, 2) + '\n');
    let stored_at: string | undefined;
    if (!hasFlag(rest, '--no-store') && !hasFlag(rest, '--dry-run')) stored_at = appendTopicDailyDeltaArtifact(surface, flagValue(rest, '--artifact-store'));
    const payload = { ok: errors.length === 0, schema: 'gbrain.topics.delta.v1', errors, stored_at, surface };
    if (hasFlag(rest, '--json') || out) printJson(payload);
    else console.log(`${surface.topic_id}\tnew=${surface.material_new.length}\tchanged=${surface.changed.length}\trepeated=${surface.repeated.length}\tstale=${surface.stale.length}\tcontradicted=${surface.contradicted.length}\tstored_at=${stored_at || 'none'}`);
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (sub === 'answer-pack') {
    const topic = flagValue(rest, '--topic') || rest.find(a => !a.startsWith('--'));
    if (!topic) throw new Error('gbrain topics answer-pack requires --topic <id>');
    const fromState = flagValue(rest, '--from-state') || flagValue(rest, '--from-current');
    const fromReduction = flagValue(rest, '--from-reduction') || flagValue(rest, '--from-claims');
    const fromSourceSpans = flagValue(rest, '--from-source-spans') || flagValue(rest, '--from-spans');
    if (!fromState && !fromReduction) throw new Error('gbrain topics answer-pack requires --from-state <file> and/or --from-reduction <file>');
    const inputs = readTopicAnswerPackInputs({ state: fromState, reduction: fromReduction, sourceSpans: fromSourceSpans });
    const pack = compileTopicAnswerPack({ topic_id: topic, domain: flagValue(rest, '--domain'), state: inputs.state, reduction: inputs.reduction, source_items: inputs.source_items, source_spans: inputs.source_spans });
    const errors = validateTopicAnswerPack(pack);
    const allErrors = [...errors, ...pack.diagnostics.errors];
    const out = flagValue(rest, '--out');
    if (out) writeFileSync(out, JSON.stringify(pack, null, 2) + '\n');
    let stored_at: string | undefined;
    if (!hasFlag(rest, '--no-store') && !hasFlag(rest, '--dry-run')) stored_at = appendTopicAnswerPackArtifact(pack, flagValue(rest, '--artifact-store'));
    const payload = { ok: allErrors.length === 0 && !pack.readiness.unanswerable, schema: 'gbrain.topics.answer_pack.compile.v1', errors: allErrors, stored_at, pack };
    if (hasFlag(rest, '--json') || out) printJson(payload);
    else console.log(`${pack.topic_id}\treadiness=${pack.readiness.status}\tsupported=${pack.readiness.supported_claims}\tunsupported=${pack.readiness.unsupported_claims}\texcluded=${pack.readiness.excluded_sources}\tstored_at=${stored_at || 'none'}`);
    if (allErrors.length || pack.readiness.unanswerable) process.exitCode = 1;
    return;
  }

  if (sub === 'dashboard') {
    const topic = flagValue(rest, '--topic') || rest.find(a => !a.startsWith('--'));
    if (!topic) throw new Error('gbrain topics dashboard requires --topic <id>');
    const inputs = readTopicDashboardInputs({
      state: flagValue(rest, '--from-state') || flagValue(rest, '--from-current'),
      delta: flagValue(rest, '--from-delta'),
      opportunities: flagValue(rest, '--from-opportunities') || flagValue(rest, '--from-opportunity-radar'),
      answerPack: flagValue(rest, '--from-answer-pack'),
      bookmarkRadar: flagValue(rest, '--from-bookmark-radar') || flagValue(rest, '--from-bookmarks'),
      reportAudit: flagValue(rest, '--from-report-audit') || flagValue(rest, '--from-audit'),
      reportReduction: flagValue(rest, '--from-report-reduction') || flagValue(rest, '--from-reduction'),
      workItems: flagValue(rest, '--from-work-items') || flagValue(rest, '--from-ops'),
    });
    const surface = compileTopicDashboard({ topic_id: topic, ...inputs });
    const errors = validateTopicDashboard(surface);
    const out = flagValue(rest, '--out');
    if (out) writeFileSync(out, JSON.stringify(surface, null, 2) + '\n');
    let stored_at: string | undefined;
    if (!hasFlag(rest, '--no-store') && !hasFlag(rest, '--dry-run')) stored_at = appendTopicDashboardArtifact(surface, flagValue(rest, '--artifact-store'));
    const payload = { ok: errors.length === 0, schema: 'gbrain.topics.dashboard.compile.v1', errors, stored_at, surface };
    if (hasFlag(rest, '--json') || out) printJson(payload);
    else console.log(`${surface.topic_id}\tstatus=${surface.status}\tconfidence=${surface.coverage.confidence_overall}\topportunities=${surface.top_opportunities.length}\trisks=${surface.risks.length}\tnext_actions=${surface.next_actions.length}\tstored_at=${stored_at || 'none'}`);
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (sub === 'source-targets') {
    const [action, ...targetRest] = rest;
    if (action === 'list') {
      const id = targetRest.find(a => !a.startsWith('--'));
      if (!id) throw new Error('gbrain topics source-targets list requires <topic-id>');
      const file = registryPath(targetRest);
      const result = listSourceTargetsFromYamlFile(file, id);
      const payload = { ...result, schema: 'gbrain.topics.source_targets.list.v1' };
      if (hasFlag(targetRest, '--json')) printJson(payload);
      else for (const t of result.source_targets) console.log(`${t.id}\t${t.fetch_policy}\t${t.authority_tier}\t${t.label}`);
      return;
    }
    if (action === 'validate') {
      const id = targetRest.find(a => !a.startsWith('--'));
      const file = registryPath(targetRest);
      const result = validateSourceTargetsFromYaml(readFileSync(file, 'utf8'), id);
      const payload = { ok: result.ok, schema: 'gbrain.topics.source_targets.validate.v1', source_file: file, topic_id: id, errors: result.errors, source_target_count: result.source_targets.length };
      if (hasFlag(targetRest, '--json')) printJson(payload);
      else console.log(result.ok ? `ok\tsource_targets=${result.source_targets.length}` : result.errors.join('\n'));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (action === 'seed-fetch-work') {
      const id = targetRest.find(a => !a.startsWith('--'));
      if (!id) throw new Error('gbrain topics source-targets seed-fetch-work requires <topic-id>');
      const file = registryPath(targetRest);
      const result = createSourceTargetFetchWorkItemsFromYamlFile(file, id, { path: flagValue(targetRest, '--store'), force: hasFlag(targetRest, '--force') });
      const payload = { ...result, schema: 'gbrain.topics.source_targets.seed_fetch_work.v1' };
      if (hasFlag(targetRest, '--json')) printJson(payload);
      else console.log(`seeded ${result.created_count} source-target fetch work items for ${result.topic_track.id}; skipped=${result.skipped_count}`);
      return;
    }
    throw new Error(`Unknown topics source-targets subcommand: ${action || ''}`);
  }

  if (sub === 'list') {
    const file = registryPath(rest);
    const tracks = parseTopicTracksYaml(readFileSync(file, 'utf8')).topic_tracks.sort((a, b) => a.tier.localeCompare(b.tier) || b.priority - a.priority || a.id.localeCompare(b.id));
    if (hasFlag(rest, '--json')) printJson({ ok: true, schema: 'gbrain.topics.list.v2', source_file: file, topic_tracks: tracks });
    else for (const t of tracks) console.log(`${t.id}\t${t.tier}\t${t.status}\t${t.title}`);
    return;
  }

  if (sub === 'get') {
    const id = rest.find(a => !a.startsWith('--'));
    if (!id) throw new Error('gbrain topics get requires <id>');
    const file = registryPath(rest);
    const topic_track = getTopicTrackFromYamlFile(file, id);
    if (hasFlag(rest, '--json')) printJson({ ok: true, schema: 'gbrain.topics.get.v2', source_file: file, topic_track });
    else console.log(`${topic_track.id}\t${topic_track.tier}\t${topic_track.status}\t${topic_track.title}\n${topic_track.why_it_matters_to_chief}`);
    return;
  }

  if (sub === 'validate') {
    const file = registryPath(rest);
    const result = validateTopicTracksYaml(readFileSync(file, 'utf8'));
    const payload = { ok: result.ok, schema: 'gbrain.topics.validate.v2', source_file: file, errors: result.errors, topic_count: result.topic_tracks.length };
    if (hasFlag(rest, '--json')) printJson(payload);
    else console.log(result.ok ? `ok\ttopics=${result.topic_tracks.length}` : result.errors.join('\n'));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (sub === 'seed-work') {
    const id = rest.find(a => !a.startsWith('--'));
    if (!id) throw new Error('gbrain topics seed-work requires <id>');
    const file = registryPath(rest);
    const result = seedTopicTrackWorkItemsFromYamlFile(file, id, { path: flagValue(rest, '--store'), force: hasFlag(rest, '--force') });
    const payload = { ...result, schema: 'gbrain.topics.seed_work.v2' };
    if (hasFlag(rest, '--json')) printJson(payload);
    else console.log(`seeded ${result.created_count} work items for ${result.topic_track.id}; skipped=${result.skipped_count}`);
    return;
  }

  throw new Error(`Unknown topics subcommand: ${sub}`);
}
