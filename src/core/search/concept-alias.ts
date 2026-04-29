import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const CONCEPT_INDEX_RELATIVE_PATH = 'projects/gbrain-living-memory/implementation/concept-index.jsonl';

function findWorkspaceRoot(start: string): string | null {
  let cur = resolve(start);
  while (true) {
    if (existsSync(join(cur, CONCEPT_INDEX_RELATIVE_PATH))) return cur;
    const next = dirname(cur);
    if (next === cur) return null;
    cur = next;
  }
}

function conceptIndexPath(): string | null {
  if (process.env.GBRAIN_LIVING_MEMORY_CONCEPT_INDEX) {
    return resolve(process.env.GBRAIN_LIVING_MEMORY_CONCEPT_INDEX);
  }

  const explicitRoot = process.env.GBRAIN_LIVING_MEMORY_ROOT || process.env.OPENCLAW_WORKSPACE_ROOT;
  if (explicitRoot) return join(resolve(explicitRoot), CONCEPT_INDEX_RELATIVE_PATH);

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const root = findWorkspaceRoot(process.cwd()) || findWorkspaceRoot(moduleDir);
  return root ? join(root, CONCEPT_INDEX_RELATIVE_PATH) : null;
}

export interface ConceptAliasMatch {
  slug: string;
  title?: string;
  aliases: string[];
  score: number;
  hits: string[];
}

let cachedConcepts: ConceptAliasMatch[] | null = null;
let cachedPath: string | null = null;

function norm(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();
}

function readConcepts(): ConceptAliasMatch[] {
  const path = conceptIndexPath();
  if (cachedConcepts && cachedPath === path) return cachedConcepts;
  cachedPath = path;
  if (!path || !existsSync(path)) {
    cachedConcepts = [];
    return cachedConcepts;
  }

  const concepts: ConceptAliasMatch[] = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const c = JSON.parse(trimmed);
      if (!c?.slug) continue;
      concepts.push({
        slug: String(c.slug),
        title: c.title ? String(c.title) : undefined,
        aliases: [c.slug, c.title, ...(Array.isArray(c.aliases) ? c.aliases : [])]
          .filter(Boolean)
          .map(String),
        score: 0,
        hits: [],
      });
    } catch {
      // Local living-memory index is best-effort. Malformed rows must not break
      // standard GBrain search/query.
    }
  }
  cachedConcepts = concepts;
  return cachedConcepts;
}

export function __resetConceptAliasCacheForTests(): void {
  cachedConcepts = null;
  cachedPath = null;
}

const BUILTIN_EVIDENCE_ALIASES: Array<{ triggers: string[]; minHits: number; aliases: string[] }> = [
  {
    // Chief may remember this episode as “World 8” / real-options-under-
    // uncertainty even though those exact words are not in the source. Anchor
    // fallback on the rare co-occurrence around the North Star ↔ Verdict
    // correction, not on generic “Final Verdict” text that appears everywhere.
    triggers: ['verdict', 'north star', 'world model', 'decision legitimacy', 'real options', 'uncertainty', 'world 8'],
    minHits: 2,
    aliases: [
      "I don't want rails receipts compliance North Star",
      'Verdict is how I want the world to run world view need not be my north star',
      'Decision Algebra Active World Model flip conditions Verdict North Star',
    ],
  },
];

function builtinEvidenceAliases(q: string): string[] {
  const out: string[] = [];
  for (const spec of BUILTIN_EVIDENCE_ALIASES) {
    const hits = spec.triggers.filter(t => q.includes(norm(t)));
    if (hits.length >= spec.minHits) out.push(...spec.aliases);
  }
  return out;
}

export function resolveConceptAliasQueries(query: string, maxAliases = 3): string[] {
  const q = norm(query);
  if (!q) return [];

  const match = readConcepts()
    .map(c => {
      let score = 0;
      const hits: string[] = [];
      for (const alias of c.aliases) {
        const a = norm(alias);
        if (!a) continue;
        if (q === a) { score += 100; hits.push(alias); }
        else if (q.includes(a)) { score += Math.min(50, 10 + a.length); hits.push(alias); }
        else if (a.includes(q) && q.length > 3) { score += 15; hits.push(alias); }
        else {
          const words = a.split(/\s+/).filter(w => w.length > 3);
          const wordHits = words.filter(w => q.includes(w));
          if (wordHits.length) { score += wordHits.length; hits.push(alias); }
        }
      }
      return { ...c, score, hits: [...new Set(hits)] };
    })
    .sort((a, b) => b.score - a.score)[0];

  const variants = match && match.score > 0
    ? [match.title, match.slug, ...match.hits, ...match.aliases].filter(Boolean).map(String)
    : [];

  const seen = new Set<string>([q]);
  const out: string[] = [];
  for (const v of [...variants, ...builtinEvidenceAliases(q)]) {
    const key = norm(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= maxAliases) break;
  }
  return out;
}
