import { create } from 'zustand';

export interface HeartbeatData {
  timestamp: number;
  sections: Record<string, string>;
  highest_priority: string | null;
  all_clear: boolean;
  received_at: string;
}

interface HeartbeatState {
  latest: HeartbeatData | null;
  setLatest: (data: HeartbeatData) => void;
}

export const useHeartbeatStore = create<HeartbeatState>((set) => ({
  latest: null,
  setLatest: (data) => set({ latest: data }),
}));
