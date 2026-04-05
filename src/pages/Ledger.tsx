import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  Download, 
  Verified, 
  FolderEdit, 
  Fingerprint, 
  Compass, 
  PenTool, 
  Code, 
  History, 
  MoreVertical, 
  ChevronRight, 
  Shield,
  Table as TableIcon,
  LayoutDashboard,
  CheckCircle2, 
  Users, 
  ArrowRight,
  GitBranch,
  Activity
} from 'lucide-react';
import { ARTIFACTS } from '../constants';
import { cn } from '../lib/utils';
import { useCapability } from '../context/CapabilityContext';

const Ledger = () => {
  const { activeCapability } = useCapability();

  const filteredArtifacts = useMemo(() => {
    return ARTIFACTS.filter(art => art.capabilityId === activeCapability.id);
  }, [activeCapability]);

  const stats = useMemo(() => {
    return {
      total: filteredArtifacts.length,
      verified: Math.floor(filteredArtifacts.length * 0.98),
      templated: Math.floor(filteredArtifacts.length * 0.64)
    };
  }, [filteredArtifacts]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[0.625rem] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">Capability Context</span>
            <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{activeCapability.id}</span>
          </div>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight mb-2">{activeCapability.name} Artifact Ledger</h1>
          <p className="text-secondary max-w-2xl leading-relaxed">
            The immutable system of record for all {activeCapability.name} deliverables. Track, audit, and manage the complete lifecycle of architectural artifacts.
          </p>
        </div>
        <div className="flex gap-3">
          <button className="px-5 py-2.5 bg-surface-container-high text-primary rounded-xl font-bold text-sm hover:bg-surface-container-highest transition-colors flex items-center gap-2">
            <Download size={18} />
            Export Report
          </button>
          <button className="px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:opacity-90 transition-colors flex items-center gap-2 shadow-sm">
            <Verified size={18} />
            Verify All Signatures
          </button>
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Stored Artifacts', value: stats.total.toLocaleString(), trend: '+4.2%', progress: 75 },
          { label: 'Work IDs', value: '156', sub: 'Active Streams', avatars: true },
          { label: 'Task Outputs', value: stats.verified.toLocaleString(), sub: '98.4% Quality Pass Rate', check: true },
          { label: 'Templated Files', value: '64%', sub: 'Standardized', bars: true },
        ].map((stat, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 rounded-xl shadow-sm flex flex-col gap-4 relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full group-hover:scale-110 transition-transform duration-500"></div>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{stat.label}</span>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-extrabold text-primary tracking-tighter">{stat.value}</span>
              {stat.trend && <span className="text-tertiary font-bold text-sm">{stat.trend}</span>}
              {stat.check && <CheckCircle2 size={16} className="text-tertiary" />}
            </div>
            {stat.progress && (
              <div className="w-full bg-surface-container-low h-1 rounded-full overflow-hidden">
                <div className="bg-primary h-full" style={{ width: `${stat.progress}%` }}></div>
              </div>
            )}
            {stat.avatars && (
              <div className="flex -space-x-2 mt-2">
                {[1, 2, 3].map(j => (
                  <div key={j} className="w-8 h-8 rounded-full border-2 border-white bg-slate-200"></div>
                ))}
                <div className="w-8 h-8 rounded-full border-2 border-white bg-primary-container text-[10px] flex items-center justify-center text-white font-bold">+12</div>
              </div>
            )}
            {stat.sub && <p className="text-xs text-secondary font-medium italic">{stat.sub}</p>}
            {stat.bars && (
              <div className="flex gap-1">
                {[1, 2, 3].map(j => <div key={j} className="h-2 flex-1 bg-primary rounded-sm"></div>)}
                <div className="h-2 flex-1 bg-surface-container-low rounded-sm"></div>
              </div>
            )}
          </motion.div>
        ))}
      </section>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1 flex flex-col gap-8 min-w-0">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-outline-variant/10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
              <div className="flex flex-col gap-2">
                <label className="text-[0.6875rem] font-bold text-slate-500 uppercase tracking-wider">Search Work ID</label>
                <div className="relative">
                  <input className="w-full bg-surface-container-low border-none rounded-lg py-2.5 px-4 text-sm focus:ring-2 focus:ring-primary-fixed-dim" placeholder="e.g. WID-4092" type="text"/>
                  <Fingerprint size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[0.6875rem] font-bold text-slate-500 uppercase tracking-wider">Origin (Phase)</label>
                <select className="w-full bg-surface-container-low border-none rounded-lg py-2.5 px-4 text-sm focus:ring-2 focus:ring-primary-fixed-dim appearance-none">
                  <option>All Phases</option>
                  <option>Discovery</option>
                  <option>Design</option>
                  <option>Governance</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button className="flex-1 py-2.5 bg-surface-container-high text-primary font-bold text-sm rounded-lg hover:bg-surface-container-highest transition-all">Clear</button>
                <button className="flex-1 py-2.5 bg-primary text-white font-bold text-sm rounded-lg hover:opacity-90 shadow-sm transition-all">Apply Filters</button>
              </div>
            </div>
          </div>

          <div className="space-y-10">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary text-white rounded-xl shadow-inner">
                    <FolderEdit size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold text-primary tracking-tight">WID-9021: {activeCapability.name} Core</h3>
                      <span className="px-2 py-0.5 bg-tertiary-fixed-dim text-tertiary text-[10px] font-extrabold rounded-full uppercase">In Progress</span>
                    </div>
                    <p className="text-sm text-secondary font-medium">Standard Template v2.4 • {filteredArtifacts.length} Artifacts • 8 Tasks Completed</p>
                  </div>
                </div>
                <MoreVertical size={20} className="text-slate-400 cursor-pointer" />
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 px-2">
                  <Compass size={18} className="text-primary-container" />
                  <h4 className="text-sm font-bold text-primary-container">Phase 1: Discovery</h4>
                  <span className="text-xs font-medium text-slate-400">({filteredArtifacts.length} Artifacts)</span>
                </div>
                <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-outline-variant/10">
                  <table className="w-full text-left">
                    <thead className="bg-surface-container-low/50">
                      <tr>
                        <th className="px-6 py-4 text-[0.6875rem] font-bold text-slate-500 uppercase tracking-widest">ID</th>
                        <th className="px-6 py-4 text-[0.6875rem] font-bold text-slate-500 uppercase tracking-widest">Name</th>
                        <th className="px-6 py-4 text-[0.6875rem] font-bold text-slate-500 uppercase tracking-widest">Type</th>
                        <th className="px-6 py-4 text-[0.6875rem] font-bold text-slate-500 uppercase tracking-widest">Version</th>
                        <th className="px-6 py-4 text-[0.6875rem] font-bold text-slate-500 uppercase tracking-widest text-right">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {filteredArtifacts.map(a => (
                        <tr key={a.id} className="hover:bg-surface-container-low transition-colors cursor-pointer">
                          <td className="px-6 py-4 text-xs font-mono text-primary font-semibold">{a.id}</td>
                          <td className="px-6 py-4 text-sm font-bold text-on-surface">{a.name}</td>
                          <td className="px-6 py-4 text-xs text-secondary font-medium">{a.type}</td>
                          <td className="px-6 py-4 text-xs font-bold text-slate-400">{a.version}</td>
                          <td className="px-6 py-4 text-xs text-slate-500 text-right">{a.created}</td>
                        </tr>
                      ))}
                      {filteredArtifacts.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-400 italic">
                            No artifacts registered in this capability context.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="w-full lg:w-80 flex flex-col gap-6">
          <div className="bg-primary-container text-white p-6 rounded-xl shadow-lg relative overflow-hidden">
            <div className="absolute -right-4 -top-4 opacity-10">
              <Activity size={120} />
            </div>
            <h4 className="text-xs font-bold text-primary-fixed uppercase tracking-widest mb-4">Active Capability</h4>
            <div className="mb-6">
              <h2 className="text-2xl font-bold leading-tight mb-1">{activeCapability.name}</h2>
              <p className="text-sm text-primary-fixed-dim">{activeCapability.id} • High Priority</p>
            </div>
            <div className="flex flex-col gap-3">
              {[
                { label: 'Applications', value: activeCapability.applications.length },
                { label: 'APIs', value: activeCapability.apis.length },
                { label: 'Databases', value: activeCapability.databases.length },
              ].map((item, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-primary-fixed-dim">{item.label}</span>
                  <span className="font-bold">{item.value}</span>
                </div>
              ))}
            </div>
            <button className="w-full mt-6 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-xs font-bold transition-all">
              Capability Dashboard
            </button>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-outline-variant/10">
            <h4 className="text-[0.6875rem] font-bold text-slate-500 uppercase tracking-widest mb-6 border-b border-outline-variant/20 pb-4">Operating Menu</h4>
            <div className="flex flex-col gap-2">
              {[
                { label: 'Audit Trail', icon: History },
                { label: 'Quality Gates', icon: Verified },
                { label: 'Peer Reviews', icon: Users, badge: 2 },
                { label: 'Relational Map', icon: GitBranch },
              ].map((item, i) => (
                <button key={i} className="flex items-center justify-between w-full p-3 hover:bg-surface-container-low rounded-lg transition-all group">
                  <div className="flex items-center gap-3">
                    <item.icon size={20} className="text-primary" />
                    <span className="text-sm font-semibold text-on-surface">{item.label}</span>
                  </div>
                  {item.badge ? (
                    <div className="bg-error-container text-error text-[10px] font-extrabold px-1.5 py-0.5 rounded">{item.badge}</div>
                  ) : (
                    <ChevronRight size={16} className="text-slate-300 group-hover:translate-x-1 transition-transform" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-surface-container-high/50 p-6 rounded-xl border border-primary/5 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-tertiary" />
              <span className="text-xs font-bold text-primary uppercase tracking-widest">Chain of Custody</span>
            </div>
            <p className="text-xs text-secondary leading-relaxed">
              All artifacts in this view are cryptographically signed and verified against the Enterprise Governance Root.
            </p>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex -space-x-1">
                {[1, 2, 3].map(j => <div key={j} className="w-6 h-6 rounded-full bg-tertiary-fixed border border-white"></div>)}
              </div>
              <span className="text-[10px] font-bold text-tertiary">TRUSTED ENVIRONMENT</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

// Re-using icons
export default Ledger;
