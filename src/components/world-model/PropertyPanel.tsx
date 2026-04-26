import React from 'react';
import { AlertTriangle, Bot, CheckCircle, Flame, ShieldAlert, BookOpen } from 'lucide-react';

interface WorldModelNode {
  id: string;
  label: string;
  type: string;
  data: any;
}

export default function PropertyPanel({ node, onClose }: { node: WorldModelNode | null, onClose: () => void }) {
  if (!node) {
    return (
      <div className="w-80 h-full bg-white border-l border-slate-200 p-6 flex flex-col items-center justify-center text-slate-400">
        <Bot className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-sm text-center">Select a node in the graph to inspect its properties and Blast Radius impact.</p>
      </div>
    );
  }

  return (
    <div className="w-80 h-full bg-white border-l border-slate-200 shadow-xl overflow-y-auto z-10 flex flex-col custom-scrollbar">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex justify-between items-start sticky top-0 bg-white">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{node.type.replace('Node', '')}</div>
          <h2 className="text-base font-bold text-slate-800 break-all">{node.label}</h2>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400">
          ×
        </button>
      </div>

      {/* Risk Badges */}
      <div className="p-4 border-b border-slate-100 flex flex-wrap gap-2">
        {node.data.riskScore === 'High' && (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded">
            <Flame size={12} /> High Risk
          </span>
        )}
        {node.data.isAiModified && (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-600 text-[10px] font-bold rounded">
            <Bot size={12} /> AI Modified
          </span>
        )}
        {node.data.requiresApproval && (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 text-[10px] font-bold rounded">
            <AlertTriangle size={12} /> Approval Required
          </span>
        )}
      </div>

      {/* Semantic AST Data (Mocked accordion style sections from user design) */}
      <div className="p-4 space-y-6 flex-1">
        
        <div>
          <h3 className="flex items-center gap-2 text-xs font-bold text-slate-800 mb-2">
            <BookOpen size={14} className="text-teal-500"/> AST Info
          </h3>
          <div className="text-xs text-slate-600 space-y-1">
            <p><span className="font-semibold">Kind:</span> {node.data.kind}</p>
            <p className="truncate" title={node.data.filePath}><span className="font-semibold">Path:</span> {node.data.filePath.split('/').pop()}</p>
            {node.data.signature && (
               <div className="mt-2 p-2 bg-slate-50 border border-slate-100 rounded text-[10px] font-mono whitespace-pre-wrap overflow-hidden">
                 {node.data.signature}
               </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="flex items-center justify-between text-xs font-bold text-slate-800 mb-2">
            <span className="flex items-center gap-2"><CheckCircle size={14} className="text-green-500"/> Impacted Tests</span>
            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Passing</span>
          </h3>
          <p className="text-xs text-slate-500 italic">No direct test regressions detected.</p>
        </div>

        <div>
          <h3 className="flex items-center gap-2 text-xs font-bold text-slate-800 mb-2">
            <ShieldAlert size={14} className="text-red-500"/> Governance Risk
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Changes to <span className="font-mono bg-slate-100 px-1 rounded">{node.label}</span> alter core state. Downstream impact to dependent workflows requires a manual quorum approval.
          </p>
        </div>
      </div>

      {/* Footer Evidence */}
      <div className="p-4 border-t border-slate-100 bg-slate-50">
        <h3 className="text-xs font-bold text-slate-800 mb-1">Evidence</h3>
        <p className="text-[10px] text-slate-500 mb-2">Evidence packet generated recently</p>
        <a href="#" className="text-xs text-primary font-bold hover:underline">EV-2025-05-19-1042 ↗</a>
      </div>
    </div>
  );
}
