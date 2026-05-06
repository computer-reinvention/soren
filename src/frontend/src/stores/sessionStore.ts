import { create } from 'zustand';
import type { Session } from '../types/session';

interface SessionState {
  sessions: Session[];
  selectedSessionId: string | null;
  setSessions: (sessions: Session[]) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  selectSession: (id: string | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  selectedSessionId: null,

  setSessions: (sessions) => set({ sessions }),

  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, ...updates } : session
      ),
    })),

  addSession: (session) =>
    set((state) => ({
      sessions: [...state.sessions, session],
    })),

  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
    })),

  selectSession: (id) => set({ selectedSessionId: id }),
}));
