/**
 * MCP tools for the gbrain ops intelligence layer.
 *
 * These expose the CLI ops commands (report-reducer, opportunity-radar,
 * scout cycle, bookmarks radar, meeting transcript actions, briefing
 * surfaces) as MCP tools so agents can invoke them directly.
 *
 * All ops commands work against the JSONL ops store (not the brain DB),
 * so the BrainEngine is accepted but not used — it satisfies the
 * OperationContext contract for consistency with other MCP tools.
 */

import { operations as baseOperations } from '../core/operations.ts';
import type { OperationContext } from '../core/operations.ts';
import type { McpToolDef } from './tool-defs.ts';

// Re-use the same ToolResult shape as dispatch.ts
export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

// Load ops kernel functions lazily to avoid circular deps
async function runOpsCommand(args: string[]): Promise<ToolResult> {
  const { runOpsCommand: cliRun } = await import('../commands/ops.ts');
  // Intercept stdout — capture it as the tool result
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalError = process.stderr.write.bind(process.stderr);
  const done = new Promise<void>((resolve) => {
    process.stdout.write = (chunk: string) => { chunks.push(chunk); return true; };
    process.stderr.write = (chunk: string) => { chunks.push(chunk); return true; };
    // Give it a moment then restore
    setTimeout(() => {
      process.stdout.write = originalWrite;
      process.stderr.write = originalError;
      resolve();
    }, 100);
  });
  // The CLI command prints to stdout. We capture it.
  await cliRun(null as any, args);
  await done;
  const output = chunks.join('');
  try {
    // If output is JSON, return it as a parsed result
    const parsed = JSON.parse(output);
    return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
  } catch {
    return { content: [{ type: 'text', text: output || '{"ok": true}' }] };
  }
}

// ---- Tool definitions ----

