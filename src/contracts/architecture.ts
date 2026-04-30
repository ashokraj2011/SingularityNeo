export const MODULAR_DOMAIN_IDS = [
  'self-service',
  'context-fabric',
  'llm-gateway',
  'agent-registry-learning',
  'tool-registry-execution',
  'local-runner',
  'user-management',
  'model-policy-resolver',
  'platform-observability',
] as const;

export type ModularDomainId = (typeof MODULAR_DOMAIN_IDS)[number];

export interface ModularDomainBoundary {
  id: ModularDomainId;
  label: string;
  description: string;
  publicEntrypoints: string[];
}

export const MODULAR_DOMAIN_BOUNDARIES: ModularDomainBoundary[] = [
  {
    id: 'self-service',
    label: 'Self-Service',
    description: 'Capability, workflow, work-item, and orchestration management.',
    publicEntrypoints: ['server/domains/self-service/index.ts'],
  },
  {
    id: 'context-fabric',
    label: 'Context Fabric',
    description: 'Conversation continuity, memory, AST grounding, and live work context.',
    publicEntrypoints: ['server/domains/context-fabric/index.ts'],
  },
  {
    id: 'llm-gateway',
    label: 'LLM Gateway',
    description: 'Provider routing, model invocation, sessions, and normalized runtime access.',
    publicEntrypoints: ['server/domains/llm-gateway/index.ts'],
  },
  {
    id: 'agent-registry-learning',
    label: 'Agent Registry & Learning',
    description: 'Agent identity, learning profiles, sessions, and learning workers.',
    publicEntrypoints: ['server/domains/agent-learning/index.ts'],
  },
  {
    id: 'tool-registry-execution',
    label: 'Tool Registry & Execution Plane',
    description: 'Tool catalog, tool policy, execution orchestration, and workflow runtime.',
    publicEntrypoints: ['server/domains/tool-plane/index.ts'],
  },
  {
    id: 'local-runner',
    label: 'Local Runner',
    description: 'Desktop runtime ownership, local execution wiring, and runner probes.',
    publicEntrypoints: ['server/domains/local-runner/index.ts'],
  },
  {
    id: 'user-management',
    label: 'User Management',
    description: 'Actor context, access control, permissions, and approval authority.',
    publicEntrypoints: ['server/domains/access/index.ts'],
  },
  {
    id: 'model-policy-resolver',
    label: 'Model Policy Resolver',
    description: 'Runtime policy, token policy, and model selection/adaptation.',
    publicEntrypoints: ['server/domains/model-policy/index.ts'],
  },
  {
    id: 'platform-observability',
    label: 'Platform / Observability',
    description: 'Persistence bootstrap, telemetry, health, and server infrastructure.',
    publicEntrypoints: ['server/domains/platform/index.ts'],
  },
];
