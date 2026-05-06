import { create } from 'zustand';
import type { AgentEvent } from '../types/agent_event';

const MAX_EVENTS_PER_SESSION = 100;
// How long to consider an agent "active" after last event (in ms)
const ACTIVITY_TIMEOUT = 90000;

interface AgentEventState {
  // Events indexed by session_id
  eventsBySession: Record<string, AgentEvent[]>;

  // Latest event per session for quick access
  latestEventBySession: Record<string, AgentEvent>;

  // Add a new event
  addEvent: (event: AgentEvent) => void;

  // Get events for a session
  getEventsForSession: (sessionId: string) => AgentEvent[];

  // Get the latest event for a session
  getLatestEvent: (sessionId: string) => AgentEvent | null;

  // Check if an agent is currently active (recent PostToolUse event)
  isAgentActive: (sessionId: string) => boolean;

  // Get all active sessions
  getActiveSessions: () => string[];

  // Clear events for a session
  clearSession: (sessionId: string) => void;

  // Clear all events
  clearAll: () => void;
}

export const useAgentEventStore = create<AgentEventState>((set, get) => ({
  eventsBySession: {},
  latestEventBySession: {},

  addEvent: (event) =>
    set((state) => {
      const sessionId = event.session_id;
      const existing = state.eventsBySession[sessionId] || [];

      // Add new event and limit size
      const updated = [event, ...existing].slice(0, MAX_EVENTS_PER_SESSION);

      return {
        eventsBySession: {
          ...state.eventsBySession,
          [sessionId]: updated,
        },
        latestEventBySession: {
          ...state.latestEventBySession,
          [sessionId]: event,
        },
      };
    }),

  getEventsForSession: (sessionId) => {
    return get().eventsBySession[sessionId] || [];
  },

  getLatestEvent: (sessionId) => {
    return get().latestEventBySession[sessionId] || null;
  },

  isAgentActive: (sessionId) => {
    const latestEvent = get().latestEventBySession[sessionId];
    if (!latestEvent) return false;

    // Check if the event is recent and not a Stop event
    const eventTime = new Date(latestEvent.timestamp).getTime();
    const now = Date.now();
    const isRecent = now - eventTime < ACTIVITY_TIMEOUT;
    const isWorking = latestEvent.event_type === 'PostToolUse';

    return isRecent && isWorking;
  },

  getActiveSessions: () => {
    const state = get();
    return Object.keys(state.latestEventBySession).filter(sessionId =>
      state.isAgentActive(sessionId)
    );
  },

  clearSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _events, ...restEvents } = state.eventsBySession;
      const { [sessionId]: _latest, ...restLatest } = state.latestEventBySession;
      return {
        eventsBySession: restEvents,
        latestEventBySession: restLatest,
      };
    }),

  clearAll: () => set({ eventsBySession: {}, latestEventBySession: {} }),
}));
