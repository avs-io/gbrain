# Brain-First Lookup Convention

Before using ANY external API (web search, enrichment services, social APIs) to
research a person, company, or topic, check the brain first.

## The 5-Step Lookup

1. `gbrain context-pack "natural question about name"` — default compact, trusted read path
   - add `--source-filter gmail|calendar|contacts|finance|browser` when the question is source-specific
   - add `--lens working|personal|semantic|operational` only when the task clearly needs that lens
2. `gbrain query "natural question about name" --no-expand` — broader hybrid exploration when the subject is unclear
3. `gbrain get <slug>` — if you know the slug, read the full page
4. Check timeline/history only when the question is explicitly temporal
5. Use `gbrain propose-memory` for durable write-back; never edit trusted memory pages directly from a workspace note
6. Use `gbrain ingest-source <source_id>` only for configured source adapters; new external data must go through raw archive -> proposals -> ledger, never directly into trusted pages

The brain almost always has something. External APIs fill gaps, not start from scratch.

## Why This Matters

- The brain has context that external APIs don't (user's direct observations, meeting notes, personal relationships)
- External API calls cost money and time
- Brain context makes external lookups more targeted (you know what's missing)
- The user's direct statements are highest-authority data. External sources are lowest.
