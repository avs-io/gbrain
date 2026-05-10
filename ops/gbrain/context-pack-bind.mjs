/**
 * context-pack-bind.mjs
 * ─────────────────────────────────────────────────────────────────
 * Privacy-aware GBrain ContextPack auto-bind for OpenClaw runtime dispatch.
 *
 * This module wires into the dispatch path where a WorkItem transitions
 * from ready→claimed→spawned. Before the worker spawn call it:
 *   1. Triages the workItem.brief for privacy tier
 *   2. Creates a GBrain ContextPack via `gbrain context-pack create`
 *   3. Returns { contextPackId, bindings, privacyApproved }
 *      — contextPackId is passed as GBRAIN_CONTEXT_PACK_ID envvar to worker
 *      — privacyApproved flags whether external API calls are allowed
 *
 * Privacy routing:
 *   P0_PRIVATE → MLX only, no external calls, ContextPack created locally
 *   P1_SENSITIVE → MLX extraction, cloud disallowed
 *   P2_REDACTED → cloud + GBrain plugin
 *   P3_PUBLIC  → cloud + GBrain plugin, auto-apply safe and local
 *
 * Usage (importable module):
 *   import { bindContextPack } from './context-pack-bind.mjs';
 *   const result = await bindContextPack({
 *     workItem: { id: 'WI-123', brief: 'Analyze quarterly earnings for fund-a' },
 *     contextPackId: undefined,  // will be generated
 *     privacyTier: undefined,    // auto-detected
 *   });
 *
 * Usage (CLI):
 *   node ops/gbrain/context-pack-bind.mjs \
 *     --workitem-id WI-123 \
 *     --brief "Analyze quarterly earnings for fund-a" \
 *     --privacy-tier P2_REDACTED \
 *     --json
 */

import { spawn } from 'child_process';
import { classifyBrief, requiresMLX, allowsCloud, maxTier } from './privacy-triage.mjs';

export const GBRAIN_CLI = process.env.GBRAIN_CLI ?? 'gbrain';
export const MLX_BASE_URL = process.env.GBRAIN_MLX_BASE_URL ?? 'http://localhost:11436';

/** Shorthand — environment variable name for worker env propagation. */
const ENV_MLX_BASE = 'GBRAIN_MLX_BASE_URL';

/**
 * @param {{ workItem: {id:string,brief:string,context?:Record<string,unknown>}, contextPackId?:string, privacyTier?:string }} opts
 * @returns {Promise<{contextPackId:string, bindings:Record<string,string>, privacyApproved:boolean, privacyTier:string, routing:'mlx'|'cloud'}>}
 */
