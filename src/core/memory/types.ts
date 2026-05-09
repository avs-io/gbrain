export type TypedMemorySensitivity = 'low' | 'medium' | 'high' | string;

export type TypedMemorySource = {
  kind?: string;
  path: string;
  timestamp?: string;
  quote?: string;
  parent_ids?: string[];
  [key: string]: unknown;
};

export type TypedMemoryItem = {
  id: string;
  memory_type: string;
  title: string;
  claim: string;
  source: TypedMemorySource;
  confidence?: number;
  status?: string;
  observed_at?: string;
  valid_time?: Record<string, unknown>;
  permission_scope?: string;
  sensitivity: TypedMemorySensitivity;
  surfacing_policy?: string;
  entities?: string[];
  tags?: string[];
  promote_to?: string[];
  [key: string]: unknown;
};

export type TypedMemoryRoute = {
  id: string;
  label: string;
  terms: string[];
  entities: string[];
  types: string[];
  intent: string;
};

export type TypedMemoryMatchedRoute = Omit<TypedMemoryRoute, 'terms' | 'entities' | 'types'> & {
  score: number;
  hits: string[];
};

export type TypedMemoryRouteCandidate = {
  id: string;
  memory_type: string;
  title: string;
  claim: string;
  score: number;
  reasons: string[];
  sensitivity: TypedMemorySensitivity;
  permission_scope?: string;
  surfacing_policy?: string;
  source: TypedMemorySource;
  entities?: string[];
  status?: string;
};

export type TypedMemoryRouteResult = {
  generated_at: string;
  query: string;
  context?: string;
  fixture?: string;
  matched_routes: TypedMemoryMatchedRoute[];
  desired_memory_types: string[];
  desired_entities: string[];
  results: TypedMemoryRouteCandidate[];
  pass: boolean;
  warnings: string[];
};
