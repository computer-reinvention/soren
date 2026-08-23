import { create } from 'zustand';
import type { Agent, ArchivedAgentSummary } from '@/types/agent';

/**
 * Server-cache store for agent data, fed by REST snapshots (useAgents) and
 * WebSocket deltas (useWebSocket). Holds DATA ONLY — selection state lives in
 * the URL (see lib/navigation.ts), not here.
 */
interface AgentState {
  agents: Agent[];
  archivedAgents: ArchivedAgentSummary[];
  setAgents: (agents: Agent[]) => void;
  /** Idempotent merge-by-id; unknown ids are ignored (snapshot owns membership). */
  updateAgent: (agentId: string, updates: Partial<Agent>) => void;
  setArchivedAgents: (agents: ArchivedAgentSummary[]) => void;
  addArchivedAgent: (agent: ArchivedAgentSummary) => void;
}

export const useAgentStore = create<AgentState>()((set) => ({
  agents: [],
  archivedAgents: [],

  setAgents: (agents) => set({ agents }),

  updateAgent: (agentId, updates) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === agentId ? { ...a, ...updates } : a)),
    })),

  setArchivedAgents: (archivedAgents) => set({ archivedAgents }),

  addArchivedAgent: (agent) =>
    set((state) => ({
      archivedAgents: state.archivedAgents.some((a) => a.id === agent.id)
        ? state.archivedAgents
        : [agent, ...state.archivedAgents],
    })),
}));
