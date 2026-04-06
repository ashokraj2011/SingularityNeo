import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bell,
  BrainCircuit,
  BookOpen,
  Box,
  ChevronDown,
  FileText,
  HelpCircle,
  LayoutDashboard,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PlusCircle,
  Search,
  Settings,
  Sparkles,
  Terminal,
  Trello,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { StatusBadge } from './EnterpriseUI';

const workspaceNavItems = [
  { name: 'Overview', shortName: 'Overview', icon: LayoutDashboard, path: '/' },
  { name: 'Design & Governance', shortName: 'Design', icon: Workflow, path: '/designer' },
  { name: 'Artifact Designer', shortName: 'Artifacts', icon: FileText, path: '/artifact-designer' },
  { name: 'Team & Collaboration', shortName: 'Team', icon: Users, path: '/team' },
  { name: 'Skill Library', shortName: 'Skills', icon: BookOpen, path: '/skills' },
  { name: 'Studio', shortName: 'Studio', icon: Sparkles, path: '/studio' },
  { name: 'Execution & Controls', shortName: 'Execution', icon: Terminal, path: '/tasks' },
  { name: 'Work Orchestrator', shortName: 'Orchestrator', icon: Trello, path: '/orchestrator' },
  { name: 'Run Console', shortName: 'Run Console', icon: Activity, path: '/run-console' },
  { name: 'Memory Explorer', shortName: 'Memory', icon: BrainCircuit, path: '/memory' },
  { name: 'Eval Center', shortName: 'Evals', icon: BarChart3, path: '/evals' },
  { name: 'Artifact Ledger', shortName: 'Ledger', icon: Wallet, path: '/ledger' },
  { name: 'Agent Chat', shortName: 'Chat', icon: MessageSquare, path: '/chat' },
] as const;

const routeTitles: Record<string, string> = {
  '/capabilities/new': 'Create Capability',
  '/capabilities/metadata': 'Capability Metadata',
};

const SIDEBAR_STORAGE_KEY = 'singularity.sidebar.collapsed';

const Sidebar = ({
  isCollapsed,
  onToggleCollapsed,
}: {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}) => {
  const navigate = useNavigate();
  const {
    activeCapability,
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
    const nextArchivedState = activeCapability.status !== 'ARCHIVED';
    const actionLabel = nextArchivedState ? 'make inactive' : 'reactivate';
    const confirmed = window.confirm(
      `Do you want to ${actionLabel} ${activeCapability.name}?`,
    );

    if (!confirmed) {
      return;
    }

    updateCapabilityMetadata(activeCapability.id, {
      status: nextArchivedState ? 'ARCHIVED' : 'STABLE',
    });
    success(
      nextArchivedState ? 'Capability made inactive' : 'Capability reactivated',
      `${activeCapability.name} is now ${nextArchivedState ? 'inactive' : 'active'} in the workspace.`,
    );
    setIsCapabilityMenuOpen(false);
  };

  return (
    <aside
      className={cn(
        'shell-sidebar hidden lg:flex transition-[width,padding] duration-200',
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

      {!isCollapsed ? (
        <div className="mt-6 rounded-2xl border border-primary/10 bg-primary/5 px-4 py-4">
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
        <div className="mt-5 flex justify-center">
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
          <button
            type="button"
            onClick={() => setIsCapabilityMenuOpen(current => !current)}
            className={cn(
              'transition-all hover:border-primary/20 hover:bg-white',
              isCollapsed
                ? 'flex w-full items-center justify-center rounded-xl border border-outline-variant/35 bg-surface-container-low px-2 py-3'
                : 'mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-outline-variant/35 bg-surface-container-low px-3 py-3 text-left',
            )}
            title={activeCapability.name}
          >
            {isCollapsed ? (
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
            ) : (
              <>
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
                <div className="flex items-center gap-2">
                  <StatusBadge
                    tone={activeCapability.status === 'ARCHIVED' ? 'warning' : 'success'}
                  >
                    {activeCapability.status === 'ARCHIVED' ? 'Inactive' : 'Active'}
                  </StatusBadge>
                  <ChevronDown
                    size={16}
                    className={cn(
                      'shrink-0 text-secondary transition-transform',
                      isCapabilityMenuOpen && 'rotate-180',
                    )}
                  />
                </div>
              </>
            )}
          </button>

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
                    className={cn(
                      'enterprise-button mt-2 w-full',
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
          className={cn(
            'enterprise-button enterprise-button-primary w-full',
            isCollapsed && 'px-0',
          )}
          title="Create Capability"
        >
          <PlusCircle size={16} />
          {!isCollapsed ? <span>Create Capability</span> : null}
        </button>
      </div>

      <nav className="mt-5 flex flex-1 flex-col gap-1.5">
        {workspaceNavItems.map(item => (
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

      <div className="mt-6 space-y-2 border-t border-outline-variant/50 pt-5">
        {[
          { label: 'System Health', icon: BarChart3 },
          { label: 'Support', icon: HelpCircle },
        ].map(item => (
          <a
            key={item.label}
            href="#"
            title={item.label}
            className={cn(
              'rounded-xl text-sm font-medium text-secondary transition-all hover:bg-surface-container-low hover:text-on-surface',
              isCollapsed
                ? 'flex items-center justify-center px-2 py-2.5'
                : 'flex items-center gap-3 px-4 py-2.5',
            )}
          >
            <item.icon size={16} />
            {!isCollapsed ? <span>{item.label}</span> : null}
          </a>
        ))}
      </div>
    </aside>
  );
};

const TopBar = ({
  isSidebarCollapsed,
  onToggleSidebar,
}: {
  isSidebarCollapsed: boolean;
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
            <label className="relative xl:w-[26rem]">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-outline"
              />
              <input
                type="text"
                placeholder="Search work items, runs, artifacts, agents"
                className="field-input pl-10"
              />
            </label>

            <div className="toolbar-shell min-w-[16rem] justify-between py-2.5">
              <div className="min-w-0">
                <p className="form-kicker">Current View</p>
                <p className="mt-1 truncate text-sm font-semibold text-on-surface">
                  {pageTitle}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="relative rounded-xl p-2 text-secondary transition-colors hover:bg-surface-container-low"
                >
                  <Bell size={17} />
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-error" />
                </button>
                <button
                  type="button"
                  className="rounded-xl p-2 text-secondary transition-colors hover:bg-surface-container-low"
                >
                  <Settings size={17} />
                </button>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-outline-variant/60 bg-surface-container-low text-sm font-bold text-primary">
                  A
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      isSidebarCollapsed ? 'true' : 'false',
    );
  }, [isSidebarCollapsed]);

  return (
    <div className="app-shell">
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapsed={() => setIsSidebarCollapsed(current => !current)}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => setIsSidebarCollapsed(current => !current)}
        />
        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
};
