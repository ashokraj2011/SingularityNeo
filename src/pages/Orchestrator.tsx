import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutGrid, 
  Trello, 
  Activity, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  User, 
  Cpu, 
  ChevronRight, 
  MoreHorizontal,
  Plus,
  Filter,
  Search,
  Zap,
  ArrowRight,
  MessageSquare,
  ShieldCheck,
  History,
  X,
  Send,
  Lightbulb
} from 'lucide-react';
import { useCapability } from '../context/CapabilityContext';
import { WORK_ITEMS, EXECUTION_LOGS, WORKFLOWS } from '../constants';
import { cn } from '../lib/utils';
import { WorkItem, WorkItemPhase } from '../types';

const PHASES: WorkItemPhase[] = ['BACKLOG', 'ANALYSIS', 'EXECUTION', 'REVIEW', 'DONE'];

const getStatusColor = (status: string) => {
  switch (status) {
    case 'BLOCKED': return 'text-error bg-error/10';
    case 'PENDING_APPROVAL': return 'text-amber-600 bg-amber-50';
    case 'COMPLETED': return 'text-success bg-success/10';
    default: return 'text-primary bg-primary/10';
  }
};

const WorkItemCard = ({ item, onClick }: { item: WorkItem; onClick: (id: string) => void; key?: string | number }) => (
  <motion.div
    layoutId={item.id}
    onClick={() => onClick(item.id)}
    className="bg-white p-4 rounded-2xl border border-outline-variant/15 shadow-sm hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group relative overflow-hidden"
  >
    <div className="flex justify-between items-start mb-3">
      <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{item.id}</span>
      <div className={cn("px-2 py-0.5 rounded-full text-[0.625rem] font-bold uppercase", getStatusColor(item.status))}>
        {item.status.replace('_', ' ')}
      </div>
    </div>
    <h4 className="text-sm font-bold text-on-surface mb-2 group-hover:text-primary transition-colors line-clamp-2">
      {item.title}
    </h4>
    <div className="flex flex-wrap gap-1 mb-4">
      {item.tags.map(tag => (
        <span key={tag} className="text-[0.5rem] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
          {tag}
        </span>
      ))}
    </div>
    <div className="flex items-center justify-between pt-3 border-t border-outline-variant/5">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-surface-container-low flex items-center justify-center text-primary border border-outline-variant/10">
          <Cpu size={12} />
        </div>
        <span className="text-[0.625rem] font-bold text-secondary uppercase tracking-tighter">
          {item.assignedAgentId || 'Unassigned'}
        </span>
      </div>
      {item.pendingRequest && (
        <div className="flex items-center gap-1 text-amber-500 animate-pulse">
          <AlertCircle size={12} />
          <span className="text-[0.625rem] font-bold uppercase tracking-widest">Action Required</span>
        </div>
      )}
    </div>
  </motion.div>
);

