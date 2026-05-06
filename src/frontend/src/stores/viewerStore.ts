import { create } from 'zustand';
import type { FileTreeItem } from '@/components/explorer/FileTree';

interface ViewerState {
  selectedFile: FileTreeItem | null;
  setSelectedFile: (file: FileTreeItem | null) => void;
  clearSelectedFile: () => void;
}

export const useViewerStore = create<ViewerState>()((set) => ({
  selectedFile: null,
  setSelectedFile: (file) => set({ selectedFile: file }),
  clearSelectedFile: () => set({ selectedFile: null }),
}));
