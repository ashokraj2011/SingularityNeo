type SessionScope = 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';

export interface CopilotSessionSummarySeed {
  sessionId: string;
  agentId?: string;
  agentName: string;
  scope: SessionScope;
  scopeId?: string;
  lastUsedAt: string;
  createdAt?: string;
  model: string;
  requestCount: number;
  totalTokens: number;
  hasStoredSummary: boolean;
  hasLiveSession: boolean;
}

export interface CopilotSessionMonitorRow {
  sessionId: string;
  agentId?: string;
  agentName: string;
  scope: SessionScope;
  scopeId?: string;
  lastUsedAt: string;
  createdAt?: string;
  model: string;
  requestCount: number;
  totalTokens: number;
  live: boolean;
  resumable: boolean;
  state: 'ACTIVE' | 'STORED';
}

export interface CopilotSessionMonitorSummary {
  activeSessionCount: number;
  storedSessionCount: number;
  resumableSessionCount: number;
  totalTokens: number;
  generalChatCount: number;
  workItemCount: number;
  taskCount: number;
}

export const buildCopilotSessionMonitorData = (
  sessions: CopilotSessionSummarySeed[],
): {
  sessions: CopilotSessionMonitorRow[];
  summary: CopilotSessionMonitorSummary;
} => {
  const rows = [...sessions]
    .map<CopilotSessionMonitorRow>(session => ({
      sessionId: session.sessionId,
      agentId: session.agentId,
      agentName: session.agentName,
      scope: session.scope,
      scopeId: session.scopeId,
      lastUsedAt: session.lastUsedAt,
      createdAt: session.createdAt,
      model: session.model,
      requestCount: session.requestCount,
      totalTokens: session.totalTokens,
      live: session.hasLiveSession,
      resumable: session.hasStoredSummary,
      state: session.hasLiveSession ? 'ACTIVE' : 'STORED',
    }))
    .sort(
      (left, right) =>
        new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime(),
    );

  return {
    sessions: rows,
    summary: {
      activeSessionCount: sessions.filter(session => session.hasLiveSession).length,
      storedSessionCount: sessions.filter(session => session.hasStoredSummary).length,
      resumableSessionCount: sessions.filter(session => session.hasStoredSummary).length,
      totalTokens: rows.reduce((total, session) => total + session.totalTokens, 0),
      generalChatCount: rows.filter(session => session.scope === 'GENERAL_CHAT').length,
      workItemCount: rows.filter(session => session.scope === 'WORK_ITEM').length,
      taskCount: rows.filter(session => session.scope === 'TASK').length,
    },
  };
};
