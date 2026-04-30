# GBrain / OpenClaw Intelligence Substrate

GBrain is no longer scoped as “better personal recall.” Evidence-addressable autobiographical recall is necessary, but it is only the kernel. The product is a sovereign personal intelligence substrate: Chief is about to decide, meet, evaluate, delegate, or miss a weak signal; GBrain/OpenClaw supplies the relevant personal history, project state, external world state, relationship context, evidence, options, warnings, and proposed next action.

## Three-layer architecture

```text
1. Living Memory Kernel
   Exact, evidence-addressable autobiographical and operational memory.

2. World Intelligence Layer
   Continuously refreshed external-topic intelligence: scouts, claims,
   entities, events, deltas, and state pages.

3. Leverage / Action Layer
   Context packs, opportunity radar, meeting briefs, agent handoffs,
   governed action proposals, and interruptions.
```

These are not one generic RAG system. They have different truth rules, privacy rules, freshness rules, evaluation rules, and output surfaces.

## Product definition

```text
GBrain is the evidence-addressable context kernel.
OpenClaw is the agentic organization that uses that kernel.
Cheap intelligence is the labor layer: extractor, scout, verifier, analyst,
coder, evaluator.
Chief is the authority layer for high-impact write-back and action.
```

## Authority hierarchy

```text
Tier 0: raw source snapshot / transcript / message / page / artifact
Tier 1: exact source span
Tier 2: extracted observation
Tier 3: verified claim with evidence
Tier 4: accepted memory atom or world claim
Tier 5: compiled state/history page
Tier 6: context pack / recommendation
Tier 7: action proposal
Tier 8: executed action
```

Only Tiers 0–4 are evidence-bearing memory. Tier 5+ are convenience and action surfaces.

## Namespaces

The substrate must keep distinct namespaces instead of collapsing everything into “memory”:

- `personal` — autobiographical transcripts, family, health, preferences, identity.
- `project` — Eonic, Sovereign AI, OpenClaw, ventures, internal project state.
- `network` — people, relationships, commitments, meeting context.
- `world` — public external intelligence, scouts, news, market maps.
- `operational` — OpenClaw execution memory, PRs, runs, failures, queues.
- `synthetic` — eval data, paraphrases, hard negatives, training examples.

A personal transcript saying “I think X” is not a public-world claim that “X happened.” Synthetic data must never be cited as evidence or promoted to trusted memory.

## Product surfaces to build first

1. **Meeting brief** — prior relationship, public context, project context, likely asks/offers, risks, suggested questions, evidence.
2. **Project / venture context pack** — current state, origin, pivots, open loops, people, world state, opportunities, threats, next actions.
3. **Topic intelligence page** — current state, entities, deltas, claims, unresolved questions, watchlist, relevance to Chief.
4. **Opportunity radar** — why now, why Chief, evidence, novelty, upside, distraction risk, recommended next step.
5. **Agent handoff pack** — objective, project state, files/source refs, prior attempts, acceptance criteria, privacy tier.
6. **Weekly strategic review** — what changed inside/outside, commitments, ignored signals, reactivated old ideas, stop/continue/accelerate.

## Operating rule

Do not add more recall-specific heuristics unless they generalize into one of the three layers above and are covered by workflow evals. Recall examples are probes, not the product spec.
