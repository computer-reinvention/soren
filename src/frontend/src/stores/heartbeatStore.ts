import { create } from 'zustand';

export interface HeartbeatData {
  timestamp: number;
  sections: Record<string, string>;
  highest_priority: string | null;
  all_clear: boolean;
  received_at: string;
  /** Epoch ms when the client received this heartbeat (set by the store). */
  clientReceivedAt: number;
}

interface HeartbeatState {
  latest: HeartbeatData | null;
  setLatest: (data: Omit<HeartbeatData, 'clientReceivedAt'>) => void;
}

export const useHeartbeatStore = create<HeartbeatState>((set) => ({
  latest: null,
  setLatest: (data) => set({ latest: { ...data, clientReceivedAt: Date.now() } }),
}));
