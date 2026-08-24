import { create } from 'zustand';

/**
 * Mobile chrome state (P4.1). Not persisted — sheets always start closed on
 * load/refresh. Only relevant when the mobile layout branch is mounted
 * (see App.tsx Shell); desktop never reads this.
 *
 * Opening one sheet closes the other — on a phone-sized viewport there's
 * only room for one overlay at a time.
 */
interface MobileNavState {
  sidebarOpen: boolean;
  activityOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setActivityOpen: (open: boolean) => void;
}

export const useMobileNavStore = create<MobileNavState>((set) => ({
  sidebarOpen: false,
  activityOpen: false,
  setSidebarOpen: (open) =>
    set((state) => ({ sidebarOpen: open, activityOpen: open ? false : state.activityOpen })),
  setActivityOpen: (open) =>
    set((state) => ({ activityOpen: open, sidebarOpen: open ? false : state.sidebarOpen })),
}));
