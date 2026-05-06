import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LayoutState {
  leftPanelSize: number;
  rightPanelSize: number;
  activityPanelCollapsed: boolean;
  setLeftPanelSize: (size: number) => void;
  setRightPanelSize: (size: number) => void;
  toggleActivityPanel: () => void;
  setActivityPanelCollapsed: (collapsed: boolean) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      leftPanelSize: 15,
      rightPanelSize: 25,
      activityPanelCollapsed: false,
      setLeftPanelSize: (size) => set({ leftPanelSize: size }),
      setRightPanelSize: (size) => set({ rightPanelSize: size }),
      toggleActivityPanel: () => set((state) => ({ activityPanelCollapsed: !state.activityPanelCollapsed })),
      setActivityPanelCollapsed: (collapsed) => set({ activityPanelCollapsed: collapsed }),
    }),
    {
      name: 'soren-layout',
      version: 3,
      migrate: (persisted: unknown) => {
        const state = persisted as Record<string, unknown>;
        const { advancedMode: _, ...clean } = state;
        return {
          leftPanelSize: 15,
          rightPanelSize: 25,
          activityPanelCollapsed: false,
          ...clean,
        } as unknown as LayoutState;
      },
    }
  )
);
