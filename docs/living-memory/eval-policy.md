# Living Memory Eval Policy

The eval suite must prove that GBrain is becoming a memory + world-model + leverage substrate, not merely passing a few autobiographical recall demos.

## Required metadata

Every eval case must declare:

- `id`
- `class`
- `namespace`
- `privacyTier`
- `visibleToImplementation`
- `requiresAbstention`
- `workflowType`

This lets the harness detect overfit, missing privacy coverage, and workflow imbalance before answer quality is even considered.

## Distribution gates

A valid suite must satisfy:

- At least one negative or abstention case exists.
- No eval class may exceed 25% of the suite.
- At least two workflow types exist for suites with 4+ cases.
- At least two namespaces exist for suites with 4+ cases.
- At least one hidden/holdout case exists for suites with 4+ cases.

These are intentionally structural gates. They prevent the implementation from silently becoming “make the current examples pass.”

## Eval classes

The long-run suite should cover:

- autobiographical recall
- project lineage
- relationship / network memory
- health / family high-sensitivity memory
- preference / taste / identity
- world intelligence
- topic state
- opportunity radar
- meeting brief
- agent handoff
- negative / abstention
- governance

## Holdout rule

Use visible, hidden, and mutation cases:

```text
70% visible regression cases
20% hidden holdout cases
10% mutation cases with swapped names/projects/dates
```

Workers may see visible regression cases. Workers must not receive hidden holdout contents. Mutation cases should catch plausible-but-wrong recall.

## Acceptance philosophy

The system should prefer:

- exact evidence over plausible memory;
- partial answer + unknowns over invented completeness;
- fresh topic deltas over generic summaries;
- quiet radar over noisy interruptions;
- privacy fail-closed over accidental cloud leakage.
