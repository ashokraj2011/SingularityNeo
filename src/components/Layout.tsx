import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  BrainCircuit,
  BookOpen,
  Box,
  CircleHelp,
  ChevronDown,
  FileText,
  LayoutDashboard,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PlusCircle,
  Search,
  Sparkles,
  Terminal,
  Trello,
  Users,
  Wallet,
  Workflow,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import {
  ADVANCED_TOOL_DESCRIPTORS,
  type AdvancedToolId,
} from '../lib/capabilityExperience';
import { readViewPreference, writeViewPreference } from '../lib/viewPreferences';
import { StatusBadge } from './EnterpriseUI';
import { SingularityHelpMenu } from './SingularityHelpMenu';

const primaryNavItems = [
  { name: 'Home', shortName: 'Home', icon: LayoutDashboard, path: '/' },
  { name: 'Work', shortName: 'Work', icon: Trello, path: '/orchestrator' },
  { name: 'Team', shortName: 'Team', icon: Users, path: '/team' },
  { name: 'Chat', shortName: 'Chat', icon: MessageSquare, path: '/chat' },
  { name: 'Evidence', shortName: 'Evidence', icon: Wallet, path: '/ledger' },
  { name: 'Designer', shortName: 'Design', icon: Workflow, path: '/designer' },
] as const;

const advancedToolIcons: Record<AdvancedToolId, typeof BrainCircuit> = {
  memory: BrainCircuit,
  'run-console': Activity,
  evals: BarChart3,
  skills: BookOpen,
  'artifact-designer': FileText,
  tasks: Terminal,
  studio: Sparkles,
};

const advancedNavItems = ADVANCED_TOOL_DESCRIPTORS.map(tool => ({
  name: tool.label,
  shortName: tool.shortName,
  path: tool.path,
  description: tool.description,
  icon: advancedToolIcons[tool.id],
}));

const workspaceNavItems = [...primaryNavItems, ...advancedNavItems] as const;

const routeTitles: Record<string, string> = {
  '/capabilities/new': 'Create Capability',
  '/capabilities/metadata': 'Capability Metadata',
};

const SIDEBAR_STORAGE_KEY = 'singularity.sidebar.collapsed';
const ADVANCED_NAV_STORAGE_KEY = 'singularity.navigation.advanced.open';