const OPS_TOOLS: McpToolDef[] = [
  {
    name: 'ops_reports_reduce',
    description: 'Reduce a free-text report artifact into structured ops work items. Reads the file, splits by heading, classifies sections (evidence/opportunity/action/discarded/archived), optionally enqueues work items into the ops store. Review-only: never auto-mutates trusted memory.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Path to the report file (md/txt/json)' },
        topic: { type: 'string', description: 'Topic track ID to tag work items against (optional)' },
        domain: { type: 'string', description: 'Domain label (optional, e.g. sovereign-ai-india)' },
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        artifact_store: { type: 'string', description: 'Path to write reduction report JSONL (optional)' },
        out: { type: 'string', description: 'Path to write output report JSON (optional)' },
        no_work_items: { type: 'boolean', description: 'If true, do not enqueue work items into the ops store' },
        json: { type: 'boolean', description: 'Emit JSON output' },
      },
      required: ['input'],
    },
  },
  {
    name: 'ops_opportunities_radar',
    description: 'Run the v1 opportunity radar against signal data (world deltas, memories, active projects). Produces scored opportunity candidates with relevance, novelty, timing, actionability, network, and asymmetric upside dimensions. Review-only.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Path to signals JSON file (worldDeltas, oldMemories, activeProjects)' },
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        out: { type: 'string', description: 'Path to write opportunity radar report JSON (optional)' },
        json: { type: 'boolean', description: 'Emit JSON output' },
      },
      required: ['input'],
    },
  },
  {
    name: 'ops_opportunities_v2',
    description: 'Run the v2 opportunity radar with typed source inputs (topic state, deltas, bookmarks, report reduction). Produces typed candidate work items (contact_person, start_research, draft_memo, build_small_tool, etc.) with lifecycle tracking (new/continuing/stale/archived).',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic track ID (e.g. world-sovereign-ai-india)' },
        from_state: { type: 'string', description: 'Path to topic-current-state JSON file (optional)' },
        from_delta: { type: 'string', description: 'Path to topic-daily-delta JSON file (optional)' },
        from_bookmarks: { type: 'string', description: 'Path to bookmark deep-radar output JSON (optional)' },
        from_reduction: { type: 'string', description: 'Path to report reduction JSON (optional)' },
        from_memory_context: { type: 'string', description: 'Path to memory context JSON (optional)' },
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        artifact_store: { type: 'string', description: 'Path to opportunities JSONL artifact store (optional)' },
        out: { type: 'string', description: 'Path to write v2 radar report JSON (optional)' },
        json: { type: 'boolean', description: 'Emit JSON output' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'ops_scout_cycle',
    description: 'Run a full topic-track scout cycle: queues seed queries + fetched sources, runs public scout signal scoring, extracts world candidates (claims, events, entity updates), compiles topic state, produces surfacing candidates. Requires --input with pre-fetched public sources JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        topic_track: { type: 'string', description: 'Topic track ID or slug (e.g. world-sovereign-ai-india)' },
        input: { type: 'string', description: 'Path to public-sources.json (pre-fetched sources from web/feeds)' },
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        out: { type: 'string', description: 'Path to write cycle report JSON (optional)' },
        since: { type: 'string', description: 'ISO timestamp — only process sources newer than this (optional)' },
        json: { type: 'boolean', description: 'Emit JSON output' },
      },
      required: ['topic_track', 'input'],
    },
  },
  {
    name: 'ops_bookmarks_radar',
    description: 'Score and classify a batch of bookmarks into actionable/notable/background signals. Generates work item proposals for critical bookmarks, archives watch-only items. Review-only: never auto-creates work items.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Path to bookmarks.json or bookmarks.md file' },
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        archive: { type: 'string', description: 'Path to decisions JSONL archive (optional)' },
        out: { type: 'string', description: 'Path to write radar report JSON (optional)' },
        json: { type: 'boolean', description: 'Emit JSON output' },
      },
      required: ['input'],
    },
  },
  {
    name: 'ops_bookmarks_deep_radar',
    description: 'Deep-radar: link bookmarks to topic tracks, cross-reference with existing world knowledge, identify gaps, contradictions, and emerging signals. Produces a richer artifact than the action radar.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Path to bookmarks.json or bookmarks.md file' },
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        artifact_store: { type: 'string', description: 'Path to deep-radar artifact JSONL (optional)' },
        out: { type: 'string', description: 'Path to write deep-radar report JSON (optional)' },
        json: { type: 'boolean', description: 'Emit JSON output' },
      },
      required: ['input'],
    },
  },
  {
    name: 'ops_meetings_extract',
    description: 'Extract actions, decisions, entities, and timeline events from a meeting transcript. Produces MeetingMemoryProposal records and optionally enqueues work items. Review-only.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Path to transcript.md or .txt file' },
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        archive: { type: 'string', description: 'Path to reports JSONL archive (optional)' },
        actions_store: { type: 'string', description: 'Path to action-proposals JSONL (optional)' },
        out: { type: 'string', description: 'Path to write extract report JSON (optional)' },
        json: { type: 'boolean', description: 'Emit JSON output' },
      },
      required: ['input'],
    },
  },
  {
    name: 'ops_brief',
    description: 'Build a briefing surface: morning (5 top opportunities), daily-build (12 opportunities), or weekly-strategy (8 opportunities synthesis). Consumes opportunity-radar output and topic state.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['morning', 'daily-build', 'weekly-strategy'],
          description: 'Brief type',
        },
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        opportunities_store: { type: 'string', description: 'Path to opportunity-radar JSONL (optional)' },
        limit: { type: 'number', description: 'Max candidates (default: 5/12/8 by type)' },
        out: { type: 'string', description: 'Path to write brief surface JSON/md (optional)' },
        json: { type: 'boolean', description: 'Emit JSON output (default: true for MCP)' },
        markdown: { type: 'boolean', description: 'Emit markdown output instead of JSON' },
      },
      required: ['type'],
    },
  },
  {
    name: 'ops_status',
    description: 'Read the current ops kernel status: programs, work items, runs, leases, supervisor ticks, interrupts, budget ledger.',
    inputSchema: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        json: { type: 'boolean', description: 'Emit JSON output (default: true for MCP)' },
      },
      required: [],
    },
  },
  {
    name: 'ops_dashboard',
    description: 'Build and return the full ops dashboard: program summaries, work item states, supervisor metrics, budget ledger, safety audit.',
    inputSchema: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        output: { type: 'string', description: 'Path to write dashboard.md (optional)' },
        json: { type: 'boolean', description: 'Emit JSON output (default: true for MCP)' },
        markdown: { type: 'boolean', description: 'Emit markdown output instead of JSON' },
      },
      required: [],
    },
  },
  {
    name: 'ops_work_list',
    description: 'List work items in the ops kernel, optionally filtered by state (proposed/approved/ready/leased/running/succeeded/failed/blocked/waiting_human/cancelled/quarantined).',
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          description: 'Filter by work item state (optional — omit for all)',
        },
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        json: { type: 'boolean', description: 'Emit JSON output (default: true for MCP)' },
      },
      required: [],
    },
  },
  {
    name: 'ops_heartbeat_check',
    description: 'Run the ops heartbeat check: reads the kernel store, checks supervisor tick freshness, lease health, and queues. Returns green/amber/red with actionable alerts. Designed for the heartbeat LaunchAgent.',
    inputSchema: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        max_tick_age_minutes: { type: 'number', description: 'Max age for a fresh supervisor tick (default: 10)' },
        json: { type: 'boolean', description: 'Emit JSON output (default: true for MCP)' },
      },
      required: [],
    },
  },
  {
    name: 'ops_supervise',
    description: 'Run one supervisor tick: claim ready work items, dispatch to workers, reconcile tasks, update leases. Used by the heartbeat to kick the supervisor when alerts fire.',
    inputSchema: {
      type: 'object',
      properties: {
        store: { type: 'string', description: 'Path to ops kernel JSONL store (default: ~/.gbrain/ops-kernel.jsonl)' },
        max_claims: { type: 'number', description: 'Max work items to claim (default: 1)' },
        max_running: { type: 'number', description: 'Max running items to allow (default: 1)' },
        profiles: { type: 'string', description: 'Path to worker_profiles.yaml (optional)' },
        json: { type: 'boolean', description: 'Emit JSON output (default: true for MCP)' },
      },
      required: [],
    },
  },
];

