import { create } from 'zustand';
import type { Agent, ArchivedAgentSummary } from '../types/agent';
import { useViewerStore } from './viewerStore';

interface AgentState {
  agents: Agent[];
  selectedAgentId: string | null;
  archivedAgents: ArchivedAgentSummary[];
  viewingArchivedId: string | null;
  setAgents: (agents: Agent[]) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  selectAgent: (id: string | null) => void;
  setArchivedAgents: (agents: ArchivedAgentSummary[]) => void;
  addArchivedAgent: (agent: ArchivedAgentSummary) => void;
  viewArchive: (id: string | null) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  selectedAgentId: null,
  archivedAgents: [],
  viewingArchivedId: null,

  setAgents: (agents) => set({ agents }),

  updateAgent: (id, updates) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === id ? { ...agent, ...updates } : agent
      ),
    })),

  selectAgent: (id) => {
    // Clear file selection and archived view when switching to an agent
    useViewerStore.getState().clearSelectedFile();
    set({ selectedAgentId: id, viewingArchivedId: null });
  },

  setArchivedAgents: (agents) => set({ archivedAgents: agents }),

  addArchivedAgent: (agent) =>
    set((state) => {
      // Avoid duplicates
      if (state.archivedAgents.some((a) => a.id === agent.id)) {
        return state;
      }
      return { archivedAgents: [agent, ...state.archivedAgents] };
    }),

  viewArchive: (id) => {
    // Clear file selection when viewing archive
    useViewerStore.getState().clearSelectedFile();
    set({ viewingArchivedId: id, selectedAgentId: null });
  },
}));
