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
    console.log(`gbrain topics list [--json] [--file <topic_tracks.yaml>]\ngbrain topics get <id> [--json] [--file <topic_tracks.yaml>]\ngbrain topics validate [--json] [--file <topic_tracks.yaml>]\ngbrain topics seed-work <id> --json [--store <ops.jsonl>] [--file <topic_tracks.yaml>] [--force]\ngbrain topics extract --topic <id> --from-source-spans <file>|--from-scout-report <file> [--json] [--out <json>] [--artifact-store <jsonl>] [--no-store]\ngbrain topics source-targets list <topic-id> [--json] [--file <topic_tracks.yaml>]\ngbrain topics source-targets validate [<topic-id>] [--json] [--file <topic_tracks.yaml>]\ngbrain topics source-targets seed-fetch-work <topic-id> --json [--store <ops.jsonl>] [--file <topic_tracks.yaml>] [--force]\n\nTopicTrack v2 registry, Research Plan DSL, public source target commands, and review-only candidate extraction. Public P3/world only; WorkItem creation never performs live web fetching.`);
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
