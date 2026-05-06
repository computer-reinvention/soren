import { create } from 'zustand';

export interface Thought {
  id: string;
  agent_name: string;
  thought_type: 'reasoning' | 'tool_result';
  content?: string | null;
  tool_name?: string | null;
  tool_input?: string | null;
  tool_response?: string | null;
  timestamp: string;
}

const MAX_THOUGHTS = 500;

interface ThoughtState {
  thoughts: Thought[];
  addThought: (thought: Thought) => void;
  addThoughts: (thoughts: Thought[]) => void;
  clear: () => void;
}

export const useThoughtStore = create<ThoughtState>((set) => ({
  thoughts: [],

  addThought: (thought) =>
    set((state) => {
      // Deduplicate by ID
      if (state.thoughts.some((t) => t.id === thought.id)) {
        return state;
      }
      return {
        thoughts: [...state.thoughts, thought].slice(-MAX_THOUGHTS),
      };
    }),

  addThoughts: (newThoughts) =>
    set((state) => {
      const existingIds = new Set(state.thoughts.map((t) => t.id));
      const unique = newThoughts.filter((t) => !existingIds.has(t.id));
      if (unique.length === 0) return state;
      // Merge and sort by timestamp, keep most recent MAX_THOUGHTS
      const merged = [...state.thoughts, ...unique]
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-MAX_THOUGHTS);
      return { thoughts: merged };
    }),

  clear: () => set({ thoughts: [] }),
}));
