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
      'See what the capability owns, whether it is trustworthy, what needs attention, and what has already been delivered.',
    icon: LayoutDashboard,
  },
  {
    title: 'Work',
    path: '/orchestrator',
    description:
      'Move delivery forward, unblock waits, approve decisions, and restart or reset work when needed.',
    icon: Trello,
  },
  {
    title: 'Team',
    path: '/team',
    description:
      'Understand who can help, which agents are ready, and quickly hand a collaborator into Chat.',
    icon: Users,
  },
  {
    title: 'Chat',
    path: '/chat',
    description:
      'Collaborate with the active agent using capability context, resumable sessions, and grounded memory.',
    icon: MessageSquare,
  },
  {
    title: 'Evidence',
    path: '/ledger',
    description:
      'Review artifacts, handoffs, completed work, and the Flight Recorder audit trail for each work item.',
    icon: Wallet,
  },
  {
    title: 'Designer',
    path: '/designer',
    description:
      'Define the workflow, lifecycle lanes, and orchestration structure that drive work through the capability.',
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
      'A capability is the operating unit. It owns the business charter, collaborators, lifecycle, workflows, and evidence for one domain of work.',
    icon: Flag,
  },
  {
    title: 'Lifecycle',
    description:
      'Each capability can define its own working phases. Those phases become the lanes in Designer, the columns in Work, and the timeline labels in Evidence.',
    icon: GitBranch,
  },
  {
    title: 'Agents',
    description:
      'Agents learn from the capability memory and help with planning, design, delivery, review, and collaboration inside that capability context.',
    icon: BrainCircuit,
  },
  {
    title: 'Evidence',
    description:
      'Artifacts, handoffs, approvals, waits, and run history become durable evidence so teams can understand what happened and why.',
    icon: ShieldCheck,
  },
];

const DAILY_FLOW: Array<{
  title: string;
  description: string;
}> = [
  {
    title: '1. Define the business outcome',
    description:
      'Create or open a capability, confirm what it owns, and make sure the outcome, success metrics, and evidence expectations are clear.',
  },
  {
    title: '2. Shape the operating model',
    description:
      'Use Designer to define the lifecycle and workflow so the system knows how work should move through the capability.',
  },
  {
    title: '3. Prepare collaborators',
    description:
      'Review Team so the owner and specialist agents are ready, learned, and aligned to the capability purpose.',
  },
  {
    title: '4. Deliver through Work and Chat',
    description:
      'Create work items, collaborate with agents, resolve waits, and keep delivery moving from one lifecycle phase to the next.',
  },
  {
    title: '5. Audit what was delivered',
    description:
      'Use Evidence and Flight Recorder to inspect artifacts, approvals, handoffs, and the final decision trail behind each result.',
  },
];

const ADVANCED_TOOL_ICONS: Record<string, LucideIcon> = {
  memory: BrainCircuit,
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
      title="Understanding Singularity Neo"
      description="Singularity Neo is a capability-centered operating workspace. It helps a team define how work should move, collaborate with agents, run delivery, and keep an audit-grade record of what happened."
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
            description="Think of Singularity Neo as the operating system for one business capability. The capability holds the workflow, lifecycle, people, agents, evidence, and runtime context needed to take work from idea to release."
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
                value="Trusted delivery"
                helper="Move work with clear approvals, durable evidence, and business-friendly visibility."
                tone="success"
              />
              <StatTile
                label="Best daily path"
                value="Home -> Work -> Evidence"
                helper="Understand readiness, move delivery, then inspect what was produced."
                tone="info"
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Current workspace lens"
            description="The whole app stays inside the selected capability context."
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
              If something looks surprising, first check which capability is active. Team,
              Chat, Work, Designer, and Evidence all follow that same selected capability.
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
            description="A simple mental model for getting value from the product without opening every tool."
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
