import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  getTopicTrackFromYamlFile,
  parseTopicTracksYaml,
  seedTopicTrackWorkItemsFromYamlFile,
  validateTopicTracksYaml,
} from '../core/ops/kernel.ts';
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
    console.log(`gbrain topics list [--json] [--file <topic_tracks.yaml>]\ngbrain topics get <id> [--json] [--file <topic_tracks.yaml>]\ngbrain topics validate [--json] [--file <topic_tracks.yaml>]\ngbrain topics seed-work <id> --json [--store <ops.jsonl>] [--file <topic_tracks.yaml>] [--force]\n\nTopicTrack v2 registry and Research Plan DSL commands. Public P3/world only; seed-work creates ops-kernel WorkItems but never fetches live web.`);
    return;
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
