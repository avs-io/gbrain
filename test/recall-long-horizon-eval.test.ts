import { describe, expect, test } from 'bun:test';
import type { BrainEngine } from '../src/core/engine.ts';
import type { SearchResult } from '../src/core/types.ts';
import { recallEvidence } from '../src/core/evidence/recall.ts';

interface RecallEvalCase {
  id: string;
  query: string;
  slug: string;
  title: string;
  compiled_truth: string;
  chunk: string;
  mustContain: string[];
}

const sourceId = 'openclaw-memory';

// Fixture excerpts are lifted from existing OpenClaw daily-memory entries, then
// normalized into source pages so the eval remains repo-local and does not rely
// on a developer's absolute brain/workspace path.
const cases: RecallEvalCase[] = [
  {
    id: 'sovereign-ai-eonic-transition-posture',
    query: 'Was Eonic dormant, or is Sovereign AI primary while Eonic stays active parallel?',
    slug: 'sources/openclaw/daily-memory/2026-04-28-strategy-status-clarification',
    title: 'Strategy Status Clarification',
    compiled_truth: `## Strategy Status Clarification — 2026-04-28 14:37 IST
Chief clarified current posture: Sovereign AI primary; Eonic active parallel; Eonic to be demoted to secondary once Sovereign AI work generates momentum.
This resolves the earlier false binary between “Eonic dormant” and “Eonic active primary.” Correct state is active-parallel/transitioning-secondary, not dormant.`,
    chunk: 'Chief clarified current posture: Sovereign AI primary; Eonic active parallel; Eonic to be demoted to secondary once Sovereign AI work generates momentum.',
    mustContain: ['Sovereign AI primary', 'Eonic active parallel', 'not dormant'],
  },
  {
    id: 'mlx-worker-lane-doctrine',
    query: 'Did Chief ban MLX, or should MLX be used as local worker compute?',
    slug: 'sources/openclaw/daily-memory/2026-04-28-model-routing-doctrine',
    title: 'Model Routing Doctrine',
    compiled_truth: `## Model Routing Doctrine — 2026-04-28 12:00 IST
Chief clarified MLX is not banned. Correct architecture: MLX = persistent low-level workers for bounded/background tasks; GPT/OpenAI-Codex = driver/controller/judgment lane.
Guardrail: never let MLX become main/default, CEO Pulse/controller, or unsupervised strategic decision-maker. MLX work must have bounded prompts, artifact gates, and GPT review for decisions.`,
    chunk: 'Chief clarified MLX is not banned. Correct architecture: MLX = persistent low-level workers for bounded/background tasks; GPT/OpenAI-Codex = driver/controller/judgment lane.',
    mustContain: ['MLX is not banned', 'persistent low-level workers', 'GPT/OpenAI-Codex'],
  },
  {
    id: 'chief-reporting-correction',
    query: 'How did Chief correct reporting of worker completions and artifact logs?',
    slug: 'sources/openclaw/daily-memory/2026-04-29-chief-reporting-correction',
    title: 'Chief Reporting Correction',
    compiled_truth: `## Chief Reporting Correction — 2026-04-29 09:10 IST
Chief explicitly corrected Claw: stop sending artifact reports and raw worker/update logs.
Desired update structure: what we agreed Claw would do; what Claw did; what was accomplished; how we are better than yesterday; what happens next.
New default: worker/subagent completions are internal signals; stay quiet unless they produce a decision-grade delta, blocker, or useful synthesis.`,
    chunk: 'Chief explicitly corrected Claw: stop sending artifact reports and raw worker/update logs.',
    mustContain: ['stop sending artifact reports', 'what was accomplished', 'decision-grade delta'],
  },
];

const pages = new Map(cases.map(c => [c.slug, {
  slug: c.slug,
  source_id: sourceId,
  title: c.title,
  compiled_truth: c.compiled_truth,
  timeline: c.title,
  type: 'source',
}]));

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
}

function resultFor(c: RecallEvalCase, score = 0.91): SearchResult {
  return {
    slug: c.slug,
    page_id: cases.indexOf(c) + 1,
    title: c.title,
    type: 'source',
    chunk_text: c.chunk,
    chunk_source: 'compiled_truth',
    chunk_id: cases.indexOf(c) + 100,
    chunk_index: 0,
    score,
    stale: false,
    source_id: sourceId,
  };
}

function fixtureEngine(): BrainEngine {
  return {
    kind: 'postgres',
    searchKeyword: async (query: string) => {
      const q = tokens(query);
      return cases
        .map(c => {
          const overlap = [...tokens(`${c.query} ${c.title}`)].filter(t => q.has(t)).length;
          return { c, overlap };
        })
        .filter(({ overlap }) => overlap >= 2)
        .sort((a, b) => b.overlap - a.overlap)
        .map(({ c, overlap }) => resultFor(c, 0.75 + Math.min(0.2, overlap / 50)));
    },
    executeRaw: async (_sql: string, params: unknown[]) => {
      const slug = String(params[0]);
      const requestedSourceId = params[1] == null ? undefined : String(params[1]);
      const page = pages.get(slug);
      if (!page) return [];
      if (requestedSourceId && page.source_id !== requestedSourceId) return [];
      return [page];
    },
  } as unknown as BrainEngine;
}

describe('long-horizon autobiographical recall eval', () => {
  test('returns exact source-window evidence for autobiographical cases beyond Citadel/Verdict', async () => {
    const engine = fixtureEngine();

    for (const c of cases) {
      const out = await recallEvidence(engine, c.query, { limit: 1, before: 0, after: 2 });

      expect(out.status, c.id).toBe('hit');
      expect(out.evidence, c.id).toHaveLength(1);
      expect(out.evidence[0].slug, c.id).toBe(c.slug);
      expect(out.evidence[0].span_id, c.id).toMatch(/^gbs1:openclaw-memory:sources\/openclaw\/daily-memory\//);
      expect(out.evidence[0].line_basis, c.id).toBe('stored_section');
      expect(out.evidence[0].quote_hash, c.id).toMatch(/^[a-f0-9]{64}$/);
      for (const phrase of c.mustContain) {
        expect(out.evidence[0].quote, `${c.id} should cite ${phrase}`).toContain(phrase);
      }
    }
  });

  test('abstains rather than answering when an approximate hit lacks an exact source window', async () => {
    const c = cases[0];
    const engine = {
      ...fixtureEngine(),
      searchKeyword: async () => [{ ...resultFor(c), chunk_text: 'A plausible but ungrounded paraphrase that is not present in the stored source page.' }],
    } as unknown as BrainEngine;

    const out = await recallEvidence(engine, 'banana orbit paraphrase', { limit: 1, before: 0, after: 1 });

    expect(out.status).toBe('abstain');
    expect(out.evidence).toEqual([]);
    expect(out.warnings.join(' ')).toContain('no exact source window');
  });
});
