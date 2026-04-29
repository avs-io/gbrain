import { writeFileSync } from 'node:fs';
import { buildScoutSignalFromSource, scoutRecipeById, BUILTIN_SCOUT_RECIPES, scoutReportJson } from '../core/scout/pipeline.ts';

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

export async function runScoutCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const flags = parseArgs(rest);
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`gbrain scout recipes --json\ngbrain scout signal --recipe <id> --source-url <url>|--source-title <title> --claim <text> --excerpt <text> [--entity <name>]... [--json] [--out <jsonl>] [--yes]`);
    return;
  }

  if (sub === 'recipes') {
    const payload = { ok: true, review_only: true, recipes: BUILTIN_SCOUT_RECIPES };
    console.log(flags.json ? JSON.stringify(payload, null, 2) : BUILTIN_SCOUT_RECIPES.map(r => `${r.id}\t${r.topic}\t${r.title}`).join('\n'));
    return;
  }

  if (sub === 'signal') {
    const recipeId = String(flags.recipe || '');
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

  throw new Error(`Unknown scout subcommand: ${sub}`);
}
