import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  BookOpen,
  Box,
  ChevronDown,
  FileText,
  HelpCircle,
  Layers,
  LayoutDashboard,
  MessageSquare,
  PlusCircle,
  Search,
  Settings,
  Sparkles,
  Terminal,
  Trello,
  Users,
  Wallet,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useCapability } from '../context/CapabilityContext';

const workspaceNavItems = [
  { name: 'Overview', shortName: 'Overview', icon: LayoutDashboard, path: '/' },
  { name: 'Design & Governance', shortName: 'Design', icon: Box, path: '/designer' },
  { name: 'Artifact Designer', shortName: 'Artifacts', icon: FileText, path: '/artifact-designer' },
  { name: 'Team & Collaboration', shortName: 'Team', icon: Users, path: '/team' },
  { name: 'Skill Library', shortName: 'Skills', icon: BookOpen, path: '/skills' },
  { name: 'Studio', shortName: 'Studio', icon: Sparkles, path: '/studio' },
  { name: 'Execution & Controls', shortName: 'Execution', icon: Terminal, path: '/tasks' },
  { name: 'Work Orchestrator', shortName: 'Orchestrator', icon: Trello, path: '/orchestrator' },
  { name: 'Artifact Ledger', shortName: 'Ledger', icon: Wallet, path: '/ledger' },
  { name: 'Agent Chat', shortName: 'Chat', icon: MessageSquare, path: '/chat' },
] as const;

const routeTitles: Record<string, string> = {
  '/capabilities/new': 'Create Capability',
  '/capabilities/metadata': 'Capability Metadata',
};

const Sidebar = () => {
  return (
    <aside className="sticky top-0 flex h-screen w-72 shrink-0 flex-col gap-6 border-r border-outline-variant/15 bg-surface-container-low p-4">
      <div className="flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
          <Box size={24} />
        </div>
        <div>
          <h2 className="text-md font-bold tracking-tight text-primary">
            Delivery Console
          </h2>
          <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-secondary">
            Enterprise Environment
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {workspaceNavItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-xl px-4 py-3 transition-all',
                isActive
                  ? 'translate-x-1 bg-white font-bold text-primary shadow-sm'
                  : 'font-medium text-secondary hover:bg-white/50',
              )
            }
          >
            <item.icon
              size={20}
              className={cn('transition-colors', 'group-hover:text-primary')}
            />
            <span className="text-sm">{item.name}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-outline-variant/50 pt-4">
        <div className="mb-4 rounded-xl bg-primary-container p-4 text-white">
          <p className="mb-2 text-xs font-medium opacity-80">Lifecycle Stability</p>
          <p className="text-[0.6875rem] leading-relaxed">
            System integrity is verified for current blueprints. High-stake
            deployments require governance review.
          </p>
        </div>
        <a
          href="#"
          className="flex items-center gap-3 rounded-xl px-4 py-2 text-secondary transition-all hover:text-primary"
        >
          <HelpCircle size={20} />
          <span className="text-xs font-bold uppercase">Support</span>
        </a>
        <a
          href="#"
          className="flex items-center gap-3 rounded-xl px-4 py-2 text-secondary transition-all hover:text-primary"
        >
          <BarChart3 size={20} />
          <span className="text-xs font-bold uppercase">System Health</span>
        </a>
      </div>
    </aside>
  );
};

