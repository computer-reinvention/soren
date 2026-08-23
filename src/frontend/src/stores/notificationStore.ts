import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Browser-notification preference (client state, persisted). */
interface NotificationState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      enabled: false,
      setEnabled: (enabled) => set({ enabled }),
    }),
    { name: 'soren-notifications' }
  )
);
