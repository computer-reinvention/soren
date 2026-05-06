import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { FilesystemItem } from '@/types/filesystem';

export function useFilesystem(path?: string) {
  return useQuery({
    queryKey: ['filesystem', path],
    queryFn: () => api.getFilesystem(path),
    staleTime: 30000,
  });
}

export function useFileContent(path: string | null) {
  return useQuery({
    queryKey: ['file-content', path],
    queryFn: () => api.getFileContent(path!),
    enabled: !!path,
    staleTime: 5000,
  });
}

// Helper to convert flat filesystem response to tree structure
export function buildFileTree(items: FilesystemItem[]): FilesystemItem[] {
  return items.sort((a, b) => {
    // Directories first, then alphabetically
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}