export async function bindContextPack({ workItem, contextPackId, privacyTier } = {}) {
  if (!workItem?.id) throw new Error('workItem.id is required');
  if (!workItem?.brief) throw new Error('workItem.brief is required');

  // ── 1. Privacy triage ───────────────────────────────────────────
  const tier = privacyTier ?? classifyBrief(workItem.brief);
  const mlxRequired = requiresMLX(tier);
  const cloudAllowed = allowsCloud(tier);
  const routing = mlxRequired ? 'mlx' : 'cloud';

  // ── 2. Resolve or generate contextPackId ───────────────────────
  const cpId = contextPackId ?? `cp-${workItem.id}-${Date.now()}`;

  // ── 3. Build the gbrain context-pack create command ─────────────
  //    We use the spawn-bridge pattern: call gbrain CLI to create the pack.
  //    The CLI handles all GBrain internal routing and privacy policy.
  const createArgs = [
    'memory', 'context-pack', 'create',
    '--workitem-id', workItem.id,
    '--pack-type', packTypeForTier(tier),
    '--max-privacy', maxPrivacyForTier(tier),
    '--json',
  ];

  /** @type {{ok:boolean, pack_id?:string, error?:string}|null} */
  let createResult = null;

  // Only call cloud gbrain CLI when cloud is allowed (P2/P3).
  // For P0/P1, we skip the cloud call entirely — MLX does local extraction.
  // Note: we do NOT fall back to cpId for the binding ID — the worker must
  // know there's no backing GBrain record when cloud was disallowed.
  if (cloudAllowed) {
    try {
      createResult = await runGbrainCreate(createArgs);
    } catch (err) {
      // Non-fatal: log and continue without a context pack ID
      console.error(`[context-pack-bind] gbrain create failed (${err}), proceeding without pack: ${err.message}`);
    }
  } else {
    console.log(`[context-pack-bind] P${tier.split('_')[0].replace('P','')} — MLX required, skipping cloud gbrain create`);
  }
// ── 4. Build bindings ──────────────────────────────────────────
  const finalPackId = createResult?.pack_id ?? null;

  const bindings = {
    // Only set GBRAIN_CONTEXT_PACK_ID when there is a backing GBrain record
    ...(finalPackId ? { GBRAIN_CONTEXT_PACK_ID: finalPackId } : {}),
    GBRAIN_PRIVACY_TIER: tier,
    GBRAIN_DISPATCH_ROUTING: routing,
    // Propagate MLX config to worker if needed
    ...(mlxRequired ? { [ENV_MLX_BASE]: MLX_BASE_URL, GBRAIN_MLX_ROUTING: '1' } : {}),
  };

  // ── 5. Audit log ────────────────────────────────────────────────
  const auditEntry = {
    ts: new Date().toISOString(),
    event: 'context_pack_bind',
    workitem_id: workItem.id,
    context_pack_id: finalPackId,
    privacy_tier: tier,
    routing,
    mlx_required: mlxRequired,
    cloud_allowed: cloudAllowed,
    created_ok: createResult?.ok ?? false,
    error: createResult?.error ?? null,
  };
  console.log(`[context-pack-bind] ${JSON.stringify(auditEntry)}`);

  return {
    contextPackId: finalPackId,
    bindings,
    privacyApproved: cloudAllowed || mlxRequired, // always approved; cloud may be restricted
    privacyTier: tier,
    routing,
  };
}

/** Map privacy tier to gbrain context-pack --pack-type argument. */
function packTypeForTier(tier) {
  switch (tier) {
    case 'P0_PRIVATE': return 'personal_context_pack';
    case 'P1_SENSITIVE': return 'personal_context_pack';
    case 'P2_REDACTED': return 'project_pack';
    case 'P3_PUBLIC':
    default:
      return 'project_pack';
  }
}

/** Map privacy tier to gbrain --max-privacy argument. */
function maxPrivacyForTier(tier) {
  switch (tier) {
    case 'P0_PRIVATE': return 'private';
    case 'P1_SENSITIVE': return 'internal';
    case 'P2_REDACTED': return 'internal';
    case 'P3_PUBLIC':
    default:
      return 'public';
  }
}

/** Run gbrain CLI and parse JSON output. Returns null on failure. */
function runGbrainCreate(args) {
  return new Promise((resolve) => {
    const child = spawn(GBRAIN_CLI, args, { shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'timeout after 15s' });
    }, 15_000);
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { resolve({ ok: false, error: stderr || `exit ${code}` }); return; }
      try { resolve(JSON.parse(stdout.trim())); } catch { resolve({ ok: false, error: `JSON parse error` }); }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
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

  const workItemId = getFlagValue('--workitem-id') ?? getFlagValue('--workitem-id');
  const brief = getFlagValue('--brief');
  const privacyTier = getFlagValue('--privacy-tier');

  if (!workItemId || !brief) {
    console.error('Usage: node context-pack-bind.mjs --workitem-id ID --brief "text" [--privacy-tier P2_REDACTED] [--json]');
    process.exit(1);
  }

  const result = await bindContextPack({
    workItem: { id: workItemId, brief },
    privacyTier,
  });

  if (hasFlag('--json')) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`ContextPack ID : ${result.contextPackId}`);
    console.log(`Privacy Tier  : ${result.privacyTier}`);
    console.log(`Routing       : ${result.routing}`);
    console.log(`MLX required  : ${result.routing === 'mlx' ? 'YES' : 'NO'}`);
    console.log(`Cloud allowed : ${result.privacyTier === 'P2_REDACTED' || result.privacyTier === 'P3_PUBLIC' ? 'YES' : 'NO'}`);
    console.log(`Bindings      : ${JSON.stringify(result.bindings)}`);
  }
}