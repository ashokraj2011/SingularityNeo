import React from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  Database,
  FileText,
  Flag,
  Gauge,
  GitBranch,
  History,
  LayoutDashboard,
  LogIn,
  MessageSquare,
  Network,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trello,
  Users,
  Wallet,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ADVANCED_TOOL_DESCRIPTORS } from '../lib/capabilityExperience';
import { AdvancedDisclosure, StatusChipGroup } from './WorkspaceUI';
import { ModalShell, SectionCard, StatTile, StatusBadge } from './EnterpriseUI';

const PRIMARY_WORKSPACES: Array<{
  title: string;
  path: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    title: 'Work',
    path: '/',
    description:
      'The default landing surface. Operate one work item at a time, guide agents, review waits, approve gated work, and keep delivery moving phase by phase.',
    icon: Trello,
  },
  {
    title: 'Home',
    path: '/home',
    description:
      'Capability health at a glance — readiness, trust signal, active risk, and what the team should focus on next.',
    icon: LayoutDashboard,
  },
  {
    title: 'Agents',
    path: '/team',
    description:
      'See who can help, what each agent is responsible for, and whether skills, tools, and learning are in good shape.',
    icon: Users,
  },
  {
    title: 'Chat',
    path: '/chat',
    description:
      'Talk to agents with capability context and memory-backed grounding. Also includes code-aware lookups — type "find <symbol>" or "where is <symbol>" to query the indexed AST for this capability.',
    icon: MessageSquare,
  },
  {
    title: 'Activity Record',
    path: '/ledger',
    description:
      'Complete audit trail — artifacts, approvals, decisions, handoffs, completed work, and flight recorder history. Code-change artifacts open in a VS Code-style diff viewer.',
    icon: Wallet,
  },
  {
    title: 'Designer',
    path: '/designer',
    description:
      'Define the workflow, lifecycle lanes, artifact expectations, and orchestration rules that shape delivery.',
    icon: Workflow,
  },
];

const ALWAYS_ON_LIBRARIES: Array<{
  title: string;
  path: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    title: 'Tools',
    path: '/tools',
    description:
      'Capability-wide inventory of tool adapters — where each tool is used, recent invocations, and the latest policy verdict per tool.',
    icon: Wrench,
  },
  {
    title: 'Policies',
    path: '/policies',
    description:
      'Runtime approval policies and governance control bindings scoped to this capability, with drill-through to the workflow steps they apply to.',
    icon: ShieldCheck,
  },
  {
    title: 'Skills',
    path: '/skills',
    description:
      'Reusable capability skills and specialist behaviors that agents can compose into their runtime context.',
    icon: BookOpen,
  },
];

const GOVERNANCE_SURFACES: Array<{
  title: string;
  path: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    title: 'Posture Dashboard',
    path: '/governance/posture',
    description:
      'One-screen read over signer health, control coverage, active exceptions, and provenance integrity — the view auditors and operators open first.',
    icon: Gauge,
  },
  {
    title: 'Controls',
    path: '/governance/controls',
    description:
      'Review the NIST CSF 2.0, SOC 2 TSC, and ISO 27001 controls the platform claims to enforce, and the policies bound to each.',
    icon: Shield,
  },
  {
    title: 'Exceptions',
    path: '/governance/exceptions',
    description:
      'Review, approve, and revoke time-bound deviations that waive policy approval gates for individual capabilities.',
    icon: AlertOctagon,
  },
  {
    title: 'Prove the Negative',
    path: '/governance/provenance',
    description:
      'Audit whether a path was touched by an AI (or a human) in a time window. Gaps in logging are surfaced rather than silently reported as "no".',
    icon: History,
  },
];

const OPERATING_MODEL: Array<{
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    title: 'Capability',
    description:
      'A capability is the operating unit. It owns the business purpose, lifecycle, workflows, collaborators, runtime context, and evidence for one domain of work.',
    icon: Flag,
  },
  {
    title: 'Lifecycle',
    description:
      'Each capability can define its own phases. Those phases become the lanes in Designer, the flow map in Work, and the timeline labels in Evidence.',
    icon: GitBranch,
  },
  {
    title: 'Agents',
    description:
      'Agents help with planning, design, delivery, validation, release, and explanation, but humans still control approvals and operating decisions.',
    icon: BrainCircuit,
  },
  {
    title: 'Evidence',
    description:
      'Artifacts, handoffs, approvals, waits, and run history become durable proof so teams can understand what happened and why.',
    icon: ShieldCheck,
  },
];

const DAILY_FLOW: Array<{
  title: string;
  description: string;
}> = [
  {
    title: '1. Choose the right capability',
    description:
      'Open the capability that owns this work so every page, workflow, agent, and artifact stays in the right context.',
  },
  {
    title: '2. Confirm the operating model',
    description:
      'Use Designer when the lifecycle, workflow, artifact contract, or step ownership needs to change.',
  },
  {
    title: '3. Check the people and agents',
    description:
      'Review Agents so the owner and specialist agents have the right skills, tools, and learning for this capability.',
  },
  {
    title: '4. Run the work through Work and Chat',
    description:
      'Create or select a work item, collaborate with the active agent, resolve waits, and keep the item moving phase by phase.',
  },
  {
    title: '5. Use Evidence to prove the result',
    description:
      'Use Evidence and Flight Recorder to inspect artifacts, approvals, handoffs, and the decision trail behind the result.',
  },
];

