export const GBRAIN_NAMESPACES = ['personal', 'ventures', 'world', 'network', 'scouts', 'actions', 'evals'] as const;
export const GBRAIN_PRIVACY_LEVELS = ['public', 'internal', 'private', 'confidential'] as const;
export const GBRAIN_SENSITIVITY_LEVELS = ['low', 'medium', 'high', 'restricted'] as const;

export type GBrainNamespace = typeof GBRAIN_NAMESPACES[number];
export type GBrainPrivacy = typeof GBRAIN_PRIVACY_LEVELS[number];
export type GBrainSensitivity = typeof GBRAIN_SENSITIVITY_LEVELS[number];

export interface NamespacePolicyClassification {
  namespace: GBrainNamespace;
  privacy: GBrainPrivacy;
  sensitivity: GBrainSensitivity;
  context_visibility: 'full' | 'summary' | 'metadata_only' | 'deny';
  agent_read: 'allowed' | 'review_required' | 'denied';
  trusted_write: 'review_required';
  external_action: 'denied' | 'explicit_approval_required';
  warnings: string[];
}

export interface NamespacePolicyInput {
  namespace?: string;
  privacy?: string;
  sensitivity?: string;
}

const namespaceSet = new Set<string>(GBRAIN_NAMESPACES);
const privacySet = new Set<string>(GBRAIN_PRIVACY_LEVELS);
const sensitivitySet = new Set<string>(GBRAIN_SENSITIVITY_LEVELS);

export function conservativeNamespacePolicyDefaults(input: NamespacePolicyInput = {}): Required<NamespacePolicyInput> {
  return {
    namespace: input.namespace || 'personal',
    privacy: input.privacy || 'private',
    sensitivity: input.sensitivity || 'high',
  };
}

export function validateNamespacePolicy(input: NamespacePolicyInput = {}): string[] {
  const value = conservativeNamespacePolicyDefaults(input);
  const errors: string[] = [];
  if (!namespaceSet.has(value.namespace)) errors.push(`namespace must be one of: ${GBRAIN_NAMESPACES.join(', ')}`);
  if (!privacySet.has(value.privacy)) errors.push(`privacy must be one of: ${GBRAIN_PRIVACY_LEVELS.join(', ')}`);
  if (!sensitivitySet.has(value.sensitivity)) errors.push(`sensitivity must be one of: ${GBRAIN_SENSITIVITY_LEVELS.join(', ')}`);
  if (errors.length) return errors;

  const namespace = value.namespace as GBrainNamespace;
  const privacy = value.privacy as GBrainPrivacy;
  const sensitivity = value.sensitivity as GBrainSensitivity;

  if (privacy === 'public' && (sensitivity === 'high' || sensitivity === 'restricted')) {
    errors.push('public privacy cannot be paired with high or restricted sensitivity');
  }
  if (privacy === 'confidential' && (sensitivity === 'low' || sensitivity === 'medium')) {
    errors.push('confidential privacy requires high or restricted sensitivity');
  }
  if ((namespace === 'personal' || namespace === 'network') && privacy === 'public') {
    errors.push(`${namespace} namespace cannot be public by default`);
  }
  if (namespace === 'actions' && privacy === 'public') {
    errors.push('actions namespace cannot be public');
  }
  if ((namespace === 'scouts' || namespace === 'evals' || namespace === 'world') && privacy === 'confidential') {
    errors.push(`${namespace} namespace should not be confidential; use personal/network/ventures for sensitive internal facts`);
  }
  return errors;
}

export function classifyNamespacePolicy(input: NamespacePolicyInput = {}): NamespacePolicyClassification {
  const errors = validateNamespacePolicy(input);
  if (errors.length) throw new Error(errors.join('; '));
  const value = conservativeNamespacePolicyDefaults(input) as { namespace: GBrainNamespace; privacy: GBrainPrivacy; sensitivity: GBrainSensitivity };
  const { namespace, privacy, sensitivity } = value;
  const restricted = sensitivity === 'restricted' || privacy === 'confidential';
  const high = sensitivity === 'high' || restricted;
  const externalAction = namespace === 'actions' ? 'explicit_approval_required' : 'denied';

  return {
    namespace,
    privacy,
    sensitivity,
    context_visibility: restricted ? 'deny' : high ? 'metadata_only' : privacy === 'private' ? 'summary' : 'full',
    agent_read: restricted ? 'denied' : high || privacy === 'private' ? 'review_required' : 'allowed',
    trusted_write: 'review_required',
    external_action: externalAction,
    warnings: high ? ['sensitive memory requires explicit review before broad context use'] : [],
  };
}