const TopBar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeCapability, setActiveCapability, capabilities } = useCapability();

  const activeNavItem =
    workspaceNavItems.find(item => item.path === location.pathname) || null;
  const pageTitle = activeNavItem?.name || routeTitles[location.pathname] || 'Console';

  return (
    <header className="sticky top-0 z-30 border-b border-outline-variant/10 bg-surface/90 backdrop-blur-xl">
      <div className="px-6 py-4 lg:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-lg font-bold tracking-tight text-primary">
                Fidelity Investments
              </h1>
              <span className="hidden h-5 w-px bg-outline-variant/30 md:block" />
              <span className="inline-flex rounded-full border border-primary/10 bg-primary/5 px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-primary">
                {pageTitle}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-secondary">
              Capability-scoped delivery workspace with dedicated teams,
              governed artifacts, workflow orchestration, and Copilot-backed
              agents.
            </p>

            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
              <div className="group relative w-full lg:w-auto">
                <button className="flex w-full items-center justify-between gap-3 rounded-2xl border border-primary/10 bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-primary/20 hover:bg-primary/5 lg:min-w-[320px]">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Layers size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-400">
                        Active Capability
                      </p>
                      <p className="truncate text-sm font-bold text-on-surface">
                        {activeCapability.name}
                      </p>
                      <p className="truncate text-[0.6875rem] text-secondary">
                        {activeCapability.domain || activeCapability.description}
                      </p>
                    </div>
                  </div>
                  <ChevronDown size={16} className="shrink-0 text-primary" />
                </button>

                <div className="invisible absolute left-0 top-full z-50 mt-2 w-full rounded-2xl border border-outline-variant/15 bg-white p-2 opacity-0 shadow-2xl transition-all group-hover:visible group-hover:opacity-100">
                  <p className="px-3 py-2 text-[0.625rem] font-bold uppercase tracking-widest text-slate-400">
                    Switch Capability Context
                  </p>
                  <div className="space-y-1">
                    {capabilities.map(capability => (
                      <button
                        key={capability.id}
                        onClick={() => setActiveCapability(capability)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 rounded-xl px-3 py-3 text-left text-sm transition-all',
                          activeCapability.id === capability.id
                            ? 'bg-primary/10 text-primary'
                            : 'text-on-surface hover:bg-surface-container-low',
                        )}
                      >
                        <span className="font-bold">{capability.name}</span>
                        <span className="truncate text-[0.6875rem] opacity-70">
                          {capability.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={() => navigate('/capabilities/new')}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-primary/10 bg-primary px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:brightness-110"
              >
                <PlusCircle size={16} />
                Create Capability
              </button>
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[360px]">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-outline"
              />
              <input
                type="text"
                placeholder="Search work IDs, agents, artifacts..."
                className="w-full rounded-2xl border border-outline-variant/15 bg-white py-3 pl-10 pr-4 text-sm shadow-sm outline-none transition-all focus:ring-2 focus:ring-primary-fixed-dim"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-2xl border border-outline-variant/10 bg-white px-4 py-3 shadow-sm">
              <div className="min-w-0">
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Current View
                </p>
                <p className="truncate text-sm font-bold text-on-surface">
                  {pageTitle}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className="relative rounded-full p-2 text-secondary transition-colors hover:bg-surface-container-low">
                  <Bell size={18} />
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-error" />
                </button>
                <button className="rounded-full p-2 text-secondary transition-colors hover:bg-surface-container-low">
                  <Settings size={18} />
                </button>
                <div className="h-9 w-9 overflow-hidden rounded-full border border-outline-variant/30 bg-surface-container-highest">
                  <img
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuD_g5dBGeBxcQOL4nycxVAyvpFT-z0NqyeUXvGOAjwx_Yit9qCTBFE-xBfFb9oAZUVBhHXV8xqM8SUWp9xTfnyE2p-jOv5llIxyff4ckj3F70G_jdm9L6X4Ui_NZETSgZL5GSxI9sRW1em0XUn9AGm_QlpeMkcQTBbvphZEFXPplfvUruPdFIMC6oHf0YBVnFbgo5HUcjh9heS-ZLsb9AEHsteApxYBDWp8ZafNgaK9My5wWuwMCGsjJFARL0kx_5ZjAMnwYpBM1vM"
                    alt="Profile"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto pb-1">
          <nav className="inline-flex min-w-full items-center gap-2 rounded-[1.25rem] border border-outline-variant/10 bg-white/90 p-2 shadow-sm lg:min-w-max">
            {workspaceNavItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all whitespace-nowrap',
                    isActive
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-secondary hover:bg-surface-container-low hover:text-primary',
                  )
                }
              >
                <item.icon size={16} />
                <span>{item.shortName}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
};

export const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="mx-auto min-h-0 w-full max-w-[1600px] flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  );
};
