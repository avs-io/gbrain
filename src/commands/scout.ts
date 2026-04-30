import { readFileSync, writeFileSync } from 'node:fs';
import {
  buildScoutQueryPlan,
  buildScoutSignalFromSource,
  scoutRecipeById,
  BUILTIN_SCOUT_RECIPES,
  listTopicTracks,
  scoutReportJson,
  validateScoutRecipe,
} from '../core/scout/pipeline.ts';

function parseArgs(args: string[]): Record<string, string | boolean | undefined> {
  const out: Record<string, string | boolean | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    if (a.startsWith('--') && a.includes('=')) {
      const [k, v] = a.slice(2).split(/=(.*)/s, 2);
      out[k.replace(/-/g, '_')] = v;
    } else if (a.startsWith('--')) {
      const k = a.slice(2).replace(/-/g, '_');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) out[k] = next, i++;
      else out[k] = true;
    } else if (!out._sub) {
      out._sub = a;
    }
  }
  return out;
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readJsonArrayFile(path: string): unknown[] {
  const value = readJsonFile(path);
  if (!Array.isArray(value)) throw new Error(`Expected ${path} to contain a JSON array`);
  return value;
}

function recipeSummaryLine(recipe: typeof BUILTIN_SCOUT_RECIPES[number]): string {
  return `${recipe.slug}\t${recipe.topic}\t${recipe.title}`;
}