const Sidebar = ({
  isCollapsed,
  isAdvancedNavOpen,
  onToggleCollapsed,
  onToggleAdvancedNav,
}: {
  isCollapsed: boolean;
  isAdvancedNavOpen: boolean;
  onToggleCollapsed: () => void;
  onToggleAdvancedNav: () => void;
}) => {
  const navigate = useNavigate();
  const {
    activeCapability,
    bootStatus,
    setActiveCapability,
    capabilities,
    updateCapabilityMetadata,
  } = useCapability();
  const { success } = useToast();
  const [isCapabilityMenuOpen, setIsCapabilityMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const activeCapabilities = useMemo(
    () => capabilities.filter(capability => capability.status !== 'ARCHIVED'),
    [capabilities],
  );
  const inactiveCapabilities = useMemo(
    () => capabilities.filter(capability => capability.status === 'ARCHIVED'),
    [capabilities],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsCapabilityMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const handleCapabilityStatusToggle = () => {
    void (async () => {
    const nextArchivedState = activeCapability.status !== 'ARCHIVED';
    const actionLabel = nextArchivedState ? 'make inactive' : 'reactivate';
    const confirmed = window.confirm(
      `Do you want to ${actionLabel} ${activeCapability.name}?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      await updateCapabilityMetadata(activeCapability.id, {
        status: nextArchivedState ? 'ARCHIVED' : 'STABLE',
      });
      success(
        nextArchivedState ? 'Capability made inactive' : 'Capability reactivated',
        `${activeCapability.name} is now ${nextArchivedState ? 'inactive' : 'active'} in the workspace.`,
      );
      setIsCapabilityMenuOpen(false);
    } catch {
      // Toast comes from the context mutation path.
    }
    })();
  };

  const openActiveCapability = () => {
    setIsCapabilityMenuOpen(false);
    navigate('/capabilities/metadata');
  };

  return (
    <aside
      className={cn(
        'shell-sidebar hidden lg:flex overflow-hidden transition-[width,padding] duration-200',
        isCollapsed ? 'w-[5.5rem] px-3' : 'w-[17rem] px-4',
      )}
    >
      <div
        className={cn(
          'px-2',
          isCollapsed ? 'flex flex-col items-center gap-3' : 'flex items-center justify-between gap-3',
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
            <Box size={22} />
          </div>
          {!isCollapsed ? (
            <div>
              <h2 className="text-base font-bold tracking-tight text-on-surface">
                Singularity Neo
              </h2>
              <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-secondary">
                Delivery Console
              </p>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="rounded-xl border border-outline-variant/50 bg-surface-container-low p-2 text-secondary transition hover:border-primary/20 hover:bg-white hover:text-on-surface"
          title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {isCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
      {!isCollapsed ? (
        <div className="rounded-2xl border border-primary/10 bg-primary/5 px-4 py-4">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
            Workspace
          </p>
          <p className="mt-2 text-sm font-semibold text-on-surface">
            Capability-scoped product operations
          </p>
          <p className="mt-2 text-xs leading-relaxed text-secondary">
            Teams, evidence, workflows, orchestration, and AI execution stay inside
            the selected capability context.
          </p>
        </div>
      ) : (
        <div className="flex justify-center">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary"
            title="Capability-scoped enterprise workspace"
          >
            <Sparkles size={18} />
          </div>
        </div>
      )}

      <div className={cn('mt-4 space-y-3', isCollapsed && 'relative')} ref={menuRef}>
        <div
          className={cn(
            'rounded-2xl border border-outline-variant/60 bg-white shadow-[0_8px_20px_rgba(12,23,39,0.04)]',
            isCollapsed ? 'p-2' : 'p-3',
          )}
        >
          {!isCollapsed ? <p className="form-kicker">Active Capability</p> : null}
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={openActiveCapability}
                className="flex w-full items-center justify-center rounded-xl border border-outline-variant/35 bg-surface-container-low px-2 py-3 transition-all hover:border-primary/20 hover:bg-white"
                title={`Open ${activeCapability.name}`}
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-sm font-bold text-primary">
                    {activeCapability.name.slice(0, 1).toUpperCase()}
                  </div>
                  <StatusBadge
                    tone={activeCapability.status === 'ARCHIVED' ? 'warning' : 'success'}
                    className="px-2 py-0.5 text-[0.55rem]"
                  >
                    {activeCapability.status === 'ARCHIVED' ? 'Off' : 'On'}
                  </StatusBadge>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setIsCapabilityMenuOpen(current => !current)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant/35 bg-white text-secondary transition-all hover:border-primary/20 hover:text-on-surface"
                title="Switch capability"
                aria-label="Switch capability"
              >
                <ChevronDown
                  size={16}
                  className={cn(
                    'transition-transform',
                    isCapabilityMenuOpen && 'rotate-180',
                  )}
                />
              </button>
            </div>
          ) : (
            <div className="mt-2 flex items-stretch gap-2">
              <button
                type="button"
                onClick={openActiveCapability}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-outline-variant/35 bg-surface-container-low px-3 py-3 text-left transition-all hover:border-primary/20 hover:bg-white"
                title={`Open ${activeCapability.name}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-on-surface">
                    {activeCapability.name}
                  </p>
                  <p className="truncate text-xs text-secondary">
                    {[activeCapability.domain, activeCapability.businessUnit]
                      .filter(Boolean)
                      .join(' • ') || activeCapability.description}
                  </p>
                </div>
                <StatusBadge
                  tone={activeCapability.status === 'ARCHIVED' ? 'warning' : 'success'}
                >
                  {activeCapability.status === 'ARCHIVED' ? 'Inactive' : 'Active'}
                </StatusBadge>
              </button>
              <button
                type="button"
                onClick={() => setIsCapabilityMenuOpen(current => !current)}
                className="flex shrink-0 items-center justify-center rounded-xl border border-outline-variant/35 bg-surface-container-low px-3 text-secondary transition-all hover:border-primary/20 hover:bg-white hover:text-on-surface"
                title="Switch capability"
                aria-label="Switch capability"
              >
                <ChevronDown
                  size={16}
                  className={cn(
                    'transition-transform',
                    isCapabilityMenuOpen && 'rotate-180',
                  )}
                />
              </button>
            </div>
          )}

          {isCapabilityMenuOpen ? (
            <div
              className={cn(
                'rounded-xl border border-outline-variant/50 bg-white p-2 shadow-[0_12px_28px_rgba(12,23,39,0.08)]',
                isCollapsed ? 'absolute left-full top-0 z-40 ml-3 w-[21rem]' : 'mt-2',
              )}
            >
              <div className="space-y-3">
                <div>
                  <p className="px-2 py-1.5 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-outline">
                    Active capabilities
                  </p>
                  <div className="space-y-1">
                    {activeCapabilities.map(capability => (
                      <button
                        key={capability.id}
                        type="button"
                        onClick={() => {
                          setActiveCapability(capability);
                          setIsCapabilityMenuOpen(false);
                        }}
                        className={cn(
                          'flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-all',
                          activeCapability.id === capability.id
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-surface-container-low',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{capability.name}</span>
                          <StatusBadge tone="success">Active</StatusBadge>
                        </div>
                        <span className="text-xs text-secondary">
                          {capability.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {inactiveCapabilities.length > 0 ? (
                  <div>
                    <p className="px-2 py-1.5 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-outline">
                      Inactive capabilities
                    </p>
                    <div className="space-y-1">
                      {inactiveCapabilities.map(capability => (
                        <button
                          key={capability.id}
                          type="button"
                          onClick={() => {
                            setActiveCapability(capability);
                            setIsCapabilityMenuOpen(false);
                          }}
                          className={cn(
                            'flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-all',
                            activeCapability.id === capability.id
                              ? 'bg-amber-50 text-amber-800'
                              : 'hover:bg-surface-container-low',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold">{capability.name}</span>
                            <StatusBadge tone="warning">Inactive</StatusBadge>
                          </div>
                          <span className="text-xs text-secondary">
                            {capability.description}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="border-t border-outline-variant/40 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCapabilityMenuOpen(false);
                      navigate('/capabilities/metadata');
                    }}
                    className="enterprise-button enterprise-button-secondary w-full"
                  >
                    Edit capability
                  </button>
                  <button
                    type="button"
                    onClick={handleCapabilityStatusToggle}
                    disabled={bootStatus !== 'ready'}
                    className={cn(
                      'enterprise-button mt-2 w-full disabled:cursor-not-allowed disabled:opacity-50',
                      activeCapability.status === 'ARCHIVED'
                        ? 'enterprise-button-brand-muted'
                        : 'enterprise-button-secondary',
                    )}
                  >
                    {activeCapability.status === 'ARCHIVED'
                      ? 'Reactivate capability'
                      : 'Make inactive'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => navigate('/capabilities/new')}
          disabled={bootStatus !== 'ready'}
          className={cn(
            'enterprise-button enterprise-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50',
            isCollapsed && 'px-0',
          )}
          title="Create Capability"
        >
          <PlusCircle size={16} />
          {!isCollapsed ? <span>Create Capability</span> : null}
        </button>
      </div>

      <nav className="mt-5 flex flex-col gap-1.5">
        {!isCollapsed ? (
          <p className="px-4 pb-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
            Business workspace
          </p>
        ) : null}
        {primaryNavItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            title={item.name}
            className={({ isActive }) =>
              cn(
                'group flex items-center rounded-xl text-sm font-semibold transition-all',
                isCollapsed ? 'justify-center gap-0 px-2 py-3' : 'gap-3 px-4 py-3',
                isActive
                  ? 'border border-primary/15 bg-primary/10 text-primary shadow-[0_8px_20px_rgba(0,132,61,0.08)]'
                  : 'text-secondary hover:bg-surface-container-low hover:text-on-surface',
              )
            }
          >
            <item.icon
              size={18}
              className="shrink-0 transition-transform group-hover:scale-105"
            />
            {!isCollapsed ? <span>{item.name}</span> : null}
          </NavLink>
        ))}
      </nav>

      <div className="mt-5 border-t border-outline-variant/50 pt-4">
        <button
          type="button"
          onClick={onToggleAdvancedNav}
          className={cn(
            'group flex w-full items-center rounded-xl text-sm font-semibold text-secondary transition-all hover:bg-surface-container-low hover:text-on-surface',
            isCollapsed ? 'justify-center gap-0 px-2 py-3' : 'gap-3 px-4 py-2.5',
            isAdvancedNavOpen && 'bg-surface-container-low text-primary',
          )}
          title="Advanced tools"
          aria-expanded={isAdvancedNavOpen}
        >
          <Sparkles size={17} className="shrink-0 transition-transform group-hover:scale-105" />
          {!isCollapsed ? (
            <>
              <span>Advanced tools</span>
              <ChevronDown
                size={15}
                className={cn(
                  'ml-auto text-outline transition-transform',
                  isAdvancedNavOpen && 'rotate-180 text-primary',
                )}
              />
            </>
          ) : null}
        </button>

        {isAdvancedNavOpen ? (
          <nav className="mt-2 flex flex-col gap-1.5">
            {advancedNavItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                title={item.name}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center rounded-xl text-sm font-semibold transition-all',
                    isCollapsed ? 'justify-center gap-0 px-2 py-3' : 'gap-3 px-4 py-2.5',
                    isActive
                      ? 'border border-primary/15 bg-primary/10 text-primary shadow-[0_8px_20px_rgba(0,132,61,0.08)]'
                      : 'text-secondary hover:bg-surface-container-low hover:text-on-surface',
                  )
                }
              >
                <item.icon
                  size={17}
                  className="shrink-0 transition-transform group-hover:scale-105"
                />
                {!isCollapsed ? <span>{item.name}</span> : null}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </div>

      </div>
    </aside>
  );
};

const TopBar = ({
  isSidebarCollapsed,
  onOpenCommandPalette,
  onOpenHelp,
  onOpenMobileNav,
  onToggleSidebar,
}: {
  isSidebarCollapsed: boolean;
  onOpenCommandPalette: () => void;
  onOpenHelp: () => void;
  onOpenMobileNav: () => void;
  onToggleSidebar: () => void;
}) => {
  const location = useLocation();

  const activeNavItem = useMemo(
    () => workspaceNavItems.find(item => item.path === location.pathname) || null,
    [location.pathname],
  );
  const pageTitle = activeNavItem?.name || routeTitles[location.pathname] || 'Console';

  return (
    <header className="shell-topbar">
      <div className="mx-auto w-full max-w-[1680px] px-6 py-3 lg:px-8">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpenMobileNav}
              className="inline-flex rounded-xl border border-outline-variant/50 bg-white p-2 text-secondary transition hover:border-primary/20 hover:bg-surface-container-low hover:text-on-surface lg:hidden"
              title="Open navigation"
              aria-label="Open navigation"
            >
              <PanelLeftOpen size={17} />
            </button>
            <button
              type="button"
              onClick={onToggleSidebar}
              className="hidden rounded-xl border border-outline-variant/50 bg-white p-2 text-secondary transition hover:border-primary/20 hover:bg-surface-container-low hover:text-on-surface lg:inline-flex"
              title={isSidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-label={isSidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              {isSidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
            <StatusBadge tone="brand">Enterprise Workspace</StatusBadge>
            <span className="page-context">{pageTitle}</span>
          </div>

          <div className="flex w-full flex-col gap-3 xl:w-auto xl:flex-row xl:items-center">
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="relative flex w-full items-center rounded-xl border border-outline-variant/60 bg-white px-4 py-3 text-left text-sm text-secondary shadow-[0_8px_24px_rgba(12,23,39,0.04)] transition hover:border-primary/20 hover:text-on-surface xl:w-[26rem]"
            >
              <Search
                size={16}
                className="mr-3 shrink-0 text-outline"
              />
              <span className="truncate">Search work items, runs, artifacts, agents</span>
              <span className="ml-auto hidden rounded-lg border border-outline-variant/50 bg-surface-container-low px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline sm:inline-flex">
                {navigator.platform.toLowerCase().includes('mac') ? 'Cmd K' : 'Ctrl K'}
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenHelp}
              className="enterprise-button enterprise-button-secondary w-full xl:w-auto"
            >
              <CircleHelp size={16} />
              <span>Help</span>
            </button>

            <div className="toolbar-shell min-w-[16rem] justify-between py-2.5">
              <div className="min-w-0">
                <p className="form-kicker">Current View</p>
                <p className="mt-1 truncate text-sm font-semibold text-on-surface">
                  {pageTitle}
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-outline-variant/60 bg-surface-container-low text-sm font-bold text-primary">
                A
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    activeCapability,
    bootStatus,
    capabilities,
    getCapabilityWorkspace,
    lastSyncError,
    retryInitialSync,
    setActiveCapability,
    setActiveChatAgent,
    updateCapabilityMetadata,
  } = useCapability();
  const { success } = useToast();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  });
  const [isAdvancedNavOpen, setIsAdvancedNavOpen] = useState<boolean>(() =>
    readViewPreference<'open' | 'closed'>(ADVANCED_NAV_STORAGE_KEY, 'closed', {
      allowed: ['open', 'closed'] as const,
    }) === 'open',
  );
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const commandInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      isSidebarCollapsed ? 'true' : 'false',
    );
  }, [isSidebarCollapsed]);

  useEffect(() => {
    writeViewPreference(ADVANCED_NAV_STORAGE_KEY, isAdvancedNavOpen ? 'open' : 'closed');
  }, [isAdvancedNavOpen]);

  const isImmersiveRoute =
    location.pathname === '/workflow-designer-neo' || location.pathname === '/designer';
  const activeWorkspace = activeCapability.id
    ? getCapabilityWorkspace(activeCapability.id)
    : null;
  const commandResults = useMemo(() => {
    const normalizedQuery = commandQuery.trim().toLowerCase();
    const matches = (value: string) =>
      !normalizedQuery || value.toLowerCase().includes(normalizedQuery);

    const primaryRouteResults = primaryNavItems
      .filter(item => matches(item.name))
      .map(item => ({
        key: `route:${item.path}`,
        label: item.name,
        description: `Primary workspace • ${item.path}`,
        section: 'Primary routes',
        type: 'route' as const,
        onSelect: () => navigate(item.path),
      }));

    const advancedRouteResults = advancedNavItems
      .filter(item => matches(item.name))
      .map(item => ({
        key: `advanced-route:${item.path}`,
        label: item.name,
        description: `Advanced tool • ${item.description}`,
        section: 'Advanced tools',
        type: 'route' as const,
        onSelect: () => navigate(item.path),
      }));

    const capabilityResults = capabilities
      .filter(capability =>
        matches([capability.name, capability.domain, capability.businessUnit].join(' ')),
      )
      .map(capability => ({
        key: `capability:${capability.id}`,
        label: capability.name,
        description:
          [capability.domain, capability.businessUnit].filter(Boolean).join(' • ') ||
          capability.description,
        section: 'Capabilities',
        type: 'capability' as const,
        onSelect: () => {
          setActiveCapability(capability);
          navigate('/capabilities/metadata');
        },
      }));

    const agentResults =
      activeWorkspace?.agents
        .filter(agent => matches([agent.name, agent.role, agent.objective].join(' ')))
        .map(agent => ({
          key: `agent:${agent.id}`,
          label: agent.name,
          description: `${agent.role} • ${activeCapability.name}`,
          section: 'Agents',
          type: 'agent' as const,
          onSelect: () => {
            void setActiveChatAgent(activeCapability.id, agent.id);
            navigate('/chat');
          },
        })) || [];

    const workItemResults =
      activeWorkspace?.workItems
        .filter(item => matches([item.title, item.id, item.status, item.phase].join(' ')))
        .map(item => ({
          key: `work-item:${item.id}`,
          label: item.title,
          description: `${item.id} • ${item.status} • ${item.phase}`,
          section: 'Work items',
          type: 'work-item' as const,
          onSelect: () => navigate(`/orchestrator?selected=${encodeURIComponent(item.id)}`),
        })) || [];

    const helpResults = [
      {
        key: 'help:singularity-overview',
        label: 'Help menu',
        description: 'Understand how Singularity Neo works, what each workspace does, and where to go next.',
        section: 'Guides',
        type: 'guide' as const,
        onSelect: () => setIsHelpMenuOpen(true),
      },
    ];

    return [
      ...primaryRouteResults,
      ...advancedRouteResults,
      ...helpResults,
      ...capabilityResults,
      ...agentResults,
      ...workItemResults,
    ].slice(0, 18);
  }, [
    activeCapability.id,
    activeCapability.name,
    activeWorkspace?.agents,
    activeWorkspace?.workItems,
    capabilities,
    commandQuery,
    navigate,
    setActiveCapability,
    setActiveChatAgent,
    setIsHelpMenuOpen,
  ]);
  const commandResultGroups = useMemo(
    () =>
      commandResults.reduce<Array<{ section: string; results: typeof commandResults }>>(
        (groups, result) => {
          const currentGroup = groups.find(group => group.section === result.section);
          if (currentGroup) {
            currentGroup.results.push(result);
          } else {
            groups.push({ section: result.section, results: [result] });
          }
          return groups;
        },
        [],
      ),
    [commandResults],
  );
  const showBlockingSyncState =
    bootStatus === 'loading' || (bootStatus === 'degraded' && capabilities.length === 0);
  const showNoCapabilityState =
    !showBlockingSyncState &&
    bootStatus === 'ready' &&
    capabilities.length === 0 &&
    location.pathname !== '/capabilities/new';

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      if (event.key === 'Escape') {
        setIsHelpMenuOpen(false);
        setIsCommandPaletteOpen(false);
        setIsMobileNavOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isCommandPaletteOpen) {
      return;
    }
    commandInputRef.current?.focus();
  }, [isCommandPaletteOpen]);

  return (
    <div className="app-shell">
      {!isImmersiveRoute ? (
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          isAdvancedNavOpen={isAdvancedNavOpen}
          onToggleCollapsed={() => setIsSidebarCollapsed(current => !current)}
          onToggleAdvancedNav={() => setIsAdvancedNavOpen(current => !current)}
        />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!isImmersiveRoute ? (
          <TopBar
            isSidebarCollapsed={isSidebarCollapsed}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onOpenHelp={() => setIsHelpMenuOpen(true)}
            onOpenMobileNav={() => setIsMobileNavOpen(true)}
            onToggleSidebar={() => setIsSidebarCollapsed(current => !current)}
          />
        ) : null}
        <main className={cn('shell-main', isImmersiveRoute && 'shell-main-immersive')}>
          {showBlockingSyncState ? (
            <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center">
              <div className="section-card max-w-xl space-y-4 text-center">
                <p className="form-kicker">
                  {bootStatus === 'loading' ? 'Connecting workspace' : 'Workspace unavailable'}
                </p>
                <h2 className="text-2xl font-bold text-on-surface">
                  {bootStatus === 'loading'
                    ? 'Loading capability state from the backend'
                    : 'The workspace cannot reach the backend right now'}
                </h2>
                <p className="text-sm leading-relaxed text-secondary">
                  {bootStatus === 'loading'
                    ? 'Waiting for the authoritative capability workspace before rendering the application.'
                    : lastSyncError || 'Retry after restoring the backend connection.'}
                </p>
                {bootStatus !== 'loading' ? (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => void retryInitialSync()}
                      className="enterprise-button enterprise-button-primary"
                    >
                      Retry sync
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : showNoCapabilityState ? (
            <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center">
              <div className="section-card max-w-xl space-y-4 text-center">
                <p className="form-kicker">No capabilities</p>
                <h2 className="text-2xl font-bold text-on-surface">
                  Create the first capability workspace
                </h2>
                <p className="text-sm leading-relaxed text-secondary">
                  The backend is connected, but no capabilities have been created yet.
                </p>
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => navigate('/capabilities/new')}
                    className="enterprise-button enterprise-button-primary"
                  >
                    Create Capability
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {bootStatus === 'degraded' ? (
                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="flex items-start justify-between gap-4">
                    <p>
                      Viewing the last synchronized capability state. Durable edits are disabled until
                      backend sync is restored. {lastSyncError}
                    </p>
                    <button
                      type="button"
                      onClick={() => void retryInitialSync()}
                      className="enterprise-button enterprise-button-secondary shrink-0"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : null}
              {children}
            </>
          )}
        </main>
      </div>

      {isImmersiveRoute ? (
        <button
          type="button"
          onClick={() => setIsHelpMenuOpen(true)}
          className="fixed right-4 top-4 z-40 inline-flex items-center gap-2 rounded-full border border-outline-variant/60 bg-white/95 px-4 py-2 text-sm font-semibold text-secondary shadow-[0_12px_28px_rgba(12,23,39,0.12)] backdrop-blur transition hover:border-primary/20 hover:text-on-surface"
        >
          <CircleHelp size={16} />
          Help
        </button>
      ) : null}

      {!isImmersiveRoute && isMobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45"
            onClick={() => setIsMobileNavOpen(false)}
            aria-label="Close navigation"
          />
          <div className="relative h-full w-[22rem] max-w-[90vw] overflow-y-auto border-r border-outline-variant/60 bg-white px-5 py-5 shadow-[0_20px_60px_rgba(12,23,39,0.2)]">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-on-surface">Singularity Neo</h2>
                <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-secondary">
                  Delivery Console
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileNavOpen(false)}
                className="rounded-xl border border-outline-variant/50 bg-surface-container-low p-2 text-secondary"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-outline-variant/60 bg-white p-4 shadow-[0_8px_20px_rgba(12,23,39,0.04)]">
              <p className="form-kicker">Active Capability</p>
              <button
                type="button"
                onClick={() => {
                  setIsMobileNavOpen(false);
                  navigate('/capabilities/metadata');
                }}
                className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-outline-variant/35 bg-surface-container-low px-3 py-3 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-on-surface">
                    {activeCapability.name}
                  </p>
                  <p className="truncate text-xs text-secondary">
                    {[activeCapability.domain, activeCapability.businessUnit]
                      .filter(Boolean)
                      .join(' • ') || activeCapability.description}
                  </p>
                </div>
              </button>
              <div className="mt-3 space-y-2">
                {capabilities.map(capability => (
                  <button
                    key={capability.id}
                    type="button"
                    onClick={() => {
                      setActiveCapability(capability);
                      setIsMobileNavOpen(false);
                    }}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-all',
                      activeCapability.id === capability.id
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-surface-container-low',
                    )}
                  >
                    <span className="text-sm font-semibold">{capability.name}</span>
                    <span className="text-xs text-secondary">{capability.description}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    navigate('/capabilities/metadata');
                  }}
                  className="enterprise-button enterprise-button-secondary w-full"
                >
                  Edit capability
                </button>
                <button
                  type="button"
                  disabled={bootStatus !== 'ready'}
                  onClick={() => {
                    void (async () => {
                      try {
                        await updateCapabilityMetadata(activeCapability.id, {
                          status:
                            activeCapability.status === 'ARCHIVED' ? 'STABLE' : 'ARCHIVED',
                        });
                        success(
                          activeCapability.status === 'ARCHIVED'
                            ? 'Capability reactivated'
                            : 'Capability made inactive',
                          `${activeCapability.name} lifecycle state was updated.`,
                        );
                        setIsMobileNavOpen(false);
                      } catch {
                        // Context toast handles failures.
                      }
                    })();
                  }}
                  className="enterprise-button enterprise-button-secondary w-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {activeCapability.status === 'ARCHIVED'
                    ? 'Reactivate capability'
                    : 'Make inactive'}
                </button>
                <button
                  type="button"
                  disabled={bootStatus !== 'ready'}
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    navigate('/capabilities/new');
                  }}
                  className="enterprise-button enterprise-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create Capability
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    setIsHelpMenuOpen(true);
                  }}
                  className="enterprise-button enterprise-button-secondary w-full"
                >
                  <CircleHelp size={16} />
                  Help
                </button>
              </div>
            </div>

            <nav className="mt-5 flex flex-col gap-1.5">
              <p className="px-4 pb-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                Business workspace
              </p>
              {primaryNavItems.map(item => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileNavOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all',
                      isActive
                        ? 'border border-primary/15 bg-primary/10 text-primary'
                        : 'text-secondary hover:bg-surface-container-low hover:text-on-surface',
                    )
                  }
                >
                  <item.icon size={18} />
                  <span>{item.name}</span>
                </NavLink>
              ))}
            </nav>

            <div className="mt-5 border-t border-outline-variant/50 pt-4">
              <button
                type="button"
                onClick={() => setIsAdvancedNavOpen(current => !current)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all',
                  isAdvancedNavOpen
                    ? 'bg-surface-container-low text-primary'
                    : 'text-secondary hover:bg-surface-container-low hover:text-on-surface',
                )}
                aria-expanded={isAdvancedNavOpen}
              >
                <Sparkles size={18} />
                <span>Advanced tools</span>
                <ChevronDown
                  size={16}
                  className={cn(
                    'ml-auto text-outline transition-transform',
                    isAdvancedNavOpen && 'rotate-180 text-primary',
                  )}
                />
              </button>
              {isAdvancedNavOpen ? (
                <nav className="mt-2 flex flex-col gap-1.5">
                  {advancedNavItems.map(item => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => setIsMobileNavOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all',
                          isActive
                            ? 'border border-primary/15 bg-primary/10 text-primary'
                            : 'text-secondary hover:bg-surface-container-low hover:text-on-surface',
                        )
                      }
                    >
                      <item.icon size={18} />
                      <span>{item.name}</span>
                    </NavLink>
                  ))}
                </nav>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isCommandPaletteOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/45 px-4 pt-[10vh]">
          <button
            type="button"
            className="absolute inset-0"
            onClick={() => setIsCommandPaletteOpen(false)}
            aria-label="Close command palette"
          />
          <div className="relative w-full max-w-3xl rounded-[1.75rem] border border-outline-variant/60 bg-white p-4 shadow-[0_24px_80px_rgba(12,23,39,0.18)]">
            <div className="flex items-center gap-3 rounded-2xl border border-outline-variant/60 bg-surface-container-low px-4 py-3">
              <Search size={16} className="text-outline" />
              <input
                ref={commandInputRef}
                value={commandQuery}
                onChange={event => setCommandQuery(event.target.value)}
                placeholder="Search routes, capabilities, agents, and work items"
                className="w-full bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setIsCommandPaletteOpen(false)}
                className="rounded-lg border border-outline-variant/50 bg-white px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline"
              >
                Esc
              </button>
            </div>

            <div className="mt-4 max-h-[60vh] overflow-y-auto">
              {commandResults.length > 0 ? (
                <div className="space-y-2">
                  {commandResultGroups.map(group => (
                    <div key={group.section} className="space-y-2">
                      <p className="px-2 pt-2 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        {group.section}
                      </p>
                      <div className="space-y-2">
                        {group.results.map(result => (
                          <button
                            key={result.key}
                            type="button"
                            onClick={() => {
                              result.onSelect();
                              setIsCommandPaletteOpen(false);
                              setCommandQuery('');
                            }}
                            className="flex w-full items-start justify-between gap-4 rounded-2xl border border-outline-variant/40 px-4 py-3 text-left transition hover:bg-surface-container-low"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-on-surface">
                                {result.label}
                              </p>
                              <p className="mt-1 text-xs text-secondary">
                                {result.description}
                              </p>
                            </div>
                            <span className="rounded-full bg-surface-container-low px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                              {result.type}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[12rem] items-center justify-center text-center">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-on-surface">No matching results</p>
                    <p className="text-sm text-secondary">
                      Try a capability name, route, agent, or work item id.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isHelpMenuOpen ? (
        <SingularityHelpMenu
          activeCapabilityName={activeCapability.name}
          onClose={() => setIsHelpMenuOpen(false)}
          onNavigate={path => {
            setIsHelpMenuOpen(false);
            navigate(path);
          }}
        />
      ) : null}
    </div>
  );
};
