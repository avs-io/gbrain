/**
 * privacy-triage.mjs
 * ─────────────────────────────────────────────────────────────────
 * Privacy-aware work-item classifier for GBrain dispatch binding.
 *
 * Classifies a workItem.brief into one of four privacy tiers:
 *   P3_PUBLIC  – raw / source / provenance materialization
 *   P2_REDACTED – reducer-owned derived pages/links
 *   P1_SENSITIVE – family, health, finance
 *   P0_PRIVATE – identity, core strategy, credentials
 *
 * Routing:
 *   P0_PRIVATE / P1_SENSITIVE → MLX local extraction (never external)
 *   P2_REDACTED / P3_PUBLIC  → cloud with GBrain plugin
 *
 * Usage:
 *   node ops/gbrain/privacy-triage.mjs --brief "Analyze quarterly earnings for fund-a"
 *   node ops/gbrain/privacy-triage.mjs --json '{"brief": "..."}'
 */

const PRIVACY_SIGNALS = {
  P0_PRIVATE: [
    /\b(ssn|social.?security|passport|driver.?license|identity|identity.?number)\b/i,
    /\b(passwords?|secret|api.?key|token|credential|auth.?token|private.?key)\b/i,
    /\b(core.?strategy|secret.?strategy|m&A|acquisition|merger|ipo)\b/i,
    /\b(hr.?confidential|board.?minutes|executive.?compensation)\b/i,
    /\b(llm.?api.?key|openai|anthropic|api.?secret)\b/i,
  ],
  P1_SENSITIVE: [
    /\b(family|health|medical|diagnosis|treatment|prescription|doctor)\b/i,
    /\b(financial|bank.?account|credit.?card|investment|portfolio|balance)\b/i,
    /\b(income|salary|compensation|net.?worth|tax.?return)\b/i,
    /\b(legal.?case|lawsuit|attorney|settlement|divorce|custody)\b/i,
    /\b(personally.?identifiable|PII|patient)\b/i,
  ],
  P2_REDACTED: [
    /\b(derived|aggregated|summarized|insight|report|analysis)\b/i,
    /\b(decision|commitment|roadmap|OKR|goal|metric)\b/i,
    /\b(person|contact|team.?member|employee|contractor)\b/i,
  ],
};

/** Classify brief text into a privacy tier. */
export function classifyBrief(brief) {
  if (!brief || typeof brief !== 'string') return 'P3_PUBLIC';

  const text = brief.trim();

  // P0: highest sensitivity
  for (const re of PRIVACY_SIGNALS.P0_PRIVATE) {
    if (re.test(text)) return 'P0_PRIVATE';
  }
  // P1: sensitive personal
  for (const re of PRIVACY_SIGNALS.P1_SENSITIVE) {
    if (re.test(text)) return 'P1_SENSITIVE';
  }
  // P2: derived/redacted content
  for (const re of PRIVACY_SIGNALS.P2_REDACTED) {
    if (re.test(text)) return 'P2_REDACTED';
  }
  // Default
  return 'P3_PUBLIC';
}

/** Returns true when the tier should route to MLX (local processing). */
export function requiresMLX(privacyTier) {
  return privacyTier === 'P0_PRIVATE' || privacyTier === 'P1_SENSITIVE';
}

/** Returns true when the tier may use cloud APIs with GBrain plugin. */
export function allowsCloud(privacyTier) {
  return privacyTier === 'P2_REDACTED' || privacyTier === 'P3_PUBLIC';
}

const TIER_RANK = { P0_PRIVATE: 3, P1_SENSITIVE: 2, P2_REDACTED: 1, P3_PUBLIC: 0 };

/** Select the most restrictive tier from an array of tiers. */
export function maxTier(tiers) {
  return tiers.sort((a, b) => (TIER_RANK[b] ?? 0) - (TIER_RANK[a] ?? 0))[0] ?? 'P3_PUBLIC';
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  function getFlagValue(flag) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
    return undefined;
  }

  function hasFlag(flag) {
    return args.includes(flag);
  }

  let brief = getFlagValue('--brief');
  if (!brief && !hasFlag('--json')) {
    const raw = getFlagValue('--json');
    if (raw) {
      try { ({ brief } = JSON.parse(raw)); } catch { /* ignore */ }
    }
  }

  if (!brief) {
    console.error('Usage: node privacy-triage.mjs --brief "work item description"');
    console.error('       node privacy-triage.mjs --json \'{"brief":"..."}\'');
    process.exit(1);
  }

  const tier = classifyBrief(brief);
  const mlx  = requiresMLX(tier);
  const cloud = allowsCloud(tier);

  if (hasFlag('--json')) {
    console.log(JSON.stringify({ brief, tier, mlx_routing: mlx, cloud_allowed: cloud, routing: mlx ? 'mlx' : 'cloud' }));
  } else {
    console.log(`Privacy tier : ${tier}`);
    console.log(`MLX routing : ${mlx ? 'YES (P0/P1 → local)' : 'NO'}`);
    console.log(`Cloud allowed: ${cloud ? 'YES (P2/P3)' : 'NO'}`);
    console.log(`Dispatch route: ${mlx ? 'MLX_LOCAL' : 'CLOUD_GBRAIN'}`);
  }
}