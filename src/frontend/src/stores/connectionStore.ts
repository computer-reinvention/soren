import { create } from 'zustand';

interface ConnectionState {
  isConnected: boolean;
  isReconnecting: boolean;
  setConnected: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  isConnected: false,
  isReconnecting: false,
  setConnected: (isConnected) => set({ isConnected }),
  setReconnecting: (isReconnecting) => set({ isReconnecting }),
}));
