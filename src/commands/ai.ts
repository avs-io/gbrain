import { routeModel } from '../core/ai/model-router.ts';
import type { PrivacyTier, WorkKind } from '../core/ai/privacy-policy.ts';

function parse(args: string[]): { kind?: WorkKind; privacy?: PrivacyTier; json: boolean; allowCloudEscalation: boolean } {
  let kind: WorkKind | undefined;
  let privacy: PrivacyTier | undefined;
  let json = false;
  let allowCloudEscalation = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') json = true;
    else if (a === '--allow-cloud-escalation') allowCloudEscalation = true;
    else if (a === '--kind') kind = args[++i] as WorkKind;
    else if (a?.startsWith('--kind=')) kind = a.slice(7) as WorkKind;
    else if (a === '--privacy') privacy = args[++i] as PrivacyTier;
    else if (a?.startsWith('--privacy=')) privacy = a.slice(10) as PrivacyTier;
  }
  return { kind, privacy, json, allowCloudEscalation };
}

export async function runAiCommand(_engine: unknown, args: string[]): Promise<void> {
  const flags = parse(args);
  if (!flags.kind || !flags.privacy) throw new Error('Usage: gbrain ai route --kind <kind> --privacy <P0|P1|P2|P3> [--allow-cloud-escalation] [--json]');
  const route = routeModel({ kind: flags.kind, privacy: flags.privacy, allowCloudEscalation: flags.allowCloudEscalation });
  if (flags.json) console.log(JSON.stringify(route, null, 2));
  else console.log(`${route.preferred_provider} ${route.fallback_providers.join(',')}`);
}
