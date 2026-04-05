import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Box, 
  Users, 
  Terminal, 
  Wallet, 
  HelpCircle, 
  BarChart3, 
  PlusCircle,
  Search,
  Bell,
  Settings,
  ChevronRight,
  ChevronDown,
  Layers,
  X,
  MessageSquare,
  Trello,
  FileText
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useCapability } from '../context/CapabilityContext';
import { Capability } from '../types';

const Sidebar = () => {
  const navItems = [
    { name: 'Overview', icon: LayoutDashboard, path: '/' },
    { name: 'Design & Governance', icon: Box, path: '/designer' },
    { name: 'Artifact Designer', icon: FileText, path: '/artifact-designer' },
    { name: 'Team & Collaboration', icon: Users, path: '/team' },
    { name: 'Execution & Controls', icon: Terminal, path: '/tasks' },
    { name: 'Work Orchestrator', icon: Trello, path: '/orchestrator' },
    { name: 'Artifact Ledger', icon: Wallet, path: '/ledger' },
    { name: 'Agent Chat', icon: MessageSquare, path: '/chat' },
  ];

  return (
    <aside className="w-72 h-screen bg-surface-container-low border-r border-outline-variant/15 flex flex-col p-4 gap-6 sticky top-0 shrink-0">
      <div className="flex items-center gap-3 px-2">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white">
          <Box size={24} />
        </div>
        <div>
          <h2 className="text-md font-bold text-primary tracking-tight">Delivery Console</h2>
          <p className="text-[0.6875rem] font-bold uppercase text-secondary tracking-wider">Enterprise Environment</p>
        </div>
      </div>

      <button className="w-full py-3 bg-primary bg-gradient-to-r from-primary to-primary-container text-white rounded-xl font-semibold flex items-center justify-center gap-2 shadow-sm hover:opacity-90 transition-opacity">
        <PlusCircle size={18} />
        <span className="text-sm">Create New Artifact</span>
      </button>

      <nav className="flex-1 flex flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
              isActive 
                ? "bg-white text-primary shadow-sm translate-x-1 font-bold" 
                : "text-secondary hover:bg-white/50 font-medium"
            )}
          >
            <item.icon size={20} className={cn("transition-colors", "group-hover:text-primary")} />
            <span className="text-sm">{item.name}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-outline-variant/50 pt-4 flex flex-col gap-1">
        <div className="p-4 bg-primary-container rounded-xl text-white mb-4">
          <p className="text-xs opacity-80 mb-2 font-medium">Lifecycle Stability</p>
          <p className="text-[0.6875rem] leading-relaxed">System integrity is verified for current blueprints. High-stake deployments require governance review.</p>
        </div>
        <a href="#" className="text-secondary hover:text-primary flex items-center gap-3 px-4 py-2 rounded-xl transition-all">
          <HelpCircle size={20} />
          <span className="text-xs font-bold uppercase">Support</span>
        </a>
        <a href="#" className="text-secondary hover:text-primary flex items-center gap-3 px-4 py-2 rounded-xl transition-all">
          <BarChart3 size={20} />
          <span className="text-xs font-bold uppercase">System Health</span>
        </a>
      </div>
    </aside>
  );
};