const Orchestrator = () => {
  const { activeCapability } = useCapability();
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [view, setView] = useState<'board' | 'list'>('board');

  const filteredWorkItems = useMemo(() => {
    return WORK_ITEMS.filter(wi => wi.capabilityId === activeCapability.id);
  }, [activeCapability]);

  const selectedWorkItem = useMemo(() => {
    return filteredWorkItems.find(wi => wi.id === selectedWorkItemId) || null;
  }, [selectedWorkItemId, filteredWorkItems]);

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] gap-6">
      <header className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[0.625rem] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">Orchestration Board</span>
            <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{activeCapability.id}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-on-surface tracking-tight">Work Item Lifecycle</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-surface-container-low p-1 rounded-xl border border-outline-variant/10">
            <button 
              onClick={() => setView('board')}
              className={cn(
                "p-2 rounded-lg transition-all",
                view === 'board' ? "bg-white text-primary shadow-sm" : "text-slate-400 hover:text-primary"
              )}
            >
              <Trello size={18} />
            </button>
            <button 
              onClick={() => setView('list')}
              className={cn(
                "p-2 rounded-lg transition-all",
                view === 'list' ? "bg-white text-primary shadow-sm" : "text-slate-400 hover:text-primary"
              )}
            >
              <LayoutGrid size={18} />
            </button>
          </div>
          <button className="bg-primary text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 shadow-sm hover:brightness-110 transition-all">
            <Plus size={18} />
            New Story
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-x-auto custom-scrollbar pb-4">
        <div className="flex gap-6 h-full min-w-max">
          {PHASES.map(phase => (
            <div key={phase} className="w-80 flex flex-col gap-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-[0.6875rem] font-bold text-slate-500 uppercase tracking-widest">{phase}</h3>
                  <span className="bg-surface-container-high text-secondary text-[0.625rem] font-bold px-2 py-0.5 rounded-full">
                    {filteredWorkItems.filter(wi => wi.phase === phase).length}
                  </span>
                </div>
                <button className="text-slate-300 hover:text-primary transition-colors">
                  <MoreHorizontal size={16} />
                </button>
              </div>
              <div className="flex-1 bg-surface-container-low/50 rounded-3xl p-3 border border-outline-variant/10 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
                {filteredWorkItems.filter(wi => wi.phase === phase).map(item => (
                  <WorkItemCard key={item.id} item={item} onClick={setSelectedWorkItemId} />
                ))}
                <button className="w-full py-3 border-2 border-dashed border-outline-variant/20 rounded-2xl text-slate-300 hover:text-primary hover:border-primary/30 transition-all flex items-center justify-center gap-2 group">
                  <Plus size={16} className="group-hover:scale-110 transition-transform" />
                  <span className="text-[0.625rem] font-bold uppercase tracking-widest">Add Item</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Work Item Detail Overlay */}
      <AnimatePresence>
        {selectedWorkItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-end p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedWorkItemId(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-full max-w-2xl h-full bg-white shadow-2xl rounded-l-[2.5rem] flex flex-col overflow-hidden border-l border-outline-variant/10"
            >
              <div className="p-8 border-b border-outline-variant/10 flex justify-between items-start">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{selectedWorkItem.id}</span>
                    <div className={cn("px-2.5 py-1 rounded-full text-[0.625rem] font-bold uppercase tracking-wider", getStatusColor(selectedWorkItem.status))}>
                      {selectedWorkItem.status.replace('_', ' ')}
                    </div>
                  </div>
                  <h2 className="text-2xl font-extrabold text-on-surface tracking-tight">{selectedWorkItem.title}</h2>
                  <p className="text-sm text-secondary leading-relaxed">{selectedWorkItem.description}</p>
                </div>
                <button 
                  onClick={() => setSelectedWorkItemId(null)}
                  className="p-2 hover:bg-surface-container-low rounded-full transition-colors text-slate-400 hover:text-primary"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
                {/* Workflow Progress */}
                <section className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[0.6875rem] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                      <Zap size={16} className="text-primary" />
                      Execution Workflow
                    </h3>
                    <span className="text-[0.625rem] font-bold text-primary bg-primary/5 px-2 py-1 rounded uppercase tracking-widest">
                      {WORKFLOWS.find(w => w.id === selectedWorkItem.workflowId)?.name}
                    </span>
                  </div>
                  <div className="relative flex justify-between items-center px-4">
                    <div className="absolute top-1/2 left-0 w-full h-0.5 bg-surface-container-high -translate-y-1/2" />
                    {[1, 2, 3, 4].map((step, i) => (
                      <div key={step} className="relative z-10 flex flex-col items-center gap-2">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all",
                          i < 2 ? "bg-primary border-primary text-white" : 
                          i === 2 ? "bg-white border-primary text-primary animate-pulse" :
                          "bg-white border-surface-container-high text-slate-300"
                        )}>
                          {i < 2 ? <CheckCircle2 size={16} /> : <span className="text-xs font-bold">{step}</span>}
                        </div>
                        <span className={cn(
                          "text-[0.5rem] font-bold uppercase tracking-widest",
                          i === 2 ? "text-primary" : "text-slate-400"
                        )}>
                          {i === 0 ? 'Analysis' : i === 1 ? 'Drafting' : i === 2 ? 'Execution' : 'Review'}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* HITL / Approval Section */}
                {selectedWorkItem.pendingRequest && (
                  <section className="bg-amber-50 border border-amber-200 rounded-3xl p-6 space-y-4 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <ShieldCheck size={80} className="text-amber-600" />
                    </div>
                    <div className="flex items-center gap-3 text-amber-700">
                      <AlertCircle size={20} />
                      <h4 className="text-sm font-bold uppercase tracking-widest">
                        Human-in-the-Loop: {selectedWorkItem.pendingRequest.type} Required
                      </h4>
                    </div>
                    <div className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl border border-amber-100 text-sm text-amber-900 leading-relaxed italic">
                      "{selectedWorkItem.pendingRequest.message}"
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                          <Cpu size={12} />
                        </div>
                        <span className="text-[0.625rem] font-bold text-amber-600 uppercase tracking-widest">
                          Requested by {selectedWorkItem.pendingRequest.requestedBy} • {selectedWorkItem.pendingRequest.timestamp}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-3 pt-2">
                      <button className="flex-1 py-3 bg-white border border-amber-200 rounded-xl text-xs font-bold text-amber-700 hover:bg-amber-100 transition-all uppercase tracking-widest">
                        Request Info
                      </button>
                      <button className="flex-1 py-3 bg-amber-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-600/20 hover:brightness-110 transition-all uppercase tracking-widest">
                        Approve & Proceed
                      </button>
                    </div>
                  </section>
                )}

                {/* Execution Logs */}
                <section className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[0.6875rem] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                      <History size={16} className="text-primary" />
                      Live Execution Trace
                    </h3>
                    <button className="text-[0.625rem] font-bold text-primary uppercase tracking-widest hover:underline flex items-center gap-1">
                      Full Trace
                      <ArrowRight size={12} />
                    </button>
                  </div>
                  <div className="bg-slate-950 rounded-2xl p-6 font-mono text-[0.75rem] text-slate-300 space-y-4 shadow-2xl border border-slate-800 max-h-64 overflow-y-auto custom-scrollbar">
                    {EXECUTION_LOGS.slice(0, 5).map((log, i) => (
                      <div key={i} className="flex gap-4 group">
                        <span className="text-slate-600 shrink-0 select-none">[{log.timestamp.split(',')[1].trim()}]</span>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "font-bold uppercase",
                              log.level === 'INFO' ? "text-blue-400" : "text-emerald-400"
                            )}>{log.level}</span>
                            <span className="text-slate-500 text-[0.625rem] font-bold">@{log.agentId}</span>
                          </div>
                          <span className="group-hover:text-white transition-colors">{log.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Agent Reasoning Trace (Unique Feature) */}
                <section className="space-y-6">
                  <h3 className="text-[0.6875rem] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                    <Lightbulb size={16} className="text-tertiary" />
                    Agent Reasoning Path
                  </h3>
                  <div className="p-6 bg-surface-container-low rounded-3xl border border-outline-variant/10 space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-xl bg-tertiary/10 text-tertiary flex items-center justify-center shrink-0">
                        <Zap size={16} />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-on-surface">Decision: Flagged Transaction #402</p>
                        <div className="space-y-2 pl-4 border-l-2 border-tertiary/20">
                          <div className="flex items-center gap-2 text-[0.6875rem] text-secondary">
                            <div className="w-1.5 h-1.5 rounded-full bg-tertiary" />
                            <span>Pattern match: High-velocity cross-border transfer</span>
                          </div>
                          <div className="flex items-center gap-2 text-[0.6875rem] text-secondary">
                            <div className="w-1.5 h-1.5 rounded-full bg-tertiary" />
                            <span>Anomaly: Account age {`<`} 30 days</span>
                          </div>
                          <div className="flex items-center gap-2 text-[0.6875rem] text-secondary">
                            <div className="w-1.5 h-1.5 rounded-full bg-tertiary" />
                            <span>Risk Score: 0.89 (Threshold: 0.75)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              {/* Interaction Footer */}
              <div className="p-8 border-t border-outline-variant/10 bg-surface-container-lowest">
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Provide input or unblock agent..."
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-2xl pl-6 pr-24 py-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none shadow-inner"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2">
                    <button className="bg-primary text-white p-2.5 rounded-xl shadow-lg shadow-primary/20 hover:brightness-110 transition-all">
                      <Send size={18} />
                    </button>
                  </div>
                </div>
                <div className="flex gap-4 mt-4">
                  <button className="flex-1 py-3 bg-white border border-outline-variant/20 rounded-xl text-[0.625rem] font-bold text-secondary hover:text-primary hover:border-primary/30 transition-all uppercase tracking-widest flex items-center justify-center gap-2">
                    <ArrowRight size={14} />
                    Re-route to Security Agent
                  </button>
                  <button className="flex-1 py-3 bg-white border border-outline-variant/20 rounded-xl text-[0.625rem] font-bold text-secondary hover:text-primary hover:border-primary/30 transition-all uppercase tracking-widest flex items-center justify-center gap-2">
                    <MessageSquare size={14} />
                    Open Discussion
                  </button>
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Orchestrator;