export async function runScoutCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const flags = parseArgs(rest);
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`gbrain scout recipes list --json\ngbrain scout recipes get <slug> --json\ngbrain scout recipes validate --file <file> --json\ngbrain scout topics list --json\ngbrain scout plan <slug> --json\ngbrain scout run --recipe <id> --input <sources.json> [--json] [--out <report.json>] [--yes]\ngbrain scout signal --recipe <id> --source-url <url>|--source-title <title> --claim <text> --excerpt <text> [--entity <name>]... [--json] [--out <jsonl>] [--yes]`);
    return;
  }

  if (sub === 'recipes') {
    const [recipeSub, maybeSlug] = rest;
    const recipeFlags = parseArgs(rest.slice(recipeSub && !recipeSub.startsWith('--') ? 1 : 0));

    if (!recipeSub || recipeSub.startsWith('--') || recipeSub === 'list') {
      const payload = { ok: true, review_only: true, recipes: BUILTIN_SCOUT_RECIPES };
      console.log(recipeFlags.json || flags.json ? JSON.stringify(payload, null, 2) : BUILTIN_SCOUT_RECIPES.map(recipeSummaryLine).join('\n'));
      return;
    }

    if (recipeSub === 'get') {
      const slug = String(maybeSlug || '').trim();
      const recipe = scoutRecipeById(slug);
      if (!recipe) throw new Error(`Unknown scout recipe: ${slug}. Available: ${BUILTIN_SCOUT_RECIPES.map(r => r.slug).join(', ')}`);
      console.log(recipeFlags.json ? JSON.stringify({ ok: true, recipe }, null, 2) : recipeSummaryLine(recipe));
      return;
    }

    if (recipeSub === 'validate') {
      const file = typeof recipeFlags.file === 'string' ? recipeFlags.file : undefined;
      if (!file) throw new Error('recipes validate requires --file <file>');
      const recipe = readJsonFile(file);
      const errors = validateScoutRecipe(recipe);
      const payload = { ok: errors.length === 0, errors };
      console.log(recipeFlags.json ? JSON.stringify(payload, null, 2) : (errors.length ? errors.join('\n') : 'ok'));
      if (errors.length) process.exitCode = 1;
      return;
    }

    throw new Error(`Unknown scout recipes subcommand: ${recipeSub}`);
  }

  if (sub === 'topics') {
    const [topicSub] = rest;
    const topicFlags = parseArgs(rest.slice(topicSub && !topicSub.startsWith('--') ? 1 : 0));
    if (!topicSub || topicSub.startsWith('--') || topicSub === 'list') {
      const tracks = listTopicTracks();
      console.log(topicFlags.json || flags.json ? JSON.stringify({ ok: true, tracks }, null, 2) : tracks.map(t => `${t.slug}\t${t.title}`).join('\n'));
      return;
    }
    throw new Error(`Unknown scout topics subcommand: ${topicSub}`);
  }

  if (sub === 'plan') {
    const slug = String(rest.find(v => !v.startsWith('--')) || '').trim();
    const planFlags = parseArgs(rest.filter(v => v !== slug));
    const recipe = scoutRecipeById(slug);
    if (!recipe) throw new Error(`Unknown scout recipe: ${slug}. Available: ${BUILTIN_SCOUT_RECIPES.map(r => r.slug).join(', ')}`);
    const plan = buildScoutQueryPlan(recipe);
    console.log(planFlags.json || flags.json ? JSON.stringify({ ok: true, plan }, null, 2) : plan.queries.map(q => `${q.id}\t${q.query}`).join('\n'));
    return;
  }

  if (sub === 'signal') {
    const recipeId = String(flags.recipe || '').trim();
    const recipe = scoutRecipeById(recipeId);
    if (!recipe) throw new Error(`Unknown scout recipe: ${recipeId}`);
    const source_url = typeof flags.source_url === 'string' ? flags.source_url : undefined;
    const source_title = typeof flags.source_title === 'string' ? flags.source_title : undefined;
    const claim = String(flags.claim || '').trim();
    const excerpt = String(flags.excerpt || '').trim();
    const entities = rest.filter((v, idx) => rest[idx - 1] === '--entity' || v.startsWith('--entity=')).map(v => v.startsWith('--entity=') ? v.slice(9) : v);
    const signal = buildScoutSignalFromSource({ recipe, source: { source_url, source_title, published_at: typeof flags.published_at === 'string' ? flags.published_at : undefined, claim, excerpt, entities } });
    const report = scoutReportJson(signal);
    const json = JSON.stringify(report, null, 2);
    const out = typeof flags.out === 'string' ? flags.out : undefined;
    if (out) {
      if (!flags.yes) console.log(json);
      else writeFileSync(out, json + '\n');
    }
    console.log(flags.json ? json : `${signal.id}\t${signal.topic}\t${signal.confidence}`);
    return;
  }

  if (sub === 'run') {
    const recipeId = String(flags.recipe || '').trim();
    const recipe = scoutRecipeById(recipeId);
    if (!recipe) throw new Error(`Unknown scout recipe: ${recipeId}`);
    const inputPath = typeof flags.input === 'string' ? flags.input : undefined;
    if (!inputPath) throw new Error('scout run requires --input <sources.json>');
    const rawSources = readJsonArrayFile(inputPath);
    const signals = rawSources.map((source, idx) => {
      if (typeof source !== 'object' || source === null) throw new Error(`sources[${idx}] must be an object`);
      return buildScoutSignalFromSource({
        recipe,
        source: {
          source_url: typeof (source as any).source_url === 'string' ? (source as any).source_url : undefined,
          source_title: typeof (source as any).source_title === 'string' ? (source as any).source_title : undefined,
          published_at: typeof (source as any).published_at === 'string' ? (source as any).published_at : undefined,
          claim: String((source as any).claim || '').trim(),
          excerpt: String((source as any).excerpt || '').trim(),
          entities: Array.isArray((source as any).entities) ? (source as any).entities.filter((v: unknown): v is string => typeof v === 'string') : undefined,
        },
      });
    });
    const report = {
      schema: 'gbrain.scout.run_report.v1',
      mode: 'review-only',
      trusted_world_truth: false,
      recipe,
      plan: buildScoutQueryPlan(recipe),
      signal_count: signals.length,
      signals,
    };
    const json = JSON.stringify(report, null, 2);
    const out = typeof flags.out === 'string' ? flags.out : undefined;
    if (out && flags.yes) writeFileSync(out, json + '\n');
    else if (out) console.log(json);
    console.log(flags.json ? json : `${recipe.slug}\trun\tsignals=${signals.length}`);
    return;
  }

  throw new Error(`Unknown scout subcommand: ${sub}`);
}
