import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Panel layout (client state, persisted).
 *
 * Constraint constants live HERE, next to the persisted values they bound.
 * Sizes are clamped on every write AND on rehydrate (migrate), so stale
 * persisted values from older constraint regimes can never feed the panel
 * library an out-of-range size (the cause of the inverted ARIA separator
 * ranges: persisted 51% right panel vs. a 40% max).
 */

export const PANEL_BOUNDS = {
  LEFT_MIN: 10,
  LEFT_MAX: 25,
  RIGHT_MIN: 15,
  RIGHT_MAX: 40,
  CENTER_MIN: 30,
  COLLAPSED_SIZE: 3,
} as const;

const clampLeft = (size: number) =>
  Math.min(PANEL_BOUNDS.LEFT_MAX, Math.max(PANEL_BOUNDS.LEFT_MIN, size));
const clampRight = (size: number) =>
  Math.min(PANEL_BOUNDS.RIGHT_MAX, Math.max(PANEL_BOUNDS.RIGHT_MIN, size));

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
      leftPanelSize: 16,
      rightPanelSize: 25,
      activityPanelCollapsed: false,
      setLeftPanelSize: (size) => set({ leftPanelSize: clampLeft(size) }),
      setRightPanelSize: (size) => set({ rightPanelSize: clampRight(size) }),
      toggleActivityPanel: () =>
        set((state) => ({ activityPanelCollapsed: !state.activityPanelCollapsed })),
      setActivityPanelCollapsed: (collapsed) => set({ activityPanelCollapsed: collapsed }),
    }),
    {
      name: 'soren-layout',
      version: 4,
      migrate: (persisted: unknown) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        const { advancedMode: _, ...clean } = state;
        const left = typeof clean.leftPanelSize === 'number' ? clean.leftPanelSize : 16;
        const right = typeof clean.rightPanelSize === 'number' ? clean.rightPanelSize : 25;
        return {
          activityPanelCollapsed: Boolean(clean.activityPanelCollapsed),
          leftPanelSize: clampLeft(left),
          rightPanelSize: clampRight(right),
        } as unknown as LayoutState;
      },
    }
  )
);
