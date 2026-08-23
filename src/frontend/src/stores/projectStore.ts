import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Project FILTER (client state, persisted so it survives refresh).
 * null = all projects. This is a display filter only — it never implies
 * which agent/file is selected (that's the URL's job).
 */
interface ProjectState {
  selectedProjectId: string | null;
  selectProject: (id: string | null) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      selectedProjectId: null,
      selectProject: (id) => set({ selectedProjectId: id }),
    }),
    { name: 'soren-project' }
  )
);
