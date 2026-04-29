import { assertRouteAllowed, type ModelProvider, type PrivacyTier, type RouteDecision, type RouteInput, type WorkKind } from './privacy-policy.ts';

export interface RouteModelInput extends RouteInput {
  prompt?: string;
}

const LOCAL: ModelProvider = 'qwen-local';
const DEFAULT_TOKENS = 8192;

function build(preferred_provider: ModelProvider, fallback_providers: ModelProvider[], extra: Partial<RouteDecision> = {}): RouteDecision {
  return {
    preferred_provider,
    fallback_providers,
    require_json_schema: true,
    allow_external_network: false,
    allow_raw_private_context: false,
    max_context_tokens: DEFAULT_TOKENS,
    warnings: [],
    ...extra,
  };
}

function cloudRoute(primary: ModelProvider, fallback: ModelProvider[] = [], allowRaw = false): RouteDecision {
  return build(primary, fallback, { allow_external_network: true, allow_raw_private_context: allowRaw, max_context_tokens: 12000 });
}

export function routeModel(input: RouteModelInput): RouteDecision {
  let route: RouteDecision;

  if (input.privacy === 'P0') {
    route = build(LOCAL, []);
  } else if (input.privacy === 'P1') {
    if (input.allowCloudEscalation) {
      route = cloudRoute('minimax-m27', ['qwen-local']);
    } else {
      route = build(LOCAL, []);
    }
  } else if (input.kind === 'code_pr_draft') {
    route = cloudRoute('codex', ['minimax-m27', 'qwen-local']);
  } else if (input.kind === 'code_pr_review') {
    route = cloudRoute('codex', ['claude-pro', 'minimax-m27', 'qwen-local']);
  } else if (input.kind === 'architecture_review') {
    route = cloudRoute('gpt-pro', ['claude-pro', 'minimax-m27']);
  } else if (input.kind === 'world_scout' || input.kind === 'bookmark_enrich' || input.kind === 'opportunity_score') {
    route = cloudRoute('minimax-m27', ['qwen-local']);
  } else if (input.privacy === 'P3') {
    route = cloudRoute('minimax-m27', ['qwen-local']);
  } else {
    route = build(LOCAL, []);
  }

  if (input.privacy === 'P0') {
    route.allow_external_network = false;
    route.fallback_providers = [];
    route.allow_raw_private_context = false;
  }
  if (input.privacy === 'P1' && !input.allowCloudEscalation) {
    route.allow_external_network = false;
    route.fallback_providers = [];
    route.allow_raw_private_context = false;
    route.preferred_provider = LOCAL;
  }
  if (input.privacy === 'P1' && input.allowCloudEscalation) {
    route.allow_raw_private_context = false;
  }

  route.warnings.push(route.allow_external_network ? 'cloud routing enabled' : 'local-only routing');
  assertRouteAllowed(route, input);
  return route;
}