const WHEN_WORK_GETS_STUCK: Array<{
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    title: 'Blocked',
    description:
      'Open Work, inspect the latest failure reason, add guidance for the agent, and restart from the current phase when ready.',
    icon: Activity,
  },
  {
    title: 'Waiting for input',
    description:
      'Provide the requested input in Work or Chat. Only workflow-required inputs block execution; advisory agent suggestions should not.',
    icon: MessageSquare,
  },
  {
    title: 'Waiting for approval',
    description:
      'Review the gated documents, diffs, and evidence, then approve, reject, or request changes with a clear operator decision. Code changes open in a side-by-side diff viewer.',
    icon: ShieldCheck,
  },
  {
    title: 'Tool call denied',
    description:
      'Click the policy verdict badge on the tool invocation to see which policy fired and why. Exceptions, if any, are listed under Governance → Exceptions.',
    icon: ShieldCheck,
  },
  {
    title: 'Looking up code',
    description:
      'In Chat, type "find <symbol>" or "where is <symbol>" to query the capability\'s indexed AST and jump straight to file:line.',
    icon: Search,
  },
  {
    title: 'Need the full story',
    description:
      'Use Explain and Evidence to understand the latest attempt, what changed, and what the system expects next.',
    icon: FileText,
  },
];

// Keep this map in sync with ADVANCED_TOOL_DESCRIPTORS in
// src/lib/capabilityExperience.ts. Any id without an entry here falls
// back to a generic Sparkles — visually uninformative, so add a real
// icon whenever you register a new descriptor.
const ADVANCED_TOOL_ICONS: Record<string, LucideIcon> = {
  incidents: AlertTriangle,
  mrm: BarChart3,
  operations: Activity,
  architecture: Network,
  identity: LogIn,
  access: Users,
  databases: Database,
  memory: BrainCircuit,
  'tool-access': ShieldCheck,
  'run-console': Activity,
  evals: BarChart3,
  skills: BookOpen,
  tools: Wrench,
  policies: ShieldCheck,
  'artifact-designer': FileText,
  tasks: Terminal,
  studio: Sparkles,
  'governance-controls': Shield,
  'governance-exceptions': AlertOctagon,
  'governance-provenance': History,
  'governance-posture': Gauge,
};

