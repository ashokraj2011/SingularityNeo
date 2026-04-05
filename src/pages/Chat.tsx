import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  User, 
  Cpu, 
  Sparkles, 
  Paperclip, 
  MoreHorizontal,
  ChevronRight,
  MessageSquare,
  Zap,
  Search
} from 'lucide-react';
import { useCapability } from '../context/CapabilityContext';
import { cn } from '../lib/utils';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  agentName?: string;
}

const Chat = () => {
  const { activeCapability } = useCapability();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'agent',
      content: `Hello! I am the specialized agent for ${activeCapability.name}. How can I assist you with your delivery orchestration today?`,
      timestamp: 'Just now',
      agentName: activeCapability.specialAgentId || 'Capability Specialist'
    }
  ]);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: 'Just now'
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');

    // Simulate agent response
    setTimeout(() => {
      const agentMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: `I've analyzed your request within the context of ${activeCapability.name}. I'm currently cross-referencing the active blueprints and artifact hand-off protocols to provide the most accurate guidance.`,
        timestamp: 'Just now',
        agentName: activeCapability.specialAgentId || 'Capability Specialist'
      };
      setMessages(prev => [...prev, agentMessage]);
    }, 1000);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] gap-6">
      <header className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[0.625rem] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">Agent Chat</span>
            <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{activeCapability.id}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-on-surface tracking-tight">Interactive Orchestration</h1>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-white border border-outline-variant/10 rounded-xl text-xs font-bold text-secondary hover:bg-surface-container-low transition-all flex items-center gap-2">
            <Zap size={14} className="text-primary" />
            Switch Agent
          </button>
        </div>
      </header>

      <div className="flex-1 flex gap-8 min-h-0">
        {/* Chat Area */}
        <div className="flex-1 flex flex-col bg-white rounded-3xl border border-outline-variant/15 shadow-sm overflow-hidden">
          {/* Search History */}
          <div className="px-6 py-4 border-b border-outline-variant/10 bg-surface-container-lowest/30">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chat history..."
                className="w-full bg-surface-container-low border border-outline-variant/10 rounded-xl pl-10 pr-4 py-2 text-xs focus:ring-2 focus:ring-primary/20 transition-all outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {messages.filter(msg => msg.content.toLowerCase().includes(searchQuery.toLowerCase())).map((msg) => (
              <div 
                key={msg.id} 
                className={cn(
                  "flex gap-4 max-w-[80%]",
                  msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm",
                  msg.role === 'user' ? "bg-primary text-white" : "bg-surface-container-high text-primary border border-primary/10"
                )}>
                  {msg.role === 'user' ? <User size={20} /> : <Cpu size={20} />}
                </div>
                <div className="space-y-1">
                  <div className={cn(
                    "flex items-center gap-2 mb-1",
                    msg.role === 'user' ? "justify-end" : "justify-start"
                  )}>
                    <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">
                      {msg.role === 'user' ? 'You' : msg.agentName}
                    </span>
                    <span className="text-[0.625rem] text-slate-300">{msg.timestamp}</span>
                  </div>
                  <div className={cn(
                    "p-4 rounded-2xl text-sm leading-relaxed",
                    msg.role === 'user' 
                      ? "bg-primary text-white rounded-tr-none" 
                      : "bg-surface-container-low text-on-surface rounded-tl-none border border-outline-variant/5"
                  )}>
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-6 border-t border-outline-variant/10 bg-surface-container-lowest">
            <form onSubmit={handleSend} className="relative">
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Message the ${activeCapability.name} specialist...`}
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded-2xl pl-12 pr-24 py-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none shadow-inner"
              />
              <button 
                type="button"
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors"
              >
                <Paperclip size={20} />
              </button>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2">
                <button 
                  type="submit"
                  disabled={!input.trim()}
                  className="bg-primary text-white p-2.5 rounded-xl shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
                >
                  <Send size={18} />
                </button>
              </div>
            </form>
            <p className="text-[0.625rem] text-center text-slate-400 mt-3 font-medium uppercase tracking-widest">
              Agent responses are governed by the {activeCapability.name} security protocol.
            </p>
          </div>
        </div>

        {/* Sidebar Context */}
        <div className="w-80 flex flex-col gap-6">
          <section className="bg-white rounded-3xl border border-outline-variant/15 shadow-sm p-6">
            <h3 className="text-sm font-bold text-primary mb-4 flex items-center gap-2 uppercase tracking-widest">
              <Sparkles size={16} />
              Active Context
            </h3>
            <div className="space-y-4">
              <div className="p-3 bg-surface-container-low rounded-xl border border-outline-variant/5">
                <p className="text-[0.625rem] font-bold text-slate-400 uppercase mb-1">Capability</p>
                <p className="text-xs font-bold text-on-surface">{activeCapability.name}</p>
              </div>
              <div className="p-3 bg-surface-container-low rounded-xl border border-outline-variant/5">
                <p className="text-[0.625rem] font-bold text-slate-400 uppercase mb-1">Primary Agent</p>
                <p className="text-xs font-bold text-on-surface">{activeCapability.specialAgentId}</p>
              </div>
              <div className="p-3 bg-surface-container-low rounded-xl border border-outline-variant/5">
                <p className="text-[0.625rem] font-bold text-slate-400 uppercase mb-1">Security Level</p>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-success rounded-full" />
                  <p className="text-xs font-bold text-on-surface">Standard Governance</p>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-3xl border border-outline-variant/15 shadow-sm p-6 flex-1 overflow-hidden flex flex-col">
            <h3 className="text-sm font-bold text-primary mb-4 flex items-center gap-2 uppercase tracking-widest">
              <MessageSquare size={16} />
              Recent Learning
            </h3>
            <div className="space-y-3 overflow-y-auto custom-scrollbar pr-2">
              {[
                'Updated risk model for volatility spikes.',
                'Refined hand-off protocol for Q3 ledgers.',
                'New compliance rule for Basel III v4.'
              ].map((item, i) => (
                <div key={i} className="p-3 bg-surface-container-low rounded-xl border border-outline-variant/5 hover:border-primary/20 transition-all cursor-pointer group">
                  <p className="text-[0.6875rem] text-secondary leading-snug group-hover:text-primary transition-colors">{item}</p>
                  <span className="text-[0.5rem] text-slate-300 uppercase font-bold">2h ago</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Chat;
