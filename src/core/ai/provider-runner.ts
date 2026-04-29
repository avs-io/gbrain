import { routeModel, type RouteModelInput } from './model-router.ts';
import { redactRoutePrompt, summarizeRoutePrompt, type PrivacyTier, type RouteDecision } from './privacy-policy.ts';
import type { WorkKind } from './privacy-policy.ts';

export interface ProviderRunInput extends RouteModelInput {
  prompt: string;
}

export interface ProviderRunEnvelope {
  schema: 'gbrain.ai.provider-runner.v1';
  ok: boolean;
  route: RouteDecision;
  redacted_prompt?: string;
  provider_request?: {
    provider: RouteDecision['preferred_provider'];
    json_schema: true;
    prompt: string;
    prompt_summary: string;
    privacy_tier: PrivacyTier;
    work_kind: WorkKind;
  };
  dry_run: true;
  decision: 'local_only' | 'cloud_allowed' | 'reject';
  reasons: string[];
  guardrails: string[];
}

function baseGuardrails(privacy: PrivacyTier): string[] {
  const guardrails = ['dry-run only; no provider/model/network calls'];
  if (privacy === 'P0' || privacy === 'P1') guardrails.push('private context must not be emitted raw');
  if (privacy === 'P0') guardrails.push('cloud forbidden');
  if (privacy === 'P1') guardrails.push('cloud requires explicit escalation');
  return guardrails;
}

export function prepareProviderRun(input: ProviderRunInput): ProviderRunEnvelope {
  const route = routeModel(input);
  const guardrails = baseGuardrails(input.privacy);
  const reasons: string[] = [...route.warnings];
  const redacted_prompt = redactRoutePrompt(input.prompt, input.privacy);

  if (input.privacy === 'P0') {
    return {
      schema: 'gbrain.ai.provider-runner.v1',
      ok: false,
      route,
      dry_run: true,
      decision: 'reject',
      reasons: [...reasons, 'P0 is always local-only and rejected for provider preparation'],
      guardrails,
    };
  }

  if (input.privacy === 'P1' && !input.allowCloudEscalation) {
    return {
      schema: 'gbrain.ai.provider-runner.v1',
      ok: true,
      route,
      redacted_prompt,
      dry_run: true,
      decision: 'local_only',
      reasons: [...reasons, 'P1 without escalation remains local-only'],
      guardrails,
    };
  }

  const provider_request = {
    provider: route.preferred_provider,
    json_schema: true as const,
    prompt: redacted_prompt,
    prompt_summary: summarizeRoutePrompt(redacted_prompt),
    privacy_tier: input.privacy,
    work_kind: input.kind,
  };

  return {
    schema: 'gbrain.ai.provider-runner.v1',
    ok: true,
    route,
    redacted_prompt,
    provider_request,
    dry_run: true,
    decision: route.allow_external_network ? 'cloud_allowed' : 'local_only',
    reasons,
    guardrails,
  };
}