export const SingularityHelpMenu = ({
  activeCapabilityName,
  onClose,
  onNavigate,
}: {
  activeCapabilityName?: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) => (
  <div className="workspace-modal-backdrop z-[100] bg-slate-950/45">
    <button
      type="button"
      className="absolute inset-0"
      onClick={onClose}
      aria-label="Close help menu"
    />
    <ModalShell
      eyebrow="Help menu"
      title="Getting Started With Singularity"
      description="Singularity helps a team define how work should move, collaborate with agents, execute safely, and keep an audit-grade record of what happened."
      actions={
        <button
          type="button"
          onClick={onClose}
          className="workspace-list-action"
          aria-label="Close help menu"
        >
          <X size={14} />
        </button>
      }
      className="relative z-[101] max-w-6xl"
    >
      <div className="space-y-6 pt-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,0.9fr)]">
          <SectionCard
            title="What this workspace is for"
            description="Think of Singularity as the operating console for one business capability. It keeps workflows, agents, evidence, approvals, governance controls, and runtime context connected from idea to delivery."
            tone="brand"
            icon={Sparkles}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <StatTile
                label="Center of gravity"
                value="Capability"
                helper="One business domain with its own collaborators, workflows, and evidence."
                tone="brand"
              />
              <StatTile
                label="Primary promise"
                value="Controlled delivery"
                helper="Move work with agent help while keeping approvals, evidence, and operator control intact."
                tone="success"
              />
              <StatTile
                label="Best daily path"
                value="Work -> Chat -> Evidence"
                helper="Operate the work, collaborate with agents in context, then inspect the proof."
                tone="info"
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Current workspace lens"
            description="The whole app follows the selected capability context."
            icon={ShieldCheck}
          >
            <StatusChipGroup
              items={[
                { label: 'Active capability', value: activeCapabilityName || 'Workspace' },
                { label: 'Primary mode', value: 'Business-first orchestration', tone: 'brand' },
                { label: 'Deep tools', value: 'Advanced and progressively disclosed' },
              ]}
            />
            <p className="text-sm leading-relaxed text-secondary">
              If something looks surprising, first check which capability is active. Home,
              Work, Agents, Chat, Designer, and Evidence all follow that same selected capability.
            </p>
          </SectionCard>
        </div>

        <SectionCard
          title="Main journey"
          description="These are the primary surfaces most users need day to day."
          icon={CheckCircle2}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {PRIMARY_WORKSPACES.map(item => (
              <div
                key={item.path}
                className="rounded-3xl border border-outline-variant/35 bg-surface-container-low p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="section-card-icon h-11 w-11 rounded-2xl">
                    <item.icon size={18} />
                  </div>
                  <StatusBadge tone="brand">{item.title}</StatusBadge>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-secondary">
                  {item.description}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate(item.path)}
                  className="enterprise-button enterprise-button-secondary mt-4 w-full"
                >
                  Open {item.title}
                  <ArrowRight size={14} />
                </button>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Always-on libraries"
          description="These capability-scoped catalogs sit next to the main surfaces in the sidebar. Use them to answer 'which tools does this capability use?', 'which policies govern it?', and 'which specialist skills can its agents compose?'."
          icon={BookOpen}
        >
          <div className="grid gap-4 md:grid-cols-3">
            {ALWAYS_ON_LIBRARIES.map(item => (
              <div
                key={item.path}
                className="rounded-3xl border border-outline-variant/35 bg-surface-container-low p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="section-card-icon h-11 w-11 rounded-2xl">
                    <item.icon size={18} />
                  </div>
                  <StatusBadge tone="brand">{item.title}</StatusBadge>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-secondary">
                  {item.description}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate(item.path)}
                  className="enterprise-button enterprise-button-secondary mt-4 w-full"
                >
                  Open {item.title}
                  <ArrowRight size={14} />
                </button>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)]">
          <SectionCard
            title="How to think about a capability"
            description="These ideas make the rest of the product easier to understand."
            icon={Flag}
          >
            <div className="grid gap-4 md:grid-cols-2">
              {OPERATING_MODEL.map(item => (
                <div
                  key={item.title}
                  className="rounded-3xl border border-outline-variant/35 bg-white p-4 shadow-[0_6px_18px_rgba(12,23,39,0.035)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="section-card-icon h-10 w-10 rounded-2xl">
                      <item.icon size={16} />
                    </div>
                    <h3 className="text-sm font-bold text-on-surface">{item.title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-secondary">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Suggested daily operating flow"
            description="A practical way to get value without opening every tool."
            icon={ArrowRight}
          >
            <div className="space-y-3">
              {DAILY_FLOW.map(item => (
                <div
                  key={item.title}
                  className="rounded-3xl border border-outline-variant/35 bg-surface-container-low px-4 py-4"
                >
                  <h3 className="text-sm font-bold text-on-surface">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-secondary">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="When work gets stuck"
          description="These are the fastest ways to get delivery moving again."
          icon={Activity}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {WHEN_WORK_GETS_STUCK.map(item => (
              <div
                key={item.title}
                className="rounded-3xl border border-outline-variant/35 bg-white p-4 shadow-[0_6px_18px_rgba(12,23,39,0.035)]"
              >
                <div className="flex items-center gap-3">
                  <div className="section-card-icon h-10 w-10 rounded-2xl">
                    <item.icon size={16} />
                  </div>
                  <h3 className="text-sm font-bold text-on-surface">{item.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-secondary">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Governance & assurance"
          description="Auditor-facing surfaces: posture at a glance, the controls the platform claims to enforce, active exceptions, and provenance proofs that answer 'was this touched by an AI or a human, and when?'."
          icon={Shield}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {GOVERNANCE_SURFACES.map(item => (
              <div
                key={item.path}
                className="rounded-3xl border border-outline-variant/35 bg-white p-4 shadow-[0_6px_18px_rgba(12,23,39,0.035)]"
              >
                <div className="flex items-center gap-3">
                  <div className="section-card-icon h-10 w-10 rounded-2xl">
                    <item.icon size={16} />
                  </div>
                  <h3 className="text-sm font-bold text-on-surface">{item.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-secondary">
                  {item.description}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate(item.path)}
                  className="enterprise-button enterprise-button-secondary mt-4 w-full"
                >
                  Open {item.title}
                  <ArrowRight size={14} />
                </button>
              </div>
            ))}
          </div>
        </SectionCard>

        <AdvancedDisclosure
          title="Advanced tools"
          description="These tools are still important, but they are meant for deeper inspection, diagnostics, authoring, or specialist operations."
          defaultOpen={false}
          badge={<StatusBadge tone="neutral">Optional depth</StatusBadge>}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ADVANCED_TOOL_DESCRIPTORS.map(tool => {
              const Icon = ADVANCED_TOOL_ICONS[tool.id] || Sparkles;
              return (
                <div
                  key={tool.id}
                  className="rounded-3xl border border-outline-variant/35 bg-surface-container-low p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="section-card-icon h-10 w-10 rounded-2xl">
                      <Icon size={16} />
                    </div>
                    <StatusBadge tone="neutral">{tool.shortName}</StatusBadge>
                  </div>
                  <h3 className="mt-4 text-sm font-bold text-on-surface">{tool.label}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-secondary">
                    {tool.description}
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate(tool.path)}
                    className="enterprise-button enterprise-button-secondary mt-4 w-full"
                  >
                    Open {tool.shortName}
                  </button>
                </div>
              );
            })}
          </div>
        </AdvancedDisclosure>
      </div>
    </ModalShell>
  </div>
);
