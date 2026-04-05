import React, { useState } from 'react';
import { 
  Cpu, 
  Zap, 
  ShieldCheck, 
  Plus, 
  CheckCircle2, 
  FileCode, 
  Search,
  BookOpen,
  Settings2,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { useCapability } from '../context/CapabilityContext';
import { cn } from '../lib/utils';
import { SKILL_LIBRARY } from '../constants';
import { Skill } from '../types';

const Studio = () => {
  const { activeCapability } = useCapability();
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [agentName, setAgentName] = useState('');

  const toggleSkill = (skillId: string) => {
    setSelectedSkills(prev => 
      prev.includes(skillId) 
        ? prev.filter(id => id !== skillId) 
        : [...prev, skillId]
    );
  };

  const handleCreateAgent = (e: React.FormEvent) => {
    e.preventDefault();
    alert(`Agent "${agentName}" created with ${selectedSkills.length} skills attached for capability ${activeCapability.name}`);
    setAgentName('');
    setSelectedSkills([]);
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[0.625rem] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">Agent Studio</span>
            <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{activeCapability.id}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-on-surface tracking-tight">Agent Authoring & Skill Library</h1>
          <p className="text-sm text-secondary font-medium">Design specialized agents and manage capability-specific skill sets.</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Special Agent & Capability Skills */}
        <div className="lg:col-span-8 space-y-8">
          {/* Special Agent Card */}
          <section className="bg-white rounded-3xl border border-outline-variant/15 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-outline-variant/10 bg-primary/5 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary text-white rounded-xl">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-primary">Capability Specialist</h3>
                  <p className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Primary Knowledge Agent</p>
                </div>
              </div>
              <span className="text-xs font-bold text-primary bg-primary/10 px-3 py-1 rounded-full uppercase">Active</span>
            </div>
            <div className="p-8 flex flex-col md:flex-row gap-8 items-center">
              <div className="w-24 h-24 rounded-2xl bg-surface-container-high flex items-center justify-center text-primary border-2 border-primary/20 shadow-inner shrink-0">
                <Cpu size={48} />
              </div>
              <div className="space-y-4 flex-1">
                <div>
                  <h4 className="text-xl font-bold text-on-surface">{activeCapability.specialAgentId || 'UNASSIGNED'}</h4>
                  <p className="text-sm text-secondary">This agent is pre-configured with deep context for {activeCapability.name}. It serves as the primary orchestrator for all sub-agents created within this capability.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeCapability.skillLibrary.map(skill => (
                    <span key={skill.id} className="text-[0.625rem] font-bold text-primary bg-primary/5 border border-primary/10 px-2 py-1 rounded uppercase">
                      {skill.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Skill Library Section */}
          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-primary flex items-center gap-2">
                <BookOpen size={20} />
                Capability Skill Library
              </h3>
              <button className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                <Plus size={14} /> Add New Skill File
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeCapability.skillLibrary.map(skill => (
                <div key={skill.id} className="p-5 bg-white rounded-2xl border border-outline-variant/15 shadow-sm hover:border-primary/30 transition-all group">
                  <div className="flex justify-between items-start mb-3">
                    <div className="p-2 bg-surface-container-low rounded-lg text-primary group-hover:bg-primary group-hover:text-white transition-all">
                      <FileCode size={18} />
                    </div>
                    <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">v{skill.version}</span>
                  </div>
                  <h4 className="font-bold text-on-surface mb-1">{skill.name}</h4>
                  <p className="text-xs text-secondary leading-relaxed mb-4">{skill.description}</p>
                  <div className="flex items-center justify-between pt-3 border-t border-outline-variant/10">
                    <span className="text-[0.625rem] font-bold text-slate-400 uppercase">{skill.category}</span>
                    <button className="text-[0.625rem] font-bold text-primary uppercase tracking-widest flex items-center gap-1">
                      Edit Logic <ChevronRight size={12} />
                    </button>
                  </div>
                </div>
              ))}
              {activeCapability.skillLibrary.length === 0 && (
                <div className="col-span-full py-12 text-center bg-surface-container-low/30 rounded-3xl border-2 border-dashed border-outline-variant/20">
                  <p className="text-sm text-secondary">No specific skills defined for this capability yet.</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Agent Creation */}
        <div className="lg:col-span-4 space-y-8">
          <section className="bg-white rounded-3xl border border-outline-variant/15 shadow-sm p-6 sticky top-24">
            <h3 className="text-lg font-bold text-primary mb-6 flex items-center gap-2">
              <Settings2 size={20} />
              Create New Agent
            </h3>
            <form onSubmit={handleCreateAgent} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">Agent Identity</label>
                <input 
                  required
                  type="text" 
                  value={agentName}
                  onChange={e => setAgentName(e.target.value)}
                  placeholder="e.g. Compliance_Sentinel_01"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                />
              </div>

              <div className="space-y-3">
                <label className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest flex justify-between">
                  Attach Skills
                  <span className="text-primary">{selectedSkills.length} Selected</span>
                </label>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {SKILL_LIBRARY.map(skill => (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleSkill(skill.id)}
                      className={cn(
                        "w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left",
                        selectedSkills.includes(skill.id) 
                          ? "bg-primary/5 border-primary shadow-sm" 
                          : "bg-surface-container-lowest border-outline-variant/10 hover:border-primary/30"
                      )}
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-bold text-on-surface">{skill.name}</span>
                        <span className="text-[0.625rem] text-slate-400">{skill.category}</span>
                      </div>
                      {selectedSkills.includes(skill.id) && (
                        <CheckCircle2 size={16} className="text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck size={16} className="text-tertiary" />
                  <span className="text-[0.625rem] font-bold text-tertiary uppercase tracking-widest">Context Injection</span>
                </div>
                <p className="text-[0.6875rem] text-secondary leading-relaxed">
                  This agent will be automatically attached to the <span className="font-bold text-on-surface">{activeCapability.name}</span> context. All execution prompts will be pre-pended with capability-specific governance rules.
                </p>
              </div>

              <button 
                type="submit"
                disabled={!agentName}
                className="w-full py-4 bg-primary text-white rounded-2xl font-bold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Plus size={20} />
                Initialize Agent
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Studio;
