import React from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  FileText,
  Flag,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trello,
  Users,
  Wallet,
  Workflow,
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
    title: 'Home',
    path: '/',
    description:
      'Start here to understand capability health, trust, readiness, active risk, and what the team should focus on next.',
    icon: LayoutDashboard,
  },
  {
    title: 'Work',
    path: '/orchestrator',
    description:
      'Operate one work item at a time, guide agents, review waits, approve gated work, and keep delivery moving.',
    icon: Trello,
  },
  {
    title: 'Team',
    path: '/team',
    description:
      'See who can help, what each agent is responsible for, and whether skills, tools, and learning are in good shape.',
    icon: Users,
  },
  {
    title: 'Chat',
    path: '/chat',
    description:
      'Talk to agents with capability context, resumable sessions, execution awareness, and memory-backed grounding.',
    icon: MessageSquare,
  },
  {
    title: 'Evidence',
    path: '/ledger',
    description:
      'Inspect artifacts, approvals, handoffs, completed work, and flight recorder history when you need proof.',
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
      'Review Team so the owner and specialist agents have the right skills, tools, and learning for this capability.',
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
      'Review the gated documents, diffs, and evidence, then approve, reject, or request changes with a clear operator decision.',
    icon: ShieldCheck,
  },
  {
    title: 'Need the full story',
    description:
      'Use Explain and Evidence to understand the latest attempt, what changed, and what the system expects next.',
    icon: FileText,
  },
];

const ADVANCED_TOOL_ICONS: Record<string, LucideIcon> = {
  memory: BrainCircuit,
  'tool-access': ShieldCheck,
  'run-console': Activity,
  evals: BarChart3,
  skills: BookOpen,
  'artifact-designer': FileText,
  tasks: Terminal,
  studio: Sparkles,
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
      title="Getting Started With Singulairy"
      description="Singulairy helps a team define how work should move, collaborate with agents, execute safely, and keep an audit-grade record of what happened."
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
            description="Think of Singulairy as the operating console for one business capability. It keeps workflows, agents, evidence, approvals, and runtime context connected from idea to delivery."
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
                value="Home -> Work -> Evidence"
                helper="Understand readiness, operate the work, then inspect the proof."
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
              Work, Team, Chat, Designer, and Evidence all follow that same selected capability.
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