const TopBar = () => {
  const location = useLocation();
  const { activeCapability, setActiveCapability, capabilities, addCapability } = useCapability();
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const [newCap, setNewCap] = React.useState({ name: '', description: '' });

  const handleCreateCapability = (e: React.FormEvent) => {
    e.preventDefault();
    const capability: Capability = {
      id: `CAP-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
      name: newCap.name,
      description: newCap.description,
      applications: [],
      apis: [],
      databases: [],
      status: 'PENDING',
      specialAgentId: `AGENT-${newCap.name.toUpperCase().replace(/\s+/g, '-')}-01`,
      skillLibrary: []
    };
    addCapability(capability);
    setIsCreateModalOpen(false);
    setNewCap({ name: '', description: '' });
    setActiveCapability(capability);
  };

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/': return 'Dashboard';
      case '/designer': return 'Designer';
      case '/tasks': return 'Tasks';
      case '/ledger': return 'Ledger';
      default: return 'Console';
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-surface/80 backdrop-blur-md flex justify-between items-center w-full px-8 py-3 border-b border-outline-variant/10">
      <div className="flex items-center gap-8">
        <h1 className="text-lg font-bold text-primary tracking-tight">Fidelity Investments</h1>
        
        <div className="h-6 w-px bg-outline-variant/20 hidden md:block" />

        <div className="relative group hidden md:block">
          <button className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 rounded-lg border border-primary/10 hover:bg-primary/10 transition-all">
            <Layers size={16} className="text-primary" />
            <span className="text-sm font-bold text-primary truncate max-w-[150px]">
              {activeCapability.name}
            </span>
            <ChevronDown size={14} className="text-primary" />
          </button>
          
          {/* Dropdown */}
          <div className="absolute top-full left-0 mt-1 w-64 bg-surface border border-outline-variant/20 rounded-xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-2 space-y-1">
            <p className="px-3 py-2 text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Switch Capability Context</p>
            {capabilities.map(cap => (
              <button
                key={cap.id}
                onClick={() => setActiveCapability(cap)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex flex-col gap-0.5",
                  activeCapability.id === cap.id ? "bg-primary/10 text-primary" : "hover:bg-surface-container-low text-on-surface"
                )}
              >
                <span className="font-bold">{cap.name}</span>
                <span className="text-[0.6875rem] opacity-60 truncate">{cap.description}</span>
              </button>
            ))}
            <div className="border-t border-outline-variant/10 mt-2 pt-2">
              <button 
                onClick={() => setIsCreateModalOpen(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-primary hover:bg-primary/5 rounded-lg transition-all"
              >
                <PlusCircle size={16} />
                Create New Capability
              </button>
            </div>
          </div>
        </div>

        {/* Create Capability Modal */}
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-outline-variant/20">
              <div className="p-6 border-b border-outline-variant/10 flex justify-between items-center">
                <h3 className="text-lg font-bold text-primary">New Capability Context</h3>
                <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-400 hover:text-primary">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleCreateCapability} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Capability Name</label>
                  <input 
                    required
                    type="text" 
                    value={newCap.name}
                    onChange={e => setNewCap(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Fixed Income Trading"
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Description</label>
                  <textarea 
                    required
                    value={newCap.description}
                    onChange={e => setNewCap(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Briefly describe the scope of this capability..."
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none h-24 resize-none"
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-secondary hover:bg-surface-container-low transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-primary text-white shadow-lg shadow-primary/20 hover:brightness-110 transition-all"
                  >
                    Create Capability
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <nav className="hidden lg:flex gap-6">
          {['Dashboard', 'Designer', 'Artifact-Designer', 'Orchestrator', 'Studio', 'Tasks', 'Ledger', 'Chat'].map((item) => {
            const path = item === 'Dashboard' ? '/' : `/${item.toLowerCase()}`;
            const isActive = location.pathname === path;
            return (
              <NavLink
                key={item}
                to={path}
                className={cn(
                  "text-sm transition-colors pb-1",
                  isActive 
                    ? "text-primary border-b-2 border-primary font-bold" 
                    : "text-secondary font-medium hover:text-primary"
                )}
              >
                {item}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative group">
          <Search size={16} className="absolute inset-y-0 left-3 top-1/2 -translate-y-1/2 text-outline" />
          <input 
            type="text" 
            placeholder="Search Work-IDs..." 
            className="bg-surface-container-low border-none rounded-full pl-10 pr-4 py-2 text-sm w-64 focus:ring-2 focus:ring-primary-fixed-dim transition-all"
          />
        </div>
        <button className="p-2 text-secondary hover:bg-surface-container-low rounded-full transition-colors relative">
          <Bell size={20} />
          <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full"></span>
        </button>
        <button className="p-2 text-secondary hover:bg-surface-container-low rounded-full transition-colors">
          <Settings size={20} />
        </button>
        <div className="w-8 h-8 rounded-full bg-surface-container-highest overflow-hidden border border-outline-variant/30">
          <img 
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuD_g5dBGeBxcQOL4nycxVAyvpFT-z0NqyeUXvGOAjwx_Yit9qCTBFE-xBfFb9oAZUVBhHXV8xqM8SUWp9xTfnyE2p-jOv5llIxyff4ckj3F70G_jdm9L6X4Ui_NZETSgZL5GSxI9sRW1em0XUn9AGm_QlpeMkcQTBbvphZEFXPplfvUruPdFIMC6oHf0YBVnFbgo5HUcjh9heS-ZLsb9AEHsteApxYBDWp8ZafNgaK9My5wWuwMCGsjJFARL0kx_5ZjAMnwYpBM1vM" 
            alt="Profile" 
            className="w-full h-full object-cover"
          />
        </div>
      </div>
    </header>
  );
};

export const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="p-8 max-w-[1600px] mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
};