// ---- Handler dispatch ----

async function handleOpsTool(name: string, params: Record<string, unknown>): Promise<ToolResult> {
  const args: string[] = [];

  switch (name) {
    case 'ops_reports_reduce': {
      args.push('reports', 'reduce', '--input', String(params.input), '--json');
      if (params.topic) { args.push('--topic', String(params.topic)); }
      if (params.domain) { args.push('--domain', String(params.domain)); }
      if (params.store) { args.push('--store', String(params.store)); }
      if (params.artifact_store) { args.push('--artifact-store', String(params.artifact_store)); }
      if (params.out) { args.push('--out', String(params.out)); }
      if (params.no_work_items) { args.push('--no-work-items'); }
      break;
    }
    case 'ops_opportunities_radar': {
      args.push('opportunities', 'radar', '--input', String(params.input), '--json');
      if (params.store) { args.push('--store', String(params.store)); }
      if (params.out) { args.push('--out', String(params.out)); }
      break;
    }
    case 'ops_opportunities_v2': {
      args.push('opportunities', 'v2', '--topic', String(params.topic), '--json');
      if (params.from_state) { args.push('--from-state', String(params.from_state)); }
      if (params.from_delta) { args.push('--from-delta', String(params.from_delta)); }
      if (params.from_bookmarks) { args.push('--from-bookmarks', String(params.from_bookmarks)); }
      if (params.from_reduction) { args.push('--from-reduction', String(params.from_reduction)); }
      if (params.from_memory_context) { args.push('--from-memory-context', String(params.from_memory_context)); }
      if (params.store) { args.push('--store', String(params.store)); }
      if (params.artifact_store) { args.push('--artifact-store', String(params.artifact_store)); }
      if (params.out) { args.push('--out', String(params.out)); }
      break;
    }
    case 'ops_scout_cycle': {
      args.push('scout', 'cycle', '--topic-track', String(params.topic_track), '--input', String(params.input), '--json');
      if (params.store) { args.push('--store', String(params.store)); }
      if (params.out) { args.push('--out', String(params.out)); }
      if (params.since) { args.push('--since', String(params.since)); }
      break;
    }
    case 'ops_bookmarks_radar': {
      args.push('bookmarks', 'radar', '--input', String(params.input), '--json');
      if (params.store) { args.push('--store', String(params.store)); }
      if (params.archive) { args.push('--archive', String(params.archive)); }
      if (params.out) { args.push('--out', String(params.out)); }
      break;
    }
    case 'ops_bookmarks_deep_radar': {
      args.push('bookmarks', 'deep-radar', '--input', String(params.input), '--json');
      if (params.store) { args.push('--store', String(params.store)); }
      if (params.artifact_store) { args.push('--artifact-store', String(params.artifact_store)); }
      if (params.out) { args.push('--out', String(params.out)); }
      break;
    }
    case 'ops_meetings_extract': {
      args.push('meetings', 'extract', '--input', String(params.input), '--json');
      if (params.store) { args.push('--store', String(params.store)); }
      if (params.archive) { args.push('--archive', String(params.archive)); }
      if (params.actions_store) { args.push('--actions-store', String(params.actions_store)); }
      if (params.out) { args.push('--out', String(params.out)); }
      break;
    }
    case 'ops_brief': {
      args.push('brief', String(params.type));
      // Default to json for MCP
      if (params.markdown) { args.push('--markdown'); } else { args.push('--json'); }
      if (params.store) { args.push('--store', String(params.store)); }
      if (params.opportunities_store) { args.push('--opportunities-store', String(params.opportunities_store)); }
      if (params.limit !== undefined) { args.push('--limit', String(params.limit)); }
      if (params.out) { args.push('--out', String(params.out)); }
      break;
    }
    case 'ops_status': {
      args.push('status', '--json');
      if (params.store) { args.push('--store', String(params.store)); }
      break;
    }
    case 'ops_dashboard': {
      args.push('dashboard');
      if (params.markdown) { args.push('--markdown'); } else { args.push('--json'); }
      if (params.output) { args.push('--output', String(params.output)); }
      if (params.store) { args.push('--store', String(params.store)); }
      break;
    }
    case 'ops_work_list': {
      args.push('work', 'list', '--json');
      if (params.state) { args.push('--state', String(params.state)); }
      if (params.store) { args.push('--store', String(params.store)); }
      break;
    }
    case 'ops_heartbeat_check': {
      args.push('heartbeat-check', '--json');
      if (params.store) { args.push('--store', String(params.store)); }
      if (params.max_tick_age_minutes !== undefined) {
        args.push('--max-tick-age-minutes', String(params.max_tick_age_minutes));
      }
      break;
    }
    case 'ops_supervise': {
      args.push('supervise', '--once', '--json');
      if (params.store) { args.push('--store', String(params.store)); }
      if (params.max_claims !== undefined) { args.push('--max-claims', String(params.max_claims)); }
      if (params.max_running !== undefined) { args.push('--max-running', String(params.max_running)); }
      if (params.profiles) { args.push('--profiles', String(params.profiles)); }
      break;
    }
    default:
      return { content: [{ type: 'text', text: `Unknown ops tool: ${name}` }], isError: true };
  }

  return runOpsCommand(args);
}

// ---- Export tool defs + handler for server.ts ----

export { OPS_TOOLS, handleOpsTool };