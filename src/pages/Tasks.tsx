import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Cpu, 
  FileText, 
  AlertCircle, 
  MoreVertical, 
  Paperclip, 
  Archive, 
  CheckCircle2, 
  Download,
  Table,
  Scale,
  X,
  Zap,
  ChevronRight,
  ExternalLink,
  Clock,
  ShieldCheck,
  FileCode,
  Activity,
  Lightbulb,
  History
} from 'lucide-react';
import { AGENT_TASKS, EXECUTION_LOGS, LEARNING_UPDATES } from '../constants';
import { cn } from '../lib/utils';
import { useCapability } from '../context/CapabilityContext';
import { AgentTask } from '../types';

const Tasks = () => {
  const { activeCapability } = useCapability();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'logs'>('details');

  const filteredTasks = useMemo(() => {
    return AGENT_TASKS.filter(task => task.capabilityId === activeCapability.id);
  }, [activeCapability]);

  const selectedTask = useMemo(() => {
    return filteredTasks.find(t => t.id === selectedTaskId) || null;
  }, [selectedTaskId, filteredTasks]);

  const stats = useMemo(() => {
    return {
      open: filteredTasks.filter(t => t.status !== 'COMPLETED').length,
      completed: filteredTasks.filter(t => t.status === 'COMPLETED').length
    };
  }, [filteredTasks]);

  const getIconForType = (type: string) => {
    switch (type) {
      case 'table': return Table;
      case 'scale': return Scale;
      case 'file': return FileCode;
      default: return FileText;
    }
  };

  return (
    <div className="flex flex-col gap-6 relative min-h-[calc(100vh-12rem)]">
      <header className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[0.625rem] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">Capability Context</span>
            <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{activeCapability.id}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-on-surface tracking-tight">{activeCapability.name} Agent Tasks</h1>
          <p className="text-sm text-secondary font-medium">Focused workspace for orchestrating intelligent delivery agents for {activeCapability.name}.</p>
        </div>
        <button className="bg-primary text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-sm hover:brightness-110 transition-all">
          <Plus size={18} />
          <span>+ New Agent Task</span>
        </button>
      </header>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Task Board */}
        <section className="flex-1 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-outline-variant/10 shadow-sm flex flex-col gap-1">
              <span className="text-[0.6875rem] font-bold uppercase text-secondary">Open Tasks</span>
              <span className="text-2xl font-extrabold text-primary">{stats.open}</span>
            </div>
            <div className="bg-white p-4 rounded-xl border border-outline-variant/10 shadow-sm flex flex-col gap-1">
              <span className="text-[0.6875rem] font-bold uppercase text-secondary">Completed</span>
              <span className="text-2xl font-extrabold text-tertiary-fixed-dim">{stats.completed}</span>
            </div>
            <div className="bg-white p-4 rounded-xl border border-outline-variant/10 shadow-sm flex flex-col gap-1">
              <span className="text-[0.6875rem] font-bold uppercase text-secondary">Active Agents</span>
              <span className="text-2xl font-extrabold text-on-surface">3</span>
            </div>
            <div className="bg-white p-4 rounded-xl border border-outline-variant/10 shadow-sm flex flex-col gap-1">
              <span className="text-[0.6875rem] font-bold uppercase text-secondary">Avg. Execution</span>
              <span className="text-2xl font-extrabold text-on-surface">4.2m</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredTasks.map((task, i) => (
              <motion.div 
                key={task.id} 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => setSelectedTaskId(task.id)}
                className={cn(
                  "p-5 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden",
                  selectedTaskId === task.id 
                    ? "bg-white border-primary ring-4 ring-primary/5 shadow-md" 
                    : "bg-white border-outline-variant/20 shadow-sm hover:border-primary/40 hover:shadow-md"
                )}
              >
                {selectedTaskId === task.id && (
                  <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                )}
                <div className="flex justify-between items-start mb-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">ID: {task.id}</span>
                    <span className={cn(
                      "text-[0.625rem] w-fit px-2 py-0.5 rounded-full font-bold uppercase",
                      task.status === 'PROCESSING' ? "bg-amber-100 text-amber-800" : 
                      task.status === 'COMPLETED' ? "bg-tertiary-fixed-dim/20 text-tertiary" :
                      "bg-surface-container-high text-secondary"
                    )}>{task.status}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[0.625rem] font-bold text-slate-400">
                    <Clock size={12} />
                    {task.timestamp}
                  </div>
                </div>
                <h4 className="text-sm font-bold text-primary mb-4 group-hover:text-primary-container transition-colors line-clamp-2 min-h-[2.5rem]">
                  {task.title}
                </h4>
                <div className="flex items-center justify-between mt-auto pt-4 border-t border-outline-variant/10">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-surface-container-low flex items-center justify-center text-primary border border-outline-variant/20">
                      <Cpu size={16} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Agent</span>
                      <span className="text-xs font-bold text-on-surface">{task.agent}</span>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTaskId(task.id);
                    }}
                    className="text-[0.625rem] font-bold text-primary hover:text-primary-container flex items-center gap-1 uppercase tracking-widest transition-colors"
                  >
                    View Details
                    <ChevronRight size={12} />
                  </button>
                </div>
              </motion.div>
            ))}
            {filteredTasks.length === 0 && (
              <div className="col-span-full py-20 text-center bg-surface-container-low/30 rounded-3xl border-2 border-dashed border-outline-variant/20">
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-slate-300 mx-auto mb-4 shadow-inner">
                  <Archive size={32} />
                </div>
                <h3 className="text-lg font-bold text-primary mb-1">No Tasks Found</h3>
                <p className="text-sm text-secondary">There are no agent tasks currently associated with this capability context.</p>
              </div>
            )}
          </div>
        </section>

        {/* Task Detail Modal */}
        <AnimatePresence>
          {selectedTask && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 lg:p-8">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedTaskId(null)}
                className="absolute inset-0 bg-black/40 backdrop-blur-md"
              />
              <motion.section 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="relative w-full max-w-3xl max-h-[90vh] bg-white shadow-2xl border border-outline-variant/10 flex flex-col overflow-hidden rounded-3xl"
              >
                <div className="p-6 border-b border-outline-variant/10 bg-white flex justify-between items-center sticky top-0 z-10">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-primary/10 text-primary rounded-2xl">
                      <Zap size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-primary leading-tight">Agent Task Workspace</h3>
                      <div className="flex items-center gap-4 mt-2">
                        <button 
                          onClick={() => setActiveTab('details')}
                          className={cn(
                            "text-[0.625rem] font-bold uppercase tracking-widest pb-1 border-b-2 transition-all",
                            activeTab === 'details' ? "text-primary border-primary" : "text-slate-400 border-transparent hover:text-primary"
                          )}
                        >
                          Task Details
                        </button>
                        <button 
                          onClick={() => setActiveTab('logs')}
                          className={cn(
                            "text-[0.625rem] font-bold uppercase tracking-widest pb-1 border-b-2 transition-all",
                            activeTab === 'logs' ? "text-primary border-primary" : "text-slate-400 border-transparent hover:text-primary"
                          )}
                        >
                          Logs & Insights
                        </button>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedTaskId(null)}
                    className="p-2 hover:bg-surface-container-low rounded-full transition-colors text-slate-400 hover:text-primary"
                  >
                    <X size={24} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
                  {activeTab === 'details' ? (
                    <>
                      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-outline-variant/10">
                        <div className="space-y-4 max-w-xl">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-[0.625rem] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider",
                              selectedTask.status === 'PROCESSING' ? "bg-amber-100 text-amber-800" : 
                              selectedTask.status === 'COMPLETED' ? "bg-tertiary-fixed-dim/20 text-tertiary" :
                              "bg-surface-container-high text-secondary"
                            )}>{selectedTask.status}</span>
                            <span className={cn(
                              "text-[0.625rem] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider",
                              selectedTask.priority === 'High' ? "bg-error/10 text-error" : "bg-slate-100 text-slate-500"
                            )}>{selectedTask.priority} Priority</span>
                          </div>
                          <h2 className="text-2xl font-extrabold text-on-surface leading-tight tracking-tight">{selectedTask.title}</h2>
                          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-secondary font-medium">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded bg-primary/5 flex items-center justify-center">
                                <Cpu size={14} className="text-primary" />
                              </div>
                              <span className="text-slate-400 uppercase text-[0.625rem] font-bold">Agent:</span>
                              <span className="text-on-surface">{selectedTask.agent}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded bg-primary/5 flex items-center justify-center">
                                <Clock size={14} className="text-primary" />
                              </div>
                              <span className="text-slate-400 uppercase text-[0.625rem] font-bold">Initiated:</span>
                              <span className="text-on-surface">{selectedTask.timestamp}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-start md:items-end gap-1">
                           <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Health Score</span>
                           <div className="flex items-center gap-1">
                              {[1, 2, 3, 4, 5].map((s) => (
                                <div key={s} className={cn("w-2 h-2 rounded-full", s <= 4 ? "bg-tertiary" : "bg-slate-200")} />
                              ))}
                              <span className="text-xs font-bold text-tertiary ml-1">84%</span>
                           </div>
                        </div>
                      </header>

                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                        <div className="lg:col-span-7 space-y-10">
                          <section className="space-y-4">
                            <label className="text-[0.6875rem] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                              <ShieldCheck size={16} className="text-primary" />
                              Strategic Prompt
                            </label>
                            <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 text-sm text-on-surface-variant leading-relaxed shadow-sm relative overflow-hidden group">
                              <div className="absolute top-0 left-0 w-1 h-full bg-primary/20 group-hover:bg-primary transition-colors" />
                              {selectedTask.prompt || "No prompt provided for this task."}
                            </div>
                          </section>

                          <section className="space-y-4">
                            <label className="text-[0.6875rem] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                              <AlertCircle size={16} className="text-amber-500" />
                              Execution Intelligence
                            </label>
                            <div className="bg-amber-50/20 border border-amber-100/50 rounded-2xl p-6 text-sm text-slate-600 leading-relaxed italic shadow-sm">
                              {selectedTask.executionNotes || "No execution notes available."}
                            </div>
                          </section>
                        </div>

                        <div className="lg:col-span-5 space-y-10">
                          <section className="space-y-4">
                            <label className="text-[0.6875rem] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                              <Paperclip size={16} className="text-primary" />
                              Linked Artifacts
                            </label>
                            <div className="grid grid-cols-1 gap-3">
                              {selectedTask.linkedArtifacts?.map((artifact, i) => {
                                const Icon = getIconForType(artifact.type);
                                return (
                                  <div key={i} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-outline-variant/10 hover:border-primary/30 hover:shadow-md transition-all group">
                                    <div className="flex items-center gap-4">
                                      <div className="p-2.5 bg-surface-container-low rounded-xl text-secondary group-hover:text-primary transition-colors border border-outline-variant/10">
                                        <Icon size={18} />
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors">{artifact.name}</span>
                                        <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-tighter">{artifact.size}</span>
                                      </div>
                                    </div>
                                    <ExternalLink size={14} className="text-slate-300 group-hover:text-primary cursor-pointer transition-colors" />
                                  </div>
                                );
                              })}
                              {(!selectedTask.linkedArtifacts || selectedTask.linkedArtifacts.length === 0) && (
                                <p className="text-xs text-slate-400 italic px-2">No linked artifacts.</p>
                              )}
                            </div>
                          </section>

                          <section className="space-y-4">
                            <label className="text-[0.6875rem] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                              <Archive size={16} className="text-primary" />
                              Produced Outputs
                            </label>
                            <div className="grid grid-cols-1 gap-3">
                              {selectedTask.producedOutputs?.map((output, i) => (
                                <div key={i} className={cn(
                                  "flex items-center justify-between p-4 rounded-2xl border transition-all hover:shadow-md",
                                  output.status === 'completed' ? "bg-tertiary-fixed/5 border-tertiary/20" : "bg-surface-container-low border-outline-variant/10"
                                )}>
                                  <div className="flex items-center gap-4">
                                    <div className={cn(
                                      "p-2.5 rounded-xl border shadow-sm",
                                      output.status === 'completed' ? "bg-tertiary text-white border-tertiary" : "bg-slate-100 text-slate-400 border-outline-variant/10"
                                    )}>
                                      {output.status === 'completed' ? <CheckCircle2 size={18} /> : <Clock size={18} />}
                                    </div>
                                    <div className="flex flex-col">
                                      <span className="text-xs font-bold text-on-surface">{output.name}</span>
                                      <span className={cn(
                                        "text-[0.625rem] font-bold uppercase tracking-widest",
                                        output.status === 'completed' ? "text-tertiary" : "text-slate-400"
                                      )}>{output.status}</span>
                                    </div>
                                  </div>
                                  {output.status === 'completed' && (
                                    <Download size={18} className="text-primary cursor-pointer hover:scale-110 transition-transform" />
                                  )}
                                </div>
                              ))}
                              {(!selectedTask.producedOutputs || selectedTask.producedOutputs.length === 0) && (
                                <p className="text-xs text-slate-400 italic px-2">No outputs produced yet.</p>
                              )}
                            </div>
                          </section>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-10">
                      <section className="space-y-6">
                        <div className="flex items-center justify-between">
                          <label className="text-[0.6875rem] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                            <Activity size={16} className="text-primary" />
                            Execution Logs
                          </label>
                          <button className="text-[0.625rem] font-bold text-primary uppercase tracking-widest hover:underline">Download Full Log</button>
                        </div>
                        <div className="bg-slate-950 rounded-2xl p-6 font-mono text-[0.75rem] text-slate-300 space-y-3 shadow-2xl border border-slate-800">
                          {EXECUTION_LOGS.filter(log => log.taskId === selectedTask.id).map((log) => (
                            <div key={log.id} className="flex gap-4 group">
                              <span className="text-slate-600 shrink-0 select-none">[{log.timestamp.split(',')[1].trim()}]</span>
                              <span className={cn(
                                "font-bold shrink-0 uppercase w-16",
                                log.level === 'INFO' ? "text-blue-400" :
                                log.level === 'WARN' ? "text-amber-400" :
                                "text-emerald-400"
                              )}>{log.level}</span>
                              <span className="group-hover:text-white transition-colors">{log.message}</span>
                            </div>
                          ))}
                          {EXECUTION_LOGS.filter(log => log.taskId === selectedTask.id).length === 0 && (
                            <p className="text-slate-500 italic">No execution logs found for this task.</p>
                          )}
                        </div>
                      </section>

                      <section className="space-y-6">
                        <label className="text-[0.6875rem] font-bold uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                          <Lightbulb size={16} className="text-tertiary" />
                          Learning & Skill Updates
                        </label>
                        <div className="grid grid-cols-1 gap-4">
                          {LEARNING_UPDATES.filter(update => update.capabilityId === activeCapability.id).map((update) => (
                            <div key={update.id} className="bg-white border border-outline-variant/15 rounded-2xl p-5 shadow-sm hover:border-primary/30 transition-all group">
                              <div className="flex justify-between items-start mb-3">
                                <div className="flex items-center gap-3">
                                  <div className="p-2 bg-tertiary/10 text-tertiary rounded-xl">
                                    <Zap size={16} />
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors">{update.insight}</h4>
                                    <p className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Source: {update.sourceLogIds.join(', ')}</p>
                                  </div>
                                </div>
                                <span className="text-[0.625rem] font-bold text-slate-300 uppercase tracking-widest">{update.timestamp}</span>
                              </div>
                              <p className="text-xs text-secondary leading-relaxed mb-4">{update.skillUpdate}</p>
                              <div className="flex items-center justify-between pt-4 border-t border-outline-variant/10">
                                <div className="flex items-center gap-2">
                                  <span className="text-[0.625rem] font-bold text-slate-400 uppercase">Impact:</span>
                                  <span className="text-[0.625rem] font-bold text-tertiary bg-tertiary/5 px-2 py-0.5 rounded uppercase tracking-widest">Skill Enhanced</span>
                                </div>
                                <button className="text-[0.625rem] font-bold text-primary flex items-center gap-1 uppercase tracking-widest hover:underline">
                                  Apply to Skill Library
                                  <ChevronRight size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                          {LEARNING_UPDATES.filter(update => update.capabilityId === activeCapability.id).length === 0 && (
                            <div className="p-10 text-center bg-surface-container-low rounded-2xl border border-dashed border-outline-variant/20">
                              <p className="text-xs text-slate-400 italic">No learning updates generated yet.</p>
                            </div>
                          )}
                        </div>
                      </section>
                    </div>
                  )}
                </div>

                <div className="p-8 border-t border-outline-variant/10 bg-surface-container-low flex flex-col sm:flex-row gap-4">
                  <button className="flex-1 py-3.5 rounded-2xl text-xs font-bold bg-white text-primary border border-primary/30 shadow-sm hover:shadow-md hover:border-primary transition-all uppercase tracking-widest">
                    Pause Execution
                  </button>
                  <button className="flex-1 py-3.5 rounded-2xl text-xs font-bold bg-primary text-white shadow-lg shadow-primary/20 hover:brightness-110 hover:shadow-xl transition-all uppercase tracking-widest">
                    Publish Result
                  </button>
                </div>
              </motion.section>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Tasks;
