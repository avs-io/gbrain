import { readFileSync } from 'node:fs';

import {
  ACTION_PROPOSAL_TYPES,
  actionProposalFromRadarCandidate,
  appendActionProposal,
  readActionProposalStore,
  recordActionProposalDecision,
  reviewActionProposals,
  validateActionProposal,
  actionProposalsPath,
  type ActionApprovalState,
} from '../core/actions/proposals.ts';
import { readSurfacingStore, surfacingCandidatesPath } from '../core/radar/surfacing.ts';

function flagValue(args: string[], flag: string): string | undefined {
  const ix = args.indexOf(flag); if (ix >= 0 && args[ix + 1] && !args[ix + 1].startsWith('--')) return args[ix + 1];
  const hit = args.find(a => a.startsWith(flag + '=')); return hit ? hit.slice(flag.length + 1) : undefined;
}
function hasFlag(args: string[], flag: string): boolean { return args.includes(flag); }
function printJson(v: unknown): void { console.log(JSON.stringify(v, null, 2)); }

export async function runActionsCommand(_engine: unknown, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`gbrain actions propose --from-radar <candidate-id> [--radar-store <path>] [--store <path>] [--owner Chief] [--json]\ngbrain actions review [--limit 20] [--state pending_approval|approved|rejected] [--store <path>] [--json]\ngbrain actions approve <id> [--actor Chief] [--store <path>] [--json]\ngbrain actions reject <id> --reason <reason> [--actor Chief] [--store <path>] [--json]\ngbrain actions validate --proposal-json <file> [--json]\n\nGoverned candidate-only action proposals. Approval records intent only; this command never sends email, schedules meetings, writes trusted memory, creates OpenClaw/Codex tasks, posts publicly, or executes actions.`);
    return;
  }

  const storePath = flagValue(rest, '--store') || actionProposalsPath();

  if (sub === 'propose') {
    const radarId = flagValue(rest, '--from-radar') || flagValue(rest, '--radar');
    if (!radarId) throw new Error('gbrain actions propose requires --from-radar <candidate-id>');
    const radarStore = flagValue(rest, '--radar-store') || surfacingCandidatesPath();
    const candidate = readSurfacingStore(radarStore).candidates.find(c => c.id === radarId);
    if (!candidate) throw new Error(`radar candidate not found: ${radarId}`);
    const proposal = actionProposalFromRadarCandidate(candidate, { owner: flagValue(rest, '--owner') || 'Chief' });
    const result = appendActionProposal(proposal, storePath);
    if (hasFlag(rest, '--json')) printJson({ ok: result.ok, action: 'propose', proposal: result.proposal, duplicate: result.duplicate, storePath: result.path, errors: result.errors, guardrails: result.proposal.guardrails });
    else if (!result.ok) console.error(`Action proposal invalid:\n- ${(result.errors || []).join('\n- ')}`);
    else if (result.duplicate) console.log(`Action proposal already exists: ${proposal.id}`);
    else console.log(`Queued action proposal: ${proposal.id}`);
    return;
  }

  if (sub === 'review') {
    const limit = Number(flagValue(rest, '--limit') || 20);
    const state = flagValue(rest, '--state') as ActionApprovalState | undefined;
    const proposals = reviewActionProposals({ path: storePath, limit: Number.isFinite(limit) ? limit : 20, state });
    if (hasFlag(rest, '--json')) printJson({ ok: true, schema: 'gbrain.actions.review.v1', proposal_count: proposals.length, proposals, guardrails: { review_only: true, actions_performed: false, external_messages_sent: false, calendar_events_created: false, trusted_pages_edited: false } });
    else for (const p of proposals) console.log(`${p.id}\t${p.approval.state}\t${p.action_type}\t${p.owner}\t${p.title}`);
    return;
  }

  if (sub === 'approve') {
    const id = rest.find(a => !a.startsWith('--'));
    if (!id) throw new Error('gbrain actions approve requires <id>');
    const decision = recordActionProposalDecision({ proposalId: id, decision: 'approved', actor: flagValue(rest, '--actor') || 'Chief', path: storePath });
    const proposal = readActionProposalStore(storePath).proposals.find(p => p.id === id);
    if (hasFlag(rest, '--json')) printJson({ ok: true, action: 'approve', decision, proposal, guardrails: proposal?.guardrails, execution_policy: proposal?.execution_policy });
    else console.log(`${id}\tapproved\trecord_intent_only`);
    return;
  }

  if (sub === 'reject') {
    const id = rest.find(a => !a.startsWith('--'));
    if (!id) throw new Error('gbrain actions reject requires <id>');
    const reason = flagValue(rest, '--reason');
    if (!reason) throw new Error('gbrain actions reject requires --reason <reason>');
    const decision = recordActionProposalDecision({ proposalId: id, decision: 'rejected', reason, actor: flagValue(rest, '--actor') || 'Chief', path: storePath });
    const proposal = readActionProposalStore(storePath).proposals.find(p => p.id === id);
    if (hasFlag(rest, '--json')) printJson({ ok: true, action: 'reject', decision, proposal, guardrails: proposal?.guardrails });
    else console.log(`${id}\trejected\t${reason}`);
    return;
  }

  if (sub === 'validate') {
    const file = flagValue(rest, '--proposal-json');
    if (!file) throw new Error('gbrain actions validate requires --proposal-json <file>');
    const proposal = JSON.parse(readFileSync(file, 'utf8'));
    const errors = validateActionProposal(proposal);
    if (hasFlag(rest, '--json')) printJson({ ok: errors.length === 0, errors, allowed_action_types: ACTION_PROPOSAL_TYPES, guardrails: { fail_closed: true, actions_performed: false } });
    else if (errors.length) console.error(`Action proposal invalid:\n- ${errors.join('\n- ')}`);
    else console.log('Action proposal valid.');
    return;
  }

  throw new Error(`Unknown actions subcommand: ${sub}`);
}
