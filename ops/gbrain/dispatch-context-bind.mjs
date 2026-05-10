/**
 * dispatch-context-bind.mjs
 * ─────────────────────────────────────────────────────────────────
 * Integration shim that wires privacy-aware GBrain ContextPack binding
 * into the OpenClaw / Minion runtime dispatch path.
 *
 * INJECTION POINT
 * ───────────────
 * The dispatch path in MinionWorker is:
 *   this.queue.claim()        ← ready → claimed (DB state change)
 *       → this.launchJob()    ← claimed → spawned (handler invocation)
 *
 * `launchJob()` at worker.ts:~187 is where the handler is actually invoked.
 * To bind a GBrain ContextPack before every handler call, wrap the handler
 * registration with `withContextPackBinding()`:
 *
 *   BEFORE (in jobs.ts or wherever registerBuiltinHandlers is called):
 *     worker.register('subagent', makeSubagentHandler({ engine, ... }));
 *
 *   AFTER:
 *     worker.register('subagent',
 *       withContextPackBinding(
 *         makeSubagentHandler({ engine, ... }),
 *         { engine, /* bindContextPackDeps */ }
 *       )
 *     );
 *
 * ENVIRONMENT VARIABLES SET ON THE JOB CONTEXT
 * ─────────────────────────────────────────────
 *   GBRAIN_CONTEXT_PACK_ID   — the bound context pack ID (or local fallback)
 *   GBRAIN_PRIVACY_TIER      — P0_PRIVATE | P1_SENSITIVE | P2_REDACTED | P3_PUBLIC
 *   GBRAIN_DISPATCH_ROUTING  — 'mlx' | 'cloud'
 *   GBRAIN_MLX_BASE_URL      — MLX server URL (set only when routing = 'mlx')
 *   GBRAIN_MLX_ROUTING       — '1' when MLX is required
 *
 * DESIGN NOTES
 * ────────────
 * This module intentionally does NOT modify any running process. It
 * provides a composable wrapper that operators drop into their
 * registerBuiltinHandlers() call site. The wrapper:
 *   1. Extracts workItem metadata from job.data
 *   2. Calls bindContextPack() for privacy-aware context pack creation
 *   3. Injects bindings as env vars on the MinionJobContext
 *   4. Delegates to the original handler
 *
 * The job.data shape expected by this binding:
 *   {
 *     workItem?: { id: string; brief: string; context?: Record<string,unknown> },
 *     privacyTier?: string,   // optional override, auto-detected if absent
 *     contextPackId?: string, // optional pre-created ID
 *     ...handlerSpecificData
 *   }
 */

import { bindContextPack, type ContextPackBindResult } from './context-pack-bind.mjs';
import { classifyBrief, requiresMLX } from './privacy-triage.mjs';

/** Result of wrapping a handler with context pack binding. */
export interface WrappedHandler {
  (ctx: MinionJobContext): Promise<unknown>;
  __contextPackBinding?: ContextPackBindResult;
}

/**
 * Wrap a MinionHandler with privacy-aware GBrain ContextPack binding.
 *
 * @param handler  - The original MinionHandler (e.g. makeSubagentHandler(...))
 * @param opts     - { engine, privacyTierOverride?, contextPackIdOverride? }
 * @returns        - Wrapped handler that auto-binds context pack before each call
 */
export function withContextPackBinding(
  handler: (ctx: MinionJobContext) => Promise<unknown>,
  opts: {
    /** BrainEngine for GBrain ops (optional — only needed for real gbrain CLI calls) */
    engine?: unknown;
    /** Override privacy tier detection (normally auto-derived from workItem.brief) */
    privacyTierOverride?: string;
    /** Override context pack ID generation */
    contextPackIdOverride?: string;
  } = {},
): WrappedHandler {
  async function wrapped(ctx: MinionJobContext): Promise<unknown> {
    // Extract workItem from job.data (fallback to empty struct)
    const data = (ctx.data ?? {}) as Record<string, unknown>;
    const workItem = (data.workItem as { id?: string; brief?: string; context?: Record<string, unknown> }) ?? {};
    const workItemId = workItem.id ?? `job-${ctx.id}`;
    const brief = workItem.brief ?? String(data.prompt ?? data.brief ?? '');

    // If brief is completely empty, use a hash of job id as deterministic fallback
    const resolvedBrief = brief.trim() || `job-${ctx.id}-fallback`;

    // Privacy tier: use override if provided, otherwise auto-detect
    const privacyTier = opts.privacyTierOverride ?? classifyBrief(resolvedBrief);

    // Bind context pack
    const bindResult = await bindContextPack({
      workItem: { id: workItemId, brief: resolvedBrief },
      contextPackId: opts.contextPackIdOverride,
      privacyTier,
    });

    // Inject bindings into the job context instead of process.env.
    // This avoids cross-contamination if multiple jobs run in the same process.
    // Attach as ctx._gbrain so downstream handlers and audit loggers can read them.
    const priorGbrain = (ctx as Record<string, unknown>)._gbrain;

    try {
      // Attach binding metadata to ctx._gbrain for the duration of this handler call
      (ctx as Record<string, unknown>)._gbrain = bindResult;

      // Delegate to original handler with injected context
      const result = await handler(ctx);

      // Attach binding metadata to the wrapped result for auditability
      (result as Record<string, unknown>).__contextPackBinding = bindResult;

      return result;
    } finally {
      // Restore prior _gbrain state (or remove if there was none)
      if (priorGbrain === undefined) {
        delete (ctx as Record<string, unknown>)._gbrain;
      } else {
        (ctx as Record<string, unknown>)._gbrain = priorGbrain;
      }
    }
  }

  return wrapped;
}

/**
 * Middleware-style injector for use in registerBuiltinHandlers chain.
 * Usage:
 *   const boundSubagentHandler = addDispatchBinding(
 *     makeSubagentHandler({ engine }),
 *     { engine }
 *   );
 *   worker.register('subagent', boundSubagentHandler);
 */
export function addDispatchBinding(
  handler: (ctx: MinionJobContext) => Promise<unknown>,
  opts?: { engine?: unknown; privacyTierOverride?: string },
) {
  return withContextPackBinding(handler, opts);
}

// ── Re-export key types for consumers ───────────────────────────────────────

export type { ContextPackBindResult } from './context-pack-bind.mjs';
export { bindContextPack } from './context-pack-bind.mjs';
export { classifyBrief, requiresMLX } from './privacy-triage.mjs';