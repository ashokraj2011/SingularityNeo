import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Bolt, 
  Network, 
  ShieldCheck, 
  RefreshCw, 
  ArrowRight, 
  Cloud, 
  Shield, 
  BarChart3, 
  Zap,
  Cpu,
  Plus,
  Clock,
  Globe,
  Database,
  Activity,
} from 'lucide-react';
import { BLUEPRINTS, WORK_PACKAGES } from '../constants';
import { cn } from '../lib/utils';
import { Status } from '../types';
import { useCapability } from '../context/CapabilityContext';
import { useNavigate } from 'react-router-dom';

const StatusBadge = ({ status }: { status: Status }) => {
  const styles: Record<string, string> = {
    STABLE: "bg-primary-fixed text-primary border border-primary/20",
    ALERT: "bg-error-container text-on-error-container border border-error/20",
    BETA: "bg-secondary-container text-secondary border border-secondary/20",
    PENDING: "bg-surface-container-high text-secondary border border-outline-variant/30",
    VERIFIED: "bg-primary-fixed-dim/30 text-primary border border-primary/20",
    RUNNING: "bg-primary-fixed/50 text-primary border border-primary/30",
    IN_PROGRESS: "bg-secondary-container/50 text-secondary border border-secondary/30",
    PROCESSING: "bg-amber-100 text-amber-800 border border-amber-200",
    QUEUED: "bg-slate-100 text-slate-600 border border-slate-200",
    COMPLETED: "bg-primary/10 text-primary border border-primary/20",
  };

  return (
    <span className={cn("px-2 py-0.5 rounded text-[0.625rem] font-bold uppercase tracking-wider", styles[status] || styles.PENDING)}>
      {status}
    </span>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { activeCapability, getCapabilityWorkspace } = useCapability();
  const [taskFilter, setTaskFilter] = useState<'ALL' | 'QUEUED' | 'PROCESSING' | 'COMPLETED'>('ALL');
  const workspace = getCapabilityWorkspace(activeCapability.id);

  const filteredBlueprints = useMemo(() => {
    return BLUEPRINTS.filter(bp => bp.capabilityId === activeCapability.id);
  }, [activeCapability]);

  const filteredWorkPackages = useMemo(() => {
    return WORK_PACKAGES.filter(wp => wp.capabilityId === activeCapability.id);
  }, [activeCapability]);

  const filteredTasks = useMemo(() => {
    const capabilityTasks = workspace.tasks;
    if (taskFilter === 'ALL') return capabilityTasks;
    return capabilityTasks.filter(task => task.status === taskFilter);
  }, [taskFilter, workspace.tasks]);

  return (
    <div className="space-y-8">
      {/* Header Area */}
      <div className="flex justify-between items-end">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[0.625rem] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">Capability Context</span>
            <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{activeCapability.id}</span>
          </div>
          <h2 className="text-3xl font-extrabold text-primary tracking-tight">{activeCapability.name}</h2>
          <p className="text-secondary mt-1 max-w-2xl leading-relaxed">{activeCapability.description}</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => navigate('/team')}
            className="px-6 py-3 bg-secondary text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-secondary/10 hover:translate-y-[-2px] transition-transform"
          >
            <Plus size={18} />
            <span>Create Agent</span>
          </button>
          <button className="px-6 py-3 bg-primary text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-primary/10 hover:translate-y-[-2px] transition-transform">
            <Bolt size={18} />
            <span>New Work Package</span>
          </button>
        </div>
      </div>

      {/* Hero Section - Capability Command Center */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-2 bg-white p-8 rounded-xl shadow-sm border border-outline-variant/10 relative overflow-hidden group"
        >
          <div className="relative z-10">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <Activity size={20} />
                </div>
                <h3 className="text-lg font-bold text-primary">Capability Command Center</h3>
              </div>
              <div className="bg-tertiary-fixed-dim/20 text-tertiary px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-tertiary-fixed-dim animate-pulse"></span>
                System Live
              </div>
            </div>

            <div className="grid grid-cols-3 gap-8">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Globe size={14} />
                  <span className="text-[0.625rem] font-bold uppercase tracking-wider">Applications</span>
                </div>
                <p className="text-3xl font-bold text-on-surface">{activeCapability.applications.length}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {activeCapability.applications.map(app => (
                    <span key={app} className="text-[0.625rem] bg-surface-container-high px-1.5 py-0.5 rounded text-secondary font-medium">{app}</span>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Cpu size={14} />
                  <span className="text-[0.625rem] font-bold uppercase tracking-wider">APIs & Services</span>
                </div>
                <p className="text-3xl font-bold text-on-surface">{activeCapability.apis.length}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {activeCapability.apis.map(api => (
                    <span key={api} className="text-[0.625rem] bg-surface-container-high px-1.5 py-0.5 rounded text-secondary font-medium">{api}</span>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                  <Database size={14} />
                  <span className="text-[0.625rem] font-bold uppercase tracking-wider">Databases</span>
                </div>
                <p className="text-3xl font-bold text-on-surface">{activeCapability.databases.length}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {activeCapability.databases.map(db => (
                    <span key={db} className="text-[0.625rem] bg-surface-container-high px-1.5 py-0.5 rounded text-secondary font-medium">{db}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-outline-variant/10 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-xs font-bold text-primary uppercase tracking-wider">Integrity Verified</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-slate-400" />
                  <span className="text-xs font-medium text-slate-500 tracking-tight">Last sync: 2m ago</span>
                </div>
              </div>
              <button className="text-xs font-bold text-primary flex items-center gap-1 hover:underline">
                View Topology <ArrowRight size={14} />
              </button>
            </div>
          </div>
          <div className="absolute top-0 right-0 w-1/3 h-full pointer-events-none opacity-5">
            <Network size={240} className="absolute -top-12 -right-12" />
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-primary text-white p-8 rounded-xl flex flex-col justify-between shadow-xl shadow-primary/20"
        >
          <div>
            <h4 className="text-lg font-bold mb-4">Recommended Next Steps</h4>
            <div className="space-y-4">
              {[
                { title: 'Approve Governance Gate', desc: 'Security scan 100% complete', icon: ShieldCheck },
                { title: 'Resync Artifacts', desc: '3 stale nodes detected', icon: RefreshCw },
              ].map((step, i) => (
                <div key={i} className="flex gap-4 p-3 bg-white/10 rounded-xl hover:bg-white/15 transition-colors cursor-pointer group">
                  <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                    <step.icon size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{step.title}</p>
                    <p className="text-[0.6875rem] text-primary-fixed-dim">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button className="w-full mt-6 py-3 bg-white text-primary rounded-xl font-bold text-sm hover:bg-surface-container-low transition-colors">
            View Full Analysis
          </button>
        </motion.div>
      </section>

      {/* Portfolio Grid */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-primary">Lifecycle Portfolio</h3>
          <button className="text-sm font-bold text-primary flex items-center gap-1 hover:underline">
            View All Blueprints <ArrowRight size={14} />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {filteredBlueprints.map((bp, i) => {
            const Icon = bp.title.includes('Cloud') ? Cloud : bp.title.includes('Security') ? Shield : bp.title.includes('Data') ? BarChart3 : Zap;
            return (
              <motion.div 
                key={bp.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className={cn(
                  "bg-surface-container-low p-6 rounded-xl border-l-4 hover:shadow-md transition-shadow group cursor-pointer",
                  bp.status === 'STABLE' ? "border-primary" : bp.status === 'ALERT' ? "border-error" : "border-secondary"
                )}
              >
                <div className="flex justify-between items-start mb-4">
                  <Icon size={24} className="text-primary group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-slate-400">{bp.version}</span>
                </div>
                <h4 className="font-bold text-on-surface mb-1">{bp.title}</h4>
                <p className="text-xs text-secondary mb-4">{bp.description}</p>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-primary">{bp.activeIds} Active IDs</span>
                  <StatusBadge status={bp.status} />
                </div>
              </motion.div>
            );
          })}
          {filteredBlueprints.length === 0 && (
            <div className="col-span-full py-12 text-center glass-panel border-dashed">
              <p className="text-sm text-slate-400 italic">No blueprints registered for this capability context.</p>
            </div>
          )}
        </div>
      </section>

      {/* Tables Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl shadow-sm border border-outline-variant/10 overflow-hidden">
          <div className="p-6 border-b border-outline-variant/10 flex justify-between items-center">
            <h3 className="font-bold text-primary">Work-ID Fabric</h3>
            <span className="text-[0.6875rem] font-bold uppercase text-slate-400">Latest Packages</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low">
                <tr>
                  <th className="px-6 py-4 text-[0.6875rem] font-bold uppercase text-slate-500">Work ID</th>
                  <th className="px-6 py-4 text-[0.6875rem] font-bold uppercase text-slate-500">Blueprint</th>
                  <th className="px-6 py-4 text-[0.6875rem] font-bold uppercase text-slate-500">Status</th>
                  <th className="px-6 py-4 text-[0.6875rem] font-bold uppercase text-slate-500">Owner</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {filteredWorkPackages.map((wp) => (
                  <tr key={wp.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="px-6 py-4 font-bold text-primary text-sm">{wp.id}</td>
                    <td className="px-6 py-4 text-sm text-secondary">{wp.blueprint}</td>
                    <td className="px-6 py-4"><StatusBadge status={wp.status} /></td>
                    <td className="px-6 py-4 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-surface-container-highest" />
                      <span className="text-xs font-medium text-slate-600">{wp.owner.name}</span>
                    </td>
                  </tr>
                ))}
                {filteredWorkPackages.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-sm text-slate-400 italic">
                      No active work packages in this context.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-outline-variant/10 overflow-hidden">
          <div className="p-6 border-b border-outline-variant/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="font-bold text-primary">Agent Task Flow</h3>
              <p className="text-[0.625rem] font-medium text-slate-400 uppercase tracking-wider">Live Stream</p>
            </div>
            <div className="flex bg-surface-container-low p-1 rounded-lg">
              {(['ALL', 'QUEUED', 'PROCESSING', 'COMPLETED'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setTaskFilter(status)}
                  className={cn(
                    "px-3 py-1.5 text-[0.6875rem] font-bold rounded-md transition-all",
                    taskFilter === status 
                      ? "bg-white text-primary shadow-sm" 
                      : "text-secondary hover:text-primary"
                  )}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
          <div className="p-6 space-y-4 max-h-[400px] overflow-y-auto">
            <AnimatePresence mode="popLayout">
              {filteredTasks.length > 0 ? (
                filteredTasks.map((task, i) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    key={task.id} 
                    className="flex items-center gap-4 group"
                  >
                    <div className={cn(
                      "w-2 h-2 rounded-full ring-4 shrink-0",
                      task.status === 'PROCESSING' ? "bg-amber-500 ring-amber-500/20" : 
                      task.status === 'COMPLETED' ? "bg-primary ring-primary/20" :
                      task.status === 'QUEUED' ? "bg-slate-400 ring-slate-400/20" :
                      "bg-slate-300 ring-slate-300/20"
                    )} />
                    <div className={cn(
                      "flex-1 flex justify-between items-center pb-4",
                      i !== filteredTasks.length - 1 && "border-b border-outline-variant/10"
                    )}>
                      <div>
                        <p className="text-sm font-bold text-on-surface">{task.title}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-[0.6875rem] text-slate-400">Agent ID: {task.id}</p>
                          <StatusBadge status={task.status} />
                        </div>
                      </div>
                      <span className="text-[0.6875rem] font-bold text-slate-400">{task.timestamp}</span>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="py-12 text-center">
                  <p className="text-sm text-secondary font-medium italic">No tasks found for this status.</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
